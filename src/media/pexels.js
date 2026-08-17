import { join } from 'node:path';
import { downloadFile, fetchJson } from '../utils/http.js';
import { ensureDir, sanitizeAssetTitle, writeJson } from '../utils/files.js';

export async function fetchPexelsImages(scenes, config, outDir) {
  if (!config.pexels.apiKey) throw new Error('Falta PEXELS_API_KEY para imagenes Pexels');
  ensureDir(outDir);

  const assets = [];
  for (const scene of scenes) {
    const url = new URL(config.pexels.photoSearchUrl);
    url.searchParams.set('query', cleanSearchQuery(scene.search_query));
    url.searchParams.set('per_page', String(config.pexels.imageSearchPerPage || 5));
    url.searchParams.set('orientation', config.pexels.orientation);
    if (config.pexels.locale) url.searchParams.set('locale', config.pexels.locale);

    const response = await fetchJson(
      url,
      {
        headers: {
          Authorization: config.pexels.apiKey,
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json'
        }
      },
      'Pexels photos scene ' + scene.scene_number
    );

    const selected = (response.photos || [])
      .filter((photo) => choosePhotoUrl(photo, config.pexels.imageSizePriority))
      .slice(0, config.pexels.imageCount || 3);

    for (const [index, photo] of selected.entries()) {
      const imageUrl = choosePhotoUrl(photo, config.pexels.imageSizePriority);
      const imageRank = index + 1;
      const rawTitle = photo.alt || scene.search_query || 'image_' + imageRank;
      const cleanTitle = sanitizeAssetTitle(rawTitle, 'image');
      const fileName = scene.run_id + '_' + scene.scene_label + '_' + cleanTitle + '_img_' + imageRank + '.jpg';
      const filePath = join(outDir, fileName);

      await downloadFile(imageUrl, filePath);
      assets.push({
        type: 'pexels-image',
        sceneId: scene.id,
        scene_id: scene.scene_id,
        scene_label: scene.scene_label,
        sceneNumber: scene.scene_number,
        option: imageRank,
        image_rank: imageRank,
        path: filePath,
        name: fileName,
        file_name: fileName,
        image_url: imageUrl,
        image_title: rawTitle,
        clean_title: cleanTitle,
        sourceUrl: imageUrl,
        source_page: photo.url || null,
        pexelsUrl: photo.url,
        photographer: photo.photographer || null,
        photographerUrl: photo.photographer_url || null,
        pexels_photo_id: photo.id || null,
        width: photo.width || null,
        height: photo.height || null,
        found: true
      });
    }
  }

  writeJson(join(outDir, 'pexels-image-attribution.json'), assets);
  return assets;
}

export async function fetchPexelsVideos(scenes, config, outDir) {
  if (!config.pexels.apiKey) throw new Error('Falta PEXELS_API_KEY para videos Pexels');
  ensureDir(outDir);

  const assets = [];
  for (const scene of scenes) {
    const url = new URL(config.pexels.videoSearchUrl);
    url.searchParams.set('query', cleanSearchQuery(scene.search_query));
    url.searchParams.set('per_page', String(config.pexels.videoSearchPerPage || 10));
    url.searchParams.set('orientation', config.pexels.orientation);
    if (config.pexels.locale) url.searchParams.set('locale', config.pexels.locale);

    const response = await fetchJson(
      url,
      {
        headers: {
          Authorization: config.pexels.apiKey,
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json'
        }
      },
      'Pexels videos scene ' + scene.scene_number
    );

    const video = (response.videos || [])[0];
    if (!video) continue;

    const file = chooseVideoFile(video.video_files || []);
    if (!file?.link) continue;

    const cleanTitle = sanitizeAssetTitle(scene.search_query, 'video');
    const fileName = scene.run_id + '_' + scene.scene_label + '_' + cleanTitle + '.mp4';
    const filePath = join(outDir, fileName);
    await downloadFile(file.link, filePath);
    assets.push({
      type: 'pexels-video',
      sceneId: scene.id,
      scene_id: scene.scene_id,
      scene_label: scene.scene_label,
      sceneNumber: scene.scene_number,
      option: 1,
      path: filePath,
      name: fileName,
      file_name: fileName,
      video_url: file.link,
      sourceUrl: file.link,
      source_page: video.url || null,
      pexelsUrl: video.url,
      width: file.width || null,
      height: file.height || null,
      duration: video.duration ?? null,
      user: video.user,
      found: true
    });
  }

  writeJson(join(outDir, 'pexels-video-attribution.json'), assets);
  return assets;
}

function cleanSearchQuery(value) {
  return String(value || '')
    .replace(/['"]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .trim();
}

function choosePhotoUrl(photo, priority = []) {
  for (const key of priority) {
    if (photo.src?.[key]) return photo.src[key];
  }
  return photo.src?.landscape || photo.src?.large || photo.src?.large2x || photo.src?.original || null;
}

function chooseVideoFile(files) {
  return (
    files.find((file) => file.quality === 'hd') ||
    files.find((file) => Number(file.width || 0) >= 1280) ||
    files[0]
  );
}
