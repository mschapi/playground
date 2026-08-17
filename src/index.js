#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { loadConfig } from './config.js';
import { readScriptInput } from './io/scriptInput.js';
import { splitScenesWithOpenAI } from './llm/openai.js';
import { heuristicScenesFromScript } from './scenes.js';
import { generateAiImages } from './media/openaiImages.js';
import { fetchPexelsImages, fetchPexelsVideos } from './media/pexels.js';
import { fetchBrightDataGoogleImages } from './media/brightData.js';
import { writeAllPremiereXmls } from './premiere/writeXmls.js';
import { renderAiStoryboardVideo } from './video/ffmpeg.js';
import { uploadJobDirectoryToDrive } from './google/drive.js';
import { createDryRunAssets } from './dryRunAssets.js';
import { compactRunId, ensureDir, slugify, writeJson, writeText } from './utils/files.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run']);
  const config = loadConfig(args.config || 'config/pipeline.config.json');

  const input = await readScriptInput(args);
  if (!input.text) throw new Error('El guion esta vacio');

  const title = args.title || inferTitle(input.text);
  const runId = args['run-id'] || compactRunId();
  const jobId = args['job-id'] || runId + '-' + (slugify(title) || 'guion');
  const jobDir = resolve(config.outputRoot, jobId);
  ensureDir(jobDir);

  log(`Guion: ${input.source}`);
  log(`Salida local: ${jobDir}`);

  const rawScenes = dryRun
    ? heuristicScenesFromScript(input.text, config)
    : await splitScenesWithOpenAI(input.text, config);
  const scenes = rawScenes.map((scene) => ({ ...scene, run_id: runId }));
  writeText(join(jobDir, 'script.txt'), input.text + '\n');
  writeJson(join(jobDir, 'scenes.json'), scenes);
  writeText(join(jobDir, 'scenes.txt'), scenes.map((scene) => String(scene.scene_number).padStart(2, '0') + ' - ' + scene.script_text).join('\n\n') + '\n');
  log(`Escenas: ${scenes.length}`);

  const assets = dryRun
    ? createDryRunAssets(scenes, jobDir)
    : {
        aiImages: await generateAiImages(scenes, config, join(jobDir, '01-ai-images')),
        pexelsImages: await fetchPexelsImages(scenes, config, join(jobDir, '02-pexels-images')),
        pexelsVideos: await fetchPexelsVideos(scenes, config, join(jobDir, '03-pexels-videos')),
        brightDataImages: await fetchBrightDataGoogleImages(
          scenes,
          config,
          join(jobDir, '04-brightdata-google-images')
        )
      };

  writeJson(join(jobDir, 'asset-manifest.json'), assets);
  const xmlFiles = writeAllPremiereXmls({ scenes, assets, config, jobDir });
  log(`XMLs: ${xmlFiles.length}`);

  const video = await renderAiStoryboardVideo({
    scenes,
    aiImages: assets.aiImages,
    config,
    outDir: join(jobDir, '05-ai-video'),
    dryRun
  });
  writeJson(join(jobDir, 'video-manifest.json'), video);
  log(video.skipped ? `Video omitido: ${video.reason}` : `Video: ${video.path}`);

  let drive = null;
  if (!dryRun && config.drive.upload) {
    drive = await uploadJobDirectoryToDrive({
      jobDir,
      folderName: `${config.projectName}-${jobId}`,
      parentFolderId: config.drive.parentFolderId || config.drive.driveId,
      driveId: config.drive.driveId
    });
    log(`Drive: ${drive.rootFolder.webViewLink || drive.rootFolder.id}`);
  } else {
    log(dryRun ? 'Drive omitido por dry-run' : 'Drive omitido por DRIVE_UPLOAD=false');
  }

  writeJson(join(jobDir, 'run-summary.json'), {
    title,
    jobId,
    runId,
    input,
    dryRun,
    counts: {
      scenes: scenes.length,
      aiImages: assets.aiImages.length,
      pexelsImages: assets.pexelsImages.length,
      pexelsVideos: assets.pexelsVideos.length,
      brightDataImages: assets.brightDataImages.length,
      xmlFiles: xmlFiles.length
    },
    xmlFiles,
    video,
    drive
  });

  log('Listo.');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function inferTitle(script) {
  return script.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80) || 'guion';
}

function log(message) {
  console.log(`[pipeline] ${message}`);
}

main().catch((error) => {
  console.error(`[pipeline] ERROR: ${error.message}`);
  process.exitCode = 1;
});

