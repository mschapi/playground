const DEFAULT_PUBLIC_API_BASE = 'https://playground-backend-q4cn.onrender.com';
let API_BASE = resolveApiBase();
let API_TOKEN = resolveApiToken();
let API_USERNAME = resolveApiUsername();
let API_PASSWORD = resolveApiPassword();

const state = {
  job: null,
  pollTimer: null,
  builderIndex: 0,
  selections: {},
  audio: null,
  audioMode: 'full',
  sceneAudios: {},
  subtitleStyle: {
    fontName: 'Chakra Petch',
    fontSize: 52,
    textColor: '#ffffff',
    backgroundColor: '#c21824'
  },
  imageStylePrompt: '',
  stylePromptOpen: false,
  preflight: null,
  multiSelect: false
};

const els = {
  envStatus: document.querySelector('#envStatus'),
  serverButton: document.querySelector('#serverButton'),
  serverPanel: document.querySelector('#serverPanel'),
  apiBaseInput: document.querySelector('#apiBaseInput'),
  apiUsernameInput: document.querySelector('#apiUsernameInput'),
  apiPasswordInput: document.querySelector('#apiPasswordInput'),
  apiTokenInput: document.querySelector('#apiTokenInput'),
  saveServerButton: document.querySelector('#saveServerButton'),
  localServerButton: document.querySelector('#localServerButton'),
  clearServerButton: document.querySelector('#clearServerButton'),
  dryRunToggle: document.querySelector('#dryRunToggle'),
  scriptInput: document.querySelector('#scriptInput'),
  runButton: document.querySelector('#runButton'),
  sampleButton: document.querySelector('#sampleButton'),
  phaseLabel: document.querySelector('#phaseLabel'),
  progressLabel: document.querySelector('#progressLabel'),
  progressBar: document.querySelector('#progressBar'),
  sceneList: document.querySelector('#sceneList'),
  sceneDurationTotal: document.querySelector('#sceneDurationTotal'),
  importScenesButton: document.querySelector('#importScenesButton'),
  sceneImportInput: document.querySelector('#sceneImportInput'),
  saveScenesButton: document.querySelector('#saveScenesButton'),
  generateAssetsButton: document.querySelector('#generateAssetsButton'),
  assetBoard: document.querySelector('#assetBoard'),
  assetCount: document.querySelector('#assetCount'),
  assetDurationTotal: document.querySelector('#assetDurationTotal'),
  stylePromptButton: document.querySelector('#stylePromptButton'),
  stylePromptPanel: document.querySelector('#stylePromptPanel'),
  stylePromptTextarea: document.querySelector('#stylePromptTextarea'),
  downloadAll: document.querySelector('#downloadAll'),
  downloadAi: document.querySelector('#downloadAi'),
  downloadPexelsImages: document.querySelector('#downloadPexelsImages'),
  downloadPexelsVideos: document.querySelector('#downloadPexelsVideos'),
  downloadGoogle: document.querySelector('#downloadGoogle'),
  createVideoButton: document.querySelector('#createVideoButton'),
  builderTitle: document.querySelector('#builderTitle'),
  builderSub: document.querySelector('#builderSub'),
  stepCount: document.querySelector('#stepCount'),
  choiceGrid: document.querySelector('#choiceGrid'),
  builderDurationTotal: document.querySelector('#builderDurationTotal'),
  builderImportAssetButton: document.querySelector('#builderImportAssetButton'),
  builderImportAssetInput: document.querySelector('#builderImportAssetInput'),
  backSceneButton: document.querySelector('#backSceneButton'),
  skipSceneButton: document.querySelector('#skipSceneButton'),
  nextSceneButton: document.querySelector('#nextSceneButton'),
  multiSelectToggle: document.querySelector('#multiSelectToggle'),
  audioInput: document.querySelector('#audioInput'),
  audioDrop: document.querySelector('#audioDrop'),
  audioLabel: document.querySelector('#audioLabel'),
  sceneAudioList: document.querySelector('#sceneAudioList'),
  subtitlePreview: document.querySelector('#subtitlePreview'),
  subtitleFontName: document.querySelector('#subtitleFontName'),
  subtitleFontSize: document.querySelector('#subtitleFontSize'),
  subtitleTextColor: document.querySelector('#subtitleTextColor'),
  subtitleBackgroundColor: document.querySelector('#subtitleBackgroundColor'),
  downloadSelected: document.querySelector('#downloadSelected'),
  renderButton: document.querySelector('#renderButton'),
  selectedSummary: document.querySelector('#selectedSummary'),
  finalVideo: document.querySelector('#finalVideo'),
  preflightButton: document.querySelector('#preflightButton'),
  refreshDebugButton: document.querySelector('#refreshDebugButton'),
  preflightGrid: document.querySelector('#preflightGrid'),
  debugDownload: document.querySelector('#debugDownload'),
  debugLog: document.querySelector('#debugLog')
};

const sampleScript = `La ciudad despierta antes de que salga el sol. En una cocina chica, alguien prepara cafe mientras revisa una lista escrita a mano.

En la calle, los negocios levantan sus persianas. La gente camina rapido, pero una persona se detiene al escuchar una melodia que viene desde una ventana.

La musica la lleva a recordar una promesa pendiente. Decide cambiar el rumbo del dia y cruza la avenida con una sonrisa nerviosa.`;

init();

