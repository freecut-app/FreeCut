// FreeCut — linha do tempo
import {
  store, tracks, clipEnd, srcTime, mediaOf, commit, select, selectTransition, moveClip, trimClip, prevAdjacent,
  projectDuration, snapPoints, clipById, trackOf, insertMedia, newTrack, makeClip, insertClip, compactMain, sortTracks, cleanupTracks
} from './store.js';
import { seek, requestRender } from './engine.js';
import { cacheOf } from './media.js';
import { $, el, clamp, fmtTime, esc } from './util.js';
import { EFFECTS, FILTERS } from './catalog.js';

const H = { main: 64, visual: 46, audio: 46 };
const SNAP_PX = 8;
let scrollEl, contentEl, tracksEl, headsEl, rulerEl, playheadEl, snapEl;
const sprites = new Map();
export const tl = { onDropData: null };

const Z = () => store.zoom;
const xOf = t => t * Z();
const tOf = x => x / Z();

export function initTimeline() {
  scrollEl = $('#tlScroll'); contentEl = $('#tlContent'); tracksEl = $('#tracks'); headsEl = $('#tlHeads');
  rulerEl = $('#ruler'); playheadEl = $('#playhead'); snapEl = $('#snapline');
  scrollEl.addEventListener('scroll', () => { headsEl.scrollTop = scrollEl.scrollTop; drawRuler(); });
  new ResizeObserver(() => { layoutSize(); drawRuler(); }).observe(scrollEl);
  scrollEl.addEventListener('wheel', onWheel, { passive: false });
  rulerEl.addEventListener('mousedown', e => scrubFrom(e));
  playheadEl.querySelector('i').addEventListener('mousedown', e => { e.stopPropagation(); scrubFrom(e); });
  tracksEl.addEventListener('mousedown', onTracksDown);
  tracksEl.addEventListener('dragover', onDragOver);
  tracksEl.addEventListener('dragleave', () => clearDropMarks());
  tracksEl.addEventListener('drop', onDrop);
  store.on('change', renderTimeline);
  store.on('select', renderTimeline);
  store.on('media', renderTimeline);
  store.on('time', updatePlayhead);
}

/* ---------------- desenho ---------------- */
function layoutSize() {
  if (!store.project) return;
  const dur = projectDuration();
  const w = Math.max(scrollEl.clientWidth, xOf(dur + Math.max(20, dur * 0.3)) + 200);
  contentEl.style.width = w + 'px';
}

function sprite(url) {
  let img = sprites.get(url);
  if (!img) { img = new Image(); img.src = url; img.onload = () => renderTimeline(); sprites.set(url, img); }
  return img.complete && img.naturalWidth ? img : null;
}

function drawThumbs(cv, c, w, h) {
  const m = mediaOf(c);
  const cache = m && store.cache[m.id];
  if (!cache || !cache.thumbs) return;
  const img = sprite(cache.thumbs);
  if (!img) return;
  const g = cv.getContext('2d');
  const n = cache.thumbCount || 1, tw = img.naturalWidth / n, th = img.naturalHeight;
  const dw = Math.max(20, h * tw / th);
  const scale = Math.min(1, 8000 / Math.max(1, w));
  for (let x = 0; x < w; x += dw) {
    let idx = 0;
    if (c.type === 'video' && m.duration) idx = clamp(Math.floor(srcTime(c, c.start + (x + dw / 2) / Z()) / m.duration * n), 0, n - 1);
    g.drawImage(img, idx * tw, 0, tw, th, x * scale, 0, dw * scale, h);
  }
}

function drawWave(cv, c, w, h, color, half) {
  const m = mediaOf(c);
  const peaks = m && store.cache[m.id] && store.cache[m.id].peaks;
  if (!peaks) return;
  const g = cv.getContext('2d');
  g.fillStyle = color;
  const scale = Math.min(1, 8000 / Math.max(1, w));
  const vol = c.volume ?? 1;
  const top = half ? h * 0.55 : 0, hh = half ? h * 0.45 : h;
  for (let x = 0; x < w; x += 2) {
    const s0 = srcTime(c, c.start + x / Z()), s1 = srcTime(c, c.start + (x + 2) / Z());
    let p = 0;
    for (let i = Math.floor(s0 * 100); i <= Math.ceil(s1 * 100); i++) p = Math.max(p, peaks[i] || 0);
    const v = Math.min(1, p * vol) * hh * 0.9;
    g.fillRect(x * scale, top + hh - v, Math.max(1, 1.4 * scale), v);
  }
}

