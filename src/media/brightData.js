import { join } from 'node:path';
import { downloadFile, fetchJson, fetchText } from '../utils/http.js';
import { ensureDir, sanitizeAssetTitle, writeJson } from '../utils/files.js';

export async function fetchBrightDataGoogleImages(scenes, config, outDir) {
  if (!config.brightData.apiKey) {
    throw new Error('Falta BRIGHTDATA_API_KEY para Google Images via Bright Data');
  }
  ensureDir(outDir);

  const assets = [];
  const errors = [];
  for (const scene of scenes) {
    try {
      const sceneAssets = await fetchSceneGoogleImages(scene, config, outDir);
      assets.push(...sceneAssets);
    } catch (error) {
      errors.push({
        scene_id: scene.scene_id,
        scene_label: scene.scene_label,
        scene_number: scene.scene_number,
        message: error.message
      });
      if (/HTTP 401|HTTP 403|status_code 407|Invalid authentication|Inactive customer|token expired|unauthorized|forbidden/i.test(error.message)) break;
    }
  }

  writeJson(join(outDir, 'brightdata-google-image-sources.json'), assets);
  if (errors.length) writeJson(join(outDir, 'brightdata-google-image-errors.json'), errors);
  return assets;
}

async function fetchSceneGoogleImages(scene, config, outDir) {
  const requestedCount = Math.max(1, Number(config.brightData.imageCount || 3));
  const blockedDomains = config.brightData.blockedDownloadDomains || [];
  const candidates = [];
  const seen = new Set();

  for (let page = 0; page < requestedCount + 2 && candidates.length < requestedCount * 3; page += 1) {
    const googleUrl = buildGoogleImagesUrl(scene.google_image_query || scene.search_query, config, page * 10);
    const parsed = await requestScenePayload(scene, config, googleUrl);
    const pageImages = chooseBrightDataImages(parsed, blockedDomains, requestedCount * 2);
    for (const image of pageImages) {
      if (!image?.imageUrl || seen.has(image.imageUrl)) continue;
      seen.add(image.imageUrl);
      candidates.push({ ...image, googleUrl });
    }
  }

  if (!candidates.length) {
    throw new Error('Bright Data no devolvio imagenes descargables para la escena ' + scene.scene_number);
  }

  const assets = [];
  for (const image of candidates) {
    if (assets.length >= requestedCount) break;
    const option = assets.length + 1;
    const imageRank = image.rank || image.global_rank || option;
    const title = image.title || image.image_alt || scene.search_query || 'image';
    const cleanTitle = sanitizeAssetTitle(title, 'imageGoogle');
    const fileName = scene.run_id + '_' + scene.scene_label + '_imageGoogle_' + cleanTitle + '_' + option + '.jpg';
    const filePath = join(outDir, fileName);

    try {
      await downloadFile(image.imageUrl, filePath, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'image/*,*/*;q=0.8'
        }
      });
    } catch {
      continue;
    }

    assets.push({
      type: 'brightdata-google-image',
      sceneId: scene.id,
      scene_id: scene.scene_id,
      scene_label: scene.scene_label,
      sceneNumber: scene.scene_number,
      option,
      image_rank: option,
      source_rank: imageRank,
      path: filePath,
      name: fileName,
      file_name: fileName,
      image_url: image.imageUrl,
      image_title: title,
      clean_title: cleanTitle,
      sourceUrl: image.imageUrl,
      source_page: image.link || null,
      query: scene.google_image_query || scene.search_query,
      googleUrl: image.googleUrl,
      found: true
    });
  }

  if (!assets.length) {
    throw new Error('Bright Data encontro resultados pero no pudo descargar ninguna imagen para la escena ' + scene.scene_number);
  }
  return assets;
}

async function requestScenePayload(scene, config, googleUrl) {
  const payload = {
    zone: config.brightData.zone,
    url: googleUrl,
    format: config.brightData.format || 'raw',
    method: 'GET',
    country: config.brightData.country
  };
  if (config.brightData.unblockDataFormat) payload.data_format = config.brightData.unblockDataFormat;

  const response =
    payload.format === 'raw'
      ? await fetchText(
          config.brightData.requestUrl,
          brightDataRequestOptions(config, payload),
          'Bright Data image scene ' + scene.scene_number
        )
      : await fetchJson(
          config.brightData.requestUrl,
          brightDataRequestOptions(config, payload),
          'Bright Data image scene ' + scene.scene_number
        );

  assertBrightDataOk(response);
  let parsed = getBrightDataPayload(response);
  if (!parsed && payload.format === 'raw') {
    const diagnostic = await fetchJson(
      config.brightData.requestUrl,
      brightDataRequestOptions(config, { ...payload, format: 'json' }),
      'Bright Data diagnostic scene ' + scene.scene_number
    );
    assertBrightDataOk(diagnostic);
    parsed = getBrightDataPayload(diagnostic);
  }
  if (!parsed) throw new Error('Bright Data devolvio una respuesta vacia o sin JSON parseable. Revisa que la cuenta y la zona SERP esten activas.');
  return parsed;
}