async function init() {
  bindEvents();
  await loadHealth();
  await loadPreflight();
  renderAll();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  els.sampleButton.addEventListener('click', () => {
    els.scriptInput.value = sampleScript;
  });

  els.serverButton.addEventListener('click', () => {
    els.serverPanel.hidden = !els.serverPanel.hidden;
    syncServerInput();
  });
  els.saveServerButton.addEventListener('click', saveServerBase);
  els.localServerButton.addEventListener('click', useLocalServerBase);
  els.clearServerButton.addEventListener('click', clearServerBase);

  els.runButton.addEventListener('click', createJob);
  els.importScenesButton.addEventListener('click', () => els.sceneImportInput.click());
  els.sceneImportInput.addEventListener('change', importScenesFile);
  els.saveScenesButton.addEventListener('click', () => saveScenes());
  els.generateAssetsButton.addEventListener('click', generateAssets);
  els.createVideoButton.addEventListener('click', () => {
    state.builderIndex = 0;
    activateTab('builder');
    renderBuilder();
  });

  els.multiSelectToggle.addEventListener('change', () => {
    state.multiSelect = els.multiSelectToggle.checked;
    renderBuilder();
  });

  els.stylePromptButton.addEventListener('click', () => {
    state.stylePromptOpen = !state.stylePromptOpen;
    renderAssets();
  });

  els.stylePromptTextarea.addEventListener('input', () => {
    state.imageStylePrompt = els.stylePromptTextarea.value;
  });

  els.builderImportAssetButton.addEventListener('click', () => els.builderImportAssetInput.click());
  els.builderImportAssetInput.addEventListener('change', (event) => {
    const scene = scenes()[state.builderIndex];
    if (scene) importAsset(scene, event);
  });

  document.querySelectorAll('input[name="audioMode"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.audioMode = input.value;
      renderBuilder();
    });
  });

  els.backSceneButton.addEventListener('click', () => {
    state.builderIndex = Math.max(0, state.builderIndex - 1);
    renderBuilder();
  });

  els.nextSceneButton.addEventListener('click', () => {
    state.builderIndex = Math.min(scenes().length, state.builderIndex + 1);
    renderBuilder();
  });

  els.skipSceneButton.addEventListener('click', () => {
    const scene = scenes()[state.builderIndex];
    const preferred = preferredAssetForScene(scene);
    if (preferred) selectSingleAndAdvance(scene, preferred);
  });

  els.audioInput.addEventListener('change', handleAudio);
  [els.subtitleFontName, els.subtitleFontSize, els.subtitleTextColor, els.subtitleBackgroundColor].forEach((input) => {
    input.addEventListener('input', updateSubtitleStyleFromInputs);
  });
  els.renderButton.addEventListener('click', renderVideo);
  els.preflightButton.addEventListener('click', loadPreflight);
  els.refreshDebugButton.addEventListener('click', refreshDebug);
}

async function loadHealth() {
  try {
    const health = await api('/api/health', { timeoutMs: isPublishedPage() ? 75_000 : 3500 });
    if (health.authRequired && !hasApiCredentials()) {
      els.envStatus.textContent = health.authType === 'basic' ? 'Ingresa para continuar' : 'Token requerido';
      els.envStatus.className = 'status-pill warn';
      els.serverPanel.hidden = false;
      syncServerInput();
    }
    if (health.apiReady) {
      if (!health.authRequired || hasApiCredentials()) {
        els.envStatus.textContent = 'APIs listas';
        els.envStatus.className = 'status-pill ready';
      }
      els.dryRunToggle.checked = false;
    } else {
      if (!health.authRequired || hasApiCredentials()) {
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

async function tryLocalBackendFallback() {
  if (localStorage.getItem('playgroundApiBase')) return false;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return false;
  if (API_BASE === 'http://localhost:8787') return false;

  const previousBase = API_BASE;
  API_BASE = 'http://localhost:8787';
  try {
    const health = await api('/api/health', { timeoutMs: 3500 });
    els.envStatus.textContent = health.apiReady ? 'APIs locales listas' : 'Backend local en prueba';
    els.envStatus.className = health.apiReady ? 'status-pill ready' : 'status-pill warn';
    els.dryRunToggle.checked = !health.apiReady;
    return true;
  } catch {
    API_BASE = previousBase;
    return false;
  }
}

async function loadPreflight() {
  try {
    state.preflight = await api('/api/preflight', { timeoutMs: isPublishedPage() ? 75_000 : 3500 });
    if (!state.imageStylePrompt && state.preflight?.config?.imageStylePrompt) {
      state.imageStylePrompt = state.preflight.config.imageStylePrompt;
    }
    applySubtitleDefaults(state.preflight?.config?.video);
  } catch (error) {
    state.preflight = { error: error.message, checks: {} };
  }
  renderDebug();
}

async function refreshDebug() {
  if (state.job?.id) {
    try {
      state.job = await api('/api/jobs/' + encodeURIComponent(state.job.id));
    } catch (error) {
      state.job = { ...state.job, debug: { events: [{ at: new Date().toISOString(), step: 'debug_refresh', status: 'error', data: { message: error.message } }] } };
    }
  }
  await loadPreflight();
  renderAll();
}

async function createJob() {
  const scriptText = els.scriptInput.value.trim();
  if (!scriptText) {
    els.scriptInput.focus();
    return;
  }

  stopPolling();
  state.job = null;
  state.builderIndex = 0;
  state.selections = {};
  state.audio = null;
  state.sceneAudios = {};
  state.audioMode = 'full';
  els.audioInput.value = '';
  els.audioLabel.textContent = 'Audio opcional';
  renderAll();

  els.runButton.disabled = true;
  try {
    const job = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ scriptText, dryRun: els.dryRunToggle.checked, autoAssets: false, imageStylePrompt: state.imageStylePrompt })
    });
    state.job = job;
    renderAll();
    startPolling(job.id);
  } catch (error) {
    setPhase(error.message, 0);
  } finally {
    els.runButton.disabled = false;
  }
}

