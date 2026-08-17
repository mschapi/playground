import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(filePath, value) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, value, 'utf8');
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function timestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function compactRunId(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0');
  return `run_${[
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')}`;
}

export function sanitizeAssetTitle(value, fallback = 'asset') {
  const cleaned = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['"]/g, '')
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return cleaned || fallback;
}

export function walkFiles(rootDir) {
  if (!existsSync(rootDir)) return [];
  const files = [];
  for (const entry of readdirSync(rootDir)) {
    const fullPath = join(rootDir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) files.push(...walkFiles(fullPath));
    if (stats.isFile()) files.push(fullPath);
  }
  return files;
}

export function relativeDirectory(rootDir, filePath) {
  const rel = relative(resolve(rootDir), dirname(resolve(filePath)));
  return rel === '' ? '.' : rel;
}

export function guessMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  const table = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.zip': 'application/zip',
    '.ass': 'text/plain'
  };
  return table[ext] || 'application/octet-stream';
}

