import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { boolEnv, env, loadDotEnv, numberEnv } from './utils/env.js';
import { readJson } from './utils/files.js';

export function loadConfig(configPath = 'config/pipeline.config.json') {
  loadDotEnv('.env');
  loadDotEnv('keys.txt', { override: true });
  const base = readJson(resolve(configPath));

  return {
    ...base,
    fps: numberEnv('FPS', base.fps),
    sceneSecondsPerWord: numberEnv(
      'SCENE_SECONDS_PER_WORD',
      base.sceneSecondsPerWord ?? 0.41
    ),
    wordsPerSecond: numberEnv('WORDS_PER_SECOND', base.wordsPerSecond),
    minSceneDurationSeconds: numberEnv(
      'MIN_SCENE_DURATION_SECONDS',
      base.minSceneDurationSeconds
    ),
    maxSceneDurationSeconds: numberEnv(
      'MAX_SCENE_DURATION_SECONDS',
      base.maxSceneDurationSeconds
    ),
    aiRenderMinDurationSeconds: numberEnv(
      'AI_RENDER_MIN_DURATION_SECONDS',
      base.aiRenderMinDurationSeconds
    ),
    aiRenderMaxDurationSeconds: numberEnv(
      'AI_RENDER_MAX_DURATION_SECONDS',
      base.aiRenderMaxDurationSeconds
    ),
    outputRoot: env('OUTPUT_ROOT', { defaultValue: base.outputRoot }),
    imageStylePrompt: env('IMAGE_STYLE_PROMPT', {
      defaultValue: base.imageStylePrompt
    }),
    openai: {
      ...base.openai,
      apiKey: env('OPENAI_API_KEY'),
      textModel: env('OPENAI_TEXT_MODEL', { defaultValue: base.openai.textModel }),
      imageModel: env('OPENAI_IMAGE_MODEL', { defaultValue: base.openai.imageModel }),
      imageSize: env('OPENAI_IMAGE_SIZE', { defaultValue: base.openai.imageSize }),
      imageQuality: env('OPENAI_IMAGE_QUALITY', {
        defaultValue: base.openai.imageQuality
      }),
      imageFormat: env('OPENAI_IMAGE_FORMAT', {
        defaultValue: base.openai.imageFormat
      })
    },
    pexels: {
      ...base.pexels,
      apiKey: env('PEXELS_API_KEY'),
      imageCount: numberEnv('PEXELS_IMAGE_COUNT', base.pexels.imageCount),
      imageSearchPerPage: numberEnv(
        'PEXELS_IMAGE_SEARCH_PER_PAGE',
        base.pexels.imageSearchPerPage
      ),
      videoCount: numberEnv('PEXELS_VIDEO_COUNT', base.pexels.videoCount),
      videoSearchPerPage: numberEnv(
        'PEXELS_VIDEO_SEARCH_PER_PAGE',
        base.pexels.videoSearchPerPage
      ),
      photoSearchUrl: env('PEXELS_PHOTO_SEARCH_URL', {
        defaultValue: base.pexels.photoSearchUrl
      }),
      videoSearchUrl: env('PEXELS_VIDEO_SEARCH_URL', {
        defaultValue: base.pexels.videoSearchUrl
      }),
      orientation: env('PEXELS_ORIENTATION', {
        defaultValue: base.pexels.orientation
      }),
      locale: env('PEXELS_LOCALE', { defaultValue: base.pexels.locale }),
      imageSizePriority: env('PEXELS_IMAGE_SIZE_PRIORITY')
        ? env('PEXELS_IMAGE_SIZE_PRIORITY')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : base.pexels.imageSizePriority
    },
    brightData: {
      ...base.brightData,
      apiKey: env('BRIGHTDATA_API_KEY'),
      requestUrl: env('BRIGHTDATA_REQUEST_URL', {
        defaultValue: base.brightData.requestUrl
      }),
      zone: env('BRIGHTDATA_ZONE', { defaultValue: base.brightData.zone }),
      country: env('BRIGHTDATA_COUNTRY', { defaultValue: base.brightData.country }),
      language: env('BRIGHTDATA_LANGUAGE', { defaultValue: base.brightData.language }),
      googleHost: env('BRIGHTDATA_GOOGLE_HOST', {
        defaultValue: base.brightData.googleHost
      }),
      format: env('BRIGHTDATA_FORMAT', { defaultValue: base.brightData.format }),
      imageCount: numberEnv('BRIGHTDATA_IMAGE_COUNT', base.brightData.imageCount || 3),
      unblockDataFormat: env('BRIGHTDATA_UNBLOCK_DATA_FORMAT', {
        defaultValue: base.brightData.unblockDataFormat
      }),
      blockedDownloadDomains: env('BRIGHTDATA_BLOCKED_DOWNLOAD_DOMAINS')
        ? env('BRIGHTDATA_BLOCKED_DOWNLOAD_DOMAINS')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : base.brightData.blockedDownloadDomains
    },
    drive: {
      upload: boolEnv('DRIVE_UPLOAD', true),
      driveId: env('DRIVE_ID'),
      parentFolderId: env('DRIVE_PARENT_FOLDER_ID')
    },
    xml: {
      ...base.xml,
      pathMode: env('XML_PATH_MODE', { defaultValue: base.xml.pathMode })
    },
    video: {
      ...base.video,
      enabled: boolEnv('VIDEO_ENABLED', base.video.enabled),
      ffmpegPath: env('FFMPEG_PATH', { defaultValue: defaultFfmpegPath() }),
      ffmpegPreset: env('VIDEO_FFMPEG_PRESET', { defaultValue: base.video.ffmpegPreset || 'veryfast' }),
      ffmpegCrf: numberEnv('VIDEO_FFMPEG_CRF', base.video.ffmpegCrf || 23),
      subtitleFontName: env('VIDEO_SUBTITLE_FONT_NAME', {
        defaultValue: base.video.subtitleFontName
      }),
      subtitleFontSize: numberEnv(
        'VIDEO_SUBTITLE_FONT_SIZE',
        base.video.subtitleFontSize
      ),
      subtitleTextColor: env('VIDEO_SUBTITLE_TEXT_COLOR', {
        defaultValue: base.video.subtitleTextColor || '#ffffff'
      }),
      subtitleBackgroundColor: env('VIDEO_SUBTITLE_BACKGROUND_COLOR', {
        defaultValue: base.video.subtitleBackgroundColor || '#c21824'
      }),
      subtitleFontsDir: env('VIDEO_SUBTITLE_FONTS_DIR', {
        defaultValue: defaultSubtitleFontsDir()
      })
    }
  };
}

function defaultSubtitleFontsDir() {
  const fontPath = resolve('assets/fonts/ChakraPetch-Regular.ttf');
  return existsSync(fontPath) ? resolve('assets/fonts') : '';
}

function defaultFfmpegPath() {
  if (process.platform !== 'win32') return 'ffmpeg';
  const local = findFirstFile(resolve('tools/ffmpeg'), 'ffmpeg.exe');
  return local || 'ffmpeg';
}

function findFirstFile(dir, fileName) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath;
    if (entry.isDirectory()) {
      const found = findFirstFile(fullPath, fileName);
      if (found) return found;
    }
  }
  return null;
}