function startPolling(jobId) {
  stopPolling();
  let transientFailures = 0;
  state.pollTimer = window.setInterval(async () => {
    try {
      const job = await api('/api/jobs/' + encodeURIComponent(jobId));
      transientFailures = 0;
      state.job = job;
      renderAll();
      if (['scenes_ready', 'ready', 'complete', 'error'].includes(job.status)) stopPolling();
    } catch (error) {
      if ([404, 502, 503, 504].includes(error.status) && transientFailures < 20) {
        transientFailures += 1;
        setPhase('Sincronizando con el servidor', state.job?.progress || 1);
        return;
      }
      setPhase(error.message, 0);
      stopPolling();
    }
  }, 1400);
}

function stopPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function saveScenes(options = {}) {
  const job = state.job;
  if (!job || !scenes().length || isBusy(job)) return null;

  const editedScenes = collectEditedScenes();
  els.saveScenesButton.disabled = true;
  try {
    const response = await api('/api/jobs/' + encodeURIComponent(job.id) + '/scenes', {
      method: 'PATCH',
      body: JSON.stringify({ scenes: editedScenes })
    });
    state.job = response;
    renderAll();
    return response;
  } catch (error) {
    if (!options.silent) setPhase(error.message, state.job?.progress || 0);
    throw error;
  } finally {
    els.saveScenesButton.disabled = false;
  }
}

async function generateAssets() {
  if (!state.job || !scenes().length || isBusy(state.job)) return;

  els.generateAssetsButton.disabled = true;
  try {
    await saveScenes({ silent: true });
    const job = state.job;
    const response = await api('/api/jobs/' + encodeURIComponent(job.id) + '/assets', {
      method: 'POST',
      body: JSON.stringify({ imageStylePrompt: state.imageStylePrompt })
    });
    state.job = response;
    activateTab('assets');
    renderAll();
    startPolling(job.id);
  } catch (error) {
    setPhase(error.message, state.job?.progress || 0);
  } finally {
    els.generateAssetsButton.disabled = false;
  }
}

async function importScenesFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !state.job || isBusy(state.job)) return;

  try {
    const text = await file.text();
    const importedScenes = parseImportedScenes(text, file.name);
    if (!importedScenes.length) throw new Error('El archivo no tiene escenas');
    const response = await api('/api/jobs/' + encodeURIComponent(state.job.id) + '/scenes', {
      method: 'PATCH',
      body: JSON.stringify({ scenes: importedScenes })
    });
    state.job = response;
    renderAll();
  } catch (error) {
    setPhase(error.message, state.job?.progress || 0);
  }
}

async function importAsset(scene, event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !state.job || isBusy(state.job)) return;

  try {
    const dataBase64 = await readFileAsDataUrl(file);
    const response = await api('/api/jobs/' + encodeURIComponent(state.job.id) + '/import-asset', {
      method: 'POST',
      body: JSON.stringify({
        scene_id: scene.scene_id,
        name: file.name,
        mimeType: file.type,
        dataBase64
      })
    });
    state.job = response;
    renderAll();
  } catch (error) {
    setPhase(error.message, state.job?.progress || 0);
  }
}

async function renderVideo() {
  const job = state.job;
  if (!job || !scenes().length) return;

  els.renderButton.disabled = true;
  try {
    const response = await api('/api/jobs/' + encodeURIComponent(job.id) + '/render', {
      method: 'POST',
      body: JSON.stringify({
        selections: state.selections,
        audioMode: state.audioMode,
        audio: state.audioMode === 'full' ? state.audio : null,
        sceneAudios: state.audioMode === 'scenes' ? state.sceneAudios : {},
        subtitleStyle: state.subtitleStyle
      })
    });
    state.job = response;
    renderAll();
    startPolling(job.id);
  } catch (error) {
    setPhase(error.message, 0);
  } finally {
    els.renderButton.disabled = false;
  }
}

async function handleAudio(event) {
  const file = event.target.files?.[0];
  if (!file) {
    state.audio = null;
    els.audioLabel.textContent = 'Audio opcional';
    return;
  }

  const dataBase64 = await readFileAsDataUrl(file);
  state.audio = { name: file.name, type: file.type, dataBase64 };
  els.audioLabel.textContent = file.name;
}

async function handleSceneAudio(scene, event) {
  const file = event.target.files?.[0];
  if (!file || !scene) {
    if (scene) delete state.sceneAudios[scene.scene_id];
    renderBuilder();
    return;
  }
  const dataBase64 = await readFileAsDataUrl(file);
  state.sceneAudios[scene.scene_id] = { name: file.name, type: file.type, dataBase64 };
  renderBuilder();
}

function renderAll() {
  const job = state.job;
  setPhase(job?.phase || 'Sin corrida', job?.progress || 0);
  renderScenes();
  renderAssets();
  renderBuilder();
  renderFinal();
  renderDebug();
}

