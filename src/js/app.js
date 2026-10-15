// FreeCut — inicialização, menus, atalhos, player interativo e projetos
import {
  store, newProject, commit, resetHistory, undo, redo, select, selected, clipById, deleteClips, duplicateClips, splitAtPlayhead,
  projectDuration, clipEnd, setKeyframe, kfValue, insertMedia, makeClip, insertClip, trackOf, allClips, mediaOf, compactMain, sortTracks, freeTrack
} from './store.js';
import { initEngine, engine, drawPreview, requestRender, play, pause, toggle, seek, gcPool, audioLevel, resizePreview, snapshotPNG, syncMedia } from './engine.js';
import { initTimeline, renderTimeline, setZoom, zoomFit } from './timeline.js';
import { tl } from './timeline.js';
import { initInspector } from './inspector.js';
import { initPanels, show as showPanel, importDialog, newText, addAtPlayhead, applyEffect, applyFilter, applyTransition } from './panels.js';
import { importPaths, loadAllAssets, toggleVoiceover } from './media.js';
import { exportDialog, exportVideo, audioPlan, addCaptions } from './exporter.js';
import { RATIOS, TEXT_PRESETS } from './catalog.js';
import { $, $$, el, toast, modal, fmtTime, clamp, debounce, deep, uid } from './util.js';

const fc = window.fc;
window.FC = { store, engine, seek, play, pause, select, commit };

/* ======================= projeto ======================= */
function loadProject(p, path = null) {
  pause();
  store.project = p;
  store.path = path;
  store.sel.clear(); store.selTrans = null; store.cache = {};
  store.time = 0;
  resetHistory();
  store.dirty = false;
  $('#projName').value = p.name;
  resizePreview();
  fitCanvas();
  loadAllAssets();
  gcPool();
  store.emit('change', 'load');
  store.emit('select');
  showPanel('media');
  setTimeout(zoomFit, 50);
  updateTitle();
}

async function saveProject(as = false) {
  let path = store.path;
  if (!path || as) {
    path = await fc.invoke('dialog:save', { title: 'Salvar projeto', name: (store.project.name || 'projeto') + '.freecut', filters: [{ name: 'Projeto FreeCut', extensions: ['freecut'] }] });
    if (!path) return false;
  }
  await fc.invoke('fs:writeText', path, JSON.stringify(store.project, null, 1));
  store.path = path;
  store.dirty = false;
  fc.invoke('fs:recent', path);
  $('#saveState').textContent = 'Salvo às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  updateTitle();
  toast('Projeto salvo', 'ok');
  return true;
}

async function openProject(path) {
  path = path || await fc.invoke('dialog:openProject');
  if (!path) return;
  try {
    const p = JSON.parse(await fc.invoke('fs:readText', path));
    if (p.app !== 'FreeCut') throw new Error('não é um projeto FreeCut');
    loadProject(p, path);
    fc.invoke('fs:recent', path);
    const missing = Object.values(p.media).filter(m => m.missing);
    setTimeout(() => { const n = Object.values(store.project.media).filter(m => m.missing).length; if (n) toast(`${n} arquivo(s) de mídia não encontrado(s)`, 'bad', 6000); }, 800);
    void missing;
  } catch (e) { toast('Não foi possível abrir: ' + e.message, 'bad', 6000); }
}

async function confirmDiscard() {
  if (!store.dirty || !allClips().length) return true;
  const r = await modal({ title: 'Alterações não salvas', body: '<p>Deseja salvar o projeto atual antes de continuar?</p>', ok: 'Salvar', cancel: 'Descartar' });
  if (r) return saveProject();
  return true;
}

const TEST_MODE = new URLSearchParams(location.search).has('test');
const autosave = debounce(async () => {
  if (TEST_MODE || !store.project || !allClips().length) return;
  const p = await fc.invoke('fs:autosavePath');
  await fc.invoke('fs:writeText', p, JSON.stringify({ path: store.path, project: store.project, t: Date.now() }));
  if (store.dirty) $('#saveState').textContent = 'Rascunho salvo automaticamente';
}, 2500);

function updateTitle() { document.title = `${store.project.name}${store.dirty ? ' •' : ''} — FreeCut`; }

