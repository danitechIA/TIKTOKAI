// ===== TikTokAI frontend =====
let TOKEN = localStorage.getItem('tk_token') || '';
let STATE = { projects: [], current: null, previewMode: 'output', poll: null };

// ---------- API helper ----------
async function api(path, opts = {}) {
  opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN }, opts.headers || {});
  const r = await fetch(path, opts);
  if (r.status === 401) { logout(); throw new Error('No autorizado'); }
  if (!r.ok) {
    let msg = 'Error ' + r.status;
    try { msg = (await r.json()).detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}

// ---------- Toast ----------
let toastT;
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastT);
  toastT = setTimeout(() => t.className = 'toast', 3200);
}

// ---------- Auth ----------
async function doLogin() {
  const pass = document.getElementById('login-pass').value;
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    if (!r.ok) throw new Error('Contraseña incorrecta');
    const data = await r.json();
    TOKEN = data.token;
    localStorage.setItem('tk_token', TOKEN);
    showApp();
  } catch (e) {
    document.getElementById('login-err').textContent = e.message;
  }
}
function logout() {
  localStorage.removeItem('tk_token'); TOKEN = '';
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
}
function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadProjects();
}

// ---------- Projects ----------
async function loadProjects() {
  try {
    STATE.projects = await api('/api/projects');
    renderProjectList();
  } catch (e) { toast(e.message, 'err'); }
}

function renderProjectList() {
  const el = document.getElementById('proj-list');
  if (!STATE.projects.length) {
    el.innerHTML = '<p class="hint-text" style="padding:10px;">Aún no hay proyectos.</p>';
    return;
  }
  el.innerHTML = STATE.projects.map(p => {
    const active = STATE.current && STATE.current.id === p.id ? 'active' : '';
    const st = statusLabel(p);
    return `<div class="proj-item ${active}" onclick="selectProject('${p.id}')">
      <div class="thumb">🎞️</div>
      <div class="meta"><div class="name">${esc(p.name)}</div><div class="desc">${st}</div></div>
    </div>`;
  }).join('');
}

function statusLabel(p) {
  const s = p.steps || {};
  if (s.render && s.render.status === 'done') return '✅ Renderizado';
  if (s.render && s.render.status === 'running') return '⏳ Renderizando…';
  if (s.transcribe && s.transcribe.status === 'done') return '📝 Transcrito';
  if (s.transcribe && s.transcribe.status === 'running') return '⏳ Transcribiendo…';
  return '📲 Subido';
}

async function selectProject(id) {
  try {
    STATE.current = await api('/api/projects/' + id);
    STATE.previewMode = STATE.current.output ? 'output' : 'source';
    renderProjectList();
    renderEditor();
    startPollingIfNeeded();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- Upload ----------
function handleUpload(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', file.name.replace(/\.[^.]+$/, ''));
  const prog = document.getElementById('upload-progress');
  const fill = prog.querySelector('.fill');
  prog.classList.remove('hidden');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/projects');
  xhr.setRequestHeader('Authorization', 'Bearer ' + TOKEN);
  xhr.upload.onprogress = e => { if (e.lengthComputable) fill.style.width = (e.loaded / e.total * 100) + '%'; };
  xhr.onload = () => {
    prog.classList.add('hidden'); fill.style.width = '0%';
    if (xhr.status >= 200 && xhr.status < 300) {
      const p = JSON.parse(xhr.responseText);
      toast('Vídeo subido ✓', 'ok');
      loadProjects().then(() => selectProject(p.id));
    } else {
      let m = 'Error al subir';
      try { m = JSON.parse(xhr.responseText).detail; } catch (e) {}
      toast(m, 'err');
    }
  };
  xhr.onerror = () => { prog.classList.add('hidden'); toast('Error de red', 'err'); };
  xhr.send(fd);
}

// Drag & drop
const dz = document.getElementById('dropzone');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); });

