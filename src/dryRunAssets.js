import { join } from 'node:path';
import { sanitizeAssetTitle, writeText } from './utils/files.js';

export function createDryRunAssets(scenes, jobDir) {
  const aiImages = [];
  const pexelsImages = [];
  const pexelsVideos = [];
  const brightDataImages = [];

  for (const scene of scenes) {
    const aiName = scene.run_id + '_' + scene.scene_label + '_ai.svg';
    const aiPath = join(jobDir, '01-ai-images', aiName);
    writeText(aiPath, placeholderSvg(scene, 'AI'));
    aiImages.push(asset(scene, aiPath, aiName, 'ai-image', 1, { durationSeconds: scene.render_duration_seconds }));

    for (let option = 1; option <= 3; option += 1) {
      const cleanTitle = sanitizeAssetTitle(scene.search_query || 'image', 'image');
      const name = scene.run_id + '_' + scene.scene_label + '_' + cleanTitle + '_img_' + option + '.svg';
      const path = join(jobDir, '02-pexels-images', name);
      writeText(path, placeholderSvg(scene, 'Pexels ' + option));
      pexelsImages.push(asset(scene, path, name, 'pexels-image', option, { image_rank: option }));
    }

    const videoTitle = sanitizeAssetTitle(scene.search_query || 'video', 'video');
    const videoName = scene.run_id + '_' + scene.scene_label + '_' + videoTitle + '.mp4';
    const videoPath = join(jobDir, '03-pexels-videos', videoName);
    writeText(videoPath, 'Video Pexels placeholder para ' + scene.scene_label + '\n');
    pexelsVideos.push(asset(scene, videoPath, videoName, 'pexels-video', 1));

    for (let option = 1; option <= 3; option += 1) {
      const googleTitle = sanitizeAssetTitle(scene.search_query || 'imageGoogle', 'imageGoogle');
      const googleName = scene.run_id + '_' + scene.scene_label + '_imageGoogle_' + googleTitle + '_' + option + '.svg';
      const googlePath = join(jobDir, '04-brightdata-google-images', googleName);
      writeText(googlePath, placeholderSvg(scene, 'Google Images ' + option));
      brightDataImages.push(asset(scene, googlePath, googleName, 'brightdata-google-image', option, { image_rank: option }));
    }
  }

  return { aiImages, pexelsImages, pexelsVideos, brightDataImages };
}

function asset(scene, path, name, type, option, extra = {}) {
  return {
    type,
    sceneId: scene.id,
    scene_id: scene.scene_id,
    scene_label: scene.scene_label,
    sceneNumber: scene.scene_number,
    option,
    path,
    name,
    file_name: name,
    output_file_name: name,
    output_full_path: '/tmp/' + name,
    sourceUrl: 'dry-run',
    ...extra
  };
}

function placeholderSvg(scene, label) {
  const title = escapeXml(label + ' - Escena ' + scene.scene_number);
  const summary = escapeXml(scene.visual_summary.slice(0, 150));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">',
    '<rect width="1920" height="1080" fill="#20242c"/>',
    '<rect x="120" y="120" width="1680" height="840" fill="#2f2f42" stroke="#f2f2f2" stroke-width="4"/>',
    '<text x="160" y="220" fill="#ffffff" font-family="Arial" font-size="72">' + title + '</text>',
    '<text x="160" y="330" fill="#ffffff" font-family="Arial" font-size="42">' + summary + '</text>',
    '</svg>',
    ''
  ].join('\n');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