function renderScenes() {
  const list = scenes();
  const busy = isBusy(state.job);
  els.importScenesButton.disabled = !state.job || busy;
  els.saveScenesButton.disabled = !list.length || busy;
  els.generateAssetsButton.disabled = !list.length || busy;
  els.createVideoButton.disabled = !list.length || !flattenAssets().length || busy;
  els.sceneList.innerHTML = '';
  els.sceneDurationTotal.textContent = 'Duracion aprox ' + formatClock(totalDurationSeconds(list));
  if (!list.length) return empty(els.sceneList);

  for (const scene of list) {
    const row = document.createElement('article');
    row.className = 'scene-row editable-scene';
    row.dataset.sceneId = scene.scene_id;
    row.innerHTML = `
      <div class="scene-side">
        <div class="scene-code">${escapeHtml(scene.scene_label)}</div>
        <label class="mini-label">Duracion
          <input class="scene-input" data-field="duration_seconds" type="number" min="0.5" step="0.5" value="${escapeAttr(Number(scene.duration_seconds || 0))}" />
        </label>
      </div>
      <div class="scene-fields">
        <label class="field-label">Texto
          <textarea class="scene-textarea" data-field="script_text">${escapeHtml(scene.script_text || scene.narration || '')}</textarea>
        </label>
        <div class="scene-param-grid">
          <label class="field-label">Pexels
            <input class="scene-input" data-field="search_query" value="${escapeAttr(scene.search_query || '')}" />
          </label>
          <label class="field-label">Google
            <input class="scene-input" data-field="google_image_query" value="${escapeAttr(scene.google_image_query || scene.search_query || '')}" />
          </label>
        </div>
        <label class="field-label">Prompt IA
          <textarea class="scene-textarea prompt" data-field="image_prompt">${escapeHtml(scene.image_prompt || scene.ai_image_prompt || '')}</textarea>
        </label>
      </div>
    `;
    els.sceneList.append(row);
  }
}

function renderAssets() {
  const list = scenes();
  const allAssets = flattenAssets();
  els.assetCount.textContent = allAssets.length + ' assets';
  els.assetDurationTotal.textContent = 'Duracion aprox ' + formatClock(totalDurationSeconds(list));
  els.stylePromptButton.disabled = !state.job || isBusy(state.job);
  els.stylePromptPanel.hidden = !state.stylePromptOpen;
  if (els.stylePromptTextarea.value !== state.imageStylePrompt) els.stylePromptTextarea.value = state.imageStylePrompt;
  setDownloadLinks();
  els.assetBoard.innerHTML = '';
  for (const notice of assetProviderNotices(list, state.job?.assets || {})) {
    els.assetBoard.append(notice);
  }
  if (!list.length) return empty(els.assetBoard);

  for (const scene of list) {
    const section = document.createElement('section');
    section.className = 'asset-scene';

    const head = document.createElement('div');
    head.className = 'asset-scene-head';
    const title = document.createElement('h3');
    title.textContent = scene.scene_label;
    const importLabel = document.createElement('label');
    importLabel.className = 'asset-import';
    importLabel.textContent = 'Importar asset';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.addEventListener('change', (event) => importAsset(scene, event));
    importLabel.append(input);
    head.append(title, importLabel);

    const grid = document.createElement('div');
    grid.className = 'asset-grid';
    const options = optionsForScene(scene);
    if (options.length) {
      for (const asset of options) grid.append(assetTile(asset, false, scene));
    } else {
      empty(grid);
    }

    section.append(head, grid);
    els.assetBoard.append(section);
  }
}

function assetProviderNotices(list, assets) {
  const notices = [];
  const sceneCount = list.length;
  const aiCount = (assets.aiImages || []).length;
  const brightCount = (assets.brightDataImages || []).length;
  const aiEvent = latestDebugEvent('ai_images');
  const brightEvent = latestDebugEvent('brightdata_google_images');

  if (aiEvent?.status === 'error') {
    notices.push({ level: 'bad', title: 'IA generativa fallo', detail: aiEvent.data?.message || 'Revisa el debug de ai_images.' });
  } else if (sceneCount && aiCount > 0 && aiCount < sceneCount) {
    notices.push({ level: 'warn', title: 'IA generativa incompleta', detail: aiCount + ' de ' + sceneCount + ' escenas tienen imagen IA. Revisa openai-image-errors.json en Debug.' });
  }

  if (brightEvent?.status === 'error') {
    notices.push({ level: 'bad', title: 'Google Images via Bright Data fallo', detail: brightEvent.data?.message || 'Revisa el debug de brightdata_google_images.' });
  } else if (brightEvent?.status === 'ok' && Number(brightEvent.data?.count || 0) === 0 && sceneCount) {
    notices.push({ level: 'warn', title: 'Google Images no trajo resultados', detail: 'Bright Data respondio sin imagenes descargables. Proba ajustar queries o revisa la configuracion de la zona.' });
  } else if (sceneCount && !brightCount && state.job?.status === 'ready') {
    notices.push({ level: 'warn', title: 'Google Images pendiente', detail: 'No hay imagenes de Google en este job. Abri Debug para ver la ultima respuesta de Bright Data.' });
  }

  return notices.map(assetNotice);
}

function latestDebugEvent(step) {
  const events = state.job?.debug?.events || [];
  return [...events].reverse().find((event) => event.step === step && ['error', 'ok'].includes(event.status));
}

function assetNotice({ level, title, detail }) {
  const div = document.createElement('div');
  div.className = 'asset-notice ' + level;
  div.setAttribute('role', level === 'bad' ? 'alert' : 'status');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = shortText(detail || '', 360);
  div.append(strong, small);
  return div;
}

