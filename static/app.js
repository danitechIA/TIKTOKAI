// ===================== TikTokAI Studio — frontend v3 (editor CapCut) =====================
// Capturador de errores: muestra el mensaje exacto en pantalla (diagnóstico)
window.addEventListener('error', e=>{ try{ const t=document.getElementById('toast'); if(t){ t.textContent='⚠️ '+(e.message||'')+' ('+((e.filename||'').split('/').pop())+':'+e.lineno+')'; t.className='toast err'; t.style.opacity='1'; } }catch(_){} });
const $ = id => document.getElementById(id);
const show = (id,hide)=>{ const el=$(id); if(el) el.classList.toggle('hidden', !!hide); };
const G = () => (typeof gsap !== 'undefined') ? gsap : null;
function icons(){ try { if (window.lucide) lucide.createIcons(); } catch(e){} }
function uid(){ return Math.random().toString(36).slice(2,9); }
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let TOKEN = localStorage.getItem('tk_token') || '';
let STATE = { projects: [], current: null, previewMode: 'live', poll: null, subModel: null, raf: null, sel: null };

// ---------- API ----------
async function api(path, opts = {}) {
  opts.headers = Object.assign({ 'Authorization': 'Bearer ' + TOKEN }, opts.headers || {});
  const r = await fetch(path, opts);
  if (r.status === 401) { logout(); throw new Error('No autorizado'); }
  if (!r.ok) { let m = 'Error ' + r.status; try { m = (await r.json()).detail || m; } catch(e){} throw new Error(m); }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}

// ---------- Toast ----------
let toastT;
function toast(msg, type='') {
  const t = $('toast'); if(!t) return;
  t.textContent = msg; t.className = 'toast ' + type;
  const g = G();
  if (g) g.fromTo(t, {y:20, opacity:0}, {y:0, opacity:1, duration:.35, ease:'back.out(2)'});
  else t.style.opacity = 1;
  clearTimeout(toastT);
  toastT = setTimeout(() => { if (g) g.to(t,{y:20,opacity:0,duration:.3}); else t.style.opacity=0; }, 3200);
}

// ---------- Theme ----------
function toggleTheme() {
  document.body.classList.toggle('light');
  const light = document.body.classList.contains('light');
  localStorage.setItem('tk_theme', light ? 'light' : 'dark');
  $('theme-btn').innerHTML = `<i data-lucide="${light?'sun':'moon'}" class="ic"></i>`; icons();
}
if (localStorage.getItem('tk_theme') === 'light') document.body.classList.add('light');

// ---------- Auth ----------
async function doLogin() {
  const pass = $('login-pass').value;
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:pass}) });
    if (!r.ok) throw new Error('Contraseña incorrecta');
    TOKEN = (await r.json()).token; localStorage.setItem('tk_token', TOKEN); showApp();
  } catch(e) { $('login-err').textContent = e.message; }
}
function logout(){ localStorage.removeItem('tk_token'); TOKEN=''; show('app',true); show('login',false); }
function showHome(){ show('editor',true); show('home',false); }
function showApp(){
  show('login',true); show('app',false); showHome(); icons(); loadProjects(); loadSfx();
}

// ---------- Projects ----------
async function loadProjects(){ try { STATE.projects = await api('/api/projects'); renderProjectList(); } catch(e){ toast(e.message,'err'); } }
function renderProjectList(){
  const el = $('proj-list'); if(!el) return;
  if (!STATE.projects.length){ el.innerHTML = '<p class="hint-text" style="padding:10px;">Aún no hay proyectos.</p>'; return; }
  const tk = encodeURIComponent(TOKEN);
  el.innerHTML = STATE.projects.map(p => {
    return `<div class="proj-item" onclick="selectProject('${p.id}')" data-id="${p.id}">
      <div class="thumb">${p.strip_path?`<img src="/api/projects/${p.id}/strip?token=${tk}" alt="" loading="lazy">`:'🎞️'}</div>
      <div class="meta"><div class="name">${esc(p.name)}</div><div class="desc">${statusLabel(p)}</div></div></div>`;
  }).join('');
}
function statusLabel(p){
  const s = p.steps||{};
  if (s.render?.status==='done') return '✅ Renderizado';
  if (s.render?.status==='running'||s.render?.status==='queued') return '⏳ Renderizando…';
  if (s.transcribe?.status==='done') return '📝 Transcrito';
  if (s.transcribe?.status==='running'||s.transcribe?.status==='queued') return '⏳ Transcribiendo…';
  return '📲 Subido';
}
async function selectProject(id){
  try {
    STATE.current = await api('/api/projects/'+id);
    STATE.previewMode = 'live'; STATE.sel = null; undoStack = []; sheetOpen = null;
    renderProjectList(); renderEditor();
    startPollingIfNeeded();
    if(!STATE.current.proxy_path) startPolling();   // se está generando el vídeo de trabajo
    const g = G(); if (g) g.from('.ed-stage', {opacity:0, duration:.3, ease:'power2.out'});
  } catch(e){ toast(e.message,'err'); }
}
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

