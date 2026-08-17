import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../utils/env.js';
import { readGoogleDoc, extractGoogleDocId } from './googleDocs.js';

export async function readScriptInput(args) {
  const scriptFile = args['script-file'];
  const gdoc = args['gdoc-id'] || args['gdoc-url'] || env('SOURCE_GDOC_ID');

  if (gdoc && !scriptFile) {
    const documentId = extractGoogleDocId(gdoc);
    return {
      source: 'gdoc:' + documentId,
      text: await readGoogleDoc(documentId)
    };
  }

  const filePath = scriptFile || 'inputs/script.txt';
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(
      'No encontre guion. Pasa --script-file, --gdoc-id, SOURCE_GDOC_ID o crea ' + resolved
    );
  }

  return {
    source: resolved,
    text: readFileSync(resolved, 'utf8').trim()
  };
}
