from pathlib import Path
import json
import shutil
from datetime import datetime, timezone


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing patch marker: {label}')
    return text.replace(old, new, 1)


server = read('src/server.js')
server = replace_once(server, "import { extname, join, parse, relative, resolve } from 'node:path';", "import { extname, join, parse, relative, resolve, sep } from 'node:path';", 'server path import')
server = replace_once(server, "} from './utils/files.js';\n\nconst PORT = Number(process.env.PORT || 8787);\nconst ROOT = resolve('.');\nconst WEB_ROOT = resolve('web');\nconst config = loadConfig();\nconst jobs = new Map();", "} from './utils/files.js';\nimport { env, numberEnv } from './utils/env.js';\n\nconst ROOT = resolve('.');\nconst WEB_ROOT = resolve('web');\nconst config = loadConfig();\nconst PORT = Number(process.env.PORT || 8787);\nconst HOST = process.env.HOST || '0.0.0.0';\nconst serverSettings = loadServerSettings();\nconst jobs = new Map();", 'server imports/constants')
server = replace_once(server, "  try {\n    await route(request, response);", "  try {\n    if (isProtectedApiRequest(request) && !isAuthorized(request)) {\n      return sendJson(response, 401, { error: 'Backend protegido: configura el token en Servidor' });\n    }\n    await route(request, response);", 'server auth gate')
server_helpers = """server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('[web] listo en http://' + displayHost + ':' + PORT);
  if (serverSettings.publicBaseUrl) console.log('[web] backend publico ' + serverSettings.publicBaseUrl);
});

function loadServerSettings() {
  return {
    accessToken: env('PIPELINE_ACCESS_TOKEN', { defaultValue: env('BACKEND_ACCESS_TOKEN', { defaultValue: '' }) }),
    publicBaseUrl: cleanBaseUrl(env('PUBLIC_BASE_URL', { defaultValue: '' })),
    scriptJsonLimitBytes: megabytesEnv('MAX_SCRIPT_JSON_MB', 2),
    sceneJsonLimitBytes: megabytesEnv('MAX_SCENE_JSON_MB', 20),
    assetRequestJsonLimitBytes: megabytesEnv('MAX_ASSET_REQUEST_JSON_MB', 4),
    uploadJsonLimitBytes: megabytesEnv('MAX_UPLOAD_JSON_MB', 80),
    renderJsonLimitBytes: megabytesEnv('MAX_RENDER_JSON_MB', 300)
  };
}

function megabytesEnv(name, fallback) {
  const value = numberEnv(name, fallback);
  return Math.max(1, value) * 1024 * 1024;
}

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isProtectedApiRequest(request) {
  if (!serverSettings.accessToken) return false;
  const url = new URL(request.url, 'http://localhost:' + PORT);
  if (!url.pathname.startsWith('/api/')) return false;
  if (request.method === 'GET' && /^\/api\/jobs\/[^/]+\/(?:file|download)$/.test(url.pathname)) return false;
  return !(url.pathname === '/api/health' || url.pathname === '/api/preflight');
}

function isAuthorized(request) {
  return readAccessToken(request) === serverSettings.accessToken;
}

function readAccessToken(request) {
  const authHeader = String(request.headers.authorization || '');
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  return String(bearer || request.headers['x-pipeline-token'] || '').trim();
}

function safeServerSummary() {
  return {
    host: HOST,
    port: PORT,
    publicBaseUrl: serverSettings.publicBaseUrl || null,
    authRequired: Boolean(serverSettings.accessToken),
    corsOrigin: process.env.CORS_ORIGIN || '*',
    limitsMb: {
      scriptJson: bytesToMb(serverSettings.scriptJsonLimitBytes),
      sceneJson: bytesToMb(serverSettings.sceneJsonLimitBytes),
      assetRequestJson: bytesToMb(serverSettings.assetRequestJsonLimitBytes),
      uploadJson: bytesToMb(serverSettings.uploadJsonLimitBytes),
      renderJson: bytesToMb(serverSettings.renderJsonLimitBytes)
    }
  };
}

function bytesToMb(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}

async function route(request, response) {"""
server = replace_once(server, "server.listen(PORT, () => {\n  console.log('[web] listo en http://localhost:' + PORT);\n});\n\nasync function route(request, response) {", server_helpers, 'server helpers')
server = replace_once(server, "      videoEnabled: config.video.enabled,\n      outputRoot: config.outputRoot", "      videoEnabled: config.video.enabled,\n      outputRoot: config.outputRoot,\n      authRequired: Boolean(serverSettings.accessToken),\n      publicBaseUrl: serverSettings.publicBaseUrl || null,\n      server: safeServerSummary()", 'server health')
server = replace_once(server, "const body = await readJsonBody(request);", "const body = await readJsonBody(request, serverSettings.scriptJsonLimitBytes);", 'server job body limit')
server = replace_once(server, "const body = await readJsonBody(request, 20 * 1024 * 1024);", "const body = await readJsonBody(request, serverSettings.sceneJsonLimitBytes);", 'server scenes body limit')
server = replace_once(server, "const body = await readJsonBody(request, 4 * 1024 * 1024);", "const body = await readJsonBody(request, serverSettings.assetRequestJsonLimitBytes);", 'server assets body limit')
server = replace_once(server, "const body = await readJsonBody(request, 80 * 1024 * 1024);", "const body = await readJsonBody(request, serverSettings.uploadJsonLimitBytes);", 'server import body limit')
server = replace_once(server, "const body = await readJsonBody(request, 300 * 1024 * 1024);", "const body = await readJsonBody(request, serverSettings.renderJsonLimitBytes);", 'server render body limit')
server = replace_once(server, "    checks,\n    config: safeConfigSummary()", "    checks,\n    config: safeConfigSummary(),\n    server: safeServerSummary()", 'server preflight summary')
server = replace_once(server, "function sendJobFile(response, job, relPath, request) {\n  const resolved = resolve(job.jobDir, relPath);\n  if (!resolved.startsWith(resolve(job.jobDir))) {", "function sendJobFile(response, job, relPath, request) {\n  const resolved = resolve(job.jobDir, relPath);\n  const rootDir = resolve(job.jobDir);\n  if (resolved !== rootDir && !resolved.startsWith(rootDir + sep)) {", 'server file path')
server = replace_once(server, "  if (!resolved.startsWith(WEB_ROOT) || !existsSync(resolved)) {", "  if ((resolved !== WEB_ROOT && !resolved.startsWith(WEB_ROOT + sep)) || !existsSync(resolved)) {", 'server static path')
server = replace_once(server, "if (size > limit) throw new Error('Payload demasiado grande');", "if (size > limit) throw new Error('Payload demasiado grande. Limite actual: ' + bytesToMb(limit) + ' MB');", 'server payload message')
server = replace_once(server, "'Access-Control-Allow-Headers': 'Content-Type,Range',", "'Access-Control-Allow-Headers': 'Content-Type,Range,Authorization,X-Pipeline-Token',", 'server cors headers')
write('src/server.js', server)