// ---------- Upload ----------
function handleUpload(file){
  if (!file) return;
  const fd = new FormData(); fd.append('file', file); fd.append('name', file.name.replace(/\.[^.]+$/,''));
  const prog = $('upload-progress'), fill = prog.querySelector('.fill');
  prog.classList.remove('hidden');
  const xhr = new XMLHttpRequest(); xhr.open('POST','/api/projects'); xhr.setRequestHeader('Authorization','Bearer '+TOKEN);
  xhr.upload.onprogress = e => { if (e.lengthComputable) fill.style.width = (e.loaded/e.total*100)+'%'; };
  xhr.onload = () => {
    prog.classList.add('hidden'); fill.style.width='0%';
    if (xhr.status>=200 && xhr.status<300){ const p=JSON.parse(xhr.responseText); toast('Vídeo subido ✓','ok'); loadProjects().then(()=>selectProject(p.id)); }
    else { let m='Error al subir'; try{m=JSON.parse(xhr.responseText).detail;}catch(e){} toast(m,'err'); }
  };
  xhr.onerror = () => { prog.classList.add('hidden'); toast('Error de red','err'); };
  xhr.send(fd);
}
const dz = $('dropzone');
['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); });

// ---------- Estilo por defecto / presets ----------
const DEFAULT_STYLE = { font:'Montserrat Black', font_size:92, primary_color:'#FFFFFF', highlight_color:'#FE2C55', outline_color:'#000000', outline_width:8, shadow:4, position_v:62, margin_h:90, words_per_line:4, max_gap:0.7, uppercase:true, active_scale:116, time_offset:0 };
const PRESETS = [
  { name:'Rojo', color:'#FE2C55' }, { name:'Verde', color:'#22E584' }, { name:'Amarillo', color:'#FFD60A' },
  { name:'Cyan', color:'#25F4EE' }, { name:'Naranja', color:'#FF6B35' }, { name:'Rosa', color:'#FF4FA3' },
  { name:'Morado', color:'#A855F7' }, { name:'Lima', color:'#A3E635' }, { name:'Blanco', color:'#FFFFFF' },
];
// Sonidos: lista dinámica desde /api/sfx (añade tus .mp3 a la carpeta sfx/ y aparecen solos)
const SFX_LABELS = { swoosh:'Swoosh + pop (para títulos)', whoosh:'Whoosh (swipe)', boom:'Boom (impacto)', pop:'Pop (burbuja)', ding:'Ding (campana)', riser:'Riser (tensión)' };
let SFX_LIST = ['swoosh','whoosh','boom','pop','ding','riser'];
async function loadSfx(){ try{ const r=await api('/api/sfx'); if(r.sfx&&r.sfx.length) SFX_LIST=r.sfx; }catch(e){} }
function sfxOptions(selected, withNone){
  const opts = (withNone?[['','Ninguno']]:[]).concat(SFX_LIST.map(s=>[s, SFX_LABELS[s]||s]));
  return opts.map(([v,l])=>`<option value="${v}" ${v===(selected||'')?'selected':''}>${l}</option>`).join('');
}
function curStyle(){ return Object.assign({}, DEFAULT_STYLE, (STATE.current && STATE.current.style)||{}); }
function playSfx(name){ if(!name)return; try{ const a=new Audio('/sfx/'+name+'.mp3'); a.volume=0.85; a.play().catch(()=>{}); }catch(_){} }

// ---------- Editor ----------
function renderEditor(){
  const p = STATE.current; if(!p) return;
  show('home', true); show('editor', false);
  const nm=$('ed-name'); if(nm) nm.textContent = p.name || 'Proyecto';
  loadPreviewVideo(p);
  const transcribed = hasWords(p);
  show('tl-empty', transcribed);
  show('btn-source', !p.output);
  renderTools();
  if (transcribed){ rebuildSubModel(); renderTimeline(p); }
  else { const inner=$('tle-inner'); if(inner) inner.innerHTML=''; }
  updateJobUI(p);
  if (sheetOpen) renderSheet();
  icons();
}
function closeEditor(){
  const v=$('preview-video'); if(v){ try{ v.pause(); }catch(_){} }
  closeSheet(); stopPolling(); stopLoop();
  STATE.current=null; STATE.sel=null;
  show('editor', true); show('home', false);
  loadProjects();
}
function hasWords(p){ return !!(p && p.transcript && p.transcript.words && p.transcript.words.length); }
function renderStepper(p){ /* el progreso se ve ahora en la barra de estado sobre el vídeo */ }

// ---------- Barra de herramientas ----------
// Sólo reordena lo que ya existía: nada nuevo, todo a un toque.
function renderTools(){
  const el=$('ed-tools'), p=STATE.current; if(!el||!p) return;
  const t = hasWords(p);
  const items = [
    { k:'subs',  ic:'captions',  lbl: t?'Subtítulos':'Transcribir', hot:!t },
    { k:'color', ic:'palette',   lbl:'Color',     need:1 },
    { k:'pos',   ic:'move-vertical', lbl:'Posición', need:1 },
    { k:'sync',  ic:'timer',     lbl:'Sincronía', need:1 },
    { k:'style', ic:'type',      lbl:'Estilo',    need:1 },
    { k:'title', ic:'heading',   lbl:'Título',    need:1, act:1 },
    { k:'sound', ic:'volume-2',  lbl:'Sonido',    need:1, act:1 },
    { k:'copy',  ic:'hash',      lbl:'Copy',      need:1 },
    { k:'export',ic:'download',  lbl:'Guardar',   need:1 },
  ];
  el.innerHTML = items.map(i=>{
    const off = i.need && !t;
    return `<button class="tool ${i.hot?'hot':''} ${sheetOpen===i.k?'on':''}" ${off?'disabled style="opacity:.35"':''}
      onclick="${i.act?(i.k==='title'?'addTitleAtCursor()':'addSoundAtCursor()'):`openSheet('${i.k}')`}">
      <span class="tbox"><i data-lucide="${i.ic}" class="ic"></i></span>
      <span class="tlbl">${i.lbl}</span></button>`;
  }).join('');
  icons();
}

// ---------- Hoja inferior ----------
let sheetOpen = null;
const SHEET_TITLES = { subs:'Subtítulos', color:'Color de subtítulos', pos:'Posición del texto', sync:'Sincronía', style:'Estilo del texto', copy:'Copy para TikTok', export:'Guardar vídeo', sel:'Elemento' };
function openSheet(kind){
  sheetOpen = kind;
  show('sheet', false); show('sheet-bd', false);
  const ttl=$('sheet-title'); if(ttl) ttl.textContent = SHEET_TITLES[kind]||'Ajustes';
  renderSheet(); renderTools();
}
function closeSheet(){
  sheetOpen = null;
  show('sheet', true); show('sheet-bd', true);
  if(STATE.sel){ STATE.sel=null; if(STATE.current && hasWords(STATE.current)) renderTimeline(STATE.current); }
  renderTools();
}
function renderSheet(){
  const box=$('inspector'), p=STATE.current; if(!box||!p) return;
  switch(sheetOpen){
    case 'subs':   return sheetSubs(box);
    case 'color':  return sheetColor(box);
    case 'pos':    return sheetPos(box);
    case 'sync':   return sheetSync(box);
    case 'style':  return sheetStyle(box);
    case 'copy':   return sheetCopy(box);
    case 'export': return sheetExport(box);
    case 'sel':    return renderInspector();
  }
}
function sheetSubs(box){
  const p=STATE.current, t=hasWords(p);
  box.innerHTML = `
    <div class="field"><label>Idioma del vídeo</label>
      <select id="lang-select"><option value="es">Español</option><option value="en">Inglés</option><option value="auto">Auto</option></select></div>
    <button class="btn ${t?'btn-ghost':'btn-primary'} btn-block" id="btn-transcribe" onclick="doTranscribe()">
      <i data-lucide="${t?'rotate-cw':'wand-2'}" class="ic"></i> ${t?'Volver a transcribir':'Transcribir con IA'}</button>
    <p class="hint-text" style="margin-top:14px;">${t
      ? 'Ya está transcrito. Toca cualquier bloque de subtítulo en la línea de tiempo para corregir su texto o sus tiempos.'
      : 'La IA escucha el vídeo y crea los subtítulos palabra a palabra. Tarda unos segundos.'}</p>`;
  if(p.transcript?.language && $('lang-select')) $('lang-select').value=p.transcript.language;
  icons();
}
function sheetColor(box){
  box.innerHTML = `<div class="field"><label>Color de la palabra activa</label><div class="swatches" id="presets"></div></div>
    <p class="hint-text">Es el color con el que se enciende cada palabra al pronunciarse.</p>`;
  renderPresets(STATE.current);
}
function sheetPos(box){
  box.innerHTML = `<div class="field"><label>Altura del subtítulo <span class="val" id="posv-val" style="float:right;"></span></label>
    <input type="range" min="15" max="92" step="1" id="posv-range" oninput="onPosV(this.value)">
    <div class="fine">
      <button class="btn btn-ghost fine-b" onclick="nudgePos(-5)"><i data-lucide="chevrons-up" class="ic"></i></button>
      <button class="btn btn-ghost fine-b" onclick="nudgePos(-1)"><i data-lucide="chevron-up" class="ic"></i></button>
      <input type="number" class="fine-num" id="posv-num" min="15" max="92" step="1" inputmode="numeric" onchange="setPos(this.value)">
      <button class="btn btn-ghost fine-b" onclick="nudgePos(1)"><i data-lucide="chevron-down" class="ic"></i></button>
      <button class="btn btn-ghost fine-b" onclick="nudgePos(5)"><i data-lucide="chevrons-down" class="ic"></i></button>
    </div></div>
    <p class="hint-text">0 % es arriba del todo y 100 % abajo. Míralo en el vídeo mientras lo tocas.</p>`;
  renderPosition(STATE.current); icons();
}
function sheetSync(box){
  box.innerHTML = `<div class="field"><label>Desfase de los subtítulos <span class="val" id="offset-val" style="float:right;">0.00</span></label>
    <input type="range" min="-1.5" max="1.5" step="0.01" value="0" id="offset-range" oninput="onOffset(this.value)">
    <div class="fine">
      <button class="btn btn-ghost fine-b" onclick="nudgeOffset(-0.1)">−.1</button>
      <button class="btn btn-ghost fine-b" onclick="nudgeOffset(-0.01)">−.01</button>
      <input type="number" class="fine-num" id="offset-num" min="-1.5" max="1.5" step="0.01" inputmode="decimal" onchange="setOffset(this.value)">
      <button class="btn btn-ghost fine-b" onclick="nudgeOffset(0.01)">+.01</button>
      <button class="btn btn-ghost fine-b" onclick="nudgeOffset(0.1)">+.1</button>
    </div>
    <button class="btn btn-ghost btn-sm fine-reset" onclick="setOffset(0)"><i data-lucide="rotate-ccw" class="ic"></i> Volver a 0</button></div>
    <p class="hint-text">En negativo los subtítulos aparecen antes; en positivo, después.</p>`;
  renderOffset(); icons();
}
function sheetStyle(box){
  box.innerHTML = `<div id="style-controls"></div>`;
  renderStyleControls(STATE.current); icons();
}
function sheetCopy(box){
  const p=STATE.current;
  box.innerHTML = `<button class="btn btn-ghost btn-block" onclick="doCaption()" id="btn-caption">
      <i data-lucide="sparkles" class="ic"></i> Generar descripción + hashtags</button>
    <span id="cap-spin"></span>
    <div class="caption-box hidden" id="caption-box" style="margin-top:14px;">
      <div class="cap" id="cap-text"></div>
      <div class="hashtags" id="cap-tags"></div>
      <button class="btn btn-ghost btn-sm" style="margin-top:12px;width:100%;" onclick="copyCaption()"><i data-lucide="copy" class="ic"></i> Copiar todo</button>
    </div>`;
  renderCaption(p); icons();
}
function sheetExport(box){
  const p=STATE.current, ready=!!p.output;
  box.innerHTML = `${ready ? `<div style="display:flex;gap:10px;">
      <button class="btn btn-accent" style="flex:1" onclick="doDownload()"><i data-lucide="download" class="ic"></i> MP4</button>
      <button class="btn btn-accent" style="flex:1" onclick="doDownloadIphone()"><i data-lucide="smartphone" class="ic"></i> iPhone</button>
    </div>
    <p class="hint-text" style="margin-top:12px;">En iPhone: abre, mantén pulsado el vídeo y «Guardar en Fotos».</p>`
    : `<p class="hint-text">Todavía no hay vídeo renderizado. Dale a <b>Exportar</b> arriba a la derecha y espera a que termine.</p>`}
    <div class="section-title" style="margin-top:26px;"><span class="lbl">Proyecto</span></div>
    <button class="btn btn-danger btn-block" onclick="doDelete()"><i data-lucide="trash-2" class="ic"></i> Eliminar proyecto</button>`;
  icons();
}

// ---------- Guardado ----------
let transcriptT, elementsT, styleT;
function saveTranscriptSoon(){
  clearTimeout(transcriptT);
  transcriptT = setTimeout(()=>{ if(!STATE.current)return;
    api('/api/projects/'+STATE.current.id+'/transcript',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({words:STATE.current.transcript.words})}).catch(()=>{});
  }, 600);
}
function saveElementsSoon(){
  clearTimeout(elementsT);
  elementsT = setTimeout(saveElements, 500);
}
function saveElements(){
  if(!STATE.current) return;
  api('/api/projects/'+STATE.current.id+'/elements',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({titles:STATE.current.titles||[], sounds:STATE.current.sounds||[]})}).catch(()=>{});
}
async function saveStyle(){ if(!STATE.current)return; try { await api('/api/projects/'+STATE.current.id+'/style',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(STATE.current.style)}); } catch(e){} }
function saveStyleSoon(){ clearTimeout(styleT); styleT=setTimeout(saveStyle,500); }

