import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { extname, join, resolve } from 'node:path';
import { ensureDir, writeText } from '../utils/files.js';
import { chunkWords } from '../utils/text.js';

const execFileAsync = promisify(execFile);
const PPRO_SAFE_SEGMENT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.m4v', '.webm']);

export async function renderAiStoryboardVideo({ scenes, aiImages, config, outDir, dryRun }) {
  ensureDir(outDir);
  const concatPath = join(outDir, 'ffmpeg-concat.txt');
  const subtitlePath = join(outDir, 'subtitles.ass');
  const outputPath = join(outDir, config.video.outputFileName);

  writeText(concatPath, buildConcatFile(scenes, aiImages));
  writeText(subtitlePath, buildAssSubtitles(scenes, config));

  if (dryRun || !config.video.enabled) {
    return {
      path: outputPath,
      skipped: true,
      reason: dryRun ? 'dry-run' : 'VIDEO_ENABLED=false',
      subtitlePath,
      concatPath
    };
  }

  await assertFfmpeg(config.video.ffmpegPath);
  const vf = [
    `scale=${config.frameSize.width}:${config.frameSize.height}:force_original_aspect_ratio=increase`,
    `crop=${config.frameSize.width}:${config.frameSize.height}`,
    'setsar=1',
    assFilter(subtitlePath, config)
  ].join(',');

  await execFileAsync(config.video.ffmpegPath, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-vf',
    vf,
    '-r',
    String(config.fps),
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-movflags',
    '+faststart',
    outputPath
  ]);

  return { path: outputPath, subtitlePath, concatPath };
}

export async function renderSelectedStoryboardVideo({ scenes, selectedAssets, selectedClips, audioPath, sceneAudioPaths = {}, config, outDir, dryRun }) {
  ensureDir(outDir);
  const segmentsDir = join(outDir, 'segments');
  ensureDir(segmentsDir);

  const subtitlePath = join(outDir, 'subtitles.ass');
  const concatPath = join(outDir, 'selected-concat.txt');
  const noSubtitlePath = join(outDir, 'selected-no-subtitles.mp4');
  const outputPath = join(outDir, 'selected-video.mp4');
  const renderClips = buildRenderClipsForFfmpeg(scenes, selectedAssets, selectedClips);
  const hasSceneAudio = Object.keys(sceneAudioPaths || {}).length > 0;

  writeText(subtitlePath, buildAssSubtitles(scenes, config));

  if (dryRun || !config.video.enabled) {
    return {
      path: outputPath,
      skipped: true,
      reason: dryRun ? 'dry-run' : 'VIDEO_ENABLED=false',
      subtitlePath,
      concatPath,
      selections: renderClips.map((clip) => clip.asset?.file_name || clip.asset?.name || clip.asset?.path || null)
    };
  }

  await assertFfmpeg(config.video.ffmpegPath);

  const segmentPaths = [];
  for (const [index, clip] of renderClips.entries()) {
    const scene = clip.scene;
    const asset = clip.asset;
    if (!asset?.path) continue;

    const ext = extname(asset.path).toLowerCase();
    if (!PPRO_SAFE_SEGMENT_EXTENSIONS.has(ext)) {
      throw new Error('El asset seleccionado no es renderizable por FFmpeg: ' + asset.path);
    }

    const segmentPath = join(segmentsDir, 'segment_' + String(index + 1).padStart(3, '0') + '.mp4');
    const duration = String(Math.max(0.1, Number(clip.durationSeconds || scene.duration_seconds || 4)));
    const vf = [
      'scale=' + config.frameSize.width + ':' + config.frameSize.height + ':force_original_aspect_ratio=increase',
      'crop=' + config.frameSize.width + ':' + config.frameSize.height,
      'setsar=1'
    ].join(',');

    const isVideo = asset.type === 'pexels-video' || asset.type === 'imported-video' || ['.mp4', '.mov', '.m4v', '.webm'].includes(ext);
    const startSeconds = Math.max(0, Number(clip.startSeconds || 0));
    const inputArgs = isVideo
      ? ['-stream_loop', '-1', '-ss', String(startSeconds), '-i', asset.path]
      : ['-loop', '1', '-i', asset.path];
    const sceneAudioPath = sceneAudioPaths?.[scene.scene_id];
    const audioInputArgs = hasSceneAudio
      ? sceneAudioPath
        ? ['-stream_loop', '-1', '-i', sceneAudioPath]
        : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100']
      : [];
    const outputArgs = hasSceneAudio
      ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest', '-c:a', 'aac', '-ar', '44100', '-ac', '2']
      : ['-an'];

    await execFileAsync(config.video.ffmpegPath, [
      '-y',
      ...inputArgs,
      ...audioInputArgs,
      '-t',
      duration,
      '-vf',
      vf,
      '-r',
      String(config.fps),
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      ...outputArgs,
      segmentPath
    ]);

    segmentPaths.push(segmentPath);
  }

  if (!segmentPaths.length) throw new Error('No hay assets seleccionados para renderizar');

  writeText(
    concatPath,
    segmentPaths.map((segmentPath) => "file '" + concatPathEscape(segmentPath) + "'").join('\n') + '\n'
  );

  await execFileAsync(config.video.ffmpegPath, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-c',
    'copy',
    noSubtitlePath
  ]);

  const vfWithSubtitles = assFilter(subtitlePath, config);
  const args = audioPath
    ? [
        '-y',
        '-i',
        noSubtitlePath,
        '-stream_loop',
        '-1',
        '-i',
        audioPath,
        '-vf',
        vfWithSubtitles,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-shortest',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        outputPath
      ]
    : hasSceneAudio
      ? [
          '-y',
          '-i',
          noSubtitlePath,
          '-vf',
          vfWithSubtitles,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c:v',
          'libx264',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputPath
        ]
      : [
          '-y',
          '-i',
          noSubtitlePath,
          '-vf',
          vfWithSubtitles,
          '-an',
          '-c:v',
          'libx264',
          '-movflags',
          '+faststart',
          outputPath
        ];

  await execFileAsync(config.video.ffmpegPath, args);

  return {
    path: outputPath,
    subtitlePath,
    concatPath,
    audioPath: audioPath || null,
    sceneAudioPaths: Object.keys(sceneAudioPaths || {}).length ? sceneAudioPaths : null,
    selections: renderClips.map((clip) => ({
      file: clip.asset?.file_name || clip.asset?.name || clip.asset?.path || null,
      scene_id: clip.scene?.scene_id,
      durationSeconds: clip.durationSeconds,
      startSeconds: clip.startSeconds || 0
    }))
  };
}