envjs = read('src/utils/env.js')
envjs = replace_once(envjs, "  ['drive_parent_folder', 'DRIVE_PARENT_FOLDER_ID'],\n  ['drive_parent_folder_id', 'DRIVE_PARENT_FOLDER_ID']", "  ['drive_parent_folder', 'DRIVE_PARENT_FOLDER_ID'],\n  ['drive_parent_folder_id', 'DRIVE_PARENT_FOLDER_ID'],\n  ['backend_token', 'PIPELINE_ACCESS_TOKEN'],\n  ['pipeline_token', 'PIPELINE_ACCESS_TOKEN'],\n  ['pipeline_access_token', 'PIPELINE_ACCESS_TOKEN']", 'env aliases')
write('src/utils/env.js', envjs)

html = read('web/index.html')
html = html.replace('styles.css?v=20260825-subtitles', 'styles.css?v=20260825-general-backend')
html = html.replace('app.js?v=20260825-subtitles', 'app.js?v=20260825-general-backend')
html = replace_once(html, "        <label class=\"field-label\">Backend\n          <input class=\"scene-input\" id=\"apiBaseInput\" placeholder=\"https://tu-backend.com\" />\n        </label>\n        <div class=\"actions-row compact-actions\">", "        <label class=\"field-label\">Backend\n          <input class=\"scene-input\" id=\"apiBaseInput\" placeholder=\"https://tu-backend.com\" />\n        </label>\n        <label class=\"field-label\">Token\n          <input class=\"scene-input\" id=\"apiTokenInput\" type=\"password\" autocomplete=\"off\" placeholder=\"Opcional\" />\n        </label>\n        <div class=\"actions-row compact-actions\">", 'html token field')
write('web/index.html', html)