/* ======================= tela inicial ======================= */
async function welcome(first = false) {
  const recent = await fc.invoke('fs:recent');
  let auto = null;
  if (first) {
    try { auto = JSON.parse(await fc.invoke('fs:readText', await fc.invoke('fs:autosavePath'))); } catch { /* sem rascunho */ }
  }
  let ratio = '16:9';
  const body = el('div');
  const grid = el('div', { class: 'ratio-grid' });
  for (const r of RATIOS) {
    const [w, h] = r.id.split(':').map(Number);
    const s = 44 / Math.max(w, h);
    const node = el('div', { class: 'ratio' + (r.id === ratio ? ' on' : ''), 'data-r': r.id },
      el('div', { class: 'shape', style: { width: w * s + 'px', height: h * s + 'px' } }), el('b', {}, r.id), el('small', {}, r.hint || r.name));
    node.addEventListener('click', () => { ratio = r.id; $$('.ratio', grid).forEach(x => x.classList.toggle('on', x === node)); });
    node.addEventListener('dblclick', () => body.closest('.modal').querySelector('[data-ok]').click());
    grid.append(node);
  }
  body.append(el('label', { class: 'f' }, 'Nome do projeto', el('input', { name: 'name', value: 'Meu vídeo' })), el('div', { class: 'sec-t' }, 'Proporção'), grid);
  if (auto && auto.project && auto.project.tracks.some(t => t.clips.length)) {
    body.append(el('div', { class: 'sec-t', style: { marginTop: '16px' } }, 'Recuperar'),
      el('div', { class: 'recent' }, el('button', { 'data-auto': 1 }, `♻ ${auto.project.name}`, el('small', {}, 'Rascunho automático de ' + new Date(auto.t).toLocaleString('pt-BR')))));
  }
  if (recent.length) {
    body.append(el('div', { class: 'sec-t', style: { marginTop: '16px' } }, 'Projetos recentes'),
      el('div', { class: 'recent' }, recent.map(p => el('button', { 'data-open': p }, p.split(/[\\/]/).pop().replace('.freecut', ''), el('small', {}, p)))));
  }
  body.append(el('div', { style: { marginTop: '14px' } }, el('button', { class: 'btn', 'data-browse': 1 }, '📂 Abrir projeto...')));
  let action = null;
  const v = await modal({
    title: 'Novo projeto', body, ok: 'Criar projeto', cancel: first ? null : 'Cancelar', wide: true,
    onOpen: (box, close) => box.addEventListener('click', e => {
      const o = e.target.closest('[data-open]'), a = e.target.closest('[data-auto]'), b = e.target.closest('[data-browse]');
      if (o) { action = ['open', o.dataset.open]; close({}); }
      if (a) { action = ['auto']; close({}); }
      if (b) { action = ['browse']; close({}); }
    })
  });
  if (action && action[0] === 'open') return openProject(action[1]);
  if (action && action[0] === 'auto') { loadProject(auto.project, auto.path); store.dirty = true; return; }
  if (action && action[0] === 'browse') { await openProject(); if (!store.project) loadProject(newProject()); return; }
  if (!v) { if (!store.project) loadProject(newProject()); return; }
  loadProject(newProject(ratio, v.name || 'Meu vídeo'));
}

/* ======================= player ======================= */
const player = $('#player'), box = $('#canvasBox'), canvas = $('#preview'), handles = $('#handles');
function fitCanvas() {
  if (!store.project) return;
  const pw = player.clientWidth - 32, ph = player.clientHeight - 32;
  const r = store.project.width / store.project.height;
  let w = pw, h = pw / r;
  if (h > ph) { h = ph; w = ph * r; }
  box.style.width = Math.max(10, w) + 'px';
  box.style.height = Math.max(10, h) + 'px';
  updateHandles();
}
new ResizeObserver(fitCanvas).observe(player);