// ---------- Editor ----------
function renderEditor() {
  const p = STATE.current;
  document.getElementById('no-project').classList.add('hidden');
  document.getElementById('editor').classList.remove('hidden');

  renderStepper(p);
  renderPreview(p);

  const transcribed = p.transcript && p.transcript.words && p.transcript.words.length;
  document.getElementById('words-area').classList.toggle('hidden', !transcribed);

  // Botón transcribir / re-transcribir
  document.getElementById('btn-transcribe').textContent = transcribed ? 'Re-transcribir' : 'Transcribir con IA';
  if (p.transcript && p.transcript.language) document.getElementById('lang-select').value = p.transcript.language;

  if (transcribed) { renderWords(p); renderStyleControls(p); renderSync(p); }

  // Render / download
  updateJobUI(p);
  document.getElementById('btn-download').classList.toggle('hidden', !(p.output));

  // Caption
  renderCaption(p);
}

function renderStepper(p) {
  const s = p.steps || {};
  const steps = [
    ['📲', 'Subir', 'upload'],
    ['📝', 'Transcribir', 'transcribe'],
    ['🎨', 'Estilo', null],
    ['✨', 'Render', 'render'],
  ];
  document.getElementById('stepper').innerHTML = steps.map(([icon, label, key]) => {
    let cls = '';
    if (key && s[key]) {
      cls = s[key].status === 'done' ? 'done'
        : (s[key].status === 'running' || s[key].status === 'queued') ? 'running'
        : s[key].status === 'error' ? 'error' : '';
    }
    if (key === 'upload') cls = 'done';
    return `<div class="step ${cls}"><span class="dot"></span>${icon} ${label}</div>`;
  }).join('');
}

function renderPreview(p) {
  const v = document.getElementById('preview-video');
  const ph = document.getElementById('preview-ph');
  const btn = document.getElementById('btn-toggle-preview');
  const hasOutput = !!p.output;
  const tk = '&token=' + encodeURIComponent(TOKEN);
  if (STATE.previewMode === 'output' && hasOutput) {
    v.src = '/api/projects/' + p.id + '/output?t=' + Date.now() + tk;
    v.classList.remove('hidden'); ph.classList.add('hidden');
    btn.textContent = 'Ver original';
  } else {
    v.src = '/api/projects/' + p.id + '/source?t=1' + tk;
    v.classList.remove('hidden'); ph.classList.add('hidden');
    btn.textContent = hasOutput ? 'Ver con subtítulos' : 'Original';
    btn.classList.toggle('hidden', !hasOutput);
  }
}

function togglePreviewSource() {
  STATE.previewMode = STATE.previewMode === 'output' ? 'source' : 'output';
  renderPreview(STATE.current);
}