function shortText(value, max) {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function renderBuilder() {
  const list = scenes();
  els.choiceGrid.innerHTML = '';
  els.stepCount.textContent = list.length ? Math.min(state.builderIndex + 1, list.length) + '/' + list.length : '0/0';
  renderSelectedSummary();
  renderAudioControls();
  renderSubtitleControls();
  els.builderDurationTotal.textContent = 'Duracion aprox ' + formatClock(totalDurationSeconds(list));
  els.renderButton.disabled = !list.length || !allScenesSelected() || state.job?.status === 'rendering';

  if (!list.length) return empty(els.choiceGrid);
  if (state.builderIndex >= list.length) {
    els.builderTitle.textContent = 'Seleccion lista';
    els.builderSub.textContent = 'Podes renderizar el video';
    els.backSceneButton.disabled = false;
    els.skipSceneButton.disabled = true;
    els.nextSceneButton.disabled = true;
    els.builderImportAssetButton.disabled = true;
    return;
  }

  const scene = list[state.builderIndex];
  const options = optionsForScene(scene);
  const preferred = preferredAssetForScene(scene);
  els.builderImportAssetButton.disabled = isBusy(state.job);
  const entries = selectedEntries(scene);
  const eachDuration = entries.length ? Number(scene.duration_seconds || 4) / entries.length : Number(scene.duration_seconds || 4);
  els.builderTitle.textContent = scene.scene_label;
  els.builderSub.textContent = entries.length > 1
    ? entries.length + ' assets seleccionados: ' + formatSeconds(eachDuration) + ' cada uno'
    : (scene.script_text || scene.narration);
  els.backSceneButton.disabled = state.builderIndex === 0;
  els.skipSceneButton.disabled = !preferred;
  els.nextSceneButton.disabled = false;

  if (!options.length) return empty(els.choiceGrid);

  for (const asset of options) {
    const tile = assetTile(asset, true, scene);
    if (isSelected(scene, asset)) tile.classList.add('selected');
    tile.addEventListener('click', () => selectAsset(scene, asset));
    els.choiceGrid.append(tile);
  }
}

function renderSelectedSummary() {
  const list = scenes();
  els.selectedSummary.innerHTML = '';
  if (!list.length) return;

  const total = document.createElement('div');
  total.className = 'summary-total';
  total.textContent = 'Total aprox: ' + formatClock(totalDurationSeconds(list));
  els.selectedSummary.append(total);

  for (const scene of list) {
    const entries = selectedEntries(scene);
    const line = document.createElement('div');
    if (!entries.length) {
      line.textContent = scene.scene_label + ': pendiente';
    } else {
      const each = Number(scene.duration_seconds || 4) / entries.length;
      line.textContent = scene.scene_label + ': ' + entries.length + ' asset(s), ' + formatSeconds(each) + ' c/u';
    }
    els.selectedSummary.append(line);
  }
}

function renderDebug() {
  if (!els.preflightGrid || !els.debugLog) return;

  const checks = state.preflight?.checks || {};
  els.preflightGrid.innerHTML = '';
  if (state.preflight?.error) {
    const card = document.createElement('article');
    card.className = 'debug-card bad';
    const title = document.createElement('strong');
    title.textContent = 'Backend';
    const detail = document.createElement('span');
    detail.textContent = state.preflight.error;
    card.append(title, detail);
    els.preflightGrid.append(card);
  } else {
    for (const [key, check] of Object.entries(checks)) {
      const card = document.createElement('article');
      card.className = 'debug-card ' + (check.ready ? 'ok' : check.required ? 'bad' : 'warn');
      const title = document.createElement('strong');
      title.textContent = check.label || key;
      const status = document.createElement('span');
      status.textContent = check.ready ? 'Listo' : check.required ? 'Falta configurar' : 'Opcional pendiente';
      const detail = document.createElement('small');
      detail.textContent = check.detail || '';
      card.append(title, status, detail);
      els.preflightGrid.append(card);
    }
  }

  const debug = state.job?.debug;
  if (debug?.logUrl) {
    els.debugDownload.hidden = false;
    els.debugDownload.href = fileLink(debug.logUrl);
  } else {
    els.debugDownload.hidden = true;
    els.debugDownload.removeAttribute('href');
  }

  const events = debug?.events || [];
  els.debugLog.textContent = JSON.stringify({
    apiBase: API_BASE || 'local',
    hasApiToken: Boolean(API_TOKEN),
    publishedPage: isPublishedPage(),
    preflight: state.preflight,
    job: state.job ? {
      id: state.job.id,
      status: state.job.status,
      phase: state.job.phase,
      progress: state.job.progress,
      debugLog: debug?.logUrl || null
    } : null,
    events
  }, null, 2);
}

function renderSubtitleControls() {
  if (!els.subtitleFontName) return;
  const style = state.subtitleStyle;
  if (els.subtitleFontName.value !== style.fontName) els.subtitleFontName.value = style.fontName;
  if (Number(els.subtitleFontSize.value) !== style.fontSize) els.subtitleFontSize.value = String(style.fontSize);
  if (els.subtitleTextColor.value !== style.textColor) els.subtitleTextColor.value = style.textColor;
  if (els.subtitleBackgroundColor.value !== style.backgroundColor) els.subtitleBackgroundColor.value = style.backgroundColor;
  els.subtitlePreview.style.fontFamily = '"' + style.fontName.replace(/"/g, '') + '", Arial, sans-serif';
  els.subtitlePreview.style.fontSize = Math.max(14, Math.min(36, Math.round(style.fontSize * 0.42))) + 'px';
  els.subtitlePreview.style.color = style.textColor;
  els.subtitlePreview.style.backgroundColor = style.backgroundColor;
}

function renderFinal() {
  const job = state.job;
  els.finalVideo.innerHTML = '';
  if (!job?.video) return;

  if (job.video.skipped) {
    els.finalVideo.innerHTML = '<p class="muted">En modo prueba queda preparada la seleccion, sin render final.</p>';
    return;
  }

  if (job.video.url) {
    const video = document.createElement('video');
    video.src = fileLink(job.video.url);
    video.controls = true;
    video.playsInline = true;
    els.finalVideo.append(video);

    const link = document.createElement('a');
    link.href = fileLink(job.video.url);
    link.download = 'video-final.mp4';
    link.textContent = 'Descargar video';
    els.finalVideo.append(link);
  }
  setDownloadLinks();
}

function renderAudioControls() {
  document.querySelectorAll('input[name="audioMode"]').forEach((input) => {
    input.checked = input.value === state.audioMode;
  });
  els.audioDrop.hidden = state.audioMode !== 'full';
  els.sceneAudioList.hidden = state.audioMode !== 'scenes';
  els.sceneAudioList.innerHTML = '';
  if (state.audioMode !== 'scenes') return;
  for (const scene of scenes()) {
    const label = document.createElement('label');
    label.className = 'scene-audio-row';
    const name = state.sceneAudios[scene.scene_id]?.name || 'Audio escena';
    label.innerHTML = '<span>' + escapeHtml(scene.scene_label) + '</span><strong>' + escapeHtml(name) + '</strong>';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.addEventListener('change', (event) => handleSceneAudio(scene, event));
    label.append(input);
    els.sceneAudioList.append(label);
  }
}

function setDownloadLinks() {
  const hasJob = Boolean(state.job?.id);
  const hasAssets = hasJob && Boolean(state.job?.assets);
  setDownloadLink(els.downloadAll, 'all', hasAssets);
  setDownloadLink(els.downloadAi, 'ai', hasAssets && (state.job.assets.aiImages || []).length);
  setDownloadLink(els.downloadPexelsImages, 'pexels-images', hasAssets && (state.job.assets.pexelsImages || []).length);
  setDownloadLink(els.downloadPexelsVideos, 'pexels-videos', hasAssets && (state.job.assets.pexelsVideos || []).length);
  setDownloadLink(els.downloadGoogle, 'google', hasAssets && (state.job.assets.brightDataImages || []).length);
  setDownloadLink(els.downloadSelected, 'selected', hasJob && Boolean(state.job?.selectionPlan));
}

function setDownloadLink(link, kind, enabled) {
  if (!link) return;
  link.hidden = !enabled;
  if (!enabled) {
    link.removeAttribute('href');
    return;
  }
  link.href = fileLink('/api/jobs/' + encodeURIComponent(state.job.id) + '/download?kind=' + encodeURIComponent(kind));
}

function updateSubtitleStyleFromInputs() {
  state.subtitleStyle = {
    fontName: cleanFontName(els.subtitleFontName.value, state.subtitleStyle.fontName),
    fontSize: clamp(Number(els.subtitleFontSize.value), 16, 120, state.subtitleStyle.fontSize),
    textColor: cleanColor(els.subtitleTextColor.value, state.subtitleStyle.textColor),
    backgroundColor: cleanColor(els.subtitleBackgroundColor.value, state.subtitleStyle.backgroundColor)
  };
  renderSubtitleControls();
}

function applySubtitleDefaults(videoConfig = {}) {
  if (!videoConfig || state.subtitleDefaultsApplied) return;
  state.subtitleDefaultsApplied = true;
  state.subtitleStyle = {
    fontName: cleanFontName(videoConfig.subtitleFontName, state.subtitleStyle.fontName),
    fontSize: clamp(Number(videoConfig.subtitleFontSize), 16, 120, state.subtitleStyle.fontSize),
    textColor: cleanColor(videoConfig.subtitleTextColor, state.subtitleStyle.textColor),
    backgroundColor: cleanColor(videoConfig.subtitleBackgroundColor, state.subtitleStyle.backgroundColor)
  };
  renderSubtitleControls();
}

function cleanFontName(value, fallback) {
  const clean = String(value || '').replace(/[\r\n,]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || fallback || 'Arial';
}

function cleanColor(value, fallback) {
  const clean = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(clean) ? clean : fallback;
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function collectEditedScenes() {
  return scenes().map((scene) => {
    const row = [...els.sceneList.querySelectorAll('[data-scene-id]')].find((item) => item.dataset.sceneId === scene.scene_id);
    if (!row) return scene;

    const scriptText = fieldValue(row, 'script_text').trim();
    const duration = Number(fieldValue(row, 'duration_seconds')) || Number(scene.duration_seconds || 4);
    const imagePrompt = fieldValue(row, 'image_prompt').trim();
    return {
      ...scene,
      script_text: scriptText,
      narration: scriptText,
      duration_seconds: duration,
      render_duration_seconds: duration,
      search_query: fieldValue(row, 'search_query').trim(),
      google_image_query: fieldValue(row, 'google_image_query').trim(),
      image_prompt: imagePrompt,
      ai_image_prompt: imagePrompt
    };
  });
}

function fieldValue(row, field) {
  return row.querySelector('[data-field="' + field + '"]')?.value || '';
}

function parseImportedScenes(text, name) {
  if (/\.json$/i.test(name)) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.scenes)) return parsed.scenes;
    throw new Error('El JSON tiene que ser un array o tener { scenes }');
  }

  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((scriptText, index) => {
      const number = index + 1;
      return {
        scene_number: number,
        scene_label: 'scene_' + String(number).padStart(2, '0'),
        scene_id: 'scene_' + String(number).padStart(2, '0'),
        script_text: scriptText,
        narration: scriptText,
        duration_seconds: 4,
        render_duration_seconds: 4,
        search_query: scriptText.slice(0, 120),
        google_image_query: scriptText.slice(0, 120),
        image_prompt: scriptText
      };
    });
}

function selectAsset(scene, asset) {
  if (state.multiSelect) {
    toggleAsset(scene, asset);
    renderBuilder();
    return;
  }
  selectSingleAndAdvance(scene, asset);
}

function selectSingleAndAdvance(scene, asset) {
  const previous = selectedEntries(scene).find((entry) => entry.key === asset.key);
  state.selections[scene.scene_id] = [{ key: asset.key, startSeconds: previous?.startSeconds || 0 }];
  state.builderIndex = Math.min(scenes().length, state.builderIndex + 1);
  renderBuilder();
}

function toggleAsset(scene, asset) {
  const entries = selectedEntries(scene);
  const exists = entries.find((entry) => entry.key === asset.key);
  if (exists) {
    setSelectedEntries(scene, entries.filter((entry) => entry.key !== asset.key));
  } else {
    setSelectedEntries(scene, [...entries, { key: asset.key, startSeconds: 0 }]);
  }
}

function setVideoStart(scene, asset, value) {
  const entries = selectedEntries(scene);
  const existing = entries.find((entry) => entry.key === asset.key);
  const next = Number(value) || 0;
  if (existing) {
    existing.startSeconds = Math.max(0, next);
    setSelectedEntries(scene, entries);
  } else {
    setSelectedEntries(scene, [...entries, { key: asset.key, startSeconds: Math.max(0, next) }]);
  }
  renderSelectedSummary();
}

function selectedEntries(scene) {
  const raw = state.selections[scene?.scene_id];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((entry) => entry?.key);
  if (typeof raw === 'string') return [{ key: raw, startSeconds: 0 }];
  return [];
}

function setSelectedEntries(scene, entries) {
  if (!entries.length) delete state.selections[scene.scene_id];
  else state.selections[scene.scene_id] = entries;
}

function isSelected(scene, asset) {
  return selectedEntries(scene).some((entry) => entry.key === asset.key);
}

function allScenesSelected() {
  return scenes().every((scene) => selectedEntries(scene).length > 0);
}

function assetTile(asset, interactive, scene) {
  const tile = document.createElement('article');
  tile.className = interactive ? 'choice-tile' : 'asset-tile';
  if (interactive) tile.tabIndex = 0;

  const preview = document.createElement('div');
  preview.className = 'preview-box';
  preview.append(mediaForAsset(asset));

  const caption = document.createElement('div');
  caption.className = 'tile-caption';
  caption.innerHTML = `
    <span class="tile-label">${escapeHtml(labelForAsset(asset))}</span>
    <span class="tile-name">${escapeHtml(asset.file_name || asset.name || '')}</span>
  `;

  if (interactive && scene && isAssetVideo(asset)) {
    const start = selectedEntries(scene).find((entry) => entry.key === asset.key)?.startSeconds || 0;
    const control = document.createElement('label');
    control.className = 'video-start-control';
    control.textContent = 'Inicio video (s)';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.5';
    input.value = String(start);
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('input', (event) => {
      event.stopPropagation();
      setVideoStart(scene, asset, event.target.value);
    });
    control.append(input);
    caption.append(control);
  }

  tile.append(preview, caption);
  return tile;
}

function mediaForAsset(asset) {
  if (isAssetVideo(asset)) {
    const video = document.createElement('video');
    video.src = fileLink(asset.url);
    video.muted = true;
    video.loop = true;
    video.controls = true;
    video.playsInline = true;
    video.addEventListener('click', (event) => event.stopPropagation());
    video.addEventListener('error', () => {
      video.replaceWith(placeholder('Video'));
    });
    return video;
  }

  const img = document.createElement('img');
  img.src = fileLink(asset.url);
  img.alt = labelForAsset(asset);
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    img.replaceWith(placeholder('Preview'));
  });
  return img;
}

