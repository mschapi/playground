import { join } from 'node:path';
import { buildCombinedTracks, buildTracksByOption, writePremiereXml } from './fcpXml.js';

export function writeAllPremiereXmls({ scenes, assets, config, jobDir }) {
  const xmlDir = join(jobDir, 'premiere-xml');
  const files = [];

  files.push(
    writePremiereXml({
      outPath: join(xmlDir, 'premiere_ai_timeline.xml'),
      outputFileName: 'premiere_ai_timeline.xml',
      title: 'AI Scenes',
      scenes,
      tracks: buildTracksByOption(assets.aiImages || [], 'ai_image'),
      config,
      useRenderDuration: true
    })
  );

  files.push(
    writePremiereXml({
      outPath: join(xmlDir, 'premiere_pexels_images_timeline.xml'),
      outputFileName: 'premiere_pexels_images_timeline.xml',
      title: 'Pexels Images Scenes',
      scenes,
      tracks: buildTracksByOption(assets.pexelsImages || [], 'pexels_image'),
      config
    })
  );

  files.push(
    writePremiereXml({
      outPath: join(xmlDir, 'premiere_pexels_videos_timeline.xml'),
      outputFileName: 'premiere_pexels_videos_timeline.xml',
      title: 'Pexels Video Scenes',
      scenes,
      tracks: buildTracksByOption(assets.pexelsVideos || [], 'pexels_video'),
      config
    })
  );

  files.push(
    writePremiereXml({
      outPath: join(xmlDir, 'premiere_google_images_timeline.xml'),
      outputFileName: 'premiere_google_images_timeline.xml',
      title: 'Google Images Scenes',
      scenes,
      tracks: buildTracksByOption(assets.brightDataImages || [], 'google_image'),
      config
    })
  );

  files.push(
    writePremiereXml({
      outPath: join(xmlDir, 'premiere_combined_timeline.xml'),
      outputFileName: 'premiere_combined_timeline.xml',
      title: 'Combined Assets Timeline',
      scenes,
      tracks: buildCombinedTracks(assets),
      config
    })
  );

  return files;
}