function badgeList(c) {
  const b = [];
  if (c.speed !== 1 && !c.curve) b.push((Math.round(c.speed * 100) / 100 + 'x').replace('.', ','));
  if (c.curve) b.push('∿');
  if (c.filter && c.filter.id !== 'none') b.push('◐');
  if ((c.effects || []).length) b.push('✦' + c.effects.length);
  if (c.anim && (c.anim.in || c.anim.out || c.anim.loop)) b.push('➚');
  if (c.bgRemove) b.push('👤');
  if (c.chroma && c.chroma.on) b.push('▣');
  if (c.mask && c.mask.type !== 'none') b.push('◔');
  if ((c.voiceFx || []).length) b.push('🎙');
  if (c.muted || (c.type === 'video' && c.volume === 0)) b.push('🔇');
  if (c.reversed) b.push('⇆');
  return b;
}

function clipLabel(c) {
  const m = mediaOf(c);
  if (c.type === 'text') return 'T  ' + c.text.content.replace(/\n/g, ' ');
  if (c.type === 'sticker') return c.sticker + ' Figurinha';
  if (c.type === 'fx') {
    const names = [];
    if (c.filter && c.filter.id !== 'none') names.push((FILTERS.find(f => f.id === c.filter.id) || {}).name);
    for (const e of c.effects || []) names.push((EFFECTS.find(x => x.id === e.id) || {}).name);
    return '✦ ' + (names.filter(Boolean).join(' + ') || c.name || 'Ajuste');
  }
  return (c.name || (m ? m.name : '')) + (m && m.missing ? ' (arquivo ausente)' : '');
}

export function renderTimeline() {
  if (!tracksEl || !store.project) return;
  layoutSize();
  tracksEl.textContent = '';
  headsEl.querySelectorAll('.thead').forEach(x => x.remove());
  const list = tracks();
  const topZone = el('div', { class: 'track-new', 'data-new': 'visual' });
  tracksEl.append(topZone);
  headsEl.append(el('div', { class: 'thead', style: { height: '22px' } }));
  for (const tr of list) {
    const h = H[tr.kind] || 46;
    const row = el('div', { class: 'track ' + tr.kind, 'data-track': tr.id, style: { height: h + 'px' } });
    let prev = null;
    for (const c of tr.clips) {
      row.append(clipEl(c, tr, h));
      if (prev && Math.abs(clipEnd(prev) - c.start) < 0.02 && c.type !== 'audio') {
        const b = el('button', {
          class: 'trans' + (c.trans ? '' : ' empty') + (store.selTrans === c.id ? ' sel' : ''), 'data-trans': c.id,
          style: { left: xOf(c.start) + 'px' }, title: c.trans ? 'Transição (clique para editar)' : 'Adicionar transição'
        }, c.trans ? '⇄' : '+');
        row.append(b);
      }
      prev = c;
    }
    tracksEl.append(row);
    headsEl.append(trackHead(tr, h));
  }
  tracksEl.append(el('div', { class: 'track-new', 'data-new': 'audio' }));
  headsEl.append(el('div', { class: 'thead', style: { height: '22px' } }));
  for (const m of store.project.markers) tracksEl.append(el('div', { class: 'marker', style: { left: xOf(m) + 'px', top: '2px' }, title: 'Marcador ' + fmtTime(m) }));
  updatePlayhead();
  drawRuler();
}

