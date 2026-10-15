// FreeCut — modelo do projeto, operações de edição e histórico
import { Emitter, uid, deep, clamp } from './util.js';
import { RATIOS, SPEED_CURVES, TEXT_DEFAULT } from './catalog.js';

export const store = new Emitter();
Object.assign(store, {
  project: null,
  sel: new Set(),          // ids de clipes selecionados
  selTrans: null,          // id do clipe cuja transição de entrada está selecionada
  time: 0,
  playing: false,
  zoom: 80,                // pixels por segundo na linha do tempo
  magnet: true,            // faixa principal sem lacunas
  snap: true,
  cache: {},               // mediaId -> { thumbs, thumbCount, peaks, img }
  path: null,              // arquivo .freecut atual
  dirty: false
});

/* ---------------- criação ---------------- */
export function newProject(ratioId = '16:9', name = 'Projeto sem título') {
  const r = RATIOS.find(x => x.id === ratioId) || RATIOS[0];
  return {
    app: 'FreeCut', version: 1, name, ratio: r.id, width: r.w, height: r.h, fps: 30,
    background: { type: 'color', color: '#000000', blur: 30 },
    media: {},
    tracks: [{ id: uid('t'), kind: 'main', name: 'Principal', muted: false, hidden: false, locked: false, clips: [] }],
    markers: []
  };
}

export function visualDefaults() {
  return {
    x: 0, y: 0, scale: 1, rot: 0, flipH: false, flipV: false, opacity: 1, blend: 'normal', fit: 'contain',
    crop: { l: 0, t: 0, r: 0, b: 0 },
    adjust: {}, filter: { id: 'none', amount: 100 }, effects: [],
    chroma: { on: false, color: '#00ff00', sim: 40, smooth: 10, spill: 50 }, bgRemove: false,
    mask: { type: 'none', x: 0, y: 0, w: 0.6, h: 0.6, rot: 0, feather: 8, invert: false },
    anim: { in: null, out: null, loop: null }, kf: {}
  };
}
export function audioDefaults() {
  return { volume: 1, fadeIn: 0, fadeOut: 0, voiceFx: [], audioPath: null, pitch: false, muted: false };
}

export function makeClip(type, extra = {}) {
  const c = { id: uid('c'), type, start: 0, dur: 3, in: 0, speed: 1, curve: null, trans: null };
  if (type === 'video' || type === 'image' || type === 'text' || type === 'sticker' || type === 'fx') Object.assign(c, visualDefaults());
  if (type === 'video' || type === 'audio') Object.assign(c, audioDefaults());
  if (type === 'text') { c.text = deep(TEXT_DEFAULT); c.y = 0; }
  if (type === 'sticker') { c.sticker = '😀'; c.scale = 0.6; }
  if (type === 'fx') c.name = 'Ajuste';
  return Object.assign(c, extra);
}

/* ---------------- consultas ---------------- */
export const P = () => store.project;
export const tracks = () => store.project.tracks;
export const mainTrack = () => store.project.tracks.find(t => t.kind === 'main');
export const isVisualTrack = t => t.kind !== 'audio';
export const allClips = () => store.project.tracks.flatMap(t => t.clips);
export const clipById = id => allClips().find(c => c.id === id);
export const trackOf = id => store.project.tracks.find(t => t.clips.some(c => c.id === id));
export const mediaOf = c => c && c.mediaId ? store.project.media[c.mediaId] : null;
export const clipEnd = c => c.start + c.dur;
export const projectDuration = () => Math.max(0, ...allClips().map(clipEnd));
export const selected = () => [...store.sel].map(clipById).filter(Boolean);
export const fps = () => store.project.fps;
export const frame = () => 1 / store.project.fps;
export const hasMediaDuration = c => c.type === 'video' || c.type === 'audio';