css = read('web/styles.css')
css = replace_once(css, 'grid-template-columns: minmax(260px, 1fr) auto;', 'grid-template-columns: minmax(260px, 1fr) minmax(180px, 260px) auto;', 'server panel grid')
write('web/styles.css', css)

app = read('web/app.js')
app = replace_once(app, 'let API_BASE = resolveApiBase();', 'let API_BASE = resolveApiBase();\nlet API_TOKEN = resolveApiToken();', 'app token global')
app = replace_once(app, "  serverPanel: document.querySelector('#serverPanel'),\n  apiBaseInput: document.querySelector('#apiBaseInput'),", "  serverPanel: document.querySelector('#serverPanel'),\n  apiBaseInput: document.querySelector('#apiBaseInput'),\n  apiTokenInput: document.querySelector('#apiTokenInput'),", 'app token element')
old_health = """async function loadHealth() {
  try {
    const health = await api('/api/health', { timeoutMs: 3500 });
    if (health.apiReady) {
      els.envStatus.textContent = 'APIs listas';
      els.envStatus.className = 'status-pill ready';
      els.dryRunToggle.checked = false;
    } else {
      els.envStatus.textContent = 'Modo prueba';
      els.envStatus.className = 'status-pill warn';
      els.dryRunToggle.checked = true;
    }
  } catch {
    if (await tryLocalBackendFallback()) return;
    els.envStatus.textContent = isPublishedPage() ? 'Sin backend publico' : 'Sin backend';
    els.envStatus.className = 'status-pill warn';
    els.serverPanel.hidden = false;
    syncServerInput();
  }
}
"""
new_health = """async function loadHealth() {
  try {
    const health = await api('/api/health', { timeoutMs: 3500 });
    if (health.authRequired && !API_TOKEN) {
      els.envStatus.textContent = 'Token requerido';
      els.envStatus.className = 'status-pill warn';
      els.serverPanel.hidden = false;
      syncServerInput();
    }
    if (health.apiReady) {
      if (!health.authRequired || API_TOKEN) {
        els.envStatus.textContent = 'APIs listas';
        els.envStatus.className = 'status-pill ready';
      }
      els.dryRunToggle.checked = false;
    } else {
      if (!health.authRequired || API_TOKEN) {
        els.envStatus.textContent = 'Modo prueba';
        els.envStatus.className = 'status-pill warn';
      }
      els.dryRunToggle.checked = true;
    }
  } catch {
    if (await tryLocalBackendFallback()) return;
    els.envStatus.textContent = isPublishedPage() ? 'Sin backend publico' : 'Sin backend';
    els.envStatus.className = 'status-pill warn';
    els.serverPanel.hidden = false;
    syncServerInput();
  }
}
"""
app = replace_once(app, old_health, new_health, 'app loadHealth')
app = replace_once(app, "    apiBase: API_BASE || 'local',\n    publishedPage: isPublishedPage(),", "    apiBase: API_BASE || 'local',\n    hasApiToken: Boolean(API_TOKEN),\n    publishedPage: isPublishedPage(),", 'app debug token')
old_api_block = """async function api(path, options = {}) {
  if (!API_BASE && isPublishedPage()) {
    throw new Error('Falta configurar un backend HTTPS en Servidor');
  }
  const { timeoutMs, ...fetchOptions } = options;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller?.signal,
      ...fetchOptions
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Backend no responde');
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

function syncServerInput() {
  els.apiBaseInput.value = API_BASE || '';
}

async function saveServerBase() {
  const clean = els.apiBaseInput.value.trim().replace(/\/$/, '');
  if (!clean) return clearServerBase();
  localStorage.setItem('playgroundApiBase', clean);
  API_BASE = clean;
  await loadHealth();
  await loadPreflight();
  renderAll();
}

async function useLocalServerBase() {
  const localBase = 'http://localhost:8787';
  localStorage.setItem('playgroundApiBase', localBase);
  API_BASE = localBase;
  syncServerInput();
  await loadHealth();
  await loadPreflight();
  renderAll();
}

async function clearServerBase() {
  localStorage.removeItem('playgroundApiBase');
  API_BASE = resolveApiBase();
  syncServerInput();
  await loadHealth();
  await loadPreflight();
  renderAll();
}
"""
new_api_block = """async function api(path, options = {}) {
  if (!API_BASE && isPublishedPage()) {
    throw new Error('Falta configurar un backend HTTPS en Servidor');
  }
  const { timeoutMs, headers: customHeaders = {}, ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json', ...customHeaders };
  if (API_TOKEN) headers.Authorization = 'Bearer ' + API_TOKEN;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(API_BASE + path, {
      headers,
      signal: controller?.signal,
      ...fetchOptions
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Backend no responde');
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    els.serverPanel.hidden = false;
    syncServerInput();
  }
  if (!response.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}

function syncServerInput() {
  els.apiBaseInput.value = API_BASE || '';
  if (els.apiTokenInput) els.apiTokenInput.value = API_TOKEN || '';
}

async function saveServerBase() {
  const clean = els.apiBaseInput.value.trim().replace(/\/$/, '');
  const token = els.apiTokenInput?.value.trim() || '';
  if (!clean) return clearServerBase();
  localStorage.setItem('playgroundApiBase', clean);
  if (token) localStorage.setItem('playgroundApiToken', token);
  else localStorage.removeItem('playgroundApiToken');
  API_BASE = clean;
  API_TOKEN = token;
  await loadHealth();
  await loadPreflight();
  renderAll();
}

async function useLocalServerBase() {
  const localBase = 'http://localhost:8787';
  localStorage.setItem('playgroundApiBase', localBase);
  API_BASE = localBase;
  API_TOKEN = els.apiTokenInput?.value.trim() || API_TOKEN;
  if (API_TOKEN) localStorage.setItem('playgroundApiToken', API_TOKEN);
  syncServerInput();
  await loadHealth();
  await loadPreflight();
  renderAll();
}

async function clearServerBase() {
  localStorage.removeItem('playgroundApiBase');
  localStorage.removeItem('playgroundApiToken');
  API_BASE = resolveApiBase();
  API_TOKEN = resolveApiToken();
  syncServerInput();
  await loadHealth();
  await loadPreflight();
  renderAll();
}
"""
app = replace_once(app, old_api_block, new_api_block, 'app api block')
app = app.rstrip() + """

function resolveApiToken() {
  const params = new URLSearchParams(location.search);
  const queryToken = params.get('apiToken') || params.get('token');
  if (queryToken) {
    localStorage.setItem('playgroundApiToken', queryToken);
    return queryToken;
  }
  return localStorage.getItem('playgroundApiToken') || '';
}
"""
write('web/app.js', app)

