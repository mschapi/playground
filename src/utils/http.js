import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ensureDir } from './files.js';
import { dirname } from 'node:path';

export async function fetchJson(url, options = {}, context = 'request') {
  const response = await fetchWithContext(url, options, context);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context} fallo con HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} no devolvio JSON valido: ${error.message}`);
  }
}

export async function fetchText(url, options = {}, context = 'request') {
  const response = await fetchWithContext(url, options, context);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context} fallo con HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  return text;
}

export async function downloadFile(url, destination, options = {}) {
  const response = await fetchWithContext(url, {
    headers: options.headers || {}
  }, 'Download ' + url);
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`No se pudo descargar ${url}: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  ensureDir(dirname(destination));
  await pipeline(response.body, createWriteStream(destination));
  return {
    contentType: response.headers.get('content-type') || '',
    contentLength: response.headers.get('content-length') || ''
  };
}

export function extensionFromUrl(url, fallback = '.bin') {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\.(jpe?g|png|webp|gif|mp4|mov)(?:$|\?)/i);
    return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : fallback;
  } catch {
    return fallback;
  }
}


async function fetchWithContext(url, options, context) {
  try {
    return await fetch(url, options);
  } catch (error) {
    const cause = error.cause?.message || error.cause?.code || error.message;
    throw new Error(context + ' no pudo conectar: ' + cause);
  }
}