/* ---------------- tempo: timeline -> fonte ---------------- */
const curveCache = new Map();
function curvePts(c) { const cv = c.curve && SPEED_CURVES.find(x => x.id === c.curve); return cv ? cv.pts : null; }
function curveIntegral(pts, u) {
  const n = pts.length - 1;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    if (u <= a) break;
    const e = Math.min(u, b);
    const ve = pts[i] + (pts[i + 1] - pts[i]) * ((e - a) / (b - a));
    acc += (pts[i] + ve) / 2 * (e - a);
  }
  return acc;
}
function curveTotal(pts) {
  const k = pts.join();
  if (!curveCache.has(k)) curveCache.set(k, curveIntegral(pts, 1));
  return curveCache.get(k);
}
export const srcLen = c => c.dur * c.speed;
/** Tempo na fonte (segundos do arquivo) para o instante t da linha do tempo. */
export function srcTime(c, t) {
  const local = t - c.start;
  const pts = curvePts(c);
  if (!pts || local < 0 || local > c.dur) return c.in + local * c.speed;
  return c.in + curveIntegral(pts, local / c.dur) / curveTotal(pts) * srcLen(c);
}
/** Velocidade instantânea (para playbackRate na prévia). */
export function rateAt(c, t) {
  const pts = curvePts(c);
  if (!pts) return c.speed;
  const u = clamp((t - c.start) / c.dur, 0, 1), n = pts.length - 1;
  const i = Math.min(n - 1, Math.floor(u * n)), f = u * n - i;
  return c.speed * (pts[i] + (pts[i + 1] - pts[i]) * f) / curveTotal(pts);
}

/* ---------------- keyframes ---------------- */
export function kfValue(c, prop, base, t) {
  const list = c.kf && c.kf[prop];
  if (!list || !list.length) return base;
  const lt = t - c.start;
  if (lt <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (lt >= last.t) return last.v;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (lt >= a.t && lt <= b.t) {
      let f = (lt - a.t) / (b.t - a.t || 1);
      if (a.e === 'ease') f = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      if (a.e === 'hold') f = 0;
      return a.v + (b.v - a.v) * f;
    }
  }
  return base;
}
export function setKeyframe(c, prop, v, t) {
  c.kf = c.kf || {};
  const lt = Math.round((t - c.start) * 1000) / 1000;
  const list = c.kf[prop] = c.kf[prop] || [];
  const ex = list.find(k => Math.abs(k.t - lt) < 1 / 60);
  if (ex) ex.v = v; else list.push({ t: lt, v, e: 'ease' });
  list.sort((a, b) => a.t - b.t);
}
export function hasKeyframeAt(c, prop, t) {
  const list = c.kf && c.kf[prop];
  return !!(list && list.some(k => Math.abs(k.t - (t - c.start)) < 1 / 60));
}
export function removeKeyframe(c, prop, t) {
  const list = c.kf && c.kf[prop];
  if (!list) return;
  c.kf[prop] = list.filter(k => Math.abs(k.t - (t - c.start)) >= 1 / 60);
  if (!c.kf[prop].length) delete c.kf[prop];
}

/* ---------------- histórico ---------------- */
const hist = { stack: [], idx: -1 };
export function commit(label = '') {
  const snap = JSON.stringify(store.project);
  if (hist.stack[hist.idx] && hist.stack[hist.idx].s === snap) { store.emit('change'); return; }
  hist.stack.length = hist.idx + 1;
  hist.stack.push({ s: snap, label });
  if (hist.stack.length > 200) hist.stack.shift();
  hist.idx = hist.stack.length - 1;
  store.dirty = true;
  store.emit('change', label);
}
export function resetHistory() { hist.stack = [{ s: JSON.stringify(store.project), label: 'abrir' }]; hist.idx = 0; }
export function undo() { if (hist.idx <= 0) return false; hist.idx--; restore(); return true; }
export function redo() { if (hist.idx >= hist.stack.length - 1) return false; hist.idx++; restore(); return true; }
export const canUndo = () => hist.idx > 0;
export const canRedo = () => hist.idx < hist.stack.length - 1;
function restore() {
  store.project = JSON.parse(hist.stack[hist.idx].s);
  for (const id of [...store.sel]) if (!clipById(id)) store.sel.delete(id);
  store.dirty = true;
  store.emit('change', 'history');
}

/* ---------------- seleção ---------------- */
export function select(ids, additive = false) {
  if (!additive) store.sel.clear();
  for (const id of [].concat(ids)) if (id) { if (additive && store.sel.has(id)) store.sel.delete(id); else store.sel.add(id); }
  store.selTrans = null;
  store.emit('select');
}
export function selectTransition(clipId) { store.sel.clear(); store.selTrans = clipId; store.emit('select'); }

/* ---------------- faixas ---------------- */
export function newTrack(kind, where = 'top') {
  const t = { id: uid('t'), kind, name: '', muted: false, hidden: false, locked: false, clips: [] };
  const list = store.project.tracks;
  if (kind === 'audio') {
    if (where === 'top') list.splice(list.findIndex(x => x.kind === 'main') + 1, 0, t); else list.push(t);
  } else {
    if (where === 'top') list.unshift(t);
    else list.splice(list.findIndex(x => x.kind === 'main'), 0, t);
  }
  return t;
}
export function cleanupTracks() {
  const list = store.project.tracks;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].kind !== 'main' && !list[i].clips.length) list.splice(i, 1);
}
const overlaps = (track, s, e, ignore) => track.clips.some(c => c.id !== ignore && c.start < e - 1e-6 && clipEnd(c) > s + 1e-6);