env_example = read('.env.example')
server_block = """# Backend / servidor
HOST=0.0.0.0
PORT=8787
PUBLIC_BASE_URL=
CORS_ORIGIN=*
PIPELINE_ACCESS_TOKEN=
OUTPUT_ROOT=outputs/jobs
MAX_SCRIPT_JSON_MB=2
MAX_SCENE_JSON_MB=20
MAX_ASSET_REQUEST_JSON_MB=4
MAX_UPLOAD_JSON_MB=80
MAX_RENDER_JSON_MB=300

"""
env_example = replace_once(env_example, "# Si existen .env y keys.txt, keys.txt gana para las API keys locales.\n\n", "# Si existen .env y keys.txt, keys.txt gana para las API keys locales.\n\n" + server_block, 'env server block')
write('.env.example', env_example)

keys = read('keys.example.txt')
if 'pipeline_token=' not in keys:
    keys = keys.rstrip() + '\npipeline_token=xx_backend_token_opcional\n'
write('keys.example.txt', keys)

pkg = json.loads(read('package.json'))
scripts = pkg.setdefault('scripts', {})
scripts.setdefault('start', 'node src/server.js')
scripts['check'] = 'node --check src/index.js && node --check src/server.js && node --check web/app.js && node --check src/video/ffmpeg.js'
write('package.json', json.dumps(pkg, indent=2, ensure_ascii=False) + '\n')