// ---------- Deshacer (palabras + títulos + sonidos) ----------
let undoStack = [];
function pushUndo(){
  const p=STATE.current; if(!p) return;
  undoStack.push(JSON.stringify({ w:(p.transcript&&p.transcript.words)||[], t:p.titles||[], s:p.sounds||[] }));
  if(undoStack.length>80) undoStack.shift();
}
function doUndo(){
  if(!undoStack.length){ toast('Nada que deshacer'); return; }
  const snap = JSON.parse(undoStack.pop()); const p=STATE.current; if(!p) return;
  if (p.transcript) p.transcript.words = snap.w;
  p.titles = snap.t; p.sounds = snap.s;
  STATE.sel = null;
  rebuildSubModel(); renderTimeline(p); refreshOverlays(); closeSheet();
  saveTranscriptSoon(); saveElementsSoon();
  toast('Deshecho ↶','ok');
}

// ---------- Preview: vídeo + overlays ----------
function loadPreviewVideo(p){
  const v = $('preview-video'); if(!v) return;
  const tk = '&token='+encodeURIComponent(TOKEN), so=$('sub-overlay'), to=$('title-overlay'), bs=$('btn-source');
  const live = !(STATE.previewMode==='output' && p.output);
  v.src = live ? ('/api/projects/'+p.id+'/preview?t=1'+tk) : ('/api/projects/'+p.id+'/output?t='+Date.now()+tk);
  if(so) so.style.display = live?'':'none';
  if(to) to.style.display = live?'':'none';
  if(bs){ bs.innerHTML=`<i data-lucide="${live?'eye':'eye-off'}" class="ic"></i>`; bs.title = live?'Ver el render':'Volver al preview'; icons(); }
  const refresh = () => { updateGeometry(); _lastKey=DIRTY; _titleKey=DIRTY; renderAt(v.currentTime); updateTitles(v.currentTime); updatePlayhead(); };
  v.onloadedmetadata = refresh; v.onloadeddata = refresh;
  setTimeout(refresh, 300); setTimeout(refresh, 900);
  v.onplay = ()=>{ _lastSfxT = v.currentTime; startLoop(); syncPlayBtn(); };
  v.onpause = ()=>{ stopLoop(); syncPlayBtn(); };
  v.onseeked = ()=>{ _lastSfxT=v.currentTime; _lastKey=DIRTY; _titleKey=DIRTY; renderAt(v.currentTime); updateTitles(v.currentTime); updatePlayhead(); };
}
function toggleSource(){ STATE.previewMode = STATE.previewMode==='output'?'live':'output'; loadPreviewVideo(STATE.current); }
function togglePlay(){ const v=$('preview-video'); if(!v)return; if (v.paused) v.play(); else v.pause(); }
function syncPlayBtn(){ const v=$('preview-video'), b=$('btn-play'); if(v&&b){ b.innerHTML=`<i data-lucide="${v.paused?'play':'pause'}" class="ic"></i>`; icons(); } }
function refreshOverlays(){ const v=$('preview-video'); _lastKey=DIRTY; _titleKey=DIRTY; if(v){ renderAt(v.currentTime); updateTitles(v.currentTime); } }

function updateGeometry(){
  const v=$('preview-video'), ov=$('sub-overlay'); if(!v||!ov||!v.videoWidth) return;
  const vw=v.clientWidth, vh=v.clientHeight, va=v.videoWidth/v.videoHeight, ea=vw/vh;
  let rW,rH,top,left;
  if (va>ea){ rW=vw; rH=vw/va; left=0; top=(vh-rH)/2; } else { rH=vh; rW=vh*va; top=0; left=(vw-rW)/2; }
  ov.dataset.rw=rW; ov.dataset.rh=rH; ov.dataset.top=top; ov.dataset.left=left;
  // El tamaño de fuente está expresado en el lienzo del render (ancho 1080,
  // alto proporcional al ORIGINAL), no en el del vídeo que se esté reproduciendo.
  // Si escaláramos con v.videoHeight, el proxy de 480p agrandaría el texto ~2,2x.
  const src=(STATE.current&&STATE.current.source)||{};
  const srcW=src.width||v.videoWidth, srcH=src.height||v.videoHeight;
  const playH = srcW ? Math.round(1080 * srcH / srcW) : v.videoHeight;
  ov.dataset.scale = rH / (playH || v.videoHeight);
}