/** Faixa livre do tipo pedido no intervalo, ou cria uma nova. */
export function freeTrack(kind, s, e, preferId) {
  const list = store.project.tracks;
  const pref = preferId && list.find(t => t.id === preferId);
  const ok = t => (kind === 'audio' ? t.kind === 'audio' : t.kind === 'visual') && !t.locked && !overlaps(t, s, e);
  if (pref && ok(pref)) return pref;
  const found = kind === 'audio' ? list.find(ok) : [...list].reverse().find(ok);
  return found || newTrack(kind === 'audio' ? 'audio' : 'visual', kind === 'audio' ? 'bottom' : 'top');
}

export function compactMain() {
  if (!store.magnet) return;
  const m = mainTrack();
  m.clips.sort((a, b) => a.start - b.start);
  let t = 0;
  for (const c of m.clips) { c.start = t; t += c.dur; }
}
export function sortTracks() { for (const t of store.project.tracks) t.clips.sort((a, b) => a.start - b.start); }

/* ---------------- operações ---------------- */
export function addMedia(info) {
  const id = uid('m');
  store.project.media[id] = { id, ...info };
  return store.project.media[id];
}

export function clipFromMedia(m) {
  const type = m.type === 'image' ? 'image' : m.type === 'audio' ? 'audio' : 'video';
  const c = makeClip(type, { mediaId: m.id, dur: m.type === 'image' ? 4 : m.duration, name: m.name });
  if (type === 'video' && !m.hasAudio) c.volume = 0;
  return c;
}

/** Insere uma mídia na linha do tempo. mode: 'main' | 'overlay' | 'auto' */
export function insertMedia(m, t = store.time, mode = 'auto', trackId = null) {
  const c = clipFromMedia(m);
  c.start = Math.max(0, t);
  if (c.type === 'audio') {
    freeTrack('audio', c.start, c.start + c.dur, trackId).clips.push(c);
  } else if (mode === 'overlay') {
    freeTrack('visual', c.start, c.start + c.dur, trackId).clips.push(c);
  } else {
    const main = mainTrack();
    if (store.magnet) {
      // insere no ponto de corte mais próximo
      const hit = main.clips.find(x => t > x.start && t < clipEnd(x));
      c.start = hit ? (t - hit.start < hit.dur / 2 ? hit.start - 1e-4 : clipEnd(hit) - 1e-4) : t - 1e-4;
      if (!main.clips.length || t >= Math.max(...main.clips.map(clipEnd))) c.start = 1e9;
      main.clips.push(c);
      compactMain();
    } else if (!overlaps(main, c.start, c.start + c.dur)) main.clips.push(c);
    else freeTrack('visual', c.start, c.start + c.dur).clips.push(c);
  }
  sortTracks();
  return c;
}

export function insertClip(c, kind = 'visual', trackId = null) {
  const tr = freeTrack(kind, c.start, c.start + c.dur, trackId);
  tr.clips.push(c);
  sortTracks();
  return c;
}

export function splitClip(c, t) {
  if (t <= c.start + 1e-3 || t >= clipEnd(c) - 1e-3) return null;
  const tr = trackOf(c.id);
  const b = deep(c);
  b.id = uid('c');
  const cut = t - c.start;
  b.start = t; b.dur = c.dur - cut; b.in = srcTime(c, t); b.trans = null;
  c.dur = cut;
  if (c.anim) { c.anim.out = null; b.anim.in = null; }
  if (c.fadeOut) { b.fadeOut = c.fadeOut; c.fadeOut = 0; }
  if (b.fadeIn) b.fadeIn = 0;
  if (c.kf) {
    for (const k of Object.keys(c.kf)) {
      const all = c.kf[k];
      c.kf[k] = all.filter(x => x.t <= cut);
      b.kf[k] = all.filter(x => x.t >= cut).map(x => ({ ...x, t: x.t - cut }));
      if (!c.kf[k].length) delete c.kf[k];
      if (!b.kf[k].length) delete b.kf[k];
    }
  }
  tr.clips.splice(tr.clips.indexOf(c) + 1, 0, b);
  return b;
}

export function splitAtPlayhead() {
  const t = store.time;
  let targets = selected().filter(c => t > c.start && t < clipEnd(c));
  if (!targets.length) targets = store.project.tracks.filter(tr => !tr.locked).flatMap(tr => tr.clips).filter(c => t > c.start && t < clipEnd(c));
  const made = targets.map(c => splitClip(c, t)).filter(Boolean);
  if (made.length) select(made.map(c => c.id));
  return made.length;
}