readme = read('README.md')
backend_section = """
## Backend general para compartir

El backend ya puede correr como servicio generico. Cada persona o equipo puede desplegarlo con sus propias keys sin tocar codigo.

Variables nuevas:

- `HOST=0.0.0.0`, necesario en Docker o plataformas cloud.
- `PORT=8787`, o el puerto que te asigne el proveedor.
- `PUBLIC_BASE_URL=https://tu-backend.com`, opcional para documentar la URL publica en health/preflight.
- `CORS_ORIGIN=https://mschapi.github.io`, o `*` si queres permitir cualquier frontend.
- `PIPELINE_ACCESS_TOKEN=...`, opcional pero recomendado para que otros no gasten tus APIs sin permiso.
- `OUTPUT_ROOT=/data/jobs`, recomendado en Docker con volumen persistente.
- `MAX_SCRIPT_JSON_MB`, `MAX_SCENE_JSON_MB`, `MAX_ASSET_REQUEST_JSON_MB`, `MAX_UPLOAD_JSON_MB`, `MAX_RENDER_JSON_MB`, limites configurables por entorno.

Para correrlo local:

```bash
cp .env.example .env
npm install
npm run setup:fonts
npm start
```

Para correrlo con Docker:

```bash
docker build -t playground-backend .
docker run --rm -p 8787:8787 --env-file .env -v playground_jobs:/data/jobs playground-backend
```

En la web publicada, tocar `Servidor` y completar la URL HTTPS del backend. Si `PIPELINE_ACCESS_TOKEN` esta configurado, pegar ese token tambien. El token queda guardado solo en el navegador del usuario.

Tambien funciona por URL:

```txt
https://mschapi.github.io/playground/?apiBase=https://tu-backend.com&apiToken=tu_token
```

Hay mas detalle en `BACKEND_DEPLOY.md` y un ejemplo de despliegue en `render.yaml`.

"""
if '## Backend general para compartir' not in readme:
    readme = replace_once(readme, '## Debug y preflight\n', backend_section + '## Debug y preflight\n', 'readme backend section')
if '## Variables principales\n\n- `HOST=0.0.0.0`' not in readme:
    readme = replace_once(readme, '## Variables principales\n\n', '## Variables principales\n\n- `HOST=0.0.0.0`\n- `PORT=8787`\n- `PUBLIC_BASE_URL`\n- `CORS_ORIGIN`\n- `PIPELINE_ACCESS_TOKEN`, recomendado en backends compartidos\n- `OUTPUT_ROOT`\n', 'readme vars')
old_pages = """## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` publica la UI estatica de `web/` en GitHub Pages. Esa UI no contiene secrets. Para usar APIs sin exponer keys necesita conectarse a un backend Node con `src/server.js` corriendo en una maquina o servidor.

En local:

```bash
node src/server.js
```

En una pagina publicada, usa el boton `Servidor` para guardar el backend publico. Tambien podes pasarlo por query string:

```txt
https://mschapi.github.io/playground/?apiBase=https://tu-backend.com
```
"""
new_pages = """## GitHub Pages

GitHub Pages publica solo la UI estatica. Esa UI no contiene secrets. Para usar APIs sin exponer keys necesita conectarse a un backend Node con `src/server.js` corriendo en una maquina o servidor HTTPS.

En local:

```bash
npm start
```

En una pagina publicada, usa el boton `Servidor` para guardar el backend publico y el token si corresponde. Tambien podes pasarlo por query string:

```txt
https://mschapi.github.io/playground/?apiBase=https://tu-backend.com&apiToken=tu_token
```
"""
readme = replace_once(readme, old_pages, new_pages, 'readme pages')
write('README.md', readme)