function trackHead(tr, h) {
  const btn = (on, ico, title, fn) => el('button', { class: on ? 'on' : '', title, onclick: e => { e.stopPropagation(); fn(); commit(); } }, ico);
  const label = tr.kind === 'main' ? '🎞 Principal' : tr.kind === 'audio' ? '♫ Áudio' : '▧ Camada';
  return el('div', { class: 'thead ' + tr.kind, style: { height: h + 'px' } },
    el('span', { class: 'tn', title: label }, label),
    tr.kind !== 'audio' ? btn(tr.hidden, tr.hidden ? '◌' : '👁', tr.hidden ? 'Mostrar faixa' : 'Ocultar faixa', () => { tr.hidden = !tr.hidden; requestRender(); }) : null,
    btn(tr.muted, tr.muted ? '🔇' : '🔊', tr.muted ? 'Ativar som' : 'Silenciar faixa', () => { tr.muted = !tr.muted; }),
    btn(tr.locked, tr.locked ? '🔒' : '🔓', tr.locked ? 'Desbloquear' : 'Bloquear faixa', () => { tr.locked = !tr.locked; }));
}

function clipEl(c, tr, h) {
  const w = Math.max(4, xOf(c.dur));
  const sel = store.sel.has(c.id);
  const e = el('div', {
    class: `clip ${c.type}${sel ? ' sel' : ''}${tr.locked ? ' locked' : ''}`, 'data-clip': c.id,
    style: { left: xOf(c.start) + 'px', width: w + 'px' }, title: clipLabel(c)
  });
  const ch = h - 6;
  if (c.type === 'video' || c.type === 'image') {
    const cv = el('canvas', { class: 'strip' });
    cv.width = Math.min(8000, Math.ceil(w)); cv.height = ch;
    drawThumbs(cv, c, w, ch);
    if (c.type === 'video' && mediaOf(c) && mediaOf(c).hasAudio && c.volume > 0 && !c.audioPath) drawWave(cv, c, w, ch, 'rgba(160,255,210,.85)', true);
    e.append(cv);
  } else if (c.type === 'audio') {
    const cv = el('canvas', { class: 'wave' });
    cv.width = Math.min(8000, Math.ceil(w)); cv.height = ch;
    drawWave(cv, c, w, ch, 'rgba(170,255,215,.9)', false);
    e.append(cv);
  }
  e.append(el('div', { class: 'lbl' }, clipLabel(c)));
  const badges = badgeList(c);
  if (badges.length) e.append(el('div', { class: 'badges' }, badges.map(b => el('span', {}, b))));
  if (c.fadeIn > 0) e.append(el('div', { class: 'fade in', style: { width: xOf(c.fadeIn) + 'px' } }));
  if (c.fadeOut > 0) e.append(el('div', { class: 'fade out', style: { width: xOf(c.fadeOut) + 'px' } }));
  const kts = new Set();
  for (const list of Object.values(c.kf || {})) for (const k of list) kts.add(Math.round(k.t * 100) / 100);
  for (const t of kts) e.append(el('div', { class: 'kfd', style: { left: xOf(t) + 'px' } }));
  e.append(el('div', { class: 'edge l', 'data-edge': 'l' }), el('div', { class: 'edge r', 'data-edge': 'r' }));
  return e;
}

