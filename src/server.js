import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, parse, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';
import { splitScenesWithOpenAI } from './llm/openai.js';
import { heuristicScenesFromScript } from './scenes.js';
import { generateAiImages } from './media/openaiImages.js';
import { fetchPexelsImages, fetchPexelsVideos } from './media/pexels.js';
import { fetchBrightDataGoogleImages } from './media/brightData.js';
import { writeAllPremiereXmls } from './premiere/writeXmls.js';
import { writePremiereXml } from './premiere/fcpXml.js';
import { renderSelectedStoryboardVideo } from './video/ffmpeg.js';
import { uploadJobDirectoryToDrive } from './google/drive.js';
import { createDryRunAssets } from './dryRunAssets.js';
import {
  compactRunId,
  ensureDir,
  guessMimeType,
  slugify,
  writeJson,
  writeText
} from './utils/files.js';

const PORT = Number(process.env.PORT || 8787);
const ROOT = resolve('.');
const WEB_ROOT = resolve('web');
const config = loadConfig();
const jobs = new Map();
const execFileAsync = promisify(execFile);

const server = createServer(async (request, response) => {
  applyCors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log('[web] listo en http://localhost:' + PORT);
});

async function route(request, response) {
  const url = new URL(request.url, 'http://localhost:' + PORT);

  if (url.pathname === '/api/health') {
    const preflight = await getPreflight();
    return sendJson(response, 200, {
      ok: true,
      apiReady: preflight.requiredReady,
      driveReady: preflight.checks.drive.ready,
      videoEnabled: config.video.enabled,
      outputRoot: config.outputRoot
    });
  }

  if (url.pathname === '/api/preflight' && request.method === 'GET') {
    return sendJson(response, 200, await getPreflight());
  }

  if (url.pathname === '/api/jobs' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const job = createJob(body);
    runJob(job).catch((error) => updateJob(job, { status: 'error', phase: 'error', error: error.message }));
    return sendJson(response, 202, publicJob(job));
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(.*))?$/);
  if (jobMatch) {
    const jobId = decodeURIComponent(jobMatch[1]);
    const action = jobMatch[2] || '';
    const job = loadJob(jobId);
    if (!job) return sendJson(response, 404, { error: 'Job no encontrado' });

    if (!action && request.method === 'GET') return sendJson(response, 200, publicJob(job));

    if (action === 'file' && request.method === 'GET') {
      return sendJobFile(response, job, url.searchParams.get('path') || '', request);
    }

    if (action === 'scenes' && request.method === 'PATCH') {
      const body = await readJsonBody(request, 20 * 1024 * 1024);
      const scenes = updateJobScenes(job, body.scenes || []);
      debugEvent(job, 'scenes_edit', 'ok', {
        sceneCount: scenes.length,
        files: ['scenes.json', 'scenes.txt'],
        assetsPreserved: Boolean(job.assets)
      });
      return sendJson(response, 200, publicJob(job));
    }

    if (action === 'assets' && request.method === 'POST') {
      const body = await readJsonBody(request, 4 * 1024 * 1024);
      startAssetGeneration(job, body).catch((error) => updateJob(job, { status: 'error', phase: 'assets_error', error: error.message }));
      return sendJson(response, 202, publicJob(job));
    }

    if (action === 'import-asset' && request.method === 'POST') {
      const body = await readJsonBody(request, 80 * 1024 * 1024);
      const asset = importJobAsset(job, body);
      debugEvent(job, 'asset_import', 'ok', {
        scene_id: asset.scene_id,
        type: asset.type,
        file: relative(job.jobDir, asset.path).replace(/\\/g, '/')
      });
      return sendJson(response, 200, publicJob(job));
    }

    if (action === 'render' && request.method === 'POST') {
      const body = await readJsonBody(request, 300 * 1024 * 1024);
      startRender(job, body).catch((error) => updateJob(job, { status: 'error', phase: 'render_error', error: error.message }));
      return sendJson(response, 202, publicJob(job));
    }

    if (action === 'download' && request.method === 'GET') {
      const zip = buildDownloadZip(job, url.searchParams.get('kind') || 'all');
      return sendJobFile(response, job, relative(job.jobDir, zip.path).replace(/\\/g, '/'), request);
    }

    return sendJson(response, 404, { error: 'Ruta de job no encontrada' });
  }

  if (request.method === 'GET') return serveStatic(response, url.pathname);
  return sendJson(response, 405, { error: 'Metodo no permitido' });
}

function createJob(body) {
  const scriptText = String(body.scriptText || '').trim();
  if (!scriptText) throw new Error('Pegá un guión antes de ejecutar');

  const title = String(body.title || inferTitle(scriptText));
  const runId = body.runId || compactRunId();
  const jobId = runId + '-' + (slugify(title) || 'guion');
  const jobDir = resolve(config.outputRoot, jobId);
  ensureDir(jobDir);

  const job = {
    id: jobId,
    runId,
    title,
    jobDir,
    dryRun: Boolean(body.dryRun),
    autoAssets: Boolean(body.autoAssets),
    imageStylePrompt: String(body.imageStylePrompt || config.imageStylePrompt || '').trim(),
    estimatedSceneCount: estimateSceneCount(scriptText),
    status: 'queued',
    phase: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scenes: [],
    assets: null,
    xmlFiles: [],
    video: null,
    drive: null,
    error: null,
    debug: { events: [] }
  };

  jobs.set(jobId, job);
  writeText(join(jobDir, 'script.txt'), scriptText + '\n');
  saveJob(job);
  debugEvent(job, 'job_created', 'ok', {
    title,
    dryRun: job.dryRun,
    runId,
    scriptCharacters: scriptText.length,
    config: safeConfigSummary()
  });
  return job;
}

