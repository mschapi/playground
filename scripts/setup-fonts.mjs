import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const fontUrl =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/chakrapetch/ChakraPetch-Regular.ttf';
const outPath = resolve('assets/fonts/ChakraPetch-Regular.ttf');

if (existsSync(outPath)) {
  console.log('[fonts] Chakra Petch ya esta en ' + outPath);
  process.exit(0);
}

mkdirSync(dirname(outPath), { recursive: true });

const response = await fetch(fontUrl);
if (!response.ok || !response.body) {
  throw new Error('[fonts] No pude descargar Chakra Petch: HTTP ' + response.status);
}

await pipeline(response.body, createWriteStream(outPath));
console.log('[fonts] Chakra Petch descargada en ' + outPath);
