const baseUrl = process.env.PUBLIC_BACKEND_URL?.replace(/\/+$/, '');
const username = process.env.PUBLIC_BACKEND_USER;
const password = process.env.PUBLIC_BACKEND_PASSWORD;
if (!baseUrl || !username || !password) throw new Error('Faltan variables PUBLIC_BACKEND_*');

const authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
const imageResponse = await fetch('https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg?auto=compress&cs=tinysrgb&w=640');
if (!imageResponse.ok) throw new Error('No se pudo descargar la imagen de prueba');
const imageDataUrl = 'data:image/jpeg;base64,' + Buffer.from(await imageResponse.arrayBuffer()).toString('base64');

let job = await api('/api/jobs', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Smoke render',
    scriptText: 'Una ventana se abre y entra la luz.',
    dryRun: false,
    autoAssets: false
  })
});
job = await poll(job.id, ['scenes_ready', 'error'], 6 * 60_000);
if (job.status === 'error') throw new Error(job.error);

for (const scene of job.scenes) {
  await api('/api/jobs/' + encodeURIComponent(job.id) + '/import-asset', {
    method: 'POST',
    body: JSON.stringify({
      scene_id: scene.scene_id,
      name: 'smoke.jpg',
      mimeType: 'image/jpeg',
      dataBase64: imageDataUrl
    })
  });
}

job = await api('/api/jobs/' + encodeURIComponent(job.id));
const selections = {};
for (const scene of job.scenes) {
  const asset = job.assets.aiImages.find((item) => item.scene_id === scene.scene_id);
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

job = await poll(job.id, ['complete', 'error'], 10 * 60_000);
if (job.status === 'error') throw new Error(job.error);
const video = await fetch(baseUrl + job.video.url, { headers: { Range: 'bytes=0-1023' } });
console.log(JSON.stringify({
  ok: true,
  jobId: job.id,
  scenes: job.scenes.length,
  durationSeconds: job.scenes.reduce((sum, scene) => sum + Number(scene.duration_seconds || 0), 0),
  videoStatus: video.status,
  videoType: video.headers.get('content-type'),
  selectedXmlFiles: job.selectedXmlFiles?.length || 0
}));

async function api(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(120_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function poll(jobId, terminalStatuses, timeoutMs) {
  const startedAt = Date.now();
  let transientFailures = 0;
  let previousPhase = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const current = await api('/api/jobs/' + encodeURIComponent(jobId));
      transientFailures = 0;
      if (current.phase !== previousPhase) {
        console.log('[render-smoke]', current.phase);
        previousPhase = current.phase;
      }
      if (terminalStatuses.includes(current.status)) return current;
    } catch (error) {
      if (![404, 502, 503, 504].includes(error.status) || transientFailures >= 20) throw error;
      transientFailures += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Timeout esperando ' + jobId);
}