// Modelo de subtítulos (idéntico al backend: la palabra se resalta en SU [inicio,fin])
function rebuildSubModel(){
  const p = STATE.current;
  if (!hasWords(p)){ STATE.subModel=null; return; }
  const st = curStyle();
  const words = p.transcript.words.filter(w => w.enabled!==false && (w.word||'').trim());
  const chunks=[]; let cur=[];
  for (const w of words){
    if (cur.length){ const gap=w.start-cur[cur.length-1].end; if (cur.length>=st.words_per_line || gap>st.max_gap){ chunks.push(cur); cur=[]; } }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  const PAD = 0.3;
  const model = chunks.map((chunk, ci) => {
    const start = chunk[0].start;
    const nextStart = ci+1 < chunks.length ? chunks[ci+1][0].start : Infinity;
    const end = Math.min(chunk[chunk.length-1].end + PAD, nextStart);
    return { chunk, start, end, ci };
  });
  STATE.subModel = { model, st };
  updateGeometry(); _lastKey=DIRTY;
  const pv=$('preview-video'); renderAt(pv?pv.currentTime:0);
}
function outlineShadow(px, color){
  const o=[]; const n=16;
  for (let i=0;i<n;i++){ const a=i/n*2*Math.PI; o.push(`${(Math.cos(a)*px).toFixed(2)}px ${(Math.sin(a)*px).toFixed(2)}px 0 ${color}`); }
  o.push(`0 ${(px*1.5).toFixed(2)}px ${(px*1.3).toFixed(2)}px rgba(0,0,0,.4)`);
  return o.join(',');
}
const DIRTY='\u0000';   // centinela: nunca puede coincidir con una clave real
let _lastKey='';
function renderAt(t){
  const ov = $('sub-overlay'); if(!ov) return;
  if (STATE.previewMode==='output' || !STATE.subModel){ ov.innerHTML=''; return; }
  const st = STATE.subModel.st, scale = parseFloat(ov.dataset.scale)||0.16;
  const off = parseFloat(st.time_offset)||0;
  const tp = t - off;
  let cm=null;
  for (const m of STATE.subModel.model){ if (tp>=m.start && tp<m.end){ cm=m; break; } }
  if (!cm){ if(_lastKey){ ov.innerHTML=''; _lastKey=''; } return; }
  let activeIdx=-1;
  for (let k=0;k<cm.chunk.length;k++){ const w=cm.chunk[k]; if (tp>=w.start && tp<w.end){ activeIdx=k; break; } }
  const key = cm.ci + ':' + activeIdx;
  if (key===_lastKey) return; _lastKey=key;
  const up = st.uppercase, hi = st.highlight_color, pri = st.primary_color;
  const fs = (st.font_size*scale).toFixed(1)+'px';
  const olPx = Math.max(1.4, st.outline_width*scale);
  const wt = st.font.includes('Black')?900:st.font.includes('ExtraBold')?800:700;
  const rW=parseFloat(ov.dataset.rw), rH=parseFloat(ov.dataset.rh), top=parseFloat(ov.dataset.top), left=parseFloat(ov.dataset.left);
  const cx = left + rW/2, cy = top + rH*(st.position_v/100);
  const html = cm.chunk.map((w,k)=>{
    let txt = (w.word||'').trim(); if (up) txt = txt.toUpperCase();
    const isA = k===activeIdx;
    return `<span class="w ${isA?'active':''}" style="color:${isA?hi:pri};transform:scale(${isA?(st.active_scale/100):1})">${esc(txt)}</span>`;
  }).join(' ');
  ov.innerHTML = `<div class="sub-block" style="left:${cx}px;top:${cy}px;width:${rW*0.9}px;font-size:${fs};font-weight:${wt};text-shadow:${outlineShadow(olPx, st.outline_color)};">${html}</div>`;
  const g=G(); const a=ov.querySelector('.w.active');
  if (g && a) g.fromTo(a, {scale:(st.active_scale/100)*0.7}, {scale:st.active_scale/100, duration:.22, ease:'back.out(3)'});
}

// Títulos en el preview (elementos con tiempo)
let _titleKey='';
function updateTitles(t){
  const ov=$('title-overlay'), so=$('sub-overlay'); if(!ov||!so||!STATE.current) return;
  if (STATE.previewMode==='output'){ ov.innerHTML=''; _titleKey=''; return; }
  const st=curStyle();
  const vis=(STATE.current.titles||[]).filter(x => (x.text||'').trim() && t>=x.start && t<x.end);
  const key=vis.map(x=>x.id+x.text+x.color+x.size+x.pos).join('|');
  if (key===_titleKey) return;
  const fresh = vis.filter(x=>!_titleKey.includes(x.id));
  _titleKey=key;
  if (!vis.length){ ov.innerHTML=''; return; }
  const scale=parseFloat(so.dataset.scale)||0.16;
  const rW=parseFloat(so.dataset.rw)||0, rH=parseFloat(so.dataset.rh)||0, top=parseFloat(so.dataset.top)||0, left=parseFloat(so.dataset.left)||0;
  const olPx=Math.max(1.4,(st.outline_width||8)*scale);
  ov.innerHTML = vis.map(x=>{
    let txt=(x.text||'').trim(); if(st.uppercase) txt=txt.toUpperCase();
    const fs=((x.size||120)*scale).toFixed(1)+'px';
    const cx=left+rW/2, cy=top+rH*((x.pos||24)/100);
    return `<div class="hook-title" data-id="${x.id}" style="left:${cx}px;top:${cy}px;width:${(rW*0.86)}px;font-size:${fs};color:${x.color||'#fff'};text-shadow:${outlineShadow(olPx, st.outline_color||'#000')};">${esc(txt)}</div>`;
  }).join('');
  const g=G();
  if (g) fresh.forEach(x=>{ const el=ov.querySelector(`[data-id="${x.id}"]`); if(el) g.fromTo(el,{scale:0.6,opacity:0},{scale:1,opacity:1,duration:.5,ease:'back.out(2)'}); });
}

// Sonidos en el preview: suenan al cruzar su instante durante la reproducción
let _lastSfxT = 0;
function soundEvents(){
  const p=STATE.current; if(!p) return [];
  const ev=(p.sounds||[]).map(s=>({t:s.t, sfx:s.sfx}));
  (p.titles||[]).forEach(x=>{ if(x.sound) ev.push({t:x.start, sfx:x.sound}); });
  return ev;
}
function startLoop(){
  stopLoop();
  const v=$('preview-video');
  const step=()=>{
    const t=v.currentTime;
    renderAt(t); updateTitles(t); updatePlayhead();
    if (STATE.previewMode!=='output' && !v.paused){
      for (const ev of soundEvents()){ if (_lastSfxT < ev.t && ev.t <= t) playSfx(ev.sfx); }
      _lastSfxT = t;
    }
    STATE.raf=requestAnimationFrame(step);
  };
  STATE.raf=requestAnimationFrame(step);
}
function stopLoop(){ if (STATE.raf){ cancelAnimationFrame(STATE.raf); STATE.raf=null; } }

// ---------- LÍNEA DE TIEMPO (cursor fijo al centro, la cinta se mueve) ----------
// TL_PAD = medio visor: así el segundo 0 cae justo bajo el cursor central y
// la posición de scroll es exactamente t*TL_PPS.
let TL_PPS = 150, TL_PAD = 0, tlBound = false;
const ROWS = { film:{top:22,h:46}, phrase:{top:72,h:26}, sub:{top:102,h:34}, title:{top:140,h:28}, sound:{top:172,h:24} };
function tlDur(){ const p=STATE.current; if(!p)return 10; let d=(p.source&&p.source.duration)||0; if(!d && hasWords(p)){ p.transcript.words.forEach(w=>{ if(w.end>d)d=w.end; }); } return d||10; }
function fmtTime(t){ t=Math.max(0,t); const m=Math.floor(t/60), s=Math.floor(t%60); return (m<10?'0':'')+m+':'+(s<10?'0':'')+s; }
function niceStep(){ const cands=[1,2,5,10,15,30,60,120,300]; for(const c of cands){ if(c*TL_PPS>=64) return c; } return 600; }
const tlX = t => TL_PAD + t*TL_PPS;
function segLeftW(s,e,minW){ return `left:${tlX(s).toFixed(1)}px;width:${Math.max(minW||22,(e-s)*TL_PPS-2).toFixed(1)}px;`; }

function renderTimeline(p){
  const inner=$('tle-inner'), scroll=$('tle-scroll'); if(!inner||!scroll) return;
  if(!hasWords(p)){ inner.innerHTML=''; inner.style.width='100%'; return; }
  const dur=tlDur();
  TL_PAD = scroll.clientWidth/2;
  inner.style.width = (dur*TL_PPS + TL_PAD*2) + 'px';

  const step=niceStep(); let ticks='';
  for(let t=0;t<=dur+0.001;t+=step){ ticks+=`<div class="tl-tick" style="left:${tlX(t).toFixed(1)}px;">${fmtTime(t)}</div>`; }

  const isSel=(ty,id)=>STATE.sel && STATE.sel.type===ty && STATE.sel.id===id ? 'sel':'';
  // Banda de frases: cada bloque es un subtítulo completo, igual que aparecerá
  // en pantalla. Es de sólo lectura; el ajuste fino sigue siendo por palabra.
  const phrases=((STATE.subModel&&STATE.subModel.model)||[]).map(m=>{
    const txt=m.chunk.map(w=>(w.word||'').trim()).join(' ');
    return `<div class="tl-phrase" data-t="${m.start}" style="top:${ROWS.phrase.top}px;${segLeftW(m.start,m.end,30)}"><span class="lbl">${esc(txt)}</span></div>`;
  }).join('');
  const film=`<div class="tl-film" id="tl-film" style="top:${ROWS.film.top}px;left:${tlX(0).toFixed(1)}px;width:${(dur*TL_PPS).toFixed(1)}px;"></div>`;
  // Guías de pista: dejan ver dónde caen título y sonido aunque estén vacíos
  const lanes=['phrase','sub','title','sound'].map(k=>
    `<div class="tl-lane" style="top:${ROWS[k].top}px;height:${ROWS[k].h}px;left:${tlX(0).toFixed(1)}px;width:${(dur*TL_PPS).toFixed(1)}px;"></div>`).join('');
  const subs=p.transcript.words.map((w,i)=> w.enabled===false?'' :
    `<div class="tl-seg seg-sub ${isSel('word',i)}" data-ty="word" data-i="${i}" style="top:${ROWS.sub.top}px;${segLeftW(w.start,w.end)}"><span class="lbl">${esc(w.word)}</span><span class="h hl" data-h="l"></span><span class="h hr" data-h="r"></span></div>`).join('');
  const titles=(p.titles||[]).map(x=>
    `<div class="tl-seg seg-title ${isSel('title',x.id)}" data-ty="title" data-id="${x.id}" style="top:${ROWS.title.top}px;${segLeftW(x.start,x.end)}"><span class="lbl">${esc(x.text||'Título')}</span><span class="h hl" data-h="l"></span><span class="h hr" data-h="r"></span></div>`).join('');
  const sounds=(p.sounds||[]).map(x=>
    `<div class="tl-seg seg-sound ${isSel('sound',x.id)}" data-ty="sound" data-id="${x.id}" style="top:${ROWS.sound.top}px;left:${tlX(x.t).toFixed(1)}px;width:30px;"><span class="lbl">🔊</span></div>`).join('');

  inner.innerHTML=`<div class="tl-ruler">${ticks}</div>${lanes}${film}${phrases}${subs}${titles}${sounds}`;
  paintFilm(); bindTLE(); updatePlayhead(true);
}
function tlZoom(f){
  const v=$('preview-video'), t=v?v.currentTime:0;
  TL_PPS=Math.max(12,Math.min(400,TL_PPS*f));
  renderTimeline(STATE.current); tlSyncScroll(t);
}
function tlTimeAt(clientX){ const r=$('tle-inner').getBoundingClientRect(); return Math.max(0,(clientX-r.left-TL_PAD)/TL_PPS); }

// ---------- Miniaturas del vídeo (la cinta de fotogramas) ----------
function stripUrl(p){ return '/api/projects/'+p.id+'/strip?token='+encodeURIComponent(TOKEN); }
function paintFilm(){
  const p=STATE.current, box=$('tl-film'); if(!box||!p) return;
  const dur=tlDur(), total=dur*TL_PPS;
  const TILE=27;                                  // ancho de cada tesela (9:16 sobre 46px de alto)
  const n=Math.max(1, Math.ceil(total/TILE));
  const w=total/n;
  const tiles=p.strip_tiles||40, has=!!p.strip_path;
  const url=has?stripUrl(p):'';
  // La tira es un mosaico horizontal: se recorta con background-position
  const bgSize=(tiles*100)+'% 100%';
  let html='';
  for(let i=0;i<n;i++){
    if(!has){ html+=`<div class="fr ph" style="width:${w.toFixed(2)}px"></div>`; continue; }
    const idx=Math.min(tiles-1, Math.floor((i+0.5)/n*tiles));
    const posX=tiles>1 ? (idx/(tiles-1))*100 : 0;
    html+=`<div class="fr" style="width:${w.toFixed(2)}px;background-image:url('${url}');background-size:${bgSize};background-position:${posX.toFixed(3)}% 0"></div>`;
  }
  box.innerHTML=html;
}
function seekTo(t, play){
  const v=$('preview-video'); if(!v)return;
  v.currentTime=Math.max(0,Math.min(tlDur(),t)); _lastSfxT=v.currentTime;
  _lastKey=DIRTY; _titleKey=DIRTY; renderAt(v.currentTime); updateTitles(v.currentTime); updatePlayhead(true);
  if(play) v.play();
}
function getEl(ty,ref){
  const p=STATE.current;
  if(ty==='word') return p.transcript.words[+ref];
  if(ty==='title') return (p.titles||[]).find(x=>x.id===ref);
  if(ty==='sound') return (p.sounds||[]).find(x=>x.id===ref);
  return null;
}
// Imán: títulos y sonidos se pegan a los bordes de palabras, al cursor y al 0
let _snapPts=[];
function buildSnapPts(){
  const p=STATE.current; _snapPts=[0, tlDur(), cursorT()];
  if(hasWords(p)) p.transcript.words.forEach(w=>{ if(w.enabled!==false){ _snapPts.push(w.start, w.end); } });
}
function snapT(t){ const th=8/TL_PPS; let best=t, bd=th; for(const s of _snapPts){ const d=Math.abs(s-t); if(d<bd){ bd=d; best=s; } } return best; }
function tipShow(text){ const tip=$('tle-tip'); if(!tip)return; tip.textContent=text; tip.classList.remove('hidden'); }
function tipHide(){ const tip=$('tle-tip'); if(tip) tip.classList.add('hidden'); }
function bindTLE(){
  $('tle-inner').querySelectorAll('.tl-seg').forEach(seg=>{
    seg.addEventListener('pointerdown', e=>{
      e.stopPropagation(); e.preventDefault();
      const ty=seg.dataset.ty, ref=ty==='word'?seg.dataset.i:seg.dataset.id;
      const el=getEl(ty,ref); if(!el) return;
      const v=$('preview-video'); if(v && !v.paused){ v.pause(); }
      pushUndo();
      const mode=(ty==='sound')?'move':(e.target.dataset.h||'move');
      const x0=e.clientX; let moved=false;
      const s0=ty==='sound'?el.t:el.start, e0=ty==='sound'?el.t:el.end;
      const doSnap = ty!=='word';       // palabras = ajuste fino libre; título/sonido = imán
      if(doSnap) buildSnapPts();
      try{ seg.setPointerCapture(e.pointerId); }catch(_){}
      const mv=ev=>{
        const dt=(ev.clientX-x0)/TL_PPS; if(Math.abs(ev.clientX-x0)>3)moved=true;
        if(ty==='sound'){
          el.t=Math.max(0,Math.min(tlDur(), doSnap?snapT(s0+dt):(s0+dt)));
          seg.style.left=tlX(el.t)+'px';
          tipShow(el.t.toFixed(2)+'s'); return;
        }
        if(mode==='l') el.start=Math.max(0,Math.min(e0-0.05, doSnap?snapT(s0+dt):(s0+dt)));
        else if(mode==='r') el.end=Math.max(s0+0.05, doSnap?snapT(e0+dt):(e0+dt));
        else { const len=e0-s0; el.start=Math.max(0, doSnap?snapT(s0+dt):(s0+dt)); el.end=el.start+len; }
        seg.style.left=tlX(el.start)+'px'; seg.style.width=Math.max(22,(el.end-el.start)*TL_PPS-2)+'px';
        if(ty==='word') rebuildSubModel(); else { _titleKey=DIRTY; }
        // El preview se refresca, pero el cursor NO salta: así el bloque no se
        // te escapa de debajo del dedo mientras lo arrastras.
        refreshOverlays();
        tipShow(el.start.toFixed(2)+'s – '+el.end.toFixed(2)+'s');
      };
      const up=()=>{
        seg.removeEventListener('pointermove',mv); seg.removeEventListener('pointerup',up);
        seg.removeEventListener('pointercancel',up);
        tipHide();
        if(!moved){
          undoStack.pop();
          STATE.sel={type:ty, id:ty==='word'?+ref:ref};
          renderTimeline(STATE.current);
          seekTo(ty==='sound'?el.t:el.start);
          openSheet('sel');            // tocar un bloque abre sus ajustes
        } else {
          if(ty==='word') saveTranscriptSoon(); else saveElementsSoon();
          renderTimeline(STATE.current);
          seekTo(ty==='sound'?el.t:el.start);
          if(sheetOpen==='sel') renderInspector();
        }
      };
      seg.addEventListener('pointermove',mv); seg.addEventListener('pointerup',up);
      seg.addEventListener('pointercancel',up);   // el táctil cancela el gesto al salirse
    });
  });
  $('tle-inner').querySelectorAll('.tl-phrase').forEach(el=>{
    el.addEventListener('click', ()=>seekTo(parseFloat(el.dataset.t)||0));
  });
  if(tlBound) return; tlBound=true;
  const scroll=$('tle-scroll');
  // Arrastrar la cinta = buscar. Al tocarla se pausa, como en cualquier editor.
  scroll.addEventListener('pointerdown', e=>{
    if(e.target.closest('.tl-seg')) return;
    const v=$('preview-video'); if(v && !v.paused) v.pause();
  });
  scroll.addEventListener('scroll', ()=>{
    if(_tlLock) return;                       // movimiento que hemos provocado nosotros
    const v=$('preview-video'); if(!v || !v.paused) return;   // reproduciendo: el scroll va detrás del vídeo
    const t=Math.max(0, Math.min(tlDur(), scroll.scrollLeft/TL_PPS));
    v.currentTime=t; _lastSfxT=t;
    _lastKey=DIRTY; _titleKey=DIRTY; renderAt(t); updateTitles(t); paintTime(t);
  }, {passive:true});
  scroll.addEventListener('wheel', e=>{ if(e.ctrlKey){ e.preventDefault(); tlZoom(e.deltaY<0?1.15:0.87); } }, {passive:false});
  window.addEventListener('resize', ()=>{ if(STATE.current && hasWords(STATE.current)) renderTimeline(STATE.current); });
}

// Sincroniza la posición de la cinta con el tiempo, sin que el propio
// movimiento se reinterprete como una búsqueda del usuario.
let _tlLock=false, _tlLockT=null;
function tlSyncScroll(t){
  const scroll=$('tle-scroll'); if(!scroll) return;
  const target=Math.round(t*TL_PPS);
  if(Math.abs(scroll.scrollLeft-target)<=1) return;
  _tlLock=true; scroll.scrollLeft=target;
  clearTimeout(_tlLockT); _tlLockT=setTimeout(()=>{ _tlLock=false; }, 140);
}
function paintTime(t){
  const td=$('tle-time'); if(td) td.textContent=fmtTime(t)+' / '+fmtTime(tlDur());
  const inner=$('tle-inner');
  if(inner && STATE.current && hasWords(STATE.current)){
    inner.querySelectorAll('.seg-sub').forEach(s=>{
      const w=STATE.current.transcript.words[+s.dataset.i];
      if(w) s.classList.toggle('active', t>=w.start && t<w.end);
    });
    const off=+(curStyle().time_offset||0), tp=t-off;
    inner.querySelectorAll('.tl-phrase').forEach(el=>{
      const m=(STATE.subModel&&STATE.subModel.model||[]).find(x=>String(x.start)===el.dataset.t);
      if(m) el.classList.toggle('active', tp>=m.start && tp<m.end);
    });
  }
}
function updatePlayhead(force){
  if(!STATE.current) return;
  const v=$('preview-video'), t=v?(v.currentTime||0):0;
  paintTime(t);
  if(force || !v || !v.paused) tlSyncScroll(t);
}

// ---------- Añadir elementos ----------
function cursorT(){ const v=$('preview-video'); return v?(v.currentTime||0):0; }
function addTitleAtCursor(){
  const p=STATE.current; if(!p) return;
  pushUndo();
  p.titles = p.titles||[];
  const t0=Math.min(cursorT(), Math.max(0,tlDur()-1));
  const nt={ id:uid(), text:'TÍTULO', start:Math.round(t0*100)/100, end:Math.round((t0+2.5)*100)/100, color:'#FFFFFF', size:120, pos:24, sound:'swoosh' };
  p.titles.push(nt);
  STATE.sel={type:'title', id:nt.id};
  renderTimeline(p); refreshOverlays(); saveElementsSoon(); openSheet('sel');
  toast('Título añadido','ok');
}
function addSoundAtCursor(){
  const p=STATE.current; if(!p) return;
  pushUndo();
  p.sounds = p.sounds||[];
  const ns={ id:uid(), sfx:'whoosh', t:Math.round(cursorT()*100)/100 };
  p.sounds.push(ns);
  STATE.sel={type:'sound', id:ns.id};
  renderTimeline(p); saveElementsSoon(); playSfx('whoosh'); openSheet('sel');
}
function deleteSel(){
  const p=STATE.current, s=STATE.sel; if(!p||!s) return;
  pushUndo();
  if(s.type==='word'){ const w=p.transcript.words[s.id]; if(w){ w.enabled=false; } saveTranscriptSoon(); rebuildSubModel(); }
  else if(s.type==='title'){ p.titles=(p.titles||[]).filter(x=>x.id!==s.id); saveElementsSoon(); }
  else if(s.type==='sound'){ p.sounds=(p.sounds||[]).filter(x=>x.id!==s.id); saveElementsSoon(); }
  STATE.sel=null;
  renderTimeline(p); refreshOverlays(); closeSheet();
}

// ---------- INSPECTOR contextual ----------
function renderInspector(){
  const box=$('inspector'), p=STATE.current; if(!box||!p) return;
  const s=STATE.sel;
  if (s && s.type==='word') return inspWord(box, s.id);
  if (s && s.type==='title') return inspTitle(box, s.id);
  if (s && s.type==='sound') return inspSound(box, s.id);
  box.innerHTML='<p class="hint-text">Toca un bloque de la línea de tiempo para editarlo.</p>';
}
function inspHead(icon, title, backable){
  const t=$('sheet-title'); if(t) t.textContent=title;   // el título vive en la cabecera de la hoja
  return '';
}
function deselect(){ closeSheet(); }

function inspWord(box, i){
  const w=STATE.current.transcript.words[i]; if(!w) return closeSheet();
  box.innerHTML = inspHead('captions','Palabra', true) + `
    <div class="field"><label>Texto</label><input type="text" value="${esc(w.word)}" onchange="wSet(${i},'word',this.value)"></div>
    <div class="insp-grid2">
      <div class="field"><label>Empieza (s)</label><div class="insp-num">
        <button class="btn btn-ghost btn-sm" onclick="wNudge(${i},'start',-0.05)">−</button>
        <input type="number" step="0.05" value="${(+w.start).toFixed(2)}" onchange="wSet(${i},'start',parseFloat(this.value))">
        <button class="btn btn-ghost btn-sm" onclick="wNudge(${i},'start',0.05)">+</button></div></div>
      <div class="field"><label>Termina (s)</label><div class="insp-num">
        <button class="btn btn-ghost btn-sm" onclick="wNudge(${i},'end',-0.05)">−</button>
        <input type="number" step="0.05" value="${(+w.end).toFixed(2)}" onchange="wSet(${i},'end',parseFloat(this.value))">
        <button class="btn btn-ghost btn-sm" onclick="wNudge(${i},'end',0.05)">+</button></div></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:6px;">
      <button class="btn btn-ghost btn-sm" onclick="seekTo(${w.start},true)"><i data-lucide="play" class="ic"></i> Desde aquí</button>
      <button class="btn btn-danger btn-sm" onclick="deleteSel()"><i data-lucide="eye-off" class="ic"></i> Ocultar palabra</button>
    </div>
    <p class="hint-text" style="margin-top:12px;">También puedes arrastrar el bloque en la línea de tiempo: bordes = cuánto está en pantalla.</p>`;
  icons();
}
function wSet(i,k,v){ pushUndo(); const w=STATE.current.transcript.words[i]; if(k==='word')w.word=String(v).trim(); else w[k]=Math.max(0,+v||0); rebuildSubModel(); renderTimeline(STATE.current); saveTranscriptSoon(); if(k!=='word')seekTo(w.start); }
function wNudge(i,k,d){ const w=STATE.current.transcript.words[i]; wSet(i,k,Math.round(((+w[k]||0)+d)*100)/100); renderInspector(); }

function inspTitle(box, id){
  const x=(STATE.current.titles||[]).find(t=>t.id===id); if(!x) return closeSheet();
  const swatches = PRESETS.map(pr=>`<span class="sw ${pr.color.toUpperCase()===(x.color||'').toUpperCase()?'on':''}" style="background:${pr.color}" title="${pr.name}" onclick="tSet('${id}','color','${pr.color}')"></span>`).join('');
  box.innerHTML = inspHead('type','Título', true) + `
    <div class="field"><label>Texto</label>
      <input type="text" id="title-text-input" value="${esc(x.text)}" oninput="tSet('${id}','text',this.value,true)" onchange="tSet('${id}','text',this.value)">
      <button class="btn btn-ghost btn-sm" style="margin-top:8px;" id="btn-hook" onclick="genHook('${id}')"><i data-lucide="sparkles" class="ic"></i> Hook viral con IA</button>
    </div>
    <div class="field"><label>Color</label><div class="swatches">${swatches}<input type="color" value="${x.color||'#FFFFFF'}" oninput="tSet('${id}','color',this.value,true)" title="Color personalizado"></div></div>
    <div class="field"><label>Sonido al aparecer 🔊</label><select onchange="tSet('${id}','sound',this.value); playSfx(this.value)">${sfxOptions(x.sound, true)}</select></div>
    <div class="insp-grid2">
      <div class="field"><label>Empieza (s)</label><input type="number" step="0.1" value="${(+x.start).toFixed(2)}" onchange="tSet('${id}','start',parseFloat(this.value))"></div>
      <div class="field"><label>Termina (s)</label><input type="number" step="0.1" value="${(+x.end).toFixed(2)}" onchange="tSet('${id}','end',parseFloat(this.value))"></div>
    </div>
    <div class="field"><label>Tamaño <span class="val" style="float:right;">${x.size||120}</span></label>
      <input type="range" min="60" max="180" step="2" value="${x.size||120}" oninput="tSet('${id}','size',parseInt(this.value),true)"></div>
    <div class="field"><label>Altura en pantalla <span class="val" style="float:right;">${Math.round(x.pos||24)}%</span></label>
      <input type="range" min="8" max="90" step="1" value="${x.pos||24}" oninput="tSet('${id}','pos',parseFloat(this.value),true)"></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-ghost btn-sm" onclick="seekTo(${x.start},true)"><i data-lucide="play" class="ic"></i> Ver título</button>
      <button class="btn btn-danger btn-sm" onclick="deleteSel()"><i data-lucide="trash-2" class="ic"></i> Eliminar título</button>
    </div>
    <p class="hint-text" style="margin-top:12px;">Arrástralo en la línea de tiempo para colocarlo en cualquier momento del vídeo.</p>`;
  icons();
  const ti=$('title-text-input');
  if (ti && (x.text==='TÍTULO' || !x.text)) { ti.focus(); ti.select(); }
}
async function genHook(id){
  const x=(STATE.current.titles||[]).find(t=>t.id===id); if(!x) return;
  const b=$('btn-hook'); if(b){ b.disabled=true; b.innerHTML='<span class="spin"></span> Generando…'; }
  try {
    const r=await api('/api/projects/'+STATE.current.id+'/hook',{method:'POST'});
    if(r.hook){ pushUndo(); x.text=r.hook; _titleKey=DIRTY; saveElementsSoon(); renderTimeline(STATE.current); renderInspector(); seekTo(Math.min(x.start+0.3,(x.start+x.end)/2)); toast('Hook generado ✨','ok'); }
  } catch(e){ toast(e.message,'err'); if(b){ b.disabled=false; b.innerHTML='<i data-lucide="sparkles" class="ic"></i> Hook viral con IA'; icons(); } }
}
function tSet(id,k,v,liveOnly){
  const x=(STATE.current.titles||[]).find(t=>t.id===id); if(!x) return;
  if(!liveOnly) pushUndo();
  if(k==='start'||k==='end'||k==='pos'){ x[k]=Math.max(0,+v||0); if(k==='end')x.end=Math.max(x.start+0.2,x.end); }
  else if(k==='size'){ x.size=+v||120; }
  else x[k]=v;
  _titleKey=DIRTY;
  const vd=$('preview-video');
  if(vd && (vd.currentTime<x.start||vd.currentTime>=x.end) && (k==='text'||k==='color'||k==='size'||k==='pos')) seekTo(Math.min(x.start+0.3,(x.start+x.end)/2));
  else refreshOverlays();
  renderTimeline(STATE.current);
  if(!liveOnly){ saveElementsSoon(); renderInspector(); } else saveElementsSoon();
}
function inspSound(box, id){
  const x=(STATE.current.sounds||[]).find(s=>s.id===id); if(!x) return closeSheet();
  box.innerHTML = inspHead('volume-2','Sonido', true) + `
    <div class="field"><label>Efecto</label><select onchange="sSet('${id}','sfx',this.value); playSfx(this.value)">${sfxOptions(x.sfx,false)}</select></div>
    <div class="field"><label>Instante (s)</label><input type="number" step="0.05" value="${(+x.t).toFixed(2)}" onchange="sSet('${id}','t',parseFloat(this.value))"></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-ghost btn-sm" onclick="playSfx('${x.sfx}')"><i data-lucide="play" class="ic"></i> Escuchar</button>
      <button class="btn btn-danger btn-sm" onclick="deleteSel()"><i data-lucide="trash-2" class="ic"></i> Eliminar</button>
    </div>
    <p class="hint-text" style="margin-top:12px;">Arrástralo en la pista de sonido para clavar el instante exacto (por ejemplo, sobre tu palabra clave).</p>`;
  icons();
}
function sSet(id,k,v){ const x=(STATE.current.sounds||[]).find(s=>s.id===id); if(!x)return; pushUndo(); if(k==='t')x.t=Math.max(0,+v||0); else x[k]=v; renderTimeline(STATE.current); saveElementsSoon(); renderInspector(); }

// ---------- Presets / estilo global ----------
function renderPresets(p){
  const el=$('presets'); if(!el) return;
  const cur=String((p.style||{}).highlight_color||'').toUpperCase();
  el.innerHTML = PRESETS.map((pr,i)=>
    `<span class="sw ${pr.color.toUpperCase()===cur?'on':''}" style="background:${pr.color}" title="${pr.name}" onclick="applyPreset(${i})"></span>`
  ).join('') + `<input type="color" value="${(p.style||{}).highlight_color||'#FE2C55'}" oninput="onStyle('highlight_color',this.value)" title="Color personalizado">`;
}
function applyPreset(i){
  const pr=PRESETS[i], cur=curStyle();
  STATE.current.style = Object.assign({}, DEFAULT_STYLE, { position_v: cur.position_v, time_offset: cur.time_offset, highlight_color: pr.color });
  renderPresets(STATE.current); rebuildSubModel(); saveStyle();
  toast('Color: '+pr.name,'ok');
}
function renderPosition(p){
  const v=curStyle().position_v;
  const r=$('posv-range'); if(r)r.value=v;
  const n=$('posv-num'); if(n)n.value=Math.round(v);
  const el=$('posv-val'); if(el)el.textContent=Math.round(v)+'%';
}
function onPosV(value){
  STATE.current.style.position_v=parseFloat(value);
  const el=$('posv-val'); if(el)el.textContent=Math.round(value)+'%';
  const n=$('posv-num'); if(n)n.value=Math.round(value);
  rebuildSubModel(); saveStyleSoon();
}
function setPos(value){
  let v=Math.round(parseFloat(value)); if(!isFinite(v)) v=curStyle().position_v||62;
  v=Math.max(15,Math.min(92,v));
  STATE.current.style.position_v=v; renderPosition(STATE.current); rebuildSubModel(); saveStyle();
}
function nudgePos(d){ setPos((curStyle().position_v||62)+d); }
function renderOffset(){
  const v=+(curStyle().time_offset||0);
  const r=$('offset-range'); if(r)r.value=v;
  const n=$('offset-num'); if(n)n.value=v.toFixed(2);
  const el=$('offset-val'); if(el)el.textContent=v.toFixed(2);
}
function onOffset(value){
  const v=Math.round(parseFloat(value)*100)/100;
  STATE.current.style.time_offset=v;
  const el=$('offset-val'); if(el)el.textContent=v.toFixed(2);
  const n=$('offset-num'); if(n)n.value=v.toFixed(2);
  rebuildSubModel(); saveStyleSoon();
}
function setOffset(value){
  let v=Math.round((parseFloat(value)||0)*100)/100;
  v=Math.max(-1.5,Math.min(1.5,v));
  STATE.current.style.time_offset=v; renderOffset(); rebuildSubModel(); saveStyle();
}
function nudgeOffset(d){ setOffset((+curStyle().time_offset||0)+d); }
const STYLE_FIELDS = [
  { key:'font', label:'Fuente', type:'select', options:[['Montserrat Black','Black'],['Montserrat ExtraBold','ExtraBold'],['Montserrat','Bold']] },
  { key:'uppercase', label:'MAYÚSCULAS', type:'toggle' },
  { key:'font_size', label:'Tamaño', type:'range', min:50, max:170, step:1 },
  { key:'words_per_line', label:'Palabras por bloque', type:'range', min:1, max:6, step:1 },
  { key:'active_scale', label:'Pop palabra activa (%)', type:'range', min:100, max:145, step:1 },
  { key:'outline_width', label:'Grosor del borde', type:'range', min:0, max:14, step:1 },
  { key:'primary_color', label:'Color texto', type:'color' },
  { key:'outline_color', label:'Color borde', type:'color' },
];
function renderStyleControls(p){
  const st=curStyle(), el=$('style-controls'); if(!el) return;
  el.innerHTML = STYLE_FIELDS.map(f=>{
    const v=st[f.key];
    if (f.type==='range') return `<div class="field"><label>${f.label}</label><div class="row"><input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" oninput="onStyle('${f.key}',this.value,true);this.nextElementSibling.textContent=this.value;"><span class="val">${v}</span></div></div>`;
    if (f.type==='color') return `<div class="field"><label>${f.label}</label><div class="row"><input type="color" value="${v}" oninput="onStyle('${f.key}',this.value)"><span class="hint-text">${v}</span></div></div>`;
    if (f.type==='select'){ const o=f.options.map(([val,lbl])=>`<option value="${val}" ${val===v?'selected':''}>${lbl}</option>`).join(''); return `<div class="field"><label>${f.label}</label><select onchange="onStyle('${f.key}',this.value)">${o}</select></div>`; }
    if (f.type==='toggle') return `<div class="field"><label class="toggle"><input type="checkbox" ${v?'checked':''} onchange="onStyle('${f.key}',this.checked)"> ${f.label}</label></div>`;
    return '';
  }).join('');
}
function onStyle(key,value,numeric){ if(numeric)value=parseFloat(value); STATE.current.style[key]=value; rebuildSubModel(); if(key==='highlight_color')renderPresets(STATE.current); saveStyleSoon(); }

// ---------- Job UI ----------
function jobActive(s,k){ return s[k] && (s[k].status==='running'||s[k].status==='queued'); }
function busy(p){ const s=p.steps||{}; return ['proxy','transcribe','render','caption'].some(k=>jobActive(s,k)); }
function updateJobUI(p){
  const s=p.steps||{}, transcribed=hasWords(p), rendering=jobActive(s,'render');
  const rb=$('btn-render');
  if (rb){ if(rendering){ rb.disabled=true; rb.innerHTML='<span class="spin"></span> <span>Exportando…</span>'; } else { rb.disabled=!transcribed; rb.innerHTML='<i data-lucide="upload" class="ic"></i> <span>Exportar</span>'; } }
  const js=$('job-status'); if(!js)return;
  let msg='',cls='running';
  if (jobActive(s,'proxy')) msg='<span class="spin"></span> Preparando el vídeo para editar…';
  else if (jobActive(s,'transcribe')) msg='<span class="spin"></span> Transcribiendo con IA…';
  else if (rendering){ const pct=(s.render&&typeof s.render.progress==='number')?s.render.progress:0; msg=`<div style="flex:1;"><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span><span class="spin"></span> Renderizando…</span><span>${pct}%</span></div><div class="progress-bar"><div class="fill" style="width:${pct}%;transition:width .4s;"></div></div></div>`; }
  else if (jobActive(s,'caption')) msg='<span class="spin"></span> Generando copy…';
  else if (s.render?.status==='error'){ msg='❌ Error en el render'; cls='error'; }
  else if (s.transcribe?.status==='error'){ msg='❌ Error al transcribir'; cls='error'; }
  if (msg){ js.innerHTML=msg; js.className='job-status '+cls; } else { js.className='job-status hidden'; js.innerHTML=''; }
  icons();
}
function flashDone(text){ const js=$('job-status'); if(!js)return; js.innerHTML=text; js.className='job-status done'; setTimeout(()=>{ if(STATE.current && !busy(STATE.current)){ js.className='job-status hidden'; js.innerHTML=''; } },2600); }

// ---------- Acciones ----------
async function doTranscribe(){
  try {
    const lang=($('lang-select')&&$('lang-select').value)||'es';
    STATE.current.steps=STATE.current.steps||{}; STATE.current.steps.transcribe={status:'running'};
    renderStepper(STATE.current); updateJobUI(STATE.current);
    await api('/api/projects/'+STATE.current.id+'/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:lang})});
    startPolling();
  } catch(e){ toast(e.message,'err'); }
}
async function doRender(){
  try {
    if(STATE.current.transcript) await api('/api/projects/'+STATE.current.id+'/transcript',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({words:STATE.current.transcript.words})});
    await saveStyle(); saveElements();
    STATE.current.steps=STATE.current.steps||{}; STATE.current.steps.render={status:'running'};
    renderStepper(STATE.current); updateJobUI(STATE.current);
    await api('/api/projects/'+STATE.current.id+'/render',{method:'POST'});
    startPolling();
  } catch(e){ toast(e.message,'err'); updateJobUI(STATE.current); }
}
async function doCaption(){ try { const cs=$('cap-spin'); if(cs) cs.innerHTML='<span class="spin"></span>'; await api('/api/projects/'+STATE.current.id+'/caption',{method:'POST'}); startPolling(); } catch(e){ toast(e.message,'err'); const cs=$('cap-spin'); if(cs) cs.innerHTML=''; } }
function renderCaption(p){
  const box=$('caption-box'); if(!box)return;
  if (p.caption&&p.caption.caption){ box.classList.remove('hidden'); $('cap-text').textContent=p.caption.caption; $('cap-tags').innerHTML=(p.caption.hashtags||[]).map(h=>`<span class="hashtag">${esc(h)}</span>`).join(''); }
  else box.classList.add('hidden');
  const cs=$('cap-spin'); if(cs) cs.innerHTML = jobActive(p.steps||{},'caption')?'<span class="spin"></span>':'';
}
function copyCaption(){ const p=STATE.current; navigator.clipboard.writeText(p.caption.caption+'\n\n'+(p.caption.hashtags||[]).join(' ')).then(()=>toast('Copiado ✓','ok')); }
function doDownload(){
  const url='/api/projects/'+STATE.current.id+'/download?token='+encodeURIComponent(TOKEN);
  const a=document.createElement('a'); a.href=url; a.download=STATE.current.name+'-tiktok.mp4';
  document.body.appendChild(a); a.click(); a.remove();
  toast('Descarga iniciada ⬇️','ok');
}
function doDownloadIphone(){
  window.open('/api/projects/'+STATE.current.id+'/output?token='+encodeURIComponent(TOKEN), '_blank');
  toast('Mantén pulsado el vídeo y "Guardar en Fotos"','ok');
}
async function doDelete(){
  if(!confirm('¿Eliminar este proyecto y su vídeo?'))return;
  try { const id=STATE.current.id; await api('/api/projects/'+id,{method:'DELETE'}); closeSheet(); STATE.current=null; show('editor',true); show('home',false); loadProjects(); toast('Eliminado','ok'); } catch(e){ toast(e.message,'err'); }
}

// Título automático al transcribir: primero la primera frase, y en cuanto la IA
// responde se sustituye por un HOOK viral de verdad (si el usuario no lo tocó).
function autofillTitle(p){
  if ((p.titles||[]).length) return;
  const ws=((p.transcript&&p.transcript.words)||[]).filter(w=>w.enabled!==false).slice(0,5).map(w=>(w.word||'').trim());
  const txt=ws.join(' ').replace(/[.,;:!?]+$/,'').trim();
  if(!txt) return;   // sin transcripción no se crea ningún título fantasma
  const nt={ id:uid(), text:txt, start:0, end:2.5, color:'#FFFFFF', size:120, pos:24, sound:'swoosh' };
  p.titles=[nt];
  saveElements();
  api('/api/projects/'+p.id+'/hook',{method:'POST'}).then(r=>{
    if(!r.hook) return;
    const t=(p.titles||[]).find(x=>x.id===nt.id);
    if(t && t.text===txt){
      t.text=r.hook; saveElementsSoon();
      if(STATE.current && STATE.current.id===p.id){ _titleKey=DIRTY; renderTimeline(p); refreshOverlays(); if(sheetOpen==='sel') renderInspector(); toast('Hook viral generado ✨','ok'); }
    }
  }).catch(()=>{});
}

// ---------- Polling ----------
function startPollingIfNeeded(){ if(STATE.current&&busy(STATE.current))startPolling(); }
function startPolling(){
  if (STATE.poll) return;
  STATE.poll=setInterval(async()=>{
    if(!STATE.current){ stopPolling(); return; }
    try {
      const prev=STATE.current, prevSteps=prev.steps||{}, wasOutput=prev.output, hadProxy=prev.proxy_path, hadStrip=prev.strip_path;
      const fresh=await api('/api/projects/'+STATE.current.id);
      // Conservar ediciones locales en curso (no pisar con lo del servidor mientras editas)
      if (busy(fresh) || !busy(prev)) {
        fresh.transcript = (prevSteps.transcribe && jobActive(prevSteps,'transcribe')) ? fresh.transcript : (prev.transcript||fresh.transcript);
        if (!jobActive(prevSteps,'transcribe')){ fresh.titles=prev.titles; fresh.sounds=prev.sounds; }
      }
      STATE.current=fresh;
      renderStepper(fresh); renderCaption(fresh); renderProjectList(); updateJobUI(fresh);
      const transcribed=hasWords(fresh);
      if (transcribed && jobActive(prevSteps,'transcribe') && fresh.steps.transcribe.status==='done'){
        autofillTitle(fresh); STATE.sel=null; renderEditor(); flashDone('✓ Transcripción lista');
      }
      if (fresh.proxy_path && !hadProxy && STATE.previewMode!=='output'){
        const at=(()=>{ const v=$('preview-video'); return v?v.currentTime:0; })();
        loadPreviewVideo(fresh);                     // ya podemos tirar del vídeo ligero
        const v=$('preview-video'); if(v) v.addEventListener('loadeddata', ()=>seekTo(at), {once:true});
        flashDone('✓ Vídeo listo para editar');
      }
      if (fresh.strip_path && !hadStrip && hasWords(fresh)) renderTimeline(fresh);
      if (fresh.output && (!wasOutput || wasOutput.rendered_at!==fresh.output.rendered_at)){
        STATE.previewMode='output'; loadPreviewVideo(fresh); if(sheetOpen==='export') renderSheet(); flashDone('✓ Render listo'); toast('Vídeo listo — «Guardar» para descargarlo','ok');
      }
      ['transcribe','render','caption'].forEach(k=>{ const stt=(fresh.steps||{})[k]; if(stt&&stt.status==='error'&&jobActive(prevSteps,k))toast('Error en '+k+': '+stt.error,'err'); });
      if (!busy(fresh)) stopPolling();
    } catch(e){ stopPolling(); }
  },1000);
}
function stopPolling(){ if(STATE.poll){ clearInterval(STATE.poll); STATE.poll=null; } }

// ---------- Atajos de teclado ----------
document.addEventListener('keydown', e=>{
  const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
  const editing = STATE.current && $('editor') && !$('editor').classList.contains('hidden');
  if ((e.ctrlKey||e.metaKey) && (e.key==='z'||e.key==='Z')){ if(!typing && editing){ e.preventDefault(); doUndo(); } return; }
  if (typing || !editing) return;
  if (e.code==='Space'){ e.preventDefault(); togglePlay(); }
  else if (e.key==='ArrowLeft'){ e.preventDefault(); seekTo(cursorT()-(e.shiftKey?1:1/30)); }
  else if (e.key==='ArrowRight'){ e.preventDefault(); seekTo(cursorT()+(e.shiftKey?1:1/30)); }
  else if (e.key==='Escape'){ if(STATE.sel) deselect(); }
  else if (e.key==='Delete' || e.key==='Backspace'){ if(STATE.sel){ e.preventDefault(); deleteSel(); } }
});

window.addEventListener('resize', ()=>{ updateGeometry(); refreshOverlays(); });

// ---------- init ----------
async function init(){
  try { const cfg=await (await fetch('/api/config')).json(); if(!cfg.auth_required){ TOKEN=''; showApp(); return; } } catch(e){}
  if (TOKEN) showApp(); else { show('login',false); icons(); }
}
init();