write('Dockerfile', """FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN node scripts/setup-fonts.mjs || echo "Chakra Petch no se pudo descargar durante el build; el render usara la fuente disponible."

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV OUTPUT_ROOT=/data/jobs
ENV FFMPEG_PATH=ffmpeg

VOLUME ["/data/jobs"]
EXPOSE 8787

CMD ["node", "src/server.js"]
""")
write('.dockerignore', """node_modules/
.git/
.env
.env.*
!.env.example
keys.txt
outputs/
work/
tools/
*.log
*.zip
""")
write('render.yaml', """services:
  - type: web
    name: playground-backend
    env: docker
    healthCheckPath: /api/health
    disk:
      name: playground-jobs
      mountPath: /data
      sizeGB: 10
    envVars:
      - key: HOST
        value: 0.0.0.0
      - key: PORT
        value: 8787
      - key: OUTPUT_ROOT
        value: /data/jobs
      - key: FFMPEG_PATH
        value: ffmpeg
      - key: CORS_ORIGIN
        value: https://mschapi.github.io
      - key: DRIVE_UPLOAD
        value: false
      - key: PIPELINE_ACCESS_TOKEN
        generateValue: true
      - key: OPENAI_API_KEY
        sync: false
      - key: PEXELS_API_KEY
        sync: false
      - key: BRIGHTDATA_API_KEY
        sync: false
      - key: BRIGHTDATA_ZONE
        value: serp_api1
      - key: GOOGLE_SERVICE_ACCOUNT_JSON
        sync: false
      - key: DRIVE_PARENT_FOLDER_ID
        sync: false
""")
write('BACKEND_DEPLOY.md', """# Backend general

La web de GitHub Pages es estatica. Para que cualquiera pueda usar GPT, Pexels, Bright Data, Drive y FFmpeg, cada instalacion necesita un backend Node publico con sus propias keys.

## Local

```bash
cp .env.example .env
npm install
npm run setup:fonts
npm start
```

Despues abrir `http://localhost:8787`.

## Docker

```bash
docker build -t playground-backend .
docker run --rm -p 8787:8787 --env-file .env -v playground_jobs:/data/jobs playground-backend
```

## Variables importantes

- `OPENAI_API_KEY`, `PEXELS_API_KEY`, `BRIGHTDATA_API_KEY`: APIs principales.
- `PIPELINE_ACCESS_TOKEN`: token opcional para proteger jobs y gasto de APIs.
- `PUBLIC_BASE_URL`: URL publica del backend, por ejemplo `https://playground-backend.example.com`.
- `CORS_ORIGIN`: origen permitido para la web. Para tu Pages: `https://mschapi.github.io`.
- `OUTPUT_ROOT`: carpeta persistente para jobs. En Docker conviene `/data/jobs`.
- `FFMPEG_PATH`: en Docker queda `ffmpeg`; en Windows local puede apuntar a `tools/ffmpeg/.../ffmpeg.exe`.
- `DRIVE_UPLOAD`: para backends publicos compartidos conviene empezar con `false` y activarlo cuando Drive este configurado.

## Usar desde GitHub Pages

En la pagina, tocar `Servidor` y completar:

- Backend: la URL HTTPS publica del backend.
- Token: el valor de `PIPELINE_ACCESS_TOKEN`, si lo configuraste.

Tambien se puede abrir con query string:

```txt
https://mschapi.github.io/playground/?apiBase=https://tu-backend.com&apiToken=tu_token
```

El token se guarda solo en el navegador de esa persona. No se sube al repo.
""")

docs = Path('docs')
docs.mkdir(exist_ok=True)
for name in ['index.html', 'app.js', 'styles.css']:
    shutil.copyfile(Path('web') / name, docs / name)
write('docs/deploy-version.txt', 'codex-general-backend ' + datetime.now(timezone.utc).isoformat() + '\n')

for temp_path in ['.github/workflows/codex-general-backend.yml', 'scripts/codex-general-backend-patch.py']:
    path = Path(temp_path)
    if path.exists():
        path.unlink()