export function drawRuler() {
  if (!rulerEl || !store.project) return;
  const w = scrollEl.clientWidth, dpr = devicePixelRatio || 1;
  rulerEl.style.width = w + 'px';
  rulerEl.width = w * dpr; rulerEl.height = 28 * dpr;
  const g = rulerEl.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#161920'; g.fillRect(0, 0, w, 28);
  const z = Z(), sl = scrollEl.scrollLeft;
  const steps = [1 / 30, 1 / 10, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find(s => s * z >= 70) || 600;
  const minor = steps.find(s => s * z >= 9 && major / s >= 2 && Number.isInteger(Math.round(major / s * 1000) / 1000)) || major / 5;
  g.strokeStyle = '#3a4150'; g.fillStyle = '#8d95a8'; g.font = '10.5px Segoe UI'; g.textBaseline = 'top';
  const t0 = Math.floor(sl / z / minor) * minor;
  for (let t = t0; t * z < sl + w; t += minor) {
    const x = Math.round(t * z - sl) + 0.5;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    g.beginPath(); g.moveTo(x, isMajor ? 14 : 21); g.lineTo(x, 28); g.stroke();
    if (isMajor) g.fillText(major < 1 ? fmtTime(t, store.project.fps, true) : fmtTime(t), x + 3, 4);
  }
  for (const m of store.project.markers) { const x = m * z - sl; g.fillStyle = '#4fc3ff'; g.fillRect(x - 1, 0, 2, 10); }
}

export function updatePlayhead() {
  if (!playheadEl || !store.project) return;
  const x = xOf(store.time);
  playheadEl.style.left = x + 'px';
  if (store.playing) {
    const sl = scrollEl.scrollLeft, w = scrollEl.clientWidth;
    if (x > sl + w - 60 || x < sl) scrollEl.scrollLeft = x - 80;
  }
}

/* ---------------- interação ---------------- */
function scrubFrom(e) {
  const rect = scrollEl.getBoundingClientRect();
  const at = ev => seek(Math.max(0, tOf(ev.clientX - rect.left + scrollEl.scrollLeft)));
  at(e);
  const move = ev => at(ev);
  const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}

function onWheel(e) {
  if (e.ctrlKey) {
    e.preventDefault();
    const rect = scrollEl.getBoundingClientRect();
    const mx = e.clientX - rect.left, t = tOf(mx + scrollEl.scrollLeft);
    setZoom(Z() * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
    scrollEl.scrollLeft = xOf(t) - mx;
  } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && scrollEl.scrollHeight <= scrollEl.clientHeight + 2) {
    e.preventDefault();
    scrollEl.scrollLeft += e.deltaY;
  }
}

export function setZoom(z) {
  store.zoom = clamp(z, 4, 600);
  $('#tlZoom').value = store.zoom;
  renderTimeline();
}
export function zoomFit() {
  const d = projectDuration();
  setZoom(d > 0 ? (scrollEl.clientWidth - 60) / d : 80);
  scrollEl.scrollLeft = 0;
}

function snap(t, except, el) {
  if (!store.snap) { snapEl.hidden = true; return t; }
  let best = null, bd = SNAP_PX / Z();
  for (const p of snapPoints(except)) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
  if (best == null) { snapEl.hidden = true; return t; }
  snapEl.hidden = false; snapEl.style.left = xOf(best) + 'px';
  void el;
  return best;
}

function trackAtY(y) {
  for (const row of tracksEl.children) {
    const r = row.getBoundingClientRect();
    if (y >= r.top && y < r.bottom) return row;
  }
  return null;
}

function onTracksDown(e) {
  if (e.button !== 0) return;
  const tb = e.target.closest('[data-trans]');
  if (tb) { selectTransition(tb.dataset.trans); store.emit('openPanel', 'transitions'); return; }
  const ce = e.target.closest('[data-clip]');
  if (!ce) {
    select([]);
    const rect = scrollEl.getBoundingClientRect();
    seek(tOf(e.clientX - rect.left + scrollEl.scrollLeft));
    return;
  }
  const c = clipById(ce.dataset.clip);
  const tr = trackOf(c.id);
  if (tr.locked) return;
  const edge = e.target.dataset.edge;
  if (e.shiftKey || e.ctrlKey) { select(c.id, true); return; }
  if (!store.sel.has(c.id)) select(c.id);
  if (edge) startTrim(e, c, edge, ce);
  else startMove(e, c, ce);
}

function startTrim(e, c, edge, ce) {
  const x0 = e.clientX;
  const orig = { start: c.start, dur: c.dur, in: c.in };
  const t0 = edge === 'l' ? c.start : clipEnd(c);
  let moved = false;
  const move = ev => {
    moved = true;
    const t = snap(t0 + (ev.clientX - x0) / Z(), [c.id]);
    Object.assign(c, orig);
    trimClip(c, edge, t);
    ce.style.left = xOf(c.start) + 'px';
    ce.style.width = Math.max(4, xOf(c.dur)) + 'px';
    if (edge === 'l') seek(c.start); else seek(Math.max(c.start, clipEnd(c) - 1 / store.project.fps));
  };
  const up = () => {
    removeEventListener('mousemove', move); removeEventListener('mouseup', up);
    snapEl.hidden = true;
    if (moved) commit('aparar'); else renderTimeline();
  };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}

function startMove(e, c, ce) {
  const x0 = e.clientX, y0 = e.clientY;
  const group = [...store.sel].map(clipById).filter(Boolean);
  const origs = new Map(group.map(x => [x.id, x.start]));
  let moved = false, target = null, dt = 0;
  const els = group.map(x => tracksEl.querySelector(`[data-clip="${x.id}"]`)).filter(Boolean);
  const rowTop0 = ce.parentElement.getBoundingClientRect().top;
  const move = ev => {
    if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
    moved = true;
    let ns = origs.get(c.id) + (ev.clientX - x0) / Z();
    // encaixa pelo início ou pelo fim do clipe arrastado
    const sStart = snap(ns, group.map(x => x.id));
    if (sStart !== ns) ns = sStart;
    else { const sEnd = snap(ns + c.dur, group.map(x => x.id)); ns = sEnd - c.dur; }
    dt = Math.max(-Math.min(...group.map(x => origs.get(x.id))), ns - origs.get(c.id));
    for (const x of els) x.style.transform = `translateX(${xOf(dt)}px)`;
    clearDropMarks();
    if (group.length === 1) {
      const row = trackAtY(ev.clientY);
      target = row;
      if (row) {
        row.classList.add('drop-ok');
        ce.style.transform = `translate(${xOf(dt)}px, ${row.getBoundingClientRect().top - rowTop0}px)`;
      }
    }
  };
  const up = () => {
    removeEventListener('mousemove', move); removeEventListener('mouseup', up);
    snapEl.hidden = true; clearDropMarks();
    if (!moved) return;
    if (group.length === 1) {
      let destId = trackOf(c.id).id;
      if (target && target.dataset.track) destId = target.dataset.track;
      else if (target && target.dataset.new) {
        const kind = c.type === 'audio' ? 'audio' : 'visual';
        if ((target.dataset.new === 'audio') === (kind === 'audio')) destId = newTrack(kind, target.dataset.new === 'audio' ? 'bottom' : 'top').id;
      }
      moveClip(c, origs.get(c.id) + dt, destId);
    } else {
      for (const x of group) x.start = Math.max(0, origs.get(x.id) + dt);
      compactMain(); sortTracks(); cleanupTracks();
    }
    commit('mover');
  };
  addEventListener('mousemove', move); addEventListener('mouseup', up);
}

/* ---------------- arrastar da biblioteca ---------------- */
function clearDropMarks() { tracksEl.querySelectorAll('.drop-ok').forEach(x => x.classList.remove('drop-ok')); }
function onDragOver(e) {
  if (![...e.dataTransfer.types].some(t => t.startsWith('freecut/') || t === 'Files')) return;
  e.preventDefault();
  clearDropMarks();
  const row = trackAtY(e.clientY);
  if (row) row.classList.add('drop-ok');
}
function onDrop(e) {
  e.preventDefault();
  clearDropMarks();
  const rect = scrollEl.getBoundingClientRect();
  const t = Math.max(0, tOf(e.clientX - rect.left + scrollEl.scrollLeft));
  const row = trackAtY(e.clientY);
  const info = { t, trackId: row && row.dataset.track, newKind: row && row.dataset.new, row };
  const mediaId = e.dataTransfer.getData('freecut/media');
  if (mediaId) {
    const m = store.project.media[mediaId];
    const tr = info.trackId && store.project.tracks.find(x => x.id === info.trackId);
    let c;
    if (m.type === 'audio') c = insertMedia(m, t, 'auto', tr && tr.kind === 'audio' ? tr.id : null);
    else if (tr && tr.kind === 'main') c = insertMedia(m, t, 'main');
    else if (info.newKind === 'visual') { const nt = newTrack('visual', 'top'); c = insertMedia(m, t, 'overlay', nt.id); }
    else c = insertMedia(m, t, tr ? 'overlay' : 'main', tr ? tr.id : null);
    select(c.id);
    commit('inserir');
    return;
  }
  if (tl.onDropData) tl.onDropData(e.dataTransfer, info);
}

export function addVisualAtPlayhead(c, trackId) {
  c.start = store.time;
  insertClip(c, 'visual', trackId);
  select(c.id);
  commit('adicionar');
  return c;
}
export { makeClip, esc };