// ---------- Words ----------
function renderWords(p) {
  const el = document.getElementById('words');
  el.innerHTML = p.transcript.words.map((w, i) =>
    `<span class="word-chip ${w.enabled ? '' : 'disabled'}" data-i="${i}"
       contenteditable="true" spellcheck="false"
       onblur="onWordBlur(${i}, this)"
       ondblclick="toggleWord(${i})">${esc(w.word)}</span>`
  ).join('');
}
function onWordBlur(i, el) {
  STATE.current.transcript.words[i].word = el.textContent.trim();
}
function toggleWord(i) {
  const w = STATE.current.transcript.words[i];
  w.enabled = !w.enabled;
  renderWords(STATE.current);
}
async function saveWords() {
  try {
    await api('/api/projects/' + STATE.current.id + '/transcript', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: STATE.current.transcript.words })
    });
    toast('Texto guardado ✓', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- Sincronización (offset global + editor de tiempos) ----------
function renderSync(p) {
  const off = (p.style && typeof p.style.time_offset === 'number') ? p.style.time_offset : 0;
  const r = document.getElementById('offset-range');
  if (r) r.value = off;
  const v = document.getElementById('offset-val');
  if (v) v.textContent = off.toFixed(2);
  if (!document.getElementById('timing-editor').classList.contains('hidden')) renderTiming(p);
}

let offsetT;
function onOffset(value) {
  const val = parseFloat(value);
  STATE.current.style.time_offset = val;
  document.getElementById('offset-val').textContent = val.toFixed(2);
  clearTimeout(offsetT);
  offsetT = setTimeout(saveStyle, 400);
}
function nudgeOffset(delta) {
  const cur = STATE.current.style.time_offset || 0;
  let val = Math.round((cur + delta) * 100) / 100;
  val = Math.max(-1.5, Math.min(1.5, val));
  STATE.current.style.time_offset = val;
  document.getElementById('offset-range').value = val;
  document.getElementById('offset-val').textContent = val.toFixed(2);
  saveStyle();
}

function toggleTiming() {
  const el = document.getElementById('timing-editor');
  const hidden = el.classList.toggle('hidden');
  document.getElementById('btn-toggle-timing').textContent = hidden ? 'Editar tiempos por palabra' : 'Ocultar tiempos';
  if (!hidden) renderTiming(STATE.current);
}

function renderTiming(p) {
  const el = document.getElementById('timing-list');
  el.innerHTML = p.transcript.words.map((w, i) =>
    `<div class="timing-row ${w.enabled ? '' : 'disabled'}">
      <button class="play" onclick="seekWord(${i})" title="Saltar aquí">▶</button>
      <span class="tw">${esc(w.word)}</span>
      <input class="t" type="number" step="0.05" value="${(+w.start).toFixed(2)}" onchange="setTime(${i},'start',this.value)">
      <span class="sep">→</span>
      <input class="t" type="number" step="0.05" value="${(+w.end).toFixed(2)}" onchange="setTime(${i},'end',this.value)">
    </div>`
  ).join('');
}
function setTime(i, key, value) {
  STATE.current.transcript.words[i][key] = parseFloat(value) || 0;
}
function seekWord(i) {
  const w = STATE.current.transcript.words[i];
  const off = STATE.current.style.time_offset || 0;
  const v = document.getElementById('preview-video');
  // Si estamos viendo el render, el offset ya está aplicado; sobre el original no
  const t = STATE.previewMode === 'output' ? (w.start + off) : w.start;
  v.currentTime = Math.max(0, t);
  v.play();
}

// ---------- Style ----------
const STYLE_FIELDS = [
  { key: 'font', label: 'Fuente', type: 'select', options: [['Montserrat Black', 'Montserrat Black'], ['Montserrat ExtraBold', 'Montserrat ExtraBold'], ['Montserrat', 'Montserrat Bold']] },
  { key: 'uppercase', label: 'MAYÚSCULAS', type: 'toggle' },
  { key: 'font_size', label: 'Tamaño', type: 'range', min: 50, max: 170, step: 1 },
  { key: 'words_per_line', label: 'Palabras por bloque', type: 'range', min: 1, max: 6, step: 1 },
  { key: 'position_v', label: 'Posición vertical (%)', type: 'range', min: 25, max: 92, step: 1 },
  { key: 'active_scale', label: 'Pop palabra activa (%)', type: 'range', min: 100, max: 145, step: 1 },
  { key: 'outline_width', label: 'Grosor del borde', type: 'range', min: 0, max: 14, step: 1 },
  { key: 'primary_color', label: 'Color texto', type: 'color' },
  { key: 'highlight_color', label: 'Color palabra activa', type: 'color' },
  { key: 'outline_color', label: 'Color borde', type: 'color' },
];

function renderStyleControls(p) {
  const st = p.style || {};
  const el = document.getElementById('style-controls');
  el.innerHTML = STYLE_FIELDS.map(f => {
    const v = st[f.key];
    if (f.type === 'range') {
      return `<div class="field"><label>${f.label}</label><div class="row">
        <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"
          oninput="onStyle('${f.key}', this.value, true); this.nextElementSibling.textContent=this.value;">
        <span class="val">${v}</span></div></div>`;
    }
    if (f.type === 'color') {
      return `<div class="field"><label>${f.label}</label><div class="row">
        <input type="color" value="${v}" oninput="onStyle('${f.key}', this.value)">
        <span class="hint-text">${v}</span></div></div>`;
    }
    if (f.type === 'select') {
      const opts = f.options.map(([val, lbl]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${lbl}</option>`).join('');
      return `<div class="field"><label>${f.label}</label><select onchange="onStyle('${f.key}', this.value)">${opts}</select></div>`;
    }
    if (f.type === 'toggle') {
      return `<div class="field"><label class="toggle"><input type="checkbox" ${v ? 'checked' : ''} onchange="onStyle('${f.key}', this.checked)"> ${f.label}</label></div>`;
    }
    return '';
  }).join('');
}

let styleT;
function onStyle(key, value, numeric) {
  if (numeric) value = parseFloat(value);
  STATE.current.style[key] = value;
  clearTimeout(styleT);
  styleT = setTimeout(saveStyle, 500);
}
async function saveStyle() {
  try {
    await api('/api/projects/' + STATE.current.id + '/style', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(STATE.current.style)
    });
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- Estado de trabajos en tiempo real ----------
function jobActive(s, k) { return s[k] && (s[k].status === 'running' || s[k].status === 'queued'); }

function updateJobUI(p) {
  const s = p.steps || {};
  const transcribed = p.transcript && p.transcript.words && p.transcript.words.length;
  const rendering = jobActive(s, 'render');
  const rb = document.getElementById('btn-render');
  if (rb) {
    if (rendering) { rb.disabled = true; rb.innerHTML = '<span class="spin"></span> Renderizando…'; }
    else { rb.disabled = !transcribed; rb.innerHTML = '✨ Renderizar subtítulos'; }
  }
  // Línea de estado en vivo
  const js = document.getElementById('job-status');
  if (!js) return;
  let msg = '', cls = 'running';
  if (jobActive(s, 'transcribe')) msg = '<span class="spin"></span> Transcribiendo con IA…';
  else if (rendering) msg = '<span class="spin"></span> Renderizando subtítulos…';
  else if (jobActive(s, 'caption')) msg = '<span class="spin"></span> Generando copy…';
  else if (s.render && s.render.status === 'error') { msg = '❌ Error en el render'; cls = 'error'; }
  else if (s.transcribe && s.transcribe.status === 'error') { msg = '❌ Error al transcribir'; cls = 'error'; }
  if (msg) { js.innerHTML = msg; js.className = 'job-status ' + cls; }
  else { js.className = 'job-status hidden'; js.innerHTML = ''; }
}

function flashDone(text) {
  const js = document.getElementById('job-status');
  if (!js) return;
  js.innerHTML = text; js.className = 'job-status done';
  setTimeout(() => { if (!busy(STATE.current || {})) { js.className = 'job-status hidden'; js.innerHTML = ''; } }, 2500);
}

// ---------- Actions ----------
async function doTranscribe() {
  try {
    await saveStyle();
    const lang = document.getElementById('lang-select').value;
    STATE.current.steps = STATE.current.steps || {};
    STATE.current.steps.transcribe = { status: 'running', error: null };
    renderStepper(STATE.current);
    updateJobUI(STATE.current);
    await api('/api/projects/' + STATE.current.id + '/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang })
    });
    startPolling();
  } catch (e) { toast(e.message, 'err'); }
}

async function doRender() {
  try {
    await saveWords();
    await saveStyle();
    // Feedback inmediato (optimista) sin esperar al primer sondeo
    STATE.current.steps = STATE.current.steps || {};
    STATE.current.steps.render = { status: 'running', error: null };
    renderStepper(STATE.current);
    updateJobUI(STATE.current);
    await api('/api/projects/' + STATE.current.id + '/render', { method: 'POST' });
    startPolling();
  } catch (e) { toast(e.message, 'err'); updateJobUI(STATE.current); }
}

async function doCaption() {
  try {
    document.getElementById('cap-spin').innerHTML = '<span class="spin"></span>';
    await api('/api/projects/' + STATE.current.id + '/caption', { method: 'POST' });
    startPolling();
  } catch (e) { toast(e.message, 'err'); document.getElementById('cap-spin').innerHTML = ''; }
}

function renderCaption(p) {
  const box = document.getElementById('caption-box');
  if (p.caption && p.caption.caption) {
    box.classList.remove('hidden');
    document.getElementById('cap-text').textContent = p.caption.caption;
    document.getElementById('cap-tags').innerHTML = (p.caption.hashtags || []).map(h => `<span class="hashtag">${esc(h)}</span>`).join('');
  } else {
    box.classList.add('hidden');
  }
  const capStep = (p.steps || {}).caption;
  document.getElementById('cap-spin').innerHTML = (capStep && (capStep.status === 'running' || capStep.status === 'queued')) ? '<span class="spin"></span>' : '';
}

function copyCaption() {
  const p = STATE.current;
  const text = p.caption.caption + '\n\n' + (p.caption.hashtags || []).join(' ');
  navigator.clipboard.writeText(text).then(() => toast('Copiado ✓', 'ok'));
}

async function doDownload() {
  const url = '/api/projects/' + STATE.current.id + '/download';
  const r = await api(url);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = STATE.current.name + '-tiktok.mp4';
  a.click();
}

async function doDelete() {
  if (!confirm('¿Eliminar este proyecto y su vídeo?')) return;
  try {
    await api('/api/projects/' + STATE.current.id, { method: 'DELETE' });
    STATE.current = null;
    document.getElementById('editor').classList.add('hidden');
    document.getElementById('no-project').classList.remove('hidden');
    loadProjects();
    toast('Eliminado', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ---------- Polling ----------
function busy(p) {
  const s = p.steps || {};
  return ['transcribe', 'render', 'caption'].some(k => s[k] && (s[k].status === 'running' || s[k].status === 'queued'));
}
function startPollingIfNeeded() { if (STATE.current && busy(STATE.current)) startPolling(); }
function startPolling() {
  if (STATE.poll) return;
  STATE.poll = setInterval(async () => {
    if (!STATE.current) { stopPolling(); return; }
    try {
      const prev = STATE.current;
      const prevSteps = prev.steps || {};
      const wasOutput = prev.output;
      const fresh = await api('/api/projects/' + STATE.current.id);
      STATE.current = fresh;

      renderStepper(fresh);
      renderCaption(fresh);
      renderProjectList();
      updateJobUI(fresh);

      const transcribed = fresh.transcript && fresh.transcript.words && fresh.transcript.words.length;
      const tStatus = (fresh.steps || {}).transcribe || {};
      const tWasActive = jobActive(prevSteps, 'transcribe');

      // Transcripción recién terminada: refrescar palabras/tiempos
      if (transcribed && tWasActive && tStatus.status === 'done') {
        if (document.getElementById('words-area').classList.contains('hidden')) renderEditor();
        else { renderWords(fresh); renderSync(fresh); }
        flashDone('✓ Transcripción lista');
      } else if (transcribed && document.getElementById('words-area').classList.contains('hidden')) {
        renderEditor();
      }

      // Render recién terminado: cargar la vista previa nueva
      if (fresh.output && (!wasOutput || wasOutput.rendered_at !== fresh.output.rendered_at)) {
        STATE.previewMode = 'output';
        renderPreview(fresh);
        document.getElementById('btn-download').classList.remove('hidden');
        flashDone('✓ Render listo · vista previa actualizada');
      }

      // Errores
      ['transcribe', 'render', 'caption'].forEach(k => {
        const st = (fresh.steps || {})[k];
        if (st && st.status === 'error' && jobActive(prevSteps, k)) toast('Error en ' + k + ': ' + st.error, 'err');
      });

      if (!busy(fresh)) stopPolling();
    } catch (e) { stopPolling(); }
  }, 1000);
}
function stopPolling() { if (STATE.poll) { clearInterval(STATE.poll); STATE.poll = null; } }

// ---------- utils ----------
function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- init ----------
async function init() {
  try {
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.auth_required) { TOKEN = ''; showApp(); return; }
  } catch (e) {}
  if (TOKEN) showApp();
  else document.getElementById('login').classList.remove('hidden');
}
init();
