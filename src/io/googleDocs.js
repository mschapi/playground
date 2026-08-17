import { getGoogleAccessToken } from '../google/auth.js';
import { fetchJson } from '../utils/http.js';

const DOCS_SCOPES = ['https://www.googleapis.com/auth/documents.readonly'];

export async function readGoogleDoc(documentId) {
  const token = await getGoogleAccessToken(DOCS_SCOPES);
  const url = new URL(`https://docs.googleapis.com/v1/documents/${documentId}`);
  url.searchParams.set('includeTabsContent', 'true');

  const document = await fetchJson(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    'Google Docs documents.get'
  );

  return collectDocumentText(document);
}

export function extractGoogleDocId(value) {
  if (!value) return '';
  const match = String(value).match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return String(value).trim();
}

function collectDocumentText(document) {
  const chunks = [];
  if (document.body?.content) {
    chunks.push(...collectStructuralElements(document.body.content));
  }
  if (Array.isArray(document.tabs)) {
    for (const tab of document.tabs) collectTabText(tab, chunks);
  }
  return chunks.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function collectTabText(tab, chunks) {
  if (tab.documentTab?.body?.content) {
    chunks.push(...collectStructuralElements(tab.documentTab.body.content));
  }
  if (Array.isArray(tab.childTabs)) {
    for (const child of tab.childTabs) collectTabText(child, chunks);
  }
}

function collectStructuralElements(elements) {
  const chunks = [];
  for (const element of elements || []) {
    if (element.paragraph) {
      for (const part of element.paragraph.elements || []) {
        const text = part.textRun?.content;
        if (text) chunks.push(text);
      }
    }
    if (element.table) {
      for (const row of element.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          chunks.push(...collectStructuralElements(cell.content));
        }
      }
    }
  }
  return chunks;
}