function brightDataRequestOptions(config, payload) {
  const headers = {
    Authorization: bearer(config.brightData.apiKey),
    'Content-Type': 'application/json'
  };
  if (config.brightData.unblockDataFormat) {
    headers['x-unblock-data-format'] = config.brightData.unblockDataFormat;
  }
  return {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  };
}

function bearer(value) {
  const token = String(value || '').trim();
  return /^Bearer\s+/i.test(token) ? token : 'Bearer ' + token;
}

function buildGoogleImagesUrl(query, config, start = 0) {
  const url = new URL('https://' + config.brightData.googleHost + '/search');
  url.searchParams.set('q', query || 'image');
  url.searchParams.set('udm', '2');
  url.searchParams.set('hl', config.brightData.language);
  url.searchParams.set('gl', config.brightData.country);
  url.searchParams.set('start', String(Math.max(0, start)));
  url.searchParams.set('brd_json', '1');
  return url.toString();
}

function assertBrightDataOk(response) {
  const statusCode = Number(response?.status_code || 0);
  if (statusCode >= 400) {
    const message = response?.headers?.['x-brd-err-msg'] || response?.headers?.['x-brd-error'] || response?.body || 'Bright Data internal status ' + statusCode;
    throw new Error('Bright Data devolvio status_code ' + statusCode + ': ' + String(message).slice(0, 500));
  }
}

function getBrightDataPayload(response) {
  const rawBody = response?.body?.body || response?.body || response;
  if (typeof rawBody === 'string' && rawBody.trim()) return JSON.parse(rawBody);
  if (rawBody && typeof rawBody === 'object') return rawBody;
  return null;
}

function chooseBrightDataImages(parsed, blockedDomains, count) {
  const images = [];
  const seen = new Set();
  const limit = Math.max(1, Number(count || 3));

  const add = (image) => {
    if (!image?.imageUrl || images.length >= limit) return;
    if (seen.has(image.imageUrl) || isBlocked(image.imageUrl, blockedDomains)) return;
    seen.add(image.imageUrl);
    images.push(image);
  };

  if (parsed && Array.isArray(parsed.images)) {
    for (const img of parsed.images) {
      add({ ...img, imageUrl: getImageUrl(img, blockedDomains) });
      if (images.length >= limit) break;
    }
  }

  if (images.length < limit) {
    for (const imageUrl of collectImageUrls(parsed)) {
      add({ imageUrl, rank: images.length + 1, title: 'imageGoogle' });
      if (images.length >= limit) break;
    }
  }

  return images;
}

function getImageUrl(img, blockedDomains) {
  const candidates = [
    img.original_image,
    img.original,
    img.image_url,
    img.thumbnail
  ].filter((url) => url && !String(url).startsWith('data:'));

  const safe = candidates.find((url) => !isBlocked(url, blockedDomains));
  return safe || candidates[0] || null;
}

function isBlocked(url, blockedDomains) {
  const value = String(url || '');
  if (!value || value.startsWith('data:')) return true;

  let host = '';
  try {
    host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return true;
  }

  return blockedDomains.some((domain) => host === domain || host.endsWith('.' + domain));
}

function collectImageUrls(value) {
  const urls = new Set();
  visit(value, urls);
  return [...urls].filter((url) => /^https?:\/\//i.test(url));
}

function visit(value, urls) {
  if (!value) return;
  if (typeof value === 'string') {
    for (const url of extractUrls(value)) urls.add(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, urls);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/image|thumbnail|src|url|link|original/i.test(key) && typeof item === 'string') {
        for (const url of extractUrls(item)) urls.add(url);
      }
      visit(item, urls);
    }
  }
}

function extractUrls(text) {
  const decoded = String(text)
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/');
  const matches = decoded.match(/https?:\/\/[^"'<>\\\s]+/g) || [];
  return matches
    .map((url) => url.replace(/[),.;]+$/, ''))
    .filter((url) => /\.(jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(url) || /googleusercontent|gstatic|encrypted-tbn/i.test(url));
}

