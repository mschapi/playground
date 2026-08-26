const baseUrl = requiredEnv('PUBLIC_BACKEND_URL').replace(/\/+$/, '');
const username = requiredEnv('PUBLIC_BACKEND_USER');
const password = requiredEnv('PUBLIC_BACKEND_PASSWORD');
const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
const scriptText = process.env.SMOKE_SCRIPT ||
  'Al amanecer, una mujer abre la ventana de su estudio. La luz entra, ilumina sus bocetos y ella elige uno para comenzar el dia.';

const existingJobId = process.env.SMOKE_JOB_ID;
const created = existingJobId ? null : await api('/api/jobs', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Smoke publico',
    scriptText,
    dryRun: false,
    autoAssets: false
  })
});
if (created) console.log('[smoke] job creado', created.id);

let job = existingJobId
  ? await api('/api/jobs/' + encodeURIComponent(existingJobId))
  : await pollJob(created.id, ['scenes_ready', 'error'], 6 * 60_000);
if (!['scenes_ready', 'ready', 'complete'].includes(job.status)) {
  job = await pollJob(job.id, ['scenes_ready', 'error'], 6 * 60_000);
}
if (job.status === 'error') throw new Error('Escenas: ' + job.error);
console.log('[smoke] escenas listas', job.scenes.length);

if (job.status === 'scenes_ready') {
  await api('/api/jobs/' + encodeURIComponent(job.id) + '/assets', {
    method: 'POST',
    body: JSON.stringify({ imageStylePrompt: job.imageStylePrompt || '' })
  });
  job = await pollJob(job.id, ['ready', 'error'], 12 * 60_000);
}
if (job.status === 'error') throw new Error('Assets: ' + job.error);

const counts = Object.fromEntries(
  Object.entries(job.assets || {}).map(([group, assets]) => [group, assets.length])
);
console.log('[smoke] assets listos', JSON.stringify(counts));

const selections = {};
for (const scene of job.scenes || []) {
  const asset = preferredAsset(job.assets, scene.scene_id);
  if (!asset) throw new Error('No hay asset utilizable para ' + scene.scene_id);
  selections[scene.scene_id] = [{ key: asset.key, startSeconds: 0 }];
}

await api('/api/jobs/' + encodeURIComponent(job.id) + '/render', {
  method: 'POST',
  body: JSON.stringify({
    selections,
    audioMode: 'full',
    subtitleStyle: {
      fontName: 'Chakra Petch',
      fontSize: 52,
      textColor: '#ffffff',
      backgroundColor: '#c21824'
    }
  })
});
job = await pollJob(job.id, ['complete', 'error'], 12 * 60_000);
if (job.status === 'error') throw new Error('Render: ' + job.error);

const videoCheck = job.video?.url
  ? await fetch(baseUrl + job.video.url, { headers: { Range: 'bytes=0-1023' } })
  : null;

console.log(JSON.stringify({
  ok: true,
  jobId: job.id,
  scenes: job.scenes.length,
  durationSeconds: job.scenes.reduce((sum, scene) => sum + Number(scene.duration_seconds || 0), 0),
  assets: counts,
  xmlFiles: job.xmlFiles?.length || 0,
  selectedXmlFiles: job.selectedXmlFiles?.length || 0,
  video: {
    ready: Boolean(job.video?.url),
    status: videoCheck?.status || null,
    contentType: videoCheck?.headers.get('content-type') || null
  },
  drive: job.drive || null
}));

async function api(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(120_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((data.error || 'HTTP ' + response.status) + ' [' + path + ']');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function pollJob(jobId, terminalStatuses, timeoutMs) {
  const startedAt = Date.now();
  let previousPhase = '';
  let transientFailures = 0;
  while (Date.now() - startedAt < timeoutMs) {
    let job;
    try {
      job = await api('/api/jobs/' + encodeURIComponent(jobId));
      transientFailures = 0;
    } catch (error) {
      if ([404, 502, 503, 504].includes(error.status) && transientFailures < 20) {
        transientFailures += 1;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      throw error;
    }
    if (job.phase !== previousPhase) {
      console.log('[smoke]', job.phase, Math.round(Number(job.progress || 0)) + '%');
      previousPhase = job.phase;
    }
    if (terminalStatuses.includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Timeout esperando job ' + jobId);
}

function preferredAsset(assets, sceneId) {
  const groups = ['aiImages', 'pexelsImages', 'brightDataImages', 'pexelsVideos'];
  for (const group of groups) {
    const asset = (assets?.[group] || []).find((item) => item.scene_id === sceneId && item.found !== false);
    if (asset) return asset;
  }
  return null;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('Falta ' + name);
  return value;
}