async function runJob(job) {
  try {
    const scriptText = readFileSync(join(job.jobDir, 'script.txt'), 'utf8');
    debugEvent(job, 'script_loaded', 'ok', {
      scriptCharacters: scriptText.length,
      scriptPreview: scriptText.slice(0, 500)
    });

    const sceneProgress = startEstimatedSceneProgress(job, scriptText);
    debugEvent(job, 'scenes', 'start', {
      mode: job.dryRun ? 'dry-run heuristic' : 'OpenAI GPT',
      textModel: config.openai.textModel,
      promptStyle: job.imageStylePrompt || config.imageStylePrompt,
      estimatedScenes: job.estimatedSceneCount
    });

    let rawScenes;
    try {
      rawScenes = job.dryRun
        ? heuristicScenesFromScript(scriptText, config)
        : await splitScenesWithOpenAI(scriptText, { ...config, imageStylePrompt: job.imageStylePrompt || config.imageStylePrompt });
    } finally {
      sceneProgress.stop();
    }

    const scenes = normalizeScenes(rawScenes, job.runId, job.scenes);
    writeScenesFiles(job, scenes);
    debugEvent(job, 'scenes', 'ok', {
      sceneCount: scenes.length,
      scenes: scenes.map((scene) => ({
        scene_id: scene.scene_id,
        scene_label: scene.scene_label,
        duration_seconds: scene.duration_seconds,
        search_query: scene.search_query,
        google_image_query: scene.google_image_query,
        image_prompt: scene.image_prompt,
        script_text: scene.script_text
      })),
      files: ['scenes.json', 'scenes.txt']
    });

    if (!job.autoAssets) {
      updateJob(job, {
        scenes,
        assets: null,
        xmlFiles: [],
        status: 'scenes_ready',
        phase: 'Escenas listas para editar',
        progress: 100
      });
      debugEvent(job, 'job_scenes_ready', 'ok', {
        sceneCount: scenes.length,
        nextStep: 'POST /api/jobs/' + job.id + '/assets'
      });
      return;
    }

    await generateAssetsAndXml(job, scenes);
  } catch (error) {
    debugEvent(job, 'job', 'error', { message: error.message, stack: error.stack });
    throw error;
  }
}

async function startRender(job, body) {
  if (job.status === 'rendering') return;
  updateJob(job, { status: 'rendering', phase: 'Renderizando video', progress: 100, error: null });

  try {
    const subtitleStyle = normalizeSubtitleStyle(body.subtitleStyle || {});
    const renderConfig = withSubtitleStyle(config, subtitleStyle);
    const selections = body.selections || {};
    const selectionPlan = normalizeSelectionPlan(job, selections);
    const renderClips = buildRenderClips(job, selectionPlan);
    const selectedAssets = renderClips.map((clip) => clip.asset);
    debugEvent(job, 'render', 'start', {
      dryRun: job.dryRun,
      scenes: job.scenes.length,
      clips: renderClips.map((clip) => ({
        type: clip.asset?.type,
        scene_id: clip.scene.scene_id,
        file_name: clip.asset?.file_name || clip.asset?.name,
        durationSeconds: clip.durationSeconds,
        startSeconds: clip.startSeconds
      })),
      audioMode: body.audioMode || 'full',
      hasAudio: Boolean(body.audio?.dataBase64),
      sceneAudioCount: Object.values(body.sceneAudios || {}).filter((item) => item?.dataBase64).length,
      ffmpegPath: config.video.ffmpegPath,
      subtitles: subtitleStyle
    });

    const audioMode = body.audioMode === 'scenes' ? 'scenes' : 'full';
    const audioPath = audioMode === 'full' ? saveAudio(job, body.audio) : null;
    const sceneAudioPaths = audioMode === 'scenes' ? saveSceneAudios(job, body.sceneAudios || {}) : {};
    if (audioPath) {
      debugEvent(job, 'audio', 'ok', {
        mode: audioMode,
        file: relative(job.jobDir, audioPath).replace(/\\/g, '/'),
        name: body.audio?.name,
        type: body.audio?.type
      });
    }
    if (Object.keys(sceneAudioPaths).length) {
      debugEvent(job, 'audio', 'ok', {
        mode: audioMode,
        sceneAudios: Object.entries(sceneAudioPaths).map(([sceneId, path]) => ({
          scene_id: sceneId,
          file: relative(job.jobDir, path).replace(/\\/g, '/')
        }))
      });
    }

    const selectedXml = writeSelectedPremiereXml(job, renderClips);
    const audioSceneFiles = audioPath ? await splitFullAudioByScenes(job, audioPath) : [];
    const selectionRecord = buildSelectionRecord({
      job,
      selectionPlan,
      renderClips,
      audioMode,
      audioPath,
      sceneAudioPaths,
      audioSceneFiles,
      subtitleStyle
    });
    writeJson(join(job.jobDir, '06-selected-video', 'selection-plan.json'), selectionRecord);

    const video = await renderSelectedStoryboardVideo({
      scenes: job.scenes,
      selectedAssets,
      selectedClips: renderClips,
      audioPath,
      sceneAudioPaths,
      config: renderConfig,
      outDir: join(job.jobDir, '06-selected-video'),
      dryRun: job.dryRun
    });
    debugEvent(job, 'render', 'ok', {
      skipped: video.skipped || false,
      file: video.path ? relative(job.jobDir, video.path).replace(/\\/g, '/') : null
    });

    let drive = null;
    if (!job.dryRun && config.drive.upload) {
      debugEvent(job, 'drive_upload', 'start', {
        target: config.drive.parentFolderId ? 'parentFolderId' : config.drive.driveId ? 'driveId' : null
      });
      drive = await uploadJobDirectoryToDrive({
        jobDir: job.jobDir,
        folderName: config.projectName + '-' + job.id,
        parentFolderId: config.drive.parentFolderId || config.drive.driveId,
        driveId: config.drive.driveId
      });
      debugEvent(job, 'drive_upload', 'ok', { drive });
    } else {
      debugEvent(job, 'drive_upload', 'skipped', {
        dryRun: job.dryRun,
        enabled: config.drive.upload,
        configured: Boolean(config.drive.parentFolderId || config.drive.driveId)
      });
    }

    updateJob(job, {
      status: 'complete',
      phase: 'Video listo',
      video,
      drive,
      selectedAssets,
      selectedXmlFiles: selectedXml ? [selectedXml] : [],
      audioSceneFiles,
      selectionPlan: selectionRecord
    });
  } catch (error) {
    debugEvent(job, 'render', 'error', { message: error.message, stack: error.stack });
    throw error;
  }
}

function normalizeSubtitleStyle(style = {}) {
  return {
    fontName: cleanSubtitleFont(style.fontName || style.font || config.video.subtitleFontName || 'Chakra Petch'),
    fontSize: clampNumber(style.fontSize ?? style.size ?? config.video.subtitleFontSize, 16, 120, config.video.subtitleFontSize || 52),
    textColor: cleanHexColor(style.textColor || style.foreground || config.video.subtitleTextColor || '#ffffff', '#ffffff'),
    backgroundColor: cleanHexColor(style.backgroundColor || style.background || config.video.subtitleBackgroundColor || '#c21824', '#c21824')
  };
}

function withSubtitleStyle(baseConfig, style) {
  return {
    ...baseConfig,
    video: {
      ...baseConfig.video,
      subtitleFontName: style.fontName,
      subtitleFontSize: style.fontSize,
      subtitleTextColor: style.textColor,
      subtitleBackgroundColor: style.backgroundColor
    }
  };
}

