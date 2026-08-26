import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadedFileKeys = new Set();
const keyAliases = new Map([
  ['openai', 'OPENAI_API_KEY'],
  ['open_ai', 'OPENAI_API_KEY'],
  ['openai_key', 'OPENAI_API_KEY'],
  ['open_ai_key', 'OPENAI_API_KEY'],
  ['pexels', 'PEXELS_API_KEY'],
  ['pexels_key', 'PEXELS_API_KEY'],
  ['brightdata', 'BRIGHTDATA_API_KEY'],
  ['bright_data', 'BRIGHTDATA_API_KEY'],
  ['brightdata_key', 'BRIGHTDATA_API_KEY'],
  ['bright_data_key', 'BRIGHTDATA_API_KEY'],
  ['serp_api_key', 'BRIGHTDATA_API_KEY'],
  ['brightdata_zone', 'BRIGHTDATA_ZONE'],
  ['bright_data_zone', 'BRIGHTDATA_ZONE'],
  ['serp_zone', 'BRIGHTDATA_ZONE'],
  ['brightdata_country', 'BRIGHTDATA_COUNTRY'],
  ['bright_data_country', 'BRIGHTDATA_COUNTRY'],
  ['brightdata_language', 'BRIGHTDATA_LANGUAGE'],
  ['bright_data_language', 'BRIGHTDATA_LANGUAGE'],
  ['brightdata_format', 'BRIGHTDATA_FORMAT'],
  ['bright_data_format', 'BRIGHTDATA_FORMAT'],
  ['brightdata_unblock_data_format', 'BRIGHTDATA_UNBLOCK_DATA_FORMAT'],
  ['bright_data_unblock_data_format', 'BRIGHTDATA_UNBLOCK_DATA_FORMAT'],
  ['drive_parent_folder', 'DRIVE_PARENT_FOLDER_ID'],
  ['drive_parent_folder_id', 'DRIVE_PARENT_FOLDER_ID'],
  ['backend_token', 'PIPELINE_ACCESS_TOKEN'],
  ['pipeline_token', 'PIPELINE_ACCESS_TOKEN'],
  ['pipeline_access_token', 'PIPELINE_ACCESS_TOKEN']
]);

export function loadDotEnv(filePath = '.env', options = {}) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) return;

  const raw = readFileSync(resolved, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_ -]*)\s*[:=]\s*(.*)$/);
    if (!match) continue;

    const [, rawKey, rawValue] = match;
    const key = normalizeEnvKey(rawKey);
    const canOverride = process.env[key] === undefined || (options.override && loadedFileKeys.has(key));
    if (!canOverride) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    loadedFileKeys.add(key);
  }
}

function normalizeEnvKey(key) {
  const clean = String(key || '').trim().replace(/[ -]+/g, '_');
  return keyAliases.get(clean.toLowerCase()) || clean;
}

export function env(name, options = {}) {
  const { required = false, defaultValue = undefined } = options;
  const value = process.env[name];
  if ((value === undefined || value === '') && required) {
    throw new Error('Falta configurar ' + name);
  }
  return value === undefined || value === '' ? defaultValue : value;
}

export function boolEnv(name, defaultValue = false) {
  const value = env(name);
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'y', 'si'].includes(value.toLowerCase());
}

export function numberEnv(name, defaultValue) {
  const value = env(name);
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(name + ' debe ser numerico');
  return parsed;
}