export function deleteClips(ids, ripple = false) {
  for (const tr of store.project.tracks) {
    if (tr.locked) continue;
    const removed = tr.clips.filter(c => ids.includes(c.id));
    if (!removed.length) continue;
    tr.clips = tr.clips.filter(c => !ids.includes(c.id));
    if (ripple && !(tr.kind === 'main' && store.magnet)) {
      for (const r of removed.sort((a, b) => b.start - a.start)) for (const c of tr.clips) if (c.start >= clipEnd(r) - 1e-6) c.start -= r.dur;
    }
    // transição perde sentido se o clipe anterior sumiu
    for (const c of tr.clips) if (c.trans && !prevAdjacent(tr, c)) c.trans = null;
  }
  compactMain();
  cleanupTracks();
  store.sel.clear();
}

export function prevAdjacent(tr, c) {
  return tr.clips.find(x => x !== c && Math.abs(clipEnd(x) - c.start) < 0.02) || null;
}

export function moveClip(c, start, targetTrackId) {
  const from = trackOf(c.id);
  const to = store.project.tracks.find(t => t.id === targetTrackId) || from;
  const okKind = c.type === 'audio' ? to.kind === 'audio' : to.kind !== 'audio';
  const dest = okKind && !to.locked ? to : from;
  c.start = Math.max(0, start);
  if (dest !== from) { from.clips.splice(from.clips.indexOf(c), 1); dest.clips.push(c); }
  if (!(dest.kind === 'main' && store.magnet) && overlaps(dest, c.start, c.start + c.dur, c.id)) {
    dest.clips.splice(dest.clips.indexOf(c), 1);
    freeTrack(c.type === 'audio' ? 'audio' : 'visual', c.start, c.start + c.dur).clips.push(c);
  }
  if (c.trans) { const tr = trackOf(c.id); if (!prevAdjacent(tr, c)) c.trans = null; }
  compactMain();
  sortTracks();
  cleanupTracks();
}

/** Ajusta a borda de um clipe. edge = 'l' | 'r'. */
export function trimClip(c, edge, t) {
  const m = mediaOf(c);
  const minD = frame();
  const maxSrc = hasMediaDuration(c) && m ? m.duration : Infinity;
  if (edge === 'l') {
    let ns = clamp(t, 0, clipEnd(c) - minD);
    let delta = ns - c.start;
    if (hasMediaDuration(c) && c.in + delta * c.speed < 0) delta = -c.in / c.speed;
    if (hasMediaDuration(c)) c.in += delta * c.speed;
    c.start += delta; c.dur -= delta;
    shiftKeyframes(c, -delta);
  } else {
    let nd = Math.max(minD, t - c.start);
    if (c.in + nd * c.speed > maxSrc) nd = (maxSrc - c.in) / c.speed;
    c.dur = nd;
  }
  compactMain();
}
function shiftKeyframes(c, d) {
  if (!c.kf) return;
  for (const k of Object.keys(c.kf)) c.kf[k] = c.kf[k].map(x => ({ ...x, t: x.t + d })).filter(x => x.t >= -1e-6 && x.t <= c.dur + 1e-6);
}

export function setSpeed(c, speed) {
  const m = mediaOf(c);
  const len = srcLen(c);
  c.speed = clamp(speed, 0.1, 100);
  c.dur = len / c.speed;
  if (m && m.duration && c.in + c.dur * c.speed > m.duration) c.dur = (m.duration - c.in) / c.speed;
  compactMain();
}

export function duplicateClips(ids) {
  const out = [];
  for (const id of ids) {
    const c = clipById(id);
    if (!c) continue;
    const d = deep(c);
    d.id = uid('c'); d.start = clipEnd(c); d.trans = null;
    const tr = trackOf(id);
    if (tr.kind === 'main' && store.magnet) { tr.clips.splice(tr.clips.indexOf(c) + 1, 0, d); for (const x of tr.clips) if (x !== d && x.start >= d.start - 1e-6 && x !== c) x.start += d.dur; }
    else insertClip(d, c.type === 'audio' ? 'audio' : 'visual', tr.id);
    out.push(d);
  }
  compactMain();
  sortTracks();
  return out;
}

export function snapPoints(exceptIds = []) {
  const pts = [0, store.time, ...store.project.markers];
  for (const c of allClips()) if (!exceptIds.includes(c.id)) pts.push(c.start, clipEnd(c));
  return pts;
}