function cleanSubtitleFont(value) {
  return String(value || '')
    .replace(/[\r\n,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Arial';
}

function cleanHexColor(value, fallback) {
  const clean = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean.toLowerCase() : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeSelectionPlan(job, selections) {
  const plan = {};
  for (const scene of job.scenes || []) {
    const raw = selections[scene.scene_id];
    const rawEntries = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const entries = [];

    for (const item of rawEntries) {
      const key = typeof item === 'string' ? item : item?.key;
      const asset = findSelectedAsset(job.assets, key);
      if (!asset) continue;
      entries.push({
        key: assetKey(asset),
        startSeconds: positiveSeconds(typeof item === 'string' ? 0 : item?.startSeconds ?? item?.start_seconds ?? item?.videoStartSeconds)
      });
    }

    if (!entries.length) {
      const fallback = findFallbackAsset(job.assets, scene);
      if (fallback) entries.push({ key: assetKey(fallback), startSeconds: 0 });
    }

    if (entries.length) plan[scene.scene_id] = entries;
  }
  return plan;
}

function buildRenderClips(job, selectionPlan) {
  const clips = [];
  for (const scene of job.scenes || []) {
    const entries = selectionPlan[scene.scene_id] || [];
    const sceneDuration = Number(scene.duration_seconds || 4);
    const clipDuration = sceneDuration / Math.max(1, entries.length);
    for (const [index, entry] of entries.entries()) {
      const asset = findSelectedAsset(job.assets, entry.key);
      if (!asset) continue;
      clips.push({
        scene,
        asset,
        sceneId: scene.scene_id,
        index,
        durationSeconds: clipDuration,
        startSeconds: positiveSeconds(entry.startSeconds)
      });
    }
  }
  return clips;
}

function positiveSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

async function startAssetGeneration(job, body = {}) {
  assertJobEditable(job);
  if (!job.scenes?.length) throw new Error('Todavia no hay escenas para generar assets');
  const imageStylePrompt = String(body.imageStylePrompt || job.imageStylePrompt || config.imageStylePrompt || '').trim();
  job.imageStylePrompt = imageStylePrompt;
  const scenes = imageStylePrompt ? applyImageStylePrompt(job.scenes, imageStylePrompt) : job.scenes;
  job.scenes = scenes;
  writeScenesFiles(job, scenes);
  await generateAssetsAndXml(job, scenes);
}

async function generateAssetsAndXml(job, scenes) {
  updateJob(job, { status: 'running', phase: 'Generando assets', progress: 32, error: null });
  debugEvent(job, 'assets', 'start', { sceneCount: scenes.length, dryRun: job.dryRun });

  const previousAssets = job.assets;
  const generatedAssets = job.dryRun ? await buildDryRunAssets(job, scenes) : await buildLiveAssets(job, scenes);
  const assets = mergeImportedAssets(generatedAssets, previousAssets);

  updateJob(job, { assets, phase: 'Creando XMLs', progress: 80 });
  writeJson(join(job.jobDir, 'asset-manifest.json'), assets);
  debugEvent(job, 'asset_manifest', 'ok', {
    counts: allAssetSummaries(assets),
    file: 'asset-manifest.json'
  });

  debugEvent(job, 'xml', 'start', { pathMode: config.xml.pathMode });
  const xmlFiles = writeAllPremiereXmls({ scenes, assets, config, jobDir: job.jobDir });
  debugEvent(job, 'xml', 'ok', {
    files: xmlFiles.map((file) => relative(job.jobDir, file.path).replace(/\\/g, '/'))
  });

  updateJob(job, {
    status: 'ready',
    phase: 'Assets listos para elegir',
    progress: 100,
    xmlFiles,
    assets
  });
  debugEvent(job, 'job_ready', 'ok', { xmlCount: xmlFiles.length, counts: allAssetSummaries(assets) });
}

function updateJobScenes(job, inputScenes) {
  assertJobEditable(job);
  if (!Array.isArray(inputScenes) || !inputScenes.length) throw new Error('Mandame al menos una escena para guardar');

  const scenes = normalizeScenes(inputScenes, job.runId, job.scenes);
  writeScenesFiles(job, scenes);

  let xmlFiles = job.xmlFiles || [];
  if (job.assets) {
    const assets = ensureAssetsObject(job.assets);
    writeJson(join(job.jobDir, 'asset-manifest.json'), assets);
    xmlFiles = writeAllPremiereXmls({ scenes, assets, config, jobDir: job.jobDir });
  }

  updateJob(job, {
    scenes,
    xmlFiles,
    status: job.assets ? 'ready' : 'scenes_ready',
    phase: job.assets ? 'Escenas guardadas y XMLs actualizados' : 'Escenas listas para editar',
    progress: job.assets ? 100 : 30,
    error: null
  });
  return scenes;
}

function writeScenesFiles(job, scenes) {
  writeJson(join(job.jobDir, 'scenes.json'), scenes);
  writeText(
    join(job.jobDir, 'scenes.txt'),
    scenes.map((scene) => String(scene.scene_number).padStart(2, '0') + ' - ' + scene.script_text).join('\n\n') + '\n'
  );
}

function normalizeScenes(inputScenes, runId, existingScenes = []) {
  const existingById = new Map();
  for (const scene of existingScenes || []) {
    if (scene.scene_id) existingById.set(scene.scene_id, scene);
    if (scene.id) existingById.set(scene.id, scene);
  }
  const usedIds = new Set();
  const usedLabels = new Set();

  return inputScenes.map((scene, index) => {
    const previous = existingById.get(scene.scene_id) || existingById.get(scene.id) || {};
    const sceneNumber = toPositiveNumber(scene.scene_number ?? previous.scene_number, index + 1);
    const fallbackLabel = 'scene_' + String(index + 1).padStart(2, '0');
    const preferredLabel = String(scene.scene_label || previous.scene_label || fallbackLabel).trim();
    const preferredId = String(scene.scene_id || previous.scene_id || scene.id || previous.id || preferredLabel || fallbackLabel).trim();
    const sceneId = uniqueSceneValue(preferredId, fallbackLabel, usedIds);
    const sceneLabel = uniqueSceneValue(preferredLabel, sceneId, usedLabels);
    const scriptText = String(scene.script_text ?? scene.narration ?? previous.script_text ?? previous.narration ?? '').trim();
    const estimatedDuration = estimateDurationSeconds(scriptText);
    const hasExistingScenes = Boolean(existingScenes?.length);
    const durationSeconds = hasExistingScenes
      ? toPositiveNumber(scene.duration_seconds ?? previous.duration_seconds, estimatedDuration)
      : normalizeGeneratedDuration(scene.duration_seconds ?? previous.duration_seconds, estimatedDuration);
    const renderDurationSeconds = toPositiveNumber(
      scene.render_duration_seconds ?? previous.render_duration_seconds ?? durationSeconds,
      durationSeconds
    );
    const searchQuery = String(scene.search_query ?? previous.search_query ?? (scriptText.slice(0, 120) || sceneLabel)).trim();
    const googleImageQuery = String(scene.google_image_query ?? previous.google_image_query ?? searchQuery).trim();
    const imagePrompt = String(scene.image_prompt ?? scene.ai_image_prompt ?? previous.image_prompt ?? (scriptText || sceneLabel)).trim();
    const visualSummary = String(scene.visual_summary ?? previous.visual_summary ?? scriptText).trim();

    return {
      ...previous,
      ...scene,
      id: sceneId,
      run_id: runId,
      scene_id: sceneId,
      scene_label: sceneLabel,
      scene_number: sceneNumber,
      script_text: scriptText,
      narration: String(scene.narration ?? previous.narration ?? scriptText),
      duration_seconds: durationSeconds,
      render_duration_seconds: renderDurationSeconds,
      search_query: searchQuery,
      google_image_query: googleImageQuery,
      image_prompt: imagePrompt,
      ai_image_prompt: String(scene.ai_image_prompt ?? previous.ai_image_prompt ?? imagePrompt),
      visual_summary: visualSummary,
      visual_intent: String(scene.visual_intent ?? previous.visual_intent ?? visualSummary)
    };
  });
}

function uniqueSceneValue(value, fallback, used) {
  const initial = String(value || fallback || 'scene').trim() || String(fallback || 'scene').trim() || 'scene';
  let candidate = initial;
  if (used.has(candidate)) candidate = String(fallback || initial).trim() || initial;
  const base = candidate;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = base + '_' + String(suffix).padStart(2, '0');
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function importJobAsset(job, body) {
  assertJobEditable(job);
  if (!job.scenes?.length) throw new Error('Primero necesitás escenas para importar assets');

  const sceneId = String(body.scene_id || body.sceneId || '').trim();
  const scene = job.scenes.find((item) => item.scene_id === sceneId || item.id === sceneId);
  if (!scene) throw new Error('No encontré la escena para importar el asset');
  if (!body.dataBase64) throw new Error('Falta el archivo a importar');

  const originalName = String(body.name || 'asset').trim();
  const mimeType = String(body.mimeType || body.type || '').trim();
  const isVideo = isVideoAsset(originalName, mimeType);
  const group = isVideo ? 'pexelsVideos' : 'aiImages';
  const type = isVideo ? 'imported-video' : 'imported-image';
  const assets = ensureAssetsObject(job.assets);
  const option = nextAssetOption(assets[group], scene.scene_id);
  const extension = extname(originalName) || extensionFromMime(mimeType) || (isVideo ? '.mp4' : '.png');
  const cleanName = slugify(parse(originalName).name || type) || type;
  const fileName = scene.run_id + '_' + scene.scene_label + '_' + cleanName + '_imported_' + option + extension.toLowerCase();
  const assetDir = join(job.jobDir, '05-imported-assets', scene.scene_label);
  const filePath = join(assetDir, fileName);
  ensureDir(assetDir);

  const base64 = String(body.dataBase64).replace(/^data:[^,]+,/, '');
  writeFileSync(filePath, Buffer.from(base64, 'base64'));

  const asset = {
    type,
    imported: true,
    sceneId: scene.id,
    scene_id: scene.scene_id,
    scene_label: scene.scene_label,
    sceneNumber: scene.scene_number,
    option,
    image_rank: isVideo ? undefined : option,
    path: filePath,
    name: fileName,
    file_name: fileName,
    output_file_name: fileName,
    output_full_path: '/tmp/' + fileName,
    sourceUrl: 'manual-upload',
    mimeType,
    found: true
  };

  assets[group].push(asset);
  writeJson(join(job.jobDir, 'asset-manifest.json'), assets);
  const xmlFiles = writeAllPremiereXmls({ scenes: job.scenes, assets, config, jobDir: job.jobDir });
  updateJob(job, {
    assets,
    xmlFiles,
    status: 'ready',
    phase: 'Asset importado',
    progress: 100,
    error: null
  });
  return asset;
}

function assertJobEditable(job) {
  if (['queued', 'running', 'rendering'].includes(job.status)) {
    throw new Error('Esperá a que termine la etapa actual antes de editar o importar');
  }
}

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isVideoAsset(name, mimeType) {
  return /^video\//i.test(mimeType) || /\.(mp4|mov|m4v|webm)$/i.test(name);
}

function extensionFromMime(mimeType) {
  const table = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm'
  };
  return table[String(mimeType || '').toLowerCase()] || '';
}

function ensureAssetsObject(assets = {}) {
  assets = assets || {};
  return {
    aiImages: [...(assets.aiImages || [])],
    pexelsImages: [...(assets.pexelsImages || [])],
    pexelsVideos: [...(assets.pexelsVideos || [])],
    brightDataImages: [...(assets.brightDataImages || [])]
  };
}

function mergeImportedAssets(generatedAssets, previousAssets) {
  const result = ensureAssetsObject(generatedAssets);
  const previous = ensureAssetsObject(previousAssets);
  for (const group of Object.keys(result)) {
    const imported = previous[group].filter((asset) => asset.imported);
    result[group] = dedupeAssets([...result[group], ...imported]);
  }
  return result;
}

function dedupeAssets(assets) {
  const seen = new Set();
  const result = [];
  for (const asset of assets || []) {
    const key = assetKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

function nextAssetOption(assets, sceneId) {
  const options = (assets || [])
    .filter((asset) => asset.scene_id === sceneId)
    .map((asset) => Number(asset.option || asset.image_rank || 1))
    .filter(Number.isFinite);
  return options.length ? Math.max(...options) + 1 : 1;
}

function saveAudio(job, audio) {
  if (!audio?.dataBase64) return null;
  const safeName = slugify(audio.name || 'audio') || 'audio';
  const extension = extname(audio.name || '') || '.mp3';
  const audioPath = join(job.jobDir, 'audio', safeName + extension);
  ensureDir(join(job.jobDir, 'audio'));
  const base64 = String(audio.dataBase64).replace(/^data:[^,]+,/, '');
  writeFileSync(audioPath, Buffer.from(base64, 'base64'));
  return audioPath;
}

function saveSceneAudios(job, sceneAudios) {
  const result = {};
  ensureDir(join(job.jobDir, 'audio', 'scenes'));
  for (const scene of job.scenes || []) {
    const audio = sceneAudios[scene.scene_id];
    if (!audio?.dataBase64) continue;
    const extension = extname(audio.name || '') || '.mp3';
    const fileName = scene.scene_label + '_audio' + extension.toLowerCase();
    const audioPath = join(job.jobDir, 'audio', 'scenes', fileName);
    const base64 = String(audio.dataBase64).replace(/^data:[^,]+,/, '');
    writeFileSync(audioPath, Buffer.from(base64, 'base64'));
    result[scene.scene_id] = audioPath;
  }
  return result;
}

async function splitFullAudioByScenes(job, audioPath) {
  if (!audioPath || !config.video.enabled) return [];
  try {
    await checkCommand(config.video.ffmpegPath, ['-version']);
    const outDir = join(job.jobDir, 'audio', 'scene-cuts');
    ensureDir(outDir);
    const files = [];
    let cursor = 0;
    for (const scene of job.scenes || []) {
      const duration = Math.max(0.1, Number(scene.duration_seconds || 4));
      const outPath = join(outDir, scene.scene_label + '_audio.m4a');
      await execFileAsync(config.video.ffmpegPath, [
        '-y',
        '-ss', String(cursor),
        '-t', String(duration),
        '-i', audioPath,
        '-vn',
        '-c:a', 'aac',
        outPath
      ]);
      files.push({
        scene_id: scene.scene_id,
        scene_label: scene.scene_label,
        path: outPath,
        file_name: parse(outPath).base
      });
      cursor += duration;
    }
    debugEvent(job, 'audio_split', 'ok', { files: files.map((file) => relative(job.jobDir, file.path).replace(/\\/g, '/')) });
    return files;
  } catch (error) {
    debugEvent(job, 'audio_split', 'error', { message: error.message });
    return [];
  }
}

function buildSelectionRecord({ job, selectionPlan, renderClips, audioMode, audioPath, sceneAudioPaths, audioSceneFiles, subtitleStyle }) {
  return {
    createdAt: new Date().toISOString(),
    rawSelections: selectionPlan,
    totalDurationSeconds: totalSceneDuration(job.scenes),
    subtitleStyle,
    scenes: (job.scenes || []).map((scene) => ({
      scene_id: scene.scene_id,
      scene_label: scene.scene_label,
      duration_seconds: Number(scene.duration_seconds || 0),
      script_text: scene.script_text || scene.narration || '',
      clips: renderClips
        .filter((clip) => clip.scene.scene_id === scene.scene_id)
        .map((clip) => ({
          assetKey: assetKey(clip.asset),
          type: clip.asset?.type,
          file_name: clip.asset?.file_name || clip.asset?.name,
          relativePath: clip.asset?.path ? relative(job.jobDir, clip.asset.path).replace(/\\/g, '/') : null,
          durationSeconds: clip.durationSeconds,
          startSeconds: clip.startSeconds || 0,
          endSeconds: (clip.startSeconds || 0) + clip.durationSeconds
        }))
    })),
    audio: {
      mode: audioMode,
      fullAudio: audioPath ? relative(job.jobDir, audioPath).replace(/\\/g, '/') : null,
      sceneAudios: audioMode === 'scenes'
        ? Object.entries(sceneAudioPaths || {}).map(([sceneId, path]) => ({
            scene_id: sceneId,
            file: relative(job.jobDir, path).replace(/\\/g, '/')
          }))
        : (audioSceneFiles || []).map((file) => ({
            scene_id: file.scene_id,
            scene_label: file.scene_label,
            file: relative(job.jobDir, file.path).replace(/\\/g, '/')
          }))
    }
  };
}

function totalSceneDuration(scenes = []) {
  return scenes.reduce((sum, scene) => sum + Math.max(0, Number(scene.duration_seconds || 0)), 0);
}

function estimateDurationSeconds(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const secondsPerWord = Number(config.sceneSecondsPerWord || 0.41);
  const min = Number(config.minSceneDurationSeconds || 1.5);
  const max = Number(config.maxSceneDurationSeconds || 18);
  const estimated = Math.round(Math.max(0.5, words * secondsPerWord) * 2) / 2;
  return Math.min(Math.max(estimated, min), max);
}

function normalizeGeneratedDuration(value, estimatedDuration) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return estimatedDuration;
  if (raw < estimatedDuration * 0.6 || raw > estimatedDuration * 1.5) return estimatedDuration;
  return Math.round(raw * 2) / 2;
}

function findSelectedAsset(assets, key) {
  if (!key || !assets) return null;
  for (const group of Object.values(assets)) {
    for (const asset of group || []) {
      if (assetKey(asset) === key) return asset;
    }
  }
  return null;
}

function findFallbackAsset(assets, scene) {
  return (
    (assets?.aiImages || []).find((asset) => asset.scene_id === scene.scene_id) ||
    (assets?.pexelsImages || []).find((asset) => asset.scene_id === scene.scene_id) ||
    (assets?.brightDataImages || []).find((asset) => asset.scene_id === scene.scene_id) ||
    (assets?.pexelsVideos || []).find((asset) => asset.scene_id === scene.scene_id)
  );
}

function estimateSceneCount(scriptText) {
  return Math.max(1, Math.ceil(String(scriptText || '').length / 100));
}

function startEstimatedSceneProgress(job, scriptText) {
  const estimate = estimateSceneCount(scriptText);
  job.estimatedSceneCount = estimate;
  let completed = 0;
  const tick = () => {
    completed += 1;
    const capped = Math.min(completed, Math.max(1, estimate));
    const percent = Math.min(99, Math.max(1, Math.round((capped / estimate) * 100)));
    const phase = percent >= 99 && completed >= estimate
      ? 'Partiendo escenas ' + estimate + '/' + estimate + ' (99%)'
      : 'Partiendo escenas ' + capped + '/' + estimate;
    updateJob(job, { status: 'running', phase, progress: percent });
  };
  tick();
  const timer = setInterval(tick, 1200);
  return { stop: () => clearInterval(timer) };
}

function applyImageStylePrompt(scenes, imageStylePrompt) {
  return (scenes || []).map((scene) => {
    const current = String(scene.image_prompt || scene.ai_image_prompt || scene.visual_summary || scene.script_text || scene.scene_label).trim();
    const previousStyle = String(config.imageStylePrompt || '').trim();
    const basePrompt = previousStyle && current.includes(previousStyle)
      ? current.replace(previousStyle, '').replace(/[, ]+$/, '').trim()
      : current;
    const styled = basePrompt.toLowerCase().includes(imageStylePrompt.toLowerCase())
      ? basePrompt
      : (basePrompt ? basePrompt + ', ' + imageStylePrompt : imageStylePrompt);
    return {
      ...scene,
      image_prompt: styled,
      ai_image_prompt: styled
    };
  });
}

function writeSelectedPremiereXml(job, renderClips) {
  if (!renderClips.length) return null;
  const selectedDir = join(job.jobDir, '06-selected-video');
  ensureDir(selectedDir);
  const selectedScenes = renderClips.map((clip, index) => {
    const clipId = clip.scene.scene_id + '_clip_' + String(index + 1).padStart(2, '0');
    return {
      ...clip.scene,
      id: clipId,
      scene_id: clipId,
      scene_label: clip.scene.scene_label + '_clip_' + String(index + 1).padStart(2, '0'),
      duration_seconds: clip.durationSeconds,
      render_duration_seconds: clip.durationSeconds
    };
  });
  const selectedAssets = renderClips.map((clip, index) => ({
    ...clip.asset,
    sceneId: selectedScenes[index].id,
    scene_id: selectedScenes[index].scene_id,
    option: 1,
    image_rank: 1
  }));
  return writePremiereXml({
    outPath: join(selectedDir, 'premiere_selected_timeline.xml'),
    outputFileName: 'premiere_selected_timeline.xml',
    title: 'Selected Assets Timeline',
    scenes: selectedScenes,
    tracks: [{ name: 'selected_assets', option: 1, clips: selectedAssets }],
    config
  });
}

function buildDownloadZip(job, kind) {
  const normalized = String(kind || 'all').toLowerCase();
  const entries = downloadEntries(job, normalized);
  if (!entries.length) throw new Error('No hay archivos para descargar en ' + normalized);
  const outDir = join(job.jobDir, 'downloads');
  ensureDir(outDir);
  const zipPath = join(outDir, 'download-' + normalized + '.zip');
  writeZipFile(zipPath, entries);
  debugEvent(job, 'download_zip', 'ok', { kind: normalized, files: entries.length, file: relative(job.jobDir, zipPath).replace(/\\/g, '/') });
  return { path: zipPath, fileName: parse(zipPath).base };
}

function downloadEntries(job, kind) {
  const assets = ensureAssetsObject(job.assets);
  const entries = [];
  const addFile = (filePath, name) => {
    if (!filePath || !existsSync(filePath)) return;
    entries.push({ path: filePath, name: uniqueZipName(entries, name || relative(job.jobDir, filePath).replace(/\\/g, '/')) });
  };
  const addAssets = (list, folder) => {
    for (const asset of list || []) addFile(asset.path, folder + '/' + (asset.file_name || asset.name || parse(asset.path).base));
  };
  const addXml = (needle) => {
    for (const file of job.xmlFiles || []) {
      if (!needle || String(file.fileName || '').includes(needle)) addFile(file.path, 'premiere-xml/' + (file.fileName || parse(file.path).base));
    }
  };

  if (kind === 'ai') { addAssets(assets.aiImages, '01-ai-images'); addXml('ai'); }
  else if (kind === 'pexels-images') { addAssets(assets.pexelsImages, '02-pexels-images'); addXml('pexels_images'); }
  else if (kind === 'pexels-videos') { addAssets(assets.pexelsVideos, '03-pexels-videos'); addXml('pexels_videos'); }
  else if (kind === 'google') { addAssets(assets.brightDataImages, '04-brightdata-google-images'); addXml('google_images'); }
  else if (kind === 'selected') {
    if (!job.selectionPlan) throw new Error('Primero renderiza o guarda una seleccion para descargar solo lo elegido');
    addAssets(job.selectedAssets || [], 'selected-assets');
    for (const file of job.selectedXmlFiles || []) addFile(file.path, 'premiere-xml/' + (file.fileName || parse(file.path).base));
    for (const file of job.audioSceneFiles || []) addFile(file.path, 'audio/scene-cuts/' + (file.file_name || parse(file.path).base));
    if (job.video?.path) addFile(job.video.path, 'video/' + (job.video.fileName || parse(job.video.path).base));
    addFile(join(job.jobDir, '06-selected-video', 'selection-plan.json'), 'selection-plan.json');
  } else {
    addAssets(assets.aiImages, '01-ai-images');
    addAssets(assets.pexelsImages, '02-pexels-images');
    addAssets(assets.pexelsVideos, '03-pexels-videos');
    addAssets(assets.brightDataImages, '04-brightdata-google-images');
    addXml();
    addFile(join(job.jobDir, 'scenes.json'), 'scenes.json');
    addFile(join(job.jobDir, 'scenes.txt'), 'scenes.txt');
    addFile(join(job.jobDir, 'asset-manifest.json'), 'asset-manifest.json');
  }
  return entries;
}

function uniqueZipName(entries, wanted) {
  const clean = String(wanted || 'file').replace(/\\/g, '/').replace(/^\/+/, '');
  let candidate = clean;
  const used = new Set(entries.map((entry) => entry.name));
  let index = 2;
  while (used.has(candidate)) {
    const parsed = parse(clean);
    candidate = (parsed.dir ? parsed.dir + '/' : '') + parsed.name + '_' + index + parsed.ext;
    index += 1;
  }
  return candidate;
}

function writeZipFile(outPath, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const data = readFileSync(entry.path);
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(outPath, Buffer.concat([...chunks, ...central, end]));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function publicJob(job) {
  return {
    ...job,
    assets: publicAssets(job),
    video: job.video ? publicFile(job, job.video) : null,
    selectedAssets: (job.selectedAssets || []).map((asset) => publicAsset(job, asset)),
    debug: publicDebug(job)
  };
}

function publicAssets(job) {
  if (!job.assets) return null;
  return Object.fromEntries(
    Object.entries(job.assets).map(([group, assets]) => [
      group,
      (assets || []).map((asset) => publicAsset(job, asset))
    ])
  );
}

function publicAsset(job, asset) {
  return {
    ...asset,
    key: assetKey(asset),
    url: fileUrl(job, asset.path),
    relativePath: relative(job.jobDir, asset.path).replace(/\\/g, '/')
  };
}

function publicFile(job, file) {
  return {
    ...file,
    url: file.path ? fileUrl(job, file.path) : null,
    relativePath: file.path ? relative(job.jobDir, file.path).replace(/\\/g, '/') : null
  };
}

function assetKey(asset) {
  return [asset.type, asset.scene_id || asset.sceneId, asset.option || asset.image_rank || 1, asset.file_name || asset.name].join('|');
}

function fileUrl(job, filePath) {
  const rel = relative(job.jobDir, filePath).replace(/\\/g, '/');
  return '/api/jobs/' + encodeURIComponent(job.id) + '/file?path=' + encodeURIComponent(rel);
}

async function buildDryRunAssets(job, scenes) {
  debugEvent(job, 'assets_dry_run', 'start', { sceneCount: scenes.length });
  const assets = createDryRunAssets(scenes, job.jobDir);
  debugEvent(job, 'assets_dry_run', 'ok', { counts: allAssetSummaries(assets) });
  return assets;
}

async function buildLiveAssets(job, scenes) {
  const assets = ensureAssetsObject();
  const stages = [
    liveAssetStage(job, assets, 'aiImages', 'ai_images', {
      provider: 'OpenAI Images',
      model: config.openai.imageModel,
      size: config.openai.imageSize,
      expected: scenes.length,
      prompts: scenes.map((scene) => ({ scene_id: scene.scene_id, prompt: scene.image_prompt }))
    }, () => generateAiImages(scenes, config, join(job.jobDir, '01-ai-images'))),
    liveAssetStage(job, assets, 'pexelsImages', 'pexels_images', {
      provider: 'Pexels photos',
      perScene: config.pexels.imageCount,
      perPage: config.pexels.imageSearchPerPage,
      orientation: config.pexels.orientation,
      queries: scenes.map((scene) => ({ scene_id: scene.scene_id, query: scene.search_query }))
    }, () => fetchPexelsImages(scenes, config, join(job.jobDir, '02-pexels-images'))),
    liveAssetStage(job, assets, 'pexelsVideos', 'pexels_videos', {
      provider: 'Pexels videos',
      perScene: config.pexels.videoCount,
      perPage: config.pexels.videoSearchPerPage,
      orientation: config.pexels.orientation,
      queries: scenes.map((scene) => ({ scene_id: scene.scene_id, query: scene.search_query }))
    }, () => fetchPexelsVideos(scenes, config, join(job.jobDir, '03-pexels-videos'))),
    liveAssetStage(job, assets, 'brightDataImages', 'brightdata_google_images', {
      provider: 'Bright Data Google Images',
      zone: config.brightData.zone,
      country: config.brightData.country,
      language: config.brightData.language,
      queries: scenes.map((scene) => ({ scene_id: scene.scene_id, query: scene.google_image_query || scene.search_query }))
    }, () => fetchBrightDataGoogleImages(scenes, config, join(job.jobDir, '04-brightdata-google-images')))
  ];

  await Promise.all(stages);
  return assets;
}

async function liveAssetStage(job, assets, group, step, details, fn) {
  updateJob(job, { phase: 'Generando assets: ' + details.provider, progress: 40 });
  const list = await runAssetStageSoft(job, step, details, fn);
  assets[group] = list;
  writeJson(join(job.jobDir, 'asset-manifest.json'), assets);
  updateJob(job, { assets, phase: 'Assets: ' + details.provider + ' listo', progress: 55 });
  return list;
}

async function runAssetStageSoft(job, step, details, fn) {
  debugEvent(job, step, 'start', details);
  try {
    const assets = await fn();
    debugEvent(job, step, 'ok', {
      count: assets.length,
      assets: assetSummary(assets)
    });
    return assets;
  } catch (error) {
    debugEvent(job, step, 'error', { message: error.message, stack: error.stack });
    return [];
  }
}

function publicDebug(job) {
  const events = readDebugEvents(job).slice(-200);
  return {
    events,
    eventCount: events.length,
    logUrl: fileUrl(job, debugPath(job, 'debug-log.json'))
  };
}

function debugEvent(job, step, status, data = {}) {
  const event = {
    at: new Date().toISOString(),
    step,
    status,
    data: safeDebug(data)
  };
  const events = readDebugEvents(job);
  events.push(event);
  const dir = debugPath(job);
  ensureDir(dir);
  writeJson(join(dir, 'debug-log.json'), events);
  writeJson(join(dir, event.at.replace(/[:.]/g, '-') + '-' + slugify(step) + '.json'), event);
  job.debug = {
    events: events.slice(-200),
    eventCount: events.length,
    logUrl: fileUrl(job, join(dir, 'debug-log.json'))
  };
  jobs.set(job.id, job);
  saveJob(job);
}

function readDebugEvents(job) {
  const logPath = debugPath(job, 'debug-log.json');
  if (!existsSync(logPath)) return job.debug?.events || [];
  try {
    const value = JSON.parse(readFileSync(logPath, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return job.debug?.events || [];
  }
}

function debugPath(job, file = '') {
  return file ? join(job.jobDir, 'debug', file) : join(job.jobDir, 'debug');
}

function safeConfigSummary() {
  return {
    projectName: config.projectName,
    fps: config.fps,
    openai: {
      hasApiKey: Boolean(config.openai.apiKey),
      textModel: config.openai.textModel,
      imageModel: config.openai.imageModel,
      imageSize: config.openai.imageSize
    },
    pexels: {
      hasApiKey: Boolean(config.pexels.apiKey),
      imageCount: config.pexels.imageCount,
      videoCount: config.pexels.videoCount,
      orientation: config.pexels.orientation,
      locale: config.pexels.locale
    },
    brightData: {
      hasApiKey: Boolean(config.brightData.apiKey),
      zone: config.brightData.zone,
      country: config.brightData.country,
      language: config.brightData.language,
      imageCount: config.brightData.imageCount
    },
    imageStylePrompt: config.imageStylePrompt,
    drive: {
      upload: config.drive.upload,
      configured: Boolean(config.drive.parentFolderId || config.drive.driveId)
    },
    video: {
      enabled: config.video.enabled,
      ffmpegPath: config.video.ffmpegPath,
      subtitleFontName: config.video.subtitleFontName,
      subtitleFontSize: config.video.subtitleFontSize,
      subtitleTextColor: config.video.subtitleTextColor,
      subtitleBackgroundColor: config.video.subtitleBackgroundColor
    }
  };
}

function allAssetSummaries(assets) {
  return Object.fromEntries(
    Object.entries(assets || {}).map(([group, list]) => [group, Array.isArray(list) ? list.length : 0])
  );
}

function assetSummary(assets) {
  return (assets || []).map((asset) => ({
    type: asset.type,
    scene_id: asset.scene_id,
    scene_label: asset.scene_label,
    option: asset.option || asset.image_rank || 1,
    file_name: asset.file_name || asset.name,
    relativePath: asset.path ? relative(resolve(config.outputRoot), asset.path).replace(/\\/g, '/') : null,
    sourceUrl: asset.sourceUrl || asset.image_url || asset.video_url || null,
    source_page: asset.source_page || asset.pexelsUrl || null,
    photographer: asset.photographer || null,
    query: asset.query || null,
    width: asset.width || null,
    height: asset.height || null,
    duration: asset.duration || null,
    found: asset.found !== false
  }));
}

function safeDebug(value, depth = 0, key = '') {
  if (/api.?key|authorization|token|secret|password|private|credential|service.?account/i.test(key)) return '[REDACTED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) return '[DATA_URL ' + value.length + ' chars]';
    if (value.length > 2000) return value.slice(0, 2000) + '...[truncated ' + value.length + ' chars]';
    return value;
  }
  if (depth >= 6) return '[Max depth]';
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => safeDebug(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, safeDebug(childValue, depth + 1, childKey)])
    );
  }
  return String(value);
}

async function getPreflight() {
  const ffmpeg = config.video.enabled ? await checkCommand(config.video.ffmpegPath, ['-version']) : { ready: true, detail: 'Video desactivado' };
  const checks = {
    openaiText: {
      label: 'Separacion de escenas con GPT',
      ready: Boolean(config.openai.apiKey),
      required: true,
      detail: config.openai.apiKey ? 'Modelo ' + config.openai.textModel : 'Falta OPENAI_API_KEY'
    },
    openaiImages: {
      label: 'Generacion de imagenes IA',
      ready: Boolean(config.openai.apiKey),
      required: true,
      detail: config.openai.apiKey ? config.openai.imageModel + ' ' + config.openai.imageSize : 'Falta OPENAI_API_KEY'
    },
    pexels: {
      label: 'Busqueda en Pexels',
      ready: Boolean(config.pexels.apiKey),
      required: true,
      detail: config.pexels.apiKey ? config.pexels.imageCount + ' imagenes y ' + config.pexels.videoCount + ' video por escena' : 'Falta PEXELS_API_KEY'
    },
    brightData: {
      label: 'Busqueda Google con Bright Data',
      ready: Boolean(config.brightData.apiKey),
      required: true,
      detail: config.brightData.apiKey ? (config.brightData.imageCount || 3) + ' imagenes por escena, zone ' + config.brightData.zone + ', pais ' + config.brightData.country : 'Falta BRIGHTDATA_API_KEY'
    },
    drive: {
      label: 'Subida a Google Drive',
      ready: Boolean(config.drive.parentFolderId || config.drive.driveId) && hasGoogleCredentials(),
      required: false,
      detail: drivePreflightDetail()
    },
    ffmpeg: {
      label: 'Render automatico con subtitulos',
      ready: ffmpeg.ready,
      required: false,
      detail: ffmpeg.detail
    }
  };

  return {
    generatedAt: new Date().toISOString(),
    requiredReady: Object.values(checks).filter((check) => check.required).every((check) => check.ready),
    allReady: Object.values(checks).every((check) => check.ready || !check.required),
    outputRoot: config.outputRoot,
    checks,
    config: safeConfigSummary()
  };
}

async function checkCommand(command, args) {
  try {
    const result = await execFileAsync(command, args, { timeout: 5000, windowsHide: true });
    const firstLine = String(result.stdout || result.stderr || '').split(/\r?\n/).find(Boolean) || 'Disponible';
    return { ready: true, detail: firstLine };
  } catch (error) {
    return { ready: false, detail: command + ' no disponible: ' + error.message };
  }
}

function hasGoogleCredentials() {
  return Boolean(
    process.env.GOOGLE_ACCESS_TOKEN ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

function drivePreflightDetail() {
  if (!config.drive.upload) return 'DRIVE_UPLOAD=false';
  if (!config.drive.parentFolderId && !config.drive.driveId) return 'Falta DRIVE_PARENT_FOLDER_ID o DRIVE_ID';
  if (!hasGoogleCredentials()) return 'Faltan credenciales de Google Drive';
  return 'Destino configurado';
}


function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  ensureDir(job.jobDir);
  writeJson(join(job.jobDir, 'ui-state.json'), job);
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobs.set(job.id, job);
  saveJob(job);
}

function loadJob(jobId) {
  if (jobs.has(jobId)) return jobs.get(jobId);
  const jobDir = resolve(config.outputRoot, jobId);
  const statePath = join(jobDir, 'ui-state.json');
  if (!existsSync(statePath)) return null;
  const job = JSON.parse(readFileSync(statePath, 'utf8'));
  jobs.set(job.id, job);
  return job;
}

function sendJobFile(response, job, relPath, request) {
  const resolved = resolve(job.jobDir, relPath);
  if (!resolved.startsWith(resolve(job.jobDir))) {
    return sendJson(response, 403, { error: 'Archivo fuera del job' });
  }
  if (!existsSync(resolved)) return sendJson(response, 404, { error: 'Archivo no encontrado' });

  const stats = statSync(resolved);
  const mimeType = guessMimeType(resolved);
  const range = request.headers.range;

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stats.size - 1;
      response.writeHead(206, withCors({
        'Content-Type': mimeType,
        'Content-Length': String(end - start + 1),
        'Content-Range': 'bytes ' + start + '-' + end + '/' + stats.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }));
      createReadStream(resolved, { start, end }).pipe(response);
      return;
    }
  }

  const headers = {
    'Content-Type': mimeType,
    'Content-Length': String(stats.size),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };
  if (extname(resolved).toLowerCase() === '.zip') {
    headers['Content-Disposition'] = 'attachment; filename="' + parse(resolved).base.replace(/"/g, '') + '"';
  }
  response.writeHead(200, withCors(headers));
  createReadStream(resolved).pipe(response);
}

function serveStatic(response, pathname) {
  const clean = pathname === '/' ? '/index.html' : pathname;
  const resolved = resolve(WEB_ROOT, '.' + decodeURIComponent(clean));
  if (!resolved.startsWith(WEB_ROOT) || !existsSync(resolved)) {
    response.writeHead(404, withCors({ 'Content-Type': 'text/plain; charset=utf-8' }));
    response.end('No encontrado');
    return;
  }
  response.writeHead(200, withCors({
    'Content-Type': guessMimeType(resolved),
    'Cache-Control': 'no-store'
  }));
  response.end(readFileSync(resolved));
}

async function readJsonBody(request, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Payload demasiado grande');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, value) {
  response.writeHead(status, withCors({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }));
  response.end(JSON.stringify(value));
}

function inferTitle(script) {
  return script.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80) || 'guion';
}

function withCors(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Range',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges'
  };
}

function applyCors(response) {
  for (const [key, value] of Object.entries(withCors())) response.setHeader(key, value);
}
