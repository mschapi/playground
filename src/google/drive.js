import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { getGoogleAccessToken } from './auth.js';
import { fetchJson } from '../utils/http.js';
import { guessMimeType, relativeDirectory, walkFiles, writeJson } from '../utils/files.js';

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MULTIPART_LIMIT_BYTES = 5 * 1024 * 1024;

export async function uploadJobDirectoryToDrive({ jobDir, folderName, parentFolderId, driveId }) {
  const rootParentId = parentFolderId || driveId;
  if (!rootParentId) throw new Error('Falta DRIVE_PARENT_FOLDER_ID o DRIVE_ID para subir a Drive');

  const token = await getGoogleAccessToken(DRIVE_SCOPES);
  const rootFolder = await createFolder(token, folderName, rootParentId);
  const folderCache = new Map([['.', rootFolder.id]]);
  const uploaded = [];

  for (const filePath of walkFiles(jobDir)) {
    const relDir = relativeDirectory(jobDir, filePath);
    const driveParentId = await ensureDriveFolderPath({
      token,
      rootFolderId: rootFolder.id,
      folderCache,
      relDir
    });
    const result = await uploadFile(token, filePath, driveParentId);
    uploaded.push({
      localPath: filePath,
      relativePath: relative(jobDir, filePath),
      ...result
    });
  }

  const manifest = {
    rootFolder,
    uploadedAt: new Date().toISOString(),
    files: uploaded
  };
  writeJson(join(jobDir, 'drive-upload-manifest.json'), manifest);
  return manifest;
}

async function ensureDriveFolderPath({ token, rootFolderId, folderCache, relDir }) {
  if (folderCache.has(relDir)) return folderCache.get(relDir);
  const parts = relDir.split(/[\\/]+/).filter(Boolean);
  let currentRel = '.';
  let currentId = rootFolderId;
  for (const part of parts) {
    currentRel = currentRel === '.' ? part : join(currentRel, part);
    if (!folderCache.has(currentRel)) {
      const folder = await createFolder(token, part, currentId);
      folderCache.set(currentRel, folder.id);
    }
    currentId = folderCache.get(currentRel);
  }
  return currentId;
}

async function createFolder(token, name, parentId) {
  return fetchJson(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: parentId ? [parentId] : undefined
      })
    },
    `Drive create folder ${name}`
  );
}

async function uploadFile(token, filePath, parentId) {
  const size = statSync(filePath).size;
  if (size > MULTIPART_LIMIT_BYTES) {
    return uploadFileResumable(token, filePath, parentId);
  }
  return uploadFileMultipart(token, filePath, parentId);
}

async function uploadFileMultipart(token, filePath, parentId) {
  const mimeType = guessMimeType(filePath);
  const boundary = `codex_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: basename(filePath),
    parents: [parentId]
  };
  const file = readFileSync(filePath);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  return fetchJson(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body
    },
    `Drive upload ${filePath}`
  );
}

async function uploadFileResumable(token, filePath, parentId) {
  const mimeType = guessMimeType(filePath);
  const size = statSync(filePath).size;
  const metadata = {
    name: basename(filePath),
    parents: [parentId]
  };

  const session = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,mimeType,size&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(size)
      },
      body: JSON.stringify(metadata)
    }
  );
  if (!session.ok) {
    throw new Error(`Drive resumable init fallo: HTTP ${session.status} ${await session.text()}`);
  }
  const uploadUrl = session.headers.get('location');
  if (!uploadUrl) throw new Error('Drive no devolvio Location para upload resumable');

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(size)
    },
    body: readFileSync(filePath)
  });
  const text = await upload.text();
  if (!upload.ok) {
    throw new Error(`Drive resumable upload fallo: HTTP ${upload.status} ${text}`);
  }
  return JSON.parse(text);
}