function dispScale() { return box.clientWidth / store.project.width; }
function updateHandles() {
  const c = selected()[0];
  const b = c && selected().length === 1 && engine.boxes.find(x => x.id === c.id);
  if (!b || store.playing) { handles.hidden = true; return; }
  const s = dispScale();
  handles.hidden = false;
  Object.assign(handles.style, {
    left: (b.cx - b.w / 2) * s + 'px', top: (b.cy - b.h / 2) * s + 'px', width: b.w * s + 'px', height: b.h * s + 'px',
    transform: `rotate(${b.rot}deg)`
  });
}

function hitTest(px, py) {
  for (let i = engine.boxes.length - 1; i >= 0; i--) {
    const b = engine.boxes[i];
    const a = -b.rot * Math.PI / 180, dx = px - b.cx, dy = py - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) {
      const c = clipById(b.id);
      if (c && !trackOf(c.id).locked) return c;
    }
  }
  return null;
}

let eyedrop = null;
store.on('eyedropper', cb => { eyedrop = cb; box.style.cursor = 'crosshair'; toast('Clique no player para escolher a cor'); });

function setProp(c, k, v) {
  if (c.kf && c.kf[k] && c.kf[k].length && store.time >= c.start && store.time <= clipEnd(c)) setKeyframe(c, k, v, store.time);
  else c[k] = v;
}

box.addEventListener('mousedown', e => {
  if (e.button !== 0 || !store.project) return;
  const rect = box.getBoundingClientRect(), s = dispScale();
  const px = (e.clientX - rect.left) / s, py = (e.clientY - rect.top) / s;
  if (eyedrop) {
    const g = canvas.getContext('2d');
    const k = canvas.width / store.project.width;
    const d = g.getImageData(Math.floor(px * k), Math.floor(py * k), 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    const cb = eyedrop; eyedrop = null; box.style.cursor = '';
    cb(hex);
    return;
  }
  const handle = e.target.dataset.h;
  let c = selected()[0];
  if (!handle) {
    c = hitTest(px, py);
    if (!c) { select([]); return; }
    if (!store.sel.has(c.id)) select(c.id);
  }
  if (!c) return;
  pause();
  const b = engine.boxes.find(x => x.id === c.id);
  const t = store.time;
  const ox = kfValue(c, 'x', c.x, t), oy = kfValue(c, 'y', c.y, t), os = kfValue(c, 'scale', c.scale, t), orot = kfValue(c, 'rot', c.rot, t);
  const cx = b ? b.cx : store.project.width / 2, cy = b ? b.cy : store.project.height / 2;
  const d0 = Math.hypot(px - cx, py - cy) || 1, a0 = Math.atan2(py - cy, px - cx);
  let moved = false;
  const gx = $('.guide.gx'), gy = $('.guide.gy');
  const move = ev => {
    moved = true;
    const qx = (ev.clientX - rect.left) / s, qy = (ev.clientY - rect.top) / s;
    if (handle === 'scale') setProp(c, 'scale', clamp(os * Math.hypot(qx - cx, qy - cy) / d0, 0.01, 20));
    else if (handle === 'rot') {
      let r = orot + (Math.atan2(qy - cy, qx - cx) - a0) * 180 / Math.PI;
      for (const snapA of [-180, -90, 0, 90, 180]) if (Math.abs(r - snapA) < 3) r = snapA;
      setProp(c, 'rot', Math.round(r * 10) / 10);
    } else {
      let nx = ox + (qx - px), ny = oy + (qy - py);
      const tol = 12 / s;
      gx.hidden = Math.abs(nx) > tol; gy.hidden = Math.abs(ny) > tol;
      if (!gx.hidden) nx = 0; if (!gy.hidden) ny = 0;
      setProp(c, 'x', Math.round(nx)); setProp(c, 'y', Math.round(ny));
    }
    drawPreview();
  };
  const up = () => {
    removeEventListener('mousemove', move); removeEventListener('mouseup', up);
    gx.hidden = gy.hidden = true;
    if (moved) commit('transformar');
  };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});
box.addEventListener('dblclick', e => {
  const c = selected()[0];
  if (c && c.type === 'text') { store.emit('select'); setTimeout(() => { const ta = $('.text-edit'); if (ta) { ta.focus(); ta.select(); } }, 30); }
  void e;
});
store.on('frame', updateHandles);
store.on('select', updateHandles);

/* ======================= arrastar arquivos ======================= */
addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); player.classList.add('drag-over'); } });
addEventListener('dragleave', e => { if (!e.relatedTarget) player.classList.remove('drag-over'); });
addEventListener('drop', async e => {
  player.classList.remove('drag-over');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map(f => fc.pathOf(f)).filter(Boolean);
  const overTimeline = e.target.closest && e.target.closest('#timeline');
  const ms = await importPaths(paths);
  if (overTimeline || !allClips().length) {
    let t = overTimeline ? store.time : 0;
    for (const m of ms) { const c = insertMedia(m, store.magnet ? 1e9 : t, 'main'); t = clipEnd(c); }
    commit('inserir');
    zoomFit();
  }
});