function placeholder(text) {
  const div = document.createElement('div');
  div.className = 'muted';
  div.textContent = text;
  return div;
}

function preferredAssetForScene(scene) {
  const options = optionsForScene(scene);
  return options.find((asset) => !isAssetVideo(asset)) || options[0] || null;
}

function optionsForScene(scene) {
  const assets = state.job?.assets || {};
  return [
    ...(assets.aiImages || []),
    ...(assets.pexelsImages || []),
    ...(assets.pexelsVideos || []),
    ...(assets.brightDataImages || [])
  ].filter((asset) => asset.scene_id === scene.scene_id);
}

function flattenAssets() {
  const assets = state.job?.assets || {};
  return Object.values(assets).flat().filter(Boolean);
}

function labelForAsset(asset) {
  if (asset.type === 'ai-image') return asset.promptFallback ? 'IA segura' : 'IA';
  if (asset.type === 'imported-image') return 'Importado imagen';
  if (asset.type === 'imported-video') return 'Importado video';
  if (asset.type === 'pexels-image') return 'Pexels imagen ' + (asset.option || asset.image_rank || 1);
  if (asset.type === 'pexels-video') return 'Pexels video';
  if (asset.type === 'brightdata-google-image') return 'Google imagen';
  return 'Asset';
}

function isAssetVideo(asset) {
  return asset.type === 'pexels-video' || asset.type === 'imported-video' || /\.(mp4|mov|m4v|webm)$/i.test(asset.url || asset.file_name || asset.name || '');
}