function buildRenderClipsForFfmpeg(scenes, selectedAssets = [], selectedClips = []) {
  if (Array.isArray(selectedClips) && selectedClips.length) return selectedClips;
  return scenes.map((scene, index) => ({
    scene,
    asset: selectedAssets[index],
    durationSeconds: Number(scene.duration_seconds || 4),
    startSeconds: 0
  }));
}

function buildConcatFile(scenes, aiImages) {
  const byScene = new Map(aiImages.map((asset) => [asset.sceneId, asset.path]));
  const lines = [];
  let lastPath = '';
  for (const scene of scenes) {
    const imagePath = byScene.get(scene.id);
    if (!imagePath) continue;
    lastPath = imagePath;
    lines.push(`file '${concatPathEscape(imagePath)}'`);
    lines.push(`duration ${scene.duration_seconds}`);
  }
  if (lastPath) lines.push(`file '${concatPathEscape(lastPath)}'`);
  return `${lines.join('\n')}\n`;
}

export function buildAssSubtitles(scenes, config) {
  const events = [];
  let cursor = 0;
  for (const scene of scenes) {
    const chunks = chunkWords(
      scene.narration || scene.script_text,
      config.video.subtitleMaxWords,
      config.video.subtitleMaxChars
    );
    const chunkDuration = scene.duration_seconds / Math.max(1, chunks.length);
    for (const [index, chunk] of chunks.entries()) {
      const start = cursor + index * chunkDuration;
      const end = index === chunks.length - 1
        ? cursor + scene.duration_seconds
        : cursor + (index + 1) * chunkDuration;
      events.push(
        `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${assEscape(chunk)}`
      );
    }
    cursor += scene.duration_seconds;
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${config.frameSize.width}`,
    `PlayResY: ${config.frameSize.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${config.video.subtitleFontName},${config.video.subtitleFontSize},&H00FFFFFF,&H00FFFFFF,&H000000FF,&H000000FF,0,0,0,0,100,100,0,0,3,12,0,2,150,150,${config.video.subtitleMarginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ].join('\n');
}

async function assertFfmpeg(ffmpegPath) {
  try {
    await execFileAsync(ffmpegPath, ['-version']);
  } catch {
    throw new Error(
      `No encontre FFmpeg (${ffmpegPath}). Instala ffmpeg o define FFMPEG_PATH.`
    );
  }
}

function concatPathEscape(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function assFilter(subtitlePath, config) {
  const filter = `ass='${ffmpegFilterPath(subtitlePath)}'`;
  const fontsDir = config.video.subtitleFontsDir || resolve('assets/fonts');
  return existsSync(fontsDir) ? `${filter}:fontsdir='${ffmpegFilterPath(fontsDir)}'` : filter;
}

function ffmpegFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function assEscape(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function assTime(seconds) {
  const centiseconds = Math.round(seconds * 100);
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