tl.onDropData = (dt, info) => {
  const t = info.t;
  const at = c => { c.start = t; insertClip(c, 'visual', info.trackId); select(c.id); commit('adicionar'); };
  const sticker = dt.getData('freecut/sticker');
  if (sticker) return at(makeClip('sticker', { sticker }));
  const preset = dt.getData('freecut/text');
  if (preset) { store.time = t; return newText(TEXT_PRESETS.find(p => p.id === preset)); }
  const target = () => {
    const row = info.trackId && store.project.tracks.find(x => x.id === info.trackId);
    return row && row.clips.find(c => t >= c.start && t < clipEnd(c) && (c.type === 'video' || c.type === 'image' || c.type === 'fx'));
  };
  const fx = dt.getData('freecut/effect');
  if (fx) { const c = target(); if (c) return applyEffect(fx, c); store.time = t; return applyEffect(fx, null); }
  const fl = dt.getData('freecut/filter');
  if (fl) { const c = target(); if (c) return applyFilter(fl, c); store.time = t; return applyFilter(fl, null); }
  const tr = dt.getData('freecut/transition');
  if (tr) {
    const row = info.trackId && store.project.tracks.find(x => x.id === info.trackId);
    if (row) {
      let best = null, bd = Infinity;
      for (const c of row.clips) { const d = Math.abs(c.start - t); if (d < bd) { bd = d; best = c; } }
      if (best) return applyTransition(tr, best);
    }
    return applyTransition(tr);
  }
};