function fileLink(url) {
  const value = String(url || '');
  if (!value) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return API_BASE + value;
}

function totalDurationSeconds(list = scenes()) {
  return (list || []).reduce((sum, scene) => sum + Number(scene.duration_seconds || 0), 0);
}

function formatClock(value) {
  const total = Math.max(0, Math.round(Number(value || 0)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? minutes + ':' + String(seconds).padStart(2, '0') : seconds + 's';
}

function formatSeconds(value) {
  const number = Number(value || 0);
  return (Math.round(number * 10) / 10) + 's';
}

function isBusy(job) {
  return ['queued', 'running', 'rendering'].includes(job?.status);
}

function scenes() {
  return state.job?.scenes || [];
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  document.querySelectorAll('.tab-view').forEach((view) => {
    view.classList.toggle('active', view.id === name + 'View');
  });
}

function setPhase(label, progress) {
  els.phaseLabel.textContent = label;
  els.progressLabel.textContent = Math.round(progress) + '%';
  els.progressBar.style.width = Math.max(0, Math.min(100, Number(progress || 0))) + '%';
}

function empty(target) {
  target.append(document.querySelector('#emptyTemplate').content.cloneNode(true));
}

async function api(path, options = {}) {
  if (!API_BASE && isPublishedPage()) {
    throw new Error('Falta configurar un backend HTTPS en Servidor');
  }
  const { timeoutMs, headers: customHeaders = {}, ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json', ...customHeaders };
  if (API_TOKEN) headers.Authorization = 'Bearer ' + API_TOKEN;
  else if (API_USERNAME && API_PASSWORD) headers.Authorization = 'Basic ' + utf8Base64(API_USERNAME + ':' + API_PASSWORD);
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
    els.envStatus.textContent = 'Usuario o contrasena incorrectos';
    els.envStatus.className = 'status-pill warn';
    els.serverPanel.hidden = false;
    syncServerInput();
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Error de servidor');
    error.status = response.status;
    throw error;
  }
  return data;
}

function syncServerInput() {
  els.apiBaseInput.value = API_BASE || '';
  if (els.apiUsernameInput) els.apiUsernameInput.value = API_USERNAME || '';
  if (els.apiPasswordInput) els.apiPasswordInput.value = API_PASSWORD || '';
  if (els.apiTokenInput) els.apiTokenInput.value = API_TOKEN || '';
}

async function saveServerBase() {
  const clean = els.apiBaseInput.value.trim().replace(/\/$/, '');
  const username = els.apiUsernameInput?.value.trim() || '';
  const password = els.apiPasswordInput?.value || '';
  const token = els.apiTokenInput?.value.trim() || '';
  if (!clean) return clearServerBase();
  localStorage.setItem('playgroundApiBase', clean);
  if (token) localStorage.setItem('playgroundApiToken', token);
  else localStorage.removeItem('playgroundApiToken');
  if (username) localStorage.setItem('playgroundApiUsername', username);
  else localStorage.removeItem('playgroundApiUsername');
  if (password) sessionStorage.setItem('playgroundApiPassword', password);
  else sessionStorage.removeItem('playgroundApiPassword');
  API_BASE = clean;
  API_TOKEN = token;
  API_USERNAME = username;
  API_PASSWORD = password;
  await loadHealth();
  await loadPreflight();
  renderAll();
}

async function useLocalServerBase() {
  const localBase = 'http://localhost:8787';
  localStorage.setItem('playgroundApiBase', localBase);
  API_BASE = localBase;
  API_USERNAME = els.apiUsernameInput?.value.trim() || API_USERNAME;
  API_PASSWORD = els.apiPasswordInput?.value || API_PASSWORD;
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
  localStorage.removeItem('playgroundApiUsername');
  sessionStorage.removeItem('playgroundApiPassword');
  API_BASE = resolveApiBase();
  API_TOKEN = resolveApiToken();
  API_USERNAME = resolveApiUsername();
  API_PASSWORD = resolveApiPassword();
  syncServerInput();
  await loadHealth();
  await loadPreflight();
  renderAll();
}

function isPublishedPage() {
  return location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function resolveApiBase() {
  const queryBase = new URLSearchParams(location.search).get('apiBase');
  if (queryBase) {
    const clean = queryBase.replace(/\/$/, '');
    localStorage.setItem('playgroundApiBase', clean);
    return clean;
  }
  const saved = localStorage.getItem('playgroundApiBase');
  if (saved) {
    const clean = saved.replace(/\/$/, '');
    const temporaryBackend = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(clean) ||
      /^https:\/\/[^/]+\.trycloudflare\.com$/i.test(clean);
    if (isPublishedPage() && temporaryBackend) {
      localStorage.removeItem('playgroundApiBase');
      localStorage.removeItem('playgroundApiToken');
      localStorage.removeItem('playgroundApiUsername');
      sessionStorage.removeItem('playgroundApiPassword');
    } else {
      return clean;
    }
  }
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return '';
  return DEFAULT_PUBLIC_API_BASE;
}

function resolveApiToken() {
  const params = new URLSearchParams(location.search);
  const queryToken = params.get('apiToken') || params.get('token');
  if (queryToken) {
    localStorage.setItem('playgroundApiToken', queryToken);
    return queryToken;
  }
  return localStorage.getItem('playgroundApiToken') || '';
}

function resolveApiUsername() {
  return localStorage.getItem('playgroundApiUsername') || '';
}

function resolveApiPassword() {
  return sessionStorage.getItem('playgroundApiPassword') || '';
}

function hasApiCredentials() {
  return Boolean(API_TOKEN || (API_USERNAME && API_PASSWORD));
}

function utf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

