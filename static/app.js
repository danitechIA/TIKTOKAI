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
function showApp(){
  show('login',true); show('app',false); icons(); loadProjects(); loadSfx();
  const g = G(); if (g) g.from('.topbar', {y:-30, opacity:0, duration:.5, ease:'power3.out'});
}

// ---------- Projects ----------
async function loadProjects(){ try { STATE.projects = await api('/api/projects'); renderProjectList(); } catch(e){ toast(e.message,'err'); } }
function renderProjectList(){
  const el = $('proj-list'); if(!el) return;
  if (!STATE.projects.length){ el.innerHTML = '<p class="hint-text" style="padding:10px;">Aún no hay proyectos.</p>'; return; }
  el.innerHTML = STATE.projects.map(p => {
    const active = STATE.current && STATE.current.id===p.id ? 'active':'';
    return `<div class="proj-item ${active}" onclick="selectProject('${p.id}')" data-id="${p.id}">
      <div class="thumb">🎞️</div>
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
    STATE.previewMode = 'live'; STATE.sel = null; undoStack = []; TL_FIT = true;
    renderProjectList(); renderEditor();
    startPollingIfNeeded();
    const g = G(); if (g) g.from('#editor .panel', {opacity:0, y:14, duration:.4, ease:'power3.out'});
  } catch(e){ toast(e.message,'err'); }
}

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
  show('no-project', true); show('editor', false);
  renderStepper(p); loadPreviewVideo(p);
  const transcribed = hasWords(p);
  show('timeline-section', !transcribed);
  show('copy-section', !transcribed);
  renderInspector();
  if (transcribed){ rebuildSubModel(); renderTimeline(p); }
  updateJobUI(p);
  show('download-group', !p.output);
  show('btn-source', !p.output);
  renderCaption(p); icons();
}
function hasWords(p){ return !!(p && p.transcript && p.transcript.words && p.transcript.words.length); }
function renderStepper(p){
  const s = p.steps||{};
  const steps = [['upload','Subir','upload'],['mic','Transcribir','transcribe'],['clapperboard','Editar',null],['sparkles','Render','render']];
  $('stepper').innerHTML = steps.map(([ic,label,key])=>{
    let cls=''; if (key==='upload') cls='done';
    else if (key && s[key]) cls = s[key].status==='done'?'done':(s[key].status==='running'||s[key].status==='queued')?'running':s[key].status==='error'?'error':'';
    else if (!key && hasWords(p)) cls='done';
    return `<div class="step ${cls}"><span class="dot"></span><i data-lucide="${ic}" class="ic"></i> ${label}</div>`;
  }).join('');
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
  rebuildSubModel(); renderTimeline(p); renderInspector(); refreshOverlays();
  saveTranscriptSoon(); saveElementsSoon();
  toast('Deshecho ↶','ok');
}

// ---------- Preview: vídeo + overlays ----------
function loadPreviewVideo(p){
  const v = $('preview-video'); if(!v) return;
  const tk = '&token='+encodeURIComponent(TOKEN), so=$('sub-overlay'), to=$('title-overlay'), bs=$('btn-source');
  const live = !(STATE.previewMode==='output' && p.output);
  v.src = live ? ('/api/projects/'+p.id+'/source?t=1'+tk) : ('/api/projects/'+p.id+'/output?t='+Date.now()+tk);
  if(so) so.style.display = live?'':'none';
  if(to) to.style.display = live?'':'none';
  if(bs) bs.textContent = live ? (p.output?'Ver render':'Original') : 'Ver preview en vivo';
  const refresh = () => { updateGeometry(); _lastKey=''; _titleKey=''; renderAt(v.currentTime); updateTitles(v.currentTime); updatePlayhead(); };
  v.onloadedmetadata = refresh; v.onloadeddata = refresh;
  setTimeout(refresh, 300); setTimeout(refresh, 900);
  v.onplay = ()=>{ _lastSfxT = v.currentTime; startLoop(); syncPlayBtn(); };
  v.onpause = ()=>{ stopLoop(); syncPlayBtn(); };
  v.onseeked = ()=>{ _lastSfxT=v.currentTime; _lastKey=''; _titleKey=''; renderAt(v.currentTime); updateTitles(v.currentTime); updatePlayhead(); };
}
function toggleSource(){ STATE.previewMode = STATE.previewMode==='output'?'live':'output'; loadPreviewVideo(STATE.current); }
function togglePlay(){ const v=$('preview-video'); if(!v)return; if (v.paused) v.play(); else v.pause(); }
function syncPlayBtn(){ const v=$('preview-video'), b=$('btn-play'); if(v&&b){ b.innerHTML=v.paused?'<i data-lucide="play" class="ic"></i> Reproducir':'<i data-lucide="pause" class="ic"></i> Pausa'; icons(); } }
function refreshOverlays(){ const v=$('preview-video'); _lastKey=''; _titleKey=''; if(v){ renderAt(v.currentTime); updateTitles(v.currentTime); } }

function updateGeometry(){
  const v=$('preview-video'), ov=$('sub-overlay'); if(!v||!ov||!v.videoWidth) return;
  const vw=v.clientWidth, vh=v.clientHeight, va=v.videoWidth/v.videoHeight, ea=vw/vh;
  let rW,rH,top,left;
  if (va>ea){ rW=vw; rH=vw/va; left=0; top=(vh-rH)/2; } else { rH=vh; rW=vh*va; top=0; left=(vw-rW)/2; }
  ov.dataset.rw=rW; ov.dataset.rh=rH; ov.dataset.top=top; ov.dataset.left=left;
  ov.dataset.scale = rH / v.videoHeight;
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
  updateGeometry(); _lastKey='';
  const pv=$('preview-video'); renderAt(pv?pv.currentTime:0);
}
function outlineShadow(px, color){
  const o=[]; const n=16;
  for (let i=0;i<n;i++){ const a=i/n*2*Math.PI; o.push(`${(Math.cos(a)*px).toFixed(2)}px ${(Math.sin(a)*px).toFixed(2)}px 0 ${color}`); }
  o.push(`0 ${(px*1.5).toFixed(2)}px ${(px*1.3).toFixed(2)}px rgba(0,0,0,.4)`);
  return o.join(',');
}
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

// ---------- LÍNEA DE TIEMPO multi-pista ----------
let TL_PPS = 100, TL_FIT = true, tlBound = false;
const RULER_H = 20, TRACK_H = 34, TRACK_GAP = 6;
const trackTop = i => RULER_H + 6 + i*(TRACK_H+TRACK_GAP);
function tlDur(){ const p=STATE.current; if(!p)return 10; let d=(p.source&&p.source.duration)||0; if(!d && hasWords(p)){ p.transcript.words.forEach(w=>{ if(w.end>d)d=w.end; }); } return d||10; }
function fmtTime(t){ t=Math.max(0,t); const m=Math.floor(t/60), s=Math.floor(t%60); return (m<10?'0':'')+m+':'+(s<10?'0':'')+s; }
function niceStep(){ const cands=[1,2,5,10,15,30,60,120,300]; for(const c of cands){ if(c*TL_PPS>=70) return c; } return 600; }
function segLeftW(s,e){ return `left:${(s*TL_PPS).toFixed(1)}px;width:${Math.max(16,(e-s)*TL_PPS-3).toFixed(1)}px;`; }

function renderTimeline(p){
  const inner=$('tle-inner'), scroll=$('tle-scroll'); if(!inner||!scroll||!hasWords(p)) return;
  const dur=tlDur();
  if(TL_FIT){ TL_PPS=Math.max(20,(scroll.clientWidth-6)/dur); }
  inner.style.width=Math.max(scroll.clientWidth, dur*TL_PPS)+'px';
  const step=niceStep(); let ticks='';
  for(let t=0;t<=dur+0.001;t+=step){ ticks+=`<div class="tle-tick" style="left:${(t*TL_PPS).toFixed(1)}px;">${fmtTime(t)}</div>`; }
  let lanes=''; for(let i=0;i<3;i++) lanes+=`<div class="tle-lane" style="top:${trackTop(i)}px;"></div>`;
  const isSel=(ty,id)=>STATE.sel && STATE.sel.type===ty && STATE.sel.id===id ? 'sel':'';
  const subs=p.transcript.words.map((w,i)=> w.enabled===false?'' :
    `<div class="tle-seg seg-sub ${isSel('word',i)}" data-ty="word" data-i="${i}" style="top:${trackTop(0)}px;${segLeftW(w.start,w.end)}"><span class="lbl">${esc(w.word)}</span><span class="h hl" data-h="l"></span><span class="h hr" data-h="r"></span></div>`).join('');
  const titles=(p.titles||[]).map(x=>
    `<div class="tle-seg seg-title ${isSel('title',x.id)}" data-ty="title" data-id="${x.id}" style="top:${trackTop(1)}px;${segLeftW(x.start,x.end)}"><span class="lbl">${esc(x.text||'Título')}</span><span class="h hl" data-h="l"></span><span class="h hr" data-h="r"></span></div>`).join('');
  const sounds=(p.sounds||[]).map(x=>
    `<div class="tle-seg seg-sound ${isSel('sound',x.id)}" data-ty="sound" data-id="${x.id}" style="top:${trackTop(2)}px;left:${(x.t*TL_PPS).toFixed(1)}px;width:26px;"><span class="lbl">🔊</span></div>`).join('');
  inner.innerHTML=`<div class="tle-ruler">${ticks}</div>${lanes}${subs}${titles}${sounds}<div class="tle-playhead" id="tle-ph"></div>`;
  bindTLE(); updatePlayhead();
}
function tlZoom(f){ TL_FIT=false; TL_PPS=Math.max(20,Math.min(600,TL_PPS*f)); renderTimeline(STATE.current); }
function tlZoomFit(){ TL_FIT=true; renderTimeline(STATE.current); }
function tlTimeAt(clientX){ const r=$('tle-inner').getBoundingClientRect(); return Math.max(0,(clientX-r.left)/TL_PPS); }
function seekTo(t, play){
  const v=$('preview-video'); if(!v)return;
  v.currentTime=Math.max(0,Math.min(tlDur(),t)); _lastSfxT=v.currentTime;
  _lastKey=''; _titleKey=''; renderAt(v.currentTime); updateTitles(v.currentTime); updatePlayhead();
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
function tipShow(text, xPx){ const tip=$('tle-tip'); if(!tip)return; tip.textContent=text; tip.classList.remove('hidden'); tip.style.left=Math.max(0,xPx)+'px'; }
function tipHide(){ const tip=$('tle-tip'); if(tip) tip.classList.add('hidden'); }
function bindTLE(){
  $('tle-inner').querySelectorAll('.tle-seg').forEach(seg=>{
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
        const dt=(ev.clientX-x0)/TL_PPS; if(Math.abs(ev.clientX-x0)>2)moved=true;
        if(ty==='sound'){
          el.t=Math.max(0,Math.min(tlDur(), doSnap?snapT(s0+dt):(s0+dt)));
          seg.style.left=(el.t*TL_PPS)+'px'; seekTo(el.t);
          tipShow(el.t.toFixed(2)+'s', el.t*TL_PPS); return;
        }
        if(mode==='l') el.start=Math.max(0,Math.min(e0-0.05, doSnap?snapT(s0+dt):(s0+dt)));
        else if(mode==='r') el.end=Math.max(s0+0.05, doSnap?snapT(e0+dt):(e0+dt));
        else { const len=e0-s0; el.start=Math.max(0, doSnap?snapT(s0+dt):(s0+dt)); el.end=el.start+len; }
        seg.style.left=(el.start*TL_PPS)+'px'; seg.style.width=Math.max(16,(el.end-el.start)*TL_PPS-3)+'px';
        if(ty==='word') rebuildSubModel(); else { _titleKey=''; }
        seekTo(mode==='r'?Math.max(0,el.end-0.02):(mode==='l'?el.start+0.02:(el.start+el.end)/2));
        tipShow(el.start.toFixed(2)+'s – '+el.end.toFixed(2)+'s', (mode==='r'?el.end:el.start)*TL_PPS);
      };
      const up=()=>{
        seg.removeEventListener('pointermove',mv); seg.removeEventListener('pointerup',up);
        tipHide();
        if(!moved){
          undoStack.pop();
          STATE.sel={type:ty, id:ty==='word'?+ref:ref};
          renderTimeline(STATE.current); renderInspector();
          seekTo(ty==='sound'?el.t:el.start);
        } else {
          if(ty==='word') saveTranscriptSoon(); else saveElementsSoon();
          renderInspector();
        }
      };
      seg.addEventListener('pointermove',mv); seg.addEventListener('pointerup',up);
    });
  });
  if(tlBound) return; tlBound=true;
  const scroll=$('tle-scroll');
  scroll.addEventListener('pointerdown', e=>{
    if(e.target.closest('.tle-seg')) return;
    const v=$('preview-video'); if(!v)return;
    if(!v.paused){ v.pause(); }
    seekTo(tlTimeAt(e.clientX));
    const mv=ev=>seekTo(tlTimeAt(ev.clientX));
    const up=()=>{ document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); };
    document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up);
  });
  scroll.addEventListener('wheel', e=>{ if(e.ctrlKey){ e.preventDefault(); tlZoom(e.deltaY<0?1.15:0.87); } }, {passive:false});
}
function updatePlayhead(){
  const inner=$('tle-inner'), ph=$('tle-ph'); if(!inner||!ph||!STATE.current)return;
  const v=$('preview-video'), t=v?(v.currentTime||0):0;
  ph.style.left=(t*TL_PPS)+'px';
  inner.querySelectorAll('.seg-sub').forEach(s=>{ const w=STATE.current.transcript.words[+s.dataset.i]; if(w) s.classList.toggle('active', t>=w.start && t<w.end); });
  const td=$('tle-time'); if(td) td.textContent=fmtTime(t)+' / '+fmtTime(tlDur());
  const scroll=$('tle-scroll'); if(scroll){ const x=t*TL_PPS; if(x<scroll.scrollLeft+30||x>scroll.scrollLeft+scroll.clientWidth-30) scroll.scrollLeft=Math.max(0,x-scroll.clientWidth/2); }
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
  renderTimeline(p); renderInspector(); refreshOverlays(); saveElementsSoon();
  toast('Título añadido — edítalo a la derecha','ok');
}
function addSoundAtCursor(){
  const p=STATE.current; if(!p) return;
  pushUndo();
  p.sounds = p.sounds||[];
  const ns={ id:uid(), sfx:'whoosh', t:Math.round(cursorT()*100)/100 };
  p.sounds.push(ns);
  STATE.sel={type:'sound', id:ns.id};
  renderTimeline(p); renderInspector(); saveElementsSoon(); playSfx('whoosh');
}
function deleteSel(){
  const p=STATE.current, s=STATE.sel; if(!p||!s) return;
  pushUndo();
  if(s.type==='word'){ const w=p.transcript.words[s.id]; if(w){ w.enabled=false; } saveTranscriptSoon(); rebuildSubModel(); }
  else if(s.type==='title'){ p.titles=(p.titles||[]).filter(x=>x.id!==s.id); saveElementsSoon(); }
  else if(s.type==='sound'){ p.sounds=(p.sounds||[]).filter(x=>x.id!==s.id); saveElementsSoon(); }
  STATE.sel=null;
  renderTimeline(p); renderInspector(); refreshOverlays();
}

// ---------- INSPECTOR contextual ----------
function renderInspector(){
  const box=$('inspector'), p=STATE.current; if(!box||!p) return;
  const s=STATE.sel;
  if (s && s.type==='word') return inspWord(box, s.id);
  if (s && s.type==='title') return inspTitle(box, s.id);
  if (s && s.type==='sound') return inspSound(box, s.id);
  return inspGlobal(box);
}
function inspHead(icon, title, backable){
  return `<div class="insp-head"><span class="t"><i data-lucide="${icon}" class="ic"></i> ${title}</span>${backable?'<button class="btn btn-ghost btn-sm back" onclick="deselect()">← Estilo general</button>':''}</div>`;
}
function deselect(){ STATE.sel=null; renderTimeline(STATE.current); renderInspector(); }

function inspGlobal(box){
  const p=STATE.current, st=curStyle(), transcribed=hasWords(p);
  let html = inspHead('sliders-horizontal','Estilo general', false);
  html += `<div class="field"><div class="row">
    <select id="lang-select" style="max-width:150px;">
      <option value="es">Español</option><option value="en">Inglés</option><option value="auto">Auto</option>
    </select>
    <button class="btn ${transcribed?'btn-ghost':'btn-primary'} btn-sm" id="btn-transcribe" onclick="doTranscribe()"><i data-lucide="${transcribed?'rotate-cw':'wand-2'}" class="ic"></i> ${transcribed?'Re-transcribir':'Transcribir con IA'}</button>
  </div></div>`;
  if (!transcribed){
    html += `<p class="hint-text">Transcribe el vídeo para generar los subtítulos palabra a palabra. Después edítalo todo en la línea de tiempo de abajo: subtítulos, títulos y sonidos.</p>`;
    box.innerHTML=html; if(p.transcript?.language && $('lang-select')) $('lang-select').value=p.transcript.language; icons(); return;
  }
  html += `<div class="field"><label>Color de subtítulos</label><div class="swatches" id="presets"></div></div>`;
  html += `<div class="field"><label>Posición del texto <span class="val" id="posv-val" style="float:right;"></span></label>
    <div class="row">
      <button class="btn btn-ghost btn-sm" onclick="nudgePos(-4)"><i data-lucide="arrow-up" class="ic"></i></button>
      <input type="range" min="15" max="92" step="1" id="posv-range" oninput="onPosV(this.value)">
      <button class="btn btn-ghost btn-sm" onclick="nudgePos(4)"><i data-lucide="arrow-down" class="ic"></i></button>
    </div></div>`;
  html += `<div class="field"><label>Sincronía global (s) — negativo adelanta <span class="val" id="offset-val" style="float:right;">0.00</span></label>
    <input type="range" min="-1.5" max="1.5" step="0.05" value="0" id="offset-range" oninput="onOffset(this.value)"></div>`;
  html += `<div class="section-title" style="margin-top:10px;"><span class="lbl">Ajuste fino</span><button class="btn btn-ghost btn-sm" id="btn-toggle-style" onclick="toggleAdvanced()">Mostrar</button></div>
    <div id="style-controls" class="hidden"></div>`;
  html += `<p class="hint-text" style="margin-top:12px;"><i data-lucide="mouse-pointer-click" class="ic" style="width:13px;height:13px;vertical-align:-2px;"></i> Selecciona cualquier bloque de la línea de tiempo para editar su texto, tiempos o sonido aquí.</p>`;
  box.innerHTML=html;
  if(p.transcript?.language && $('lang-select')) $('lang-select').value=p.transcript.language;
  renderPresets(p); renderPosition(p);
  const off=st.time_offset||0; if($('offset-range'))$('offset-range').value=off; if($('offset-val'))$('offset-val').textContent=(+off).toFixed(2);
  renderStyleControls(p);
  icons();
}
function inspWord(box, i){
  const w=STATE.current.transcript.words[i]; if(!w) return inspGlobal(box);
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
  const x=(STATE.current.titles||[]).find(t=>t.id===id); if(!x) return inspGlobal(box);
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
    if(r.hook){ pushUndo(); x.text=r.hook; _titleKey=''; saveElementsSoon(); renderTimeline(STATE.current); renderInspector(); seekTo(Math.min(x.start+0.3,(x.start+x.end)/2)); toast('Hook generado ✨','ok'); }
  } catch(e){ toast(e.message,'err'); if(b){ b.disabled=false; b.innerHTML='<i data-lucide="sparkles" class="ic"></i> Hook viral con IA'; icons(); } }
}
function tSet(id,k,v,liveOnly){
  const x=(STATE.current.titles||[]).find(t=>t.id===id); if(!x) return;
  if(!liveOnly) pushUndo();
  if(k==='start'||k==='end'||k==='pos'){ x[k]=Math.max(0,+v||0); if(k==='end')x.end=Math.max(x.start+0.2,x.end); }
  else if(k==='size'){ x.size=+v||120; }
  else x[k]=v;
  _titleKey='';
  const vd=$('preview-video');
  if(vd && (vd.currentTime<x.start||vd.currentTime>=x.end) && (k==='text'||k==='color'||k==='size'||k==='pos')) seekTo(Math.min(x.start+0.3,(x.start+x.end)/2));
  else refreshOverlays();
  renderTimeline(STATE.current);
  if(!liveOnly){ saveElementsSoon(); renderInspector(); } else saveElementsSoon();
}
function inspSound(box, id){
  const x=(STATE.current.sounds||[]).find(s=>s.id===id); if(!x) return inspGlobal(box);
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
function renderPosition(p){ const v=curStyle().position_v; const r=$('posv-range'); if(r)r.value=v; const el=$('posv-val'); if(el)el.textContent=Math.round(v)+'%'; }
function onPosV(value){ STATE.current.style.position_v=parseFloat(value); const el=$('posv-val'); if(el)el.textContent=Math.round(value)+'%'; rebuildSubModel(); saveStyleSoon(); }
function nudgePos(d){ let v=Math.round((curStyle().position_v||62)+d); v=Math.max(15,Math.min(92,v)); STATE.current.style.position_v=v; renderPosition(STATE.current); rebuildSubModel(); saveStyle(); }
function onOffset(value){ const v=parseFloat(value); STATE.current.style.time_offset=v; const el=$('offset-val'); if(el)el.textContent=v.toFixed(2); rebuildSubModel(); saveStyleSoon(); }
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
function toggleAdvanced(){ const el=$('style-controls'); const h=el.classList.toggle('hidden'); $('btn-toggle-style').textContent=h?'Mostrar':'Ocultar'; }
function onStyle(key,value,numeric){ if(numeric)value=parseFloat(value); STATE.current.style[key]=value; rebuildSubModel(); if(key==='highlight_color')renderPresets(STATE.current); saveStyleSoon(); }

// ---------- Job UI ----------
function jobActive(s,k){ return s[k] && (s[k].status==='running'||s[k].status==='queued'); }
function busy(p){ const s=p.steps||{}; return ['transcribe','render','caption'].some(k=>jobActive(s,k)); }
function updateJobUI(p){
  const s=p.steps||{}, transcribed=hasWords(p), rendering=jobActive(s,'render');
  const rb=$('btn-render');
  if (rb){ if(rendering){ rb.disabled=true; rb.innerHTML='<span class="spin"></span> Renderizando…'; } else { rb.disabled=!transcribed; rb.innerHTML='<i data-lucide="sparkles" class="ic"></i> Renderizar'; } }
  const js=$('job-status'); if(!js)return;
  let msg='',cls='running';
  if (jobActive(s,'transcribe')) msg='<span class="spin"></span> Transcribiendo con IA…';
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
async function doCaption(){ try { $('cap-spin').innerHTML='<span class="spin"></span>'; await api('/api/projects/'+STATE.current.id+'/caption',{method:'POST'}); startPolling(); } catch(e){ toast(e.message,'err'); $('cap-spin').innerHTML=''; } }
function renderCaption(p){
  const box=$('caption-box'); if(!box)return;
  if (p.caption&&p.caption.caption){ box.classList.remove('hidden'); $('cap-text').textContent=p.caption.caption; $('cap-tags').innerHTML=(p.caption.hashtags||[]).map(h=>`<span class="hashtag">${esc(h)}</span>`).join(''); }
  else box.classList.add('hidden');
  $('cap-spin').innerHTML = jobActive(p.steps||{},'caption')?'<span class="spin"></span>':'';
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
  try { await api('/api/projects/'+STATE.current.id,{method:'DELETE'}); STATE.current=null; show('editor',true); show('no-project',false); loadProjects(); toast('Eliminado','ok'); } catch(e){ toast(e.message,'err'); }
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
      if(STATE.current && STATE.current.id===p.id){ _titleKey=''; renderTimeline(p); renderInspector(); refreshOverlays(); toast('Hook viral generado ✨','ok'); }
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
      const prev=STATE.current, prevSteps=prev.steps||{}, wasOutput=prev.output;
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
      if (fresh.output && (!wasOutput || wasOutput.rendered_at!==fresh.output.rendered_at)){
        STATE.previewMode='output'; loadPreviewVideo(fresh); show('download-group',false); flashDone('✓ Render listo');
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

window.addEventListener('resize', ()=>{ updateGeometry(); refreshOverlays(); if(STATE.current && hasWords(STATE.current) && TL_FIT) renderTimeline(STATE.current); });

// ---------- init ----------
async function init(){
  try { const cfg=await (await fetch('/api/config')).json(); if(!cfg.auth_required){ TOKEN=''; showApp(); return; } } catch(e){}
  if (TOKEN) showApp(); else { show('login',false); icons(); }
}
init();