/* ======================= ações ======================= */
let clipboard = [];
const ACTS = {
  undo: () => { if (undo()) { gcPool(); requestRender(); } },
  redo: () => { if (redo()) { gcPool(); requestRender(); } },
  export: exportDialog,
  import: importDialog,
  play: toggle,
  prevFrame: () => { pause(); seek(store.time - 1 / store.project.fps); },
  nextFrame: () => { pause(); seek(store.time + 1 / store.project.fps); },
  split: () => { if (splitAtPlayhead()) commit('dividir'); else toast('Posicione o cursor sobre um clipe para dividir.'); },
  delete: () => { if (store.sel.size) { deleteClips([...store.sel]); commit('excluir'); gcPool(); requestRender(); } else if (store.selTrans) { const c = clipById(store.selTrans); if (c) { c.trans = null; commit('transição'); } } },
  rippleDelete: () => { if (store.sel.size) { deleteClips([...store.sel], true); commit('excluir'); gcPool(); requestRender(); } },
  duplicate: () => { if (!store.sel.size) return; const d = duplicateClips([...store.sel]); select(d.map(c => c.id)); commit('duplicar'); },
  freeze: () => { const c = selected().find(x => x.type === 'video'); if (!c) { toast('Selecione um clipe de vídeo.'); return; } store.emit('select'); toast('Use Recursos → Congelar quadro no painel à direita'); },
  reverse: () => { const c = selected().find(x => x.type === 'video'); if (!c) { toast('Selecione um clipe de vídeo.'); return; } toast('Use Recursos → Reverter no painel à direita'); },
  crop: () => { if (!selected().length) toast('Selecione um clipe para recortar.'); else toast('Ajuste o corte em Básico → Enquadramento'); },
  marker: () => { const t = Math.round(store.time * 100) / 100; const m = store.project.markers; const i = m.findIndex(x => Math.abs(x - t) < 0.05); if (i >= 0) m.splice(i, 1); else m.push(t); m.sort((a, b) => a - b); commit('marcador'); },
  magnet: () => { store.magnet = !store.magnet; if (store.magnet) { compactMain(); commit('ímã'); } updateToggles(); toast(store.magnet ? 'Faixa principal magnética ativada' : 'Faixa principal livre (permite lacunas)'); },
  snap: () => { store.snap = !store.snap; updateToggles(); },
  voiceover: toggleVoiceover,
  zoomIn: () => setZoom(store.zoom * 1.4),
  zoomOut: () => setZoom(store.zoom / 1.4),
  zoomFit,
  snapshot: async () => {
    const blob = await snapshotPNG();
    const out = await fc.invoke('dialog:save', { title: 'Salvar quadro', name: `${store.project.name} ${fmtTime(store.time).replace(/:/g, '-')}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!out) return;
    await fc.invoke('fs:writeFile', out, new Uint8Array(await blob.arrayBuffer()));
    toast('Quadro salvo', 'ok');
  },
  fullscreen: () => { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen(); },
  newProject: async () => { if (await confirmDiscard()) welcome(); },
  open: async () => { if (await confirmDiscard()) openProject(); },
  save: () => saveProject(),
  saveAs: () => saveProject(true),
  selectAll: () => select(allClips().map(c => c.id)),
  copy: () => { clipboard = selected().map(c => ({ c: deep(c), kind: trackOf(c.id).kind })); if (clipboard.length) toast(`${clipboard.length} clipe(s) copiado(s)`); },
  paste: () => {
    if (!clipboard.length) return;
    const base = Math.min(...clipboard.map(x => x.c.start));
    const ids = [];
    for (const { c, kind } of clipboard) {
      const n = deep(c); n.id = uid('c'); n.start = store.time + (c.start - base); n.trans = null;
      if (kind === 'main' && store.magnet) { const m = store.project.tracks.find(t => t.kind === 'main'); n.start -= 1e-4; m.clips.push(n); compactMain(); }
      else insertClip(n, n.type === 'audio' ? 'audio' : 'visual');
      ids.push(n.id);
    }
    sortTracks(); select(ids); commit('colar');
  },
  addText: () => newText(),
  shortcuts: () => modal({ title: 'Atalhos de teclado', ok: 'Fechar', cancel: null, body: `<table class="kbd-table">${[
    ['Espaço', 'Reproduzir / pausar'], ['S  ou  Ctrl+B', 'Dividir no cursor'], ['Delete', 'Excluir'], ['Shift+Delete', 'Excluir e fechar lacuna'],
    ['Ctrl+D', 'Duplicar'], ['Ctrl+C / Ctrl+V', 'Copiar / colar clipes'], ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'], ['← / →', 'Quadro anterior / próximo'],
    ['Shift+← / →', '1 segundo'], ['Home / End', 'Início / fim'], ['↑ / ↓', 'Corte anterior / próximo'], ['M', 'Marcador'],
    ['Ctrl+= / Ctrl+-', 'Zoom da linha do tempo'], ['Shift+Z', 'Ajustar linha do tempo'], ['T', 'Adicionar texto'], ['Ctrl+S', 'Salvar projeto'],
    ['Ctrl+E', 'Exportar'], ['Ctrl+I', 'Importar mídia'], ['Ctrl+N', 'Novo projeto'], ['Ctrl+O', 'Abrir projeto'], ['Q / W', 'Aparar início / fim até o cursor'], ['F', 'Tela cheia']
  ].map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('')}</table>` }),
  about: () => modal({ title: 'Sobre o FreeCut', ok: 'Fechar', cancel: null, body: '<p><b>FreeCut 1.0</b> — editor de vídeo gratuito, com todos os recursos liberados.</p><p class="plabel">Exportação H.264 por GPU até 4K 60 fps, legendas por IA (Whisper), remoção de fundo (MediaPipe), texto para fala (SAPI), efeitos de voz, estabilização e redução de ruído (ffmpeg). Tudo processado no seu computador.</p>' }),
  trimStart: () => trimToPlayhead('l'),
  trimEnd: () => trimToPlayhead('r'),
  quit: () => window.close()
};

function trimToPlayhead(edge) {
  const t = store.time;
  const c = selected()[0] || store.project.tracks.find(x => x.kind === 'main').clips.find(x => t > x.start && t < clipEnd(x));
  if (!c || t <= c.start || t >= clipEnd(c)) { toast('Posicione o cursor dentro do clipe.'); return; }
  import('./store.js').then(({ trimClip }) => { trimClip(c, edge, t); commit('aparar'); if (edge === 'l') seek(c.start); });
}

function updateToggles() {
  $('#magnetBtn').classList.toggle('on', store.magnet);
  $('#snapBtn').classList.toggle('on', store.snap);
}

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (a && ACTS[a.dataset.act]) { ACTS[a.dataset.act](); return; }
});

/* ---------- menus do topo ---------- */
const MENUS = {
  file: [['Novo projeto', 'newProject', 'Ctrl+N'], ['Abrir projeto...', 'open', 'Ctrl+O'], ['Salvar', 'save', 'Ctrl+S'], ['Salvar como...', 'saveAs', 'Ctrl+Shift+S'], '-',
    ['Importar mídia...', 'import', 'Ctrl+I'], ['Exportar...', 'export', 'Ctrl+E'], '-', ['Sair', 'quit', '']],
  edit: [['Desfazer', 'undo', 'Ctrl+Z'], ['Refazer', 'redo', 'Ctrl+Y'], '-', ['Dividir', 'split', 'S'], ['Duplicar', 'duplicate', 'Ctrl+D'], ['Copiar', 'copy', 'Ctrl+C'], ['Colar', 'paste', 'Ctrl+V'],
    ['Excluir', 'delete', 'Del'], ['Excluir e fechar lacuna', 'rippleDelete', 'Shift+Del'], ['Selecionar tudo', 'selectAll', 'Ctrl+A'], '-', ['Adicionar texto', 'addText', 'T'], ['Marcador', 'marker', 'M']],
  help: [['Atalhos de teclado', 'shortcuts', 'F1'], ['Sobre o FreeCut', 'about', '']]
};
const pop = $('#menuPop');
document.addEventListener('mousedown', e => {
  const b = e.target.closest('[data-menu]');
  if (b) {
    e.preventDefault();
    if (!pop.hidden && pop.dataset.for === b.dataset.menu) { pop.hidden = true; return; }
    pop.textContent = '';
    for (const it of MENUS[b.dataset.menu]) pop.append(it === '-' ? el('hr') : el('button', { 'data-act': it[1] }, it[0], el('kbd', {}, it[2])));
    const r = b.getBoundingClientRect();
    pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 4 + 'px';
    pop.dataset.for = b.dataset.menu;
    pop.hidden = false;
    return;
  }
  if (!e.target.closest('#menuPop')) pop.hidden = true;
});
pop.addEventListener('click', () => { pop.hidden = true; });

/* ---------- teclado ---------- */
document.addEventListener('keydown', e => {
  if (document.querySelector('.modal-back')) return;
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const run = (name) => { e.preventDefault(); ACTS[name](); };
  if (ctrl) {
    if (k === 'z' && !typing) return run(e.shiftKey ? 'redo' : 'undo');
    if (k === 'y' && !typing) return run('redo');
    if (k === 's') return run(e.shiftKey ? 'saveAs' : 'save');
    if (k === 'e') return run('export');
    if (k === 'i') return run('import');
    if (k === 'n') return run('newProject');
    if (k === 'o') return run('open');
    if (typing) return;
    if (k === 'b') return run('split');
    if (k === 'd') return run('duplicate');
    if (k === 'c') return run('copy');
    if (k === 'v') return run('paste');
    if (k === 'a') return run('selectAll');
    if (k === '=' || k === '+') return run('zoomIn');
    if (k === '-') return run('zoomOut');
    return;
  }
  if (typing) return;
  const fpsStep = 1 / store.project.fps;
  const cuts = () => [...new Set([0, ...allClips().flatMap(c => [c.start, clipEnd(c)])])].sort((a, b) => a - b);
  switch (e.key) {
    case ' ': return run('play');
    case 'Delete': case 'Backspace': return run(e.shiftKey ? 'rippleDelete' : 'delete');
    case 'ArrowLeft': e.preventDefault(); pause(); return seek(store.time - (e.shiftKey ? 1 : fpsStep));
    case 'ArrowRight': e.preventDefault(); pause(); return seek(store.time + (e.shiftKey ? 1 : fpsStep));
    case 'ArrowUp': e.preventDefault(); { const p = cuts().filter(t => t < store.time - 1e-3).pop(); if (p != null) seek(p); } return;
    case 'ArrowDown': e.preventDefault(); { const n = cuts().find(t => t > store.time + 1e-3); if (n != null) seek(n); } return;
    case 'Home': return seek(0);
    case 'End': return seek(projectDuration());
    case 'F1': return run('shortcuts');
    case 'Escape': select([]); return;
  }
  if (k === 's') return run('split');
  if (k === 'm') return run('marker');
  if (k === 't') return run('addText');
  if (k === 'q') return run('trimStart');
  if (k === 'w') return run('trimEnd');
  if (k === 'f') return run('fullscreen');
  if (k === 'z' && e.shiftKey) return run('zoomFit');
});

/* ======================= interface geral ======================= */
$('#projName').addEventListener('change', e => { store.project.name = e.target.value.trim() || 'Projeto sem título'; commit('nome'); updateTitle(); });
$('#projName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#tlZoom').addEventListener('input', e => setZoom(+e.target.value));
$('#previewQ').addEventListener('change', e => { engine.previewScale = +e.target.value; resizePreview(); requestRender(); });

// redimensionar a linha do tempo
$('#splitter').addEventListener('mousedown', e => {
  const y0 = e.clientY, h0 = $('#timeline').offsetHeight;
  const move = ev => document.documentElement.style.setProperty('--tl-h', clamp(h0 - (ev.clientY - y0), 160, innerHeight - 260) + 'px');
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
});

function updateTransport() {
  const dur = projectDuration();
  $('#tcNow').textContent = fmtTime(store.time, store.project.fps, true);
  $('#tcDur').textContent = fmtTime(dur, store.project.fps, true);
  $('#playBtn').textContent = store.playing ? '❚❚' : '▶';
  $('#emptyHint').hidden = allClips().length > 0;
}
store.on('time', updateTransport);
store.on('play', () => { updateTransport(); updateHandles(); });
store.on('change', () => {
  updateTransport(); updateTitle(); autosave();
  if (!store.playing) { syncMedia(store.time, false); requestRender(); }
});
store.on('recording', on => { const b = $('#voBtn'); b.classList.toggle('rec', on); b.textContent = on ? '■ REC' : '🎙'; });
store.on('textEdit', () => renderTimeline());
store.on('ratio', fitCanvas);

(function meter() {
  const lv = store.playing ? audioLevel() : 0;
  $('#meterBar').style.width = Math.min(100, lv * 140) + '%';
  requestAnimationFrame(meter);
})();

fc.on('app:closing', async () => {
  if (store.dirty && allClips().length) {
    const r = await modal({ title: 'Sair do FreeCut', body: '<p>Salvar as alterações do projeto antes de sair?</p>', ok: 'Salvar e sair', cancel: 'Sair sem salvar' });
    if (r && !(await saveProject())) return;
  }
  fc.invoke('app:close');
});

/* ======================= início ======================= */
initEngine(canvas);
initTimeline();
initInspector();
initPanels();
updateToggles();
if (new URLSearchParams(location.search).has('test')) { loadProject(newProject('16:9', 'Teste')); window.FC.ready = true; }
else welcome(true).then(() => { window.FC.ready = true; });
window.FC.loadProject = loadProject;
window.FC.newProject = newProject;
window.FC.importPaths = importPaths;
window.FC.insertMedia = insertMedia;
window.FC.drawPreview = drawPreview;
window.FC.makeClip = makeClip;
window.FC.insertClip = insertClip;
window.FC.freeTrack = freeTrack;
window.FC.mediaOf = mediaOf;
window.FC.addAtPlayhead = addAtPlayhead;
Object.assign(window.FC, { exportVideo, audioPlan, addCaptions, applyEffect, applyFilter, applyTransition, newText, splitAtPlayhead, renderTimeline });
