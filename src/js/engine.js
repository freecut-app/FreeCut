// FreeCut — compositor de vídeo e reprodução
import { store, allClips, clipEnd, srcTime, rateAt, kfValue, mediaOf, projectDuration, prevAdjacent } from './store.js';
import { FILTERS, EFFECTS } from './catalog.js';
import { GLFX, needsGL } from './gl.js';
import { maskFor, loadSegmenter } from './segment.js';
import { clamp, easing } from './util.js';

const DEG = Math.PI / 180;
const EFFECT_BY_ID = Object.fromEntries(EFFECTS.map(e => [e.id, e]));
const FILTER_BY_ID = Object.fromEntries(FILTERS.map(f => [f.id, f]));

export const engine = {
  canvas: null, ctx: null, glfx: null,
  pool: new Map(),          // clipId -> { v: HTMLMediaElement, gain, kind, src }
  images: new Map(),        // mediaId -> HTMLImageElement
  textCache: new Map(),
  stickerCache: new Map(),
  layers: [],               // telas temporárias para transições e máscaras
  boxes: [],                // caixas dos clipes no último quadro (para selecionar no player)
  audio: null, master: null, analyser: null,
  previewScale: 1,
  exporting: false
};

export function initEngine(canvas) {
  engine.canvas = canvas;
  engine.ctx = canvas.getContext('2d');
  try { engine.glfx = new GLFX(); } catch (e) { console.error(e); }
  engine.audio = new AudioContext({ latencyHint: 'interactive' });
  engine.master = engine.audio.createGain();
  engine.analyser = engine.audio.createAnalyser();
  engine.analyser.fftSize = 512;
  engine.master.connect(engine.analyser);
  engine.analyser.connect(engine.audio.destination);
  resizePreview();
}

export function resizePreview() {
  const p = store.project;
  if (!p || !engine.canvas) return;
  const w = Math.round(p.width * engine.previewScale), h = Math.round(p.height * engine.previewScale);
  if (engine.canvas.width !== w || engine.canvas.height !== h) { engine.canvas.width = w; engine.canvas.height = h; }
}

/* ======================= fontes de mídia ======================= */

function mediaUrl(path) { return window.fc.mediaUrl(path); }

function poolEntry(c, kind, path) {
  let e = engine.pool.get(c.id + ':' + kind);
  if (e && e.src === path) return e;
  if (e) dropEntry(c.id + ':' + kind);
  const v = document.createElement(kind === 'video' ? 'video' : 'audio');
  v.preload = 'auto';
  v.playsInline = true;
  v.src = mediaUrl(path);
  v.addEventListener('seeked', () => { if (!store.playing && !engine.exporting) requestRender(); });
  v.addEventListener('loadeddata', () => { if (!store.playing && !engine.exporting) { requestRender(); } });
  const node = engine.audio.createMediaElementSource(v);
  const gain = engine.audio.createGain();
  node.connect(gain); gain.connect(engine.master);
  e = { v, gain, kind, src: path };
  engine.pool.set(c.id + ':' + kind, e);
  return e;
}
function dropEntry(key) {
  const e = engine.pool.get(key);
  if (!e) return;
  e.v.pause(); e.v.removeAttribute('src'); e.v.load();
  try { e.gain.disconnect(); } catch { /* já desconectado */ }
  engine.pool.delete(key);
}
/** Remove elementos de clipes que não existem mais. */
export function gcPool() {
  const ids = new Set(allClips().map(c => c.id));
  for (const k of [...engine.pool.keys()]) if (!ids.has(k.split(':')[0])) dropEntry(k);
}

function videoOf(c) {
  const m = mediaOf(c);
  return m ? poolEntry(c, 'video', m.path) : null;
}
/** Elemento que toca o áudio do clipe (o próprio vídeo ou um arquivo processado). */
function audioEntry(c) {
  const m = mediaOf(c);
  if (!m) return null;
  if (c.audioPath) return poolEntry(c, 'audio', c.audioPath);
  if (c.type === 'audio') return poolEntry(c, 'audio', m.path);
  return null;
}

function imageOf(c) {
  const m = mediaOf(c);
  if (!m) return null;
  let img = engine.images.get(m.id);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => requestRender();
    img.src = mediaUrl(m.path);
    engine.images.set(m.id, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/* ======================= texto e figurinhas ======================= */

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function textCanvas(c, k, visible = 1, karaoke = 0) {
  const T = c.text;
  const content = T.upper ? T.content.toLocaleUpperCase('pt-BR') : T.content;
  const total = [...content].length;
  const nVis = visible >= 1 ? total : Math.floor(total * visible);
  const nKar = T.karaoke && T.karaoke.on ? Math.floor(total * karaoke) : -1;
  const key = JSON.stringify(T) + '|' + k.toFixed(3) + '|' + nVis + '|' + nKar;
  const cached = engine.textCache.get(c.id);
  if (cached && cached.key === key) return cached.canvas;

  const size = T.size * k;
  const font = `${T.italic ? 'italic ' : ''}${T.bold ? 'bold ' : ''}${size}px "${T.font}", "Segoe UI Emoji", sans-serif`;
  const cv = cached ? cached.canvas : document.createElement('canvas');
  const g = cv.getContext('2d');
  g.font = font;
  g.letterSpacing = (T.spacing || 0) * k + 'px';
  const lines = content.split('\n');
  const widths = lines.map(l => g.measureText(l || ' ').width);
  const maxW = Math.max(1, ...widths);
  const lh = size * (T.lineHeight || 1.15);
  const sw = T.stroke && T.stroke.on ? T.stroke.width * k : 0;
  const glow = T.glow && T.glow.on ? T.glow.size * k : 0;
  const sh = T.shadow && T.shadow.on ? (Math.abs(T.shadow.x) + Math.abs(T.shadow.y) + T.shadow.blur) * k : 0;
  const bgPad = T.bg && T.bg.on ? T.bg.pad * k : 0;
  const pad = Math.ceil(Math.max(sw, glow * 1.5, sh, bgPad) + 6 * k + sw);
  cv.width = Math.ceil(maxW + pad * 2);
  cv.height = Math.ceil(lh * lines.length + pad * 2);
  g.font = font;
  g.letterSpacing = (T.spacing || 0) * k + 'px';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;

  if (T.bg && T.bg.on) {
    g.globalAlpha = T.bg.opacity;
    g.fillStyle = T.bg.color;
    const bx = T.align === 'left' ? pad - bgPad : T.align === 'right' ? cv.width - pad - maxW - bgPad : (cv.width - maxW) / 2 - bgPad;
    roundRect(g, bx, pad - bgPad, maxW + bgPad * 2, lh * lines.length + bgPad * 2, T.bg.radius * k);
    g.fill();
    g.globalAlpha = 1;
  }

  let shown = 0, karDone = 0;
  lines.forEach((line, i) => {
    const chars = [...line];
    const vis = chars.slice(0, Math.max(0, nVis - shown)).join('');
    const kar = nKar >= 0 ? chars.slice(0, Math.max(0, nKar - karDone)).join('') : '';
    shown += chars.length + 1; karDone += chars.length + 1;
    if (!vis) return;
    const w = widths[i];
    const x = T.align === 'left' ? pad : T.align === 'right' ? cv.width - pad - w : (cv.width - w) / 2;
    const y = pad + lh * i + lh / 2;
    g.textAlign = 'left';
    if (glow) {
      g.save(); g.shadowColor = T.glow.color; g.shadowBlur = glow; g.fillStyle = T.glow.color;
      for (let r = 0; r < 3; r++) g.fillText(vis, x, y);
      g.restore();
    }
    if (T.shadow && T.shadow.on) {
      g.save(); g.globalAlpha = T.shadow.opacity; g.shadowColor = T.shadow.color; g.shadowBlur = T.shadow.blur * k;
      g.shadowOffsetX = T.shadow.x * k; g.shadowOffsetY = T.shadow.y * k; g.fillStyle = T.shadow.color;
      if (sw) { g.lineWidth = sw * 2; g.strokeStyle = T.shadow.color; g.strokeText(vis, x, y); }
      g.fillText(vis, x, y);
      g.restore();
    }
    if (sw) { g.lineWidth = sw * 2; g.strokeStyle = T.stroke.color; g.strokeText(vis, x, y); }
    g.fillStyle = T.color;
    g.fillText(vis, x, y);
    if (kar) { g.fillStyle = T.karaoke.color; g.fillText(kar.slice(0, vis.length), x, y); }
    if (T.underline) { g.fillStyle = T.color; g.fillRect(x, y + size * 0.42, g.measureText(vis).width, Math.max(2, size * 0.06)); }
  });
  engine.textCache.set(c.id, { key, canvas: cv });
  return cv;
}

function stickerCanvas(emoji) {
  let cv = engine.stickerCache.get(emoji);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  g.font = '400px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, 256, 280);
  engine.stickerCache.set(emoji, cv);
  return cv;
}

/* ======================= animações ======================= */

function animState(c, lt, W, H) {
  const o = { dx: 0, dy: 0, s: 1, r: 0, a: 1, blur: 0, chars: 1 };
  const an = c.anim || {};
  const apply = (id, p, dir) => {
    // p: 0 = fora de cena, 1 = em cena
    const e = easing('out', p), q = 1 - e;
    switch (id) {
      case 'fade': o.a *= p; break;
      case 'zoomIn': o.s *= 0.4 + 0.6 * e; o.a *= p; break;
      case 'zoomOut': o.s *= 1 + 0.8 * q; o.a *= p; break;
      case 'slideL': o.dx += -q * W * dir; break;
      case 'slideR': o.dx += q * W * dir; break;
      case 'slideU': o.dy += q * H * 0.6 * dir; o.a *= p; break;
      case 'slideD': o.dy += -q * H * 0.6 * dir; o.a *= p; break;
      case 'spin': o.r += -q * 360 * dir; o.s *= Math.max(0.01, e); break;
      case 'bounce': o.s *= Math.max(0.01, easing('bounce', p)); break;
      case 'pop': o.s *= Math.max(0.01, easing('back', p)); break;
      case 'blur': o.blur += q * 40; o.a *= p; break;
      case 'swing': o.r += Math.sin(q * Math.PI * 3) * 25 * q; o.a *= p; break;
      case 'typewriter': o.chars = p; break;
    }
  };
  if (an.in && an.in.id) { const d = Math.min(an.in.dur || 0.5, c.dur); if (lt < d) apply(an.in.id, clamp(lt / d, 0, 1), 1); }
  if (an.out && an.out.id) { const d = Math.min(an.out.dur || 0.5, c.dur); if (lt > c.dur - d) apply(an.out.id, clamp((c.dur - lt) / d, 0, 1), -1); }
  const loopFx = (id, sp) => {
    const w = 2 * Math.PI * sp;
    switch (id) {
      case 'pulse': o.s *= 1 + 0.06 * Math.sin(lt * w); break;
      case 'shake': o.dx += (Math.sin(lt * 53) + Math.sin(lt * 31)) * 6 * sp; o.dy += (Math.cos(lt * 47) + Math.sin(lt * 29)) * 6 * sp; break;
      case 'wiggle': o.r += Math.sin(lt * w * 2) * 5; break;
      case 'float': o.dy += Math.sin(lt * w) * 18; break;
      case 'rotate': o.r += lt * 90 * sp; break;
      case 'flicker': o.a *= Math.sin(lt * w * 4) > -0.3 ? 1 : 0.35; break;
      case 'heartbeat': o.s *= 1 + 0.12 * Math.pow(Math.max(0, Math.sin(lt * w * 1.2)), 12); break;
      case 'zoomSlow': o.s *= 1 + 0.18 * clamp(lt / c.dur, 0, 1); break;
      case 'zoompulse': o.s *= 1 + 0.1 * Math.pow(Math.max(0, Math.sin(lt * w * 2)), 6); break;
      case 'swing': o.r += Math.sin(lt * w) * 6; break;
    }
  };
  if (an.loop && an.loop.id) loopFx(an.loop.id, an.loop.speed || 1);
  for (const e of c.effects || []) {
    const def = EFFECT_BY_ID[e.id];
    if (def && def.tr) loopFx(def.tr === 'shake' ? 'shake' : def.tr, (e.amount || 50) / 50);
  }
  return o;
}

/* ======================= composição ======================= */

function layer(i, W, H) {
  let cv = engine.layers[i];
  if (!cv) cv = engine.layers[i] = document.createElement('canvas');
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.clearRect(0, 0, W, H);
  return [cv, g];
}

/** Ajustes finais = filtro (proporcional à intensidade) + ajustes manuais (com keyframes). */
function colorParams(c, t) {
  const a = {};
  const f = c.filter && FILTER_BY_ID[c.filter.id];
  const amt = c.filter ? (c.filter.amount ?? 100) / 100 : 0;
  if (f) for (const [k, v] of Object.entries(f.a)) a[k] = Array.isArray(v) ? v.map(x => x * amt) : v * amt;
  for (const [k, v] of Object.entries(c.adjust || {})) a[k] = (a[k] || 0) + kfValue(c, 'adjust.' + k, v, t);
  if (c.kf) for (const k of Object.keys(c.kf)) if (k.startsWith('adjust.') && !(k.slice(7) in (c.adjust || {}))) a[k.slice(7)] = (a[k.slice(7)] || 0) + kfValue(c, k, 0, t);
  return a;
}
function glEffects(c) {
  return (c.effects || []).map(e => ({ gl: (EFFECT_BY_ID[e.id] || {}).gl, amount: (e.amount ?? 60) / 100 })).filter(e => e.gl);
}

/** Desenha um clipe visual em g (tela W×H). */
function drawClip(g, c, t, W, H, k, record) {
  const lt = t - c.start;
  let src = null, sw = 0, sh = 0, natural = false;
  const an = animState(c, clamp(lt, 0, c.dur), W / k, H / k);
  if (c.type === 'video') {
    const e = videoOf(c);
    if (!e || e.v.readyState < 2 || !e.v.videoWidth) return;
    src = e.v; sw = e.v.videoWidth; sh = e.v.videoHeight;
  } else if (c.type === 'image') {
    src = imageOf(c); if (!src) return;
    sw = src.naturalWidth; sh = src.naturalHeight;
  } else if (c.type === 'text') {
    const kar = c.text.karaoke && c.text.karaoke.on ? clamp(lt / Math.max(0.1, c.dur * 0.92), 0, 1) : 0;
    src = textCanvas(c, k, an.chars, kar); sw = src.width; sh = src.height; natural = true;
  } else if (c.type === 'sticker') {
    src = stickerCanvas(c.sticker); sw = src.width; sh = src.height;
  } else return;

  // efeitos de cor / chroma / IA
  const a = colorParams(c, t);
  const fx = glEffects(c);
  const chroma = c.chroma && c.chroma.on ? c.chroma : null;
  if (engine.glfx && (c.type === 'video' || c.type === 'image') && needsGL(a, fx, chroma, c.bgRemove)) {
    let mask = null;
    if (c.bgRemove) mask = maskFor(c.id + ':' + (c.type === 'video' ? srcTime(c, t).toFixed(3) : 'img'), src);
    const scale = Math.min(1, (engine.exporting ? 4096 : 1920) / Math.max(sw, sh), engine.exporting ? 1 : 1.2 * Math.max(W, H) / Math.max(sw, sh));
    const gw = Math.max(2, Math.round(sw * scale)), gh = Math.max(2, Math.round(sh * scale));
    src = engine.glfx.process(src, gw, gh, { a, fx, chroma, mask, time: lt });
    // copia porque o canvas do WebGL é reutilizado
    const [cv, cg] = layer(9, gw, gh);
    cg.drawImage(src, 0, 0);
    src = cv; sw = gw; sh = gh;
  }

  const cr = c.crop || { l: 0, t: 0, r: 0, b: 0 };
  const sx = cr.l * sw, sy = cr.t * sh, cw = Math.max(1, sw * (1 - cr.l - cr.r)), ch = Math.max(1, sh * (1 - cr.t - cr.b));
  let dw, dh;
  if (natural) { dw = cw; dh = ch; }
  else if (c.type === 'sticker') { dw = cw * k; dh = ch * k; }
  else {
    const fit = c.fit === 'cover' ? Math.max(W / cw, H / ch) : Math.min(W / cw, H / ch);
    dw = cw * fit; dh = ch * fit;
  }
  const x = kfValue(c, 'x', c.x, t), y = kfValue(c, 'y', c.y, t);
  const s = kfValue(c, 'scale', c.scale, t) * an.s;
  const rot = kfValue(c, 'rot', c.rot, t) + an.r;
  const op = clamp(kfValue(c, 'opacity', c.opacity, t) * an.a, 0, 1);
  if (op <= 0.001 || s <= 0.0001) return;
  const cx = W / 2 + (x + an.dx) * k, cy = H / 2 + (y + an.dy) * k;
  if (record) engine.boxes.push({ id: c.id, cx: cx / k, cy: cy / k, w: dw * s / k, h: dh * s / k, rot });

  const hasMask = c.mask && c.mask.type !== 'none';
  let target = g;
  let lyr = null;
  if (hasMask) { lyr = layer(8, W, H); target = lyr[1]; }
  target.save();
  if (!hasMask) { target.globalAlpha = op; target.globalCompositeOperation = c.blend && c.blend !== 'normal' ? c.blend : 'source-over'; }
  if (an.blur > 0.3) target.filter = `blur(${an.blur * k}px)`;
  target.translate(cx, cy);
  target.rotate(rot * DEG);
  target.scale(s * (c.flipH ? -1 : 1), s * (c.flipV ? -1 : 1));
  target.drawImage(src, sx, sy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  target.restore();
  if (hasMask) {
    applyMask(target, c, cx, cy, dw * s, dh * s, rot, k);
    g.save();
    g.globalAlpha = op;
    g.globalCompositeOperation = c.blend && c.blend !== 'normal' ? c.blend : 'source-over';
    g.drawImage(lyr[0], 0, 0);
    g.restore();
  }
}

function shapePath(g, type, w, h) {
  g.beginPath();
  if (type === 'circle') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (type === 'rect') roundRect(g, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.08);
  else if (type === 'heart') {
    const s = Math.min(w, h) / 2;
    g.moveTo(0, s * 0.7);
    g.bezierCurveTo(-s * 1.4, -s * 0.2, -s * 0.6, -s * 1.2, 0, -s * 0.45);
    g.bezierCurveTo(s * 0.6, -s * 1.2, s * 1.4, -s * 0.2, 0, s * 0.7);
  } else if (type === 'star') {
    const R = Math.min(w, h) / 2, r = R * 0.45;
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath();
  } else if (type === 'linear') g.rect(-1e4, 0, 2e4, 1e4);
  else if (type === 'mirror') g.rect(-1e4, -h / 2, 2e4, h);
}

function applyMask(g, c, cx, cy, w, h, rot, k) {
  const m = c.mask;
  g.save();
  g.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in';
  if (m.feather > 0) g.filter = `blur(${m.feather * k * 2}px)`;
  g.translate(cx + m.x * w, cy + m.y * h);
  g.rotate((rot + m.rot) * DEG);
  g.fillStyle = '#000';
  shapePath(g, m.type, m.w * w, m.h * h);
  g.fill();
  g.restore();
}

/** Camada de ajuste: aplica cor/efeitos a tudo o que está abaixo. */
function applyFxClip(g, c, t, W, H) {
  if (!engine.glfx) return;
  const a = colorParams(c, t), fx = glEffects(c);
  if (!needsGL(a, fx, null, false)) return;
  const out = engine.glfx.process(g.canvas, W, H, { a, fx, time: t - c.start });
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy';
  g.globalAlpha = 1;
  g.drawImage(out, 0, 0);
  g.restore();
}

function composeTransition(g, A, B, id, p, W, H, seed) {
  const e = easing('inout', p);
  const d = (cv, x = 0, y = 0, a = 1) => { g.globalAlpha = a; g.drawImage(cv, x, y); g.globalAlpha = 1; };
  const scaled = (cv, s, a = 1, r = 0) => {
    g.save(); g.globalAlpha = a; g.translate(W / 2, H / 2); g.rotate(r); g.scale(s, s); g.drawImage(cv, -W / 2, -H / 2); g.restore();
  };
  const clipDraw = (fn, cv) => { g.save(); g.beginPath(); fn(); g.clip(); g.drawImage(cv, 0, 0); g.restore(); };
  switch (id) {
    case 'black': case 'white':
      d(p < 0.5 ? A : B);
      g.fillStyle = id === 'black' ? '#000' : '#fff'; g.globalAlpha = 1 - Math.abs(p - 0.5) * 2; g.fillRect(0, 0, W, H); g.globalAlpha = 1; break;
    case 'slideL': d(A); d(B, W * (1 - e)); break;
    case 'slideR': d(A); d(B, -W * (1 - e)); break;
    case 'slideU': d(A); d(B, 0, H * (1 - e)); break;
    case 'slideD': d(A); d(B, 0, -H * (1 - e)); break;
    case 'pushL': d(A, -W * e); d(B, W * (1 - e)); break;
    case 'pushR': d(A, W * e); d(B, -W * (1 - e)); break;
    case 'wipeL': d(A); clipDraw(() => g.rect(W * (1 - e), 0, W * e, H), B); break;
    case 'wipeR': d(A); clipDraw(() => g.rect(0, 0, W * e, H), B); break;
    case 'wipeU': d(A); clipDraw(() => g.rect(0, H * (1 - e), W, H * e), B); break;
    case 'wipeD': d(A); clipDraw(() => g.rect(0, 0, W, H * e), B); break;
    case 'zoomIn': scaled(A, 1 + e * 0.8, 1 - e); scaled(B, 0.6 + 0.4 * e, e); break;
    case 'zoomOut': scaled(A, 1 - e * 0.5, 1 - e); scaled(B, 1.6 - 0.6 * e, e); break;
    case 'spin': scaled(A, 1 - e * 0.6, 1 - e, e * Math.PI); scaled(B, 0.4 + 0.6 * e, e, (e - 1) * Math.PI); break;
    case 'blur': {
      const b = Math.sin(p * Math.PI) * 30 * W / 1920;
      g.filter = `blur(${b}px)`; d(A, 0, 0, 1 - e); d(B, 0, 0, e); g.filter = 'none'; break;
    }
    case 'circle': d(A); clipDraw(() => g.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * e, 0, Math.PI * 2), B); break;
    case 'doors':
      d(B);
      g.save(); g.beginPath(); g.rect(0, 0, W / 2, H); g.clip(); g.drawImage(A, -W / 2 * e, 0); g.restore();
      g.save(); g.beginPath(); g.rect(W / 2, 0, W / 2, H); g.clip(); g.drawImage(A, W / 2 * e, 0); g.restore(); break;
    case 'clock': d(A); clipDraw(() => { g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + e * Math.PI * 2); g.closePath(); }, B); break;
    case 'stripes': d(A); clipDraw(() => { const n = 8; for (let i = 0; i < n; i++) g.rect(0, (H / n) * i, W, (H / n) * e); }, B); break;
    case 'glitch': {
      d(p < 0.5 ? A : B);
      const n = 12, amt = Math.sin(p * Math.PI);
      for (let i = 0; i < n; i++) {
        const r = Math.sin(seed * 13 + i * 91 + Math.floor(p * 20) * 7) * 0.5 + 0.5;
        if (r < 0.55) continue;
        const y = (H / n) * i, off = (r - 0.75) * W * 0.15 * amt;
        g.drawImage(p < 0.5 ? B : A, 0, y, W, H / n, off, y, W, H / n);
      }
      break;
    }
    default: d(A); d(B, 0, 0, e);
  }
}

/** Fundo do quadro: cor sólida ou o clipe principal desfocado. */
function drawBackground(g, t, W, H, k) {
  const bg = store.project.background || { type: 'color', color: '#000' };
  g.fillStyle = bg.type === 'color' ? bg.color : '#000';
  g.fillRect(0, 0, W, H);
  if (bg.type !== 'blur') return;
  const main = store.project.tracks.find(tr => tr.kind === 'main');
  const c = main && main.clips.find(x => t >= x.start && t < clipEnd(x));
  if (!c) return;
  let src = null, sw = 0, sh = 0;
  if (c.type === 'video') { const e = videoOf(c); if (e && e.v.readyState >= 2) { src = e.v; sw = e.v.videoWidth; sh = e.v.videoHeight; } }
  else if (c.type === 'image') { src = imageOf(c); if (src) { sw = src.naturalWidth; sh = src.naturalHeight; } }
  if (!src || !sw) return;
  const f = Math.max(W / sw, H / sh) * 1.15;
  g.save();
  g.filter = `blur(${(bg.blur || 30) * k}px) brightness(0.85)`;
  g.drawImage(src, (W - sw * f) / 2, (H - sh * f) / 2, sw * f, sh * f);
  g.restore();
}

/** Renderiza o quadro do instante t em g (tela W×H). */
export function renderFrame(g, t, W, H, { record = false } = {}) {
  const p = store.project;
  const k = W / p.width;
  if (record) engine.boxes = [];
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  drawBackground(g, t, W, H, k);
  const vis = p.tracks.filter(tr => tr.kind !== 'audio' && !tr.hidden);
  for (let i = vis.length - 1; i >= 0; i--) {
    const tr = vis[i];
    const clips = tr.clips;
    for (let j = 0; j < clips.length; j++) {
      const c = clips[j];
      const nx = clips[j + 1];
      const tIn = c.trans && prevAdjacent(tr, c) ? c.trans.dur / 2 : 0;
      const tOut = nx && nx.trans && Math.abs(nx.start - clipEnd(c)) < 0.02 ? nx.trans.dur / 2 : 0;
      if (t < c.start - tIn || t >= clipEnd(c) + tOut) continue;
      if (t < c.start + tIn && tIn) continue;            // desenhado pela transição do anterior
      if (tOut && t >= clipEnd(c) - tOut) {
        const dur = nx.trans.dur, pr = clamp((t - (nx.start - dur / 2)) / dur, 0, 1);
        const [A, ga] = layer(0, W, H), [B, gb] = layer(1, W, H);
        if (c.type === 'fx') applyFxClip(g, c, t, W, H); else drawClip(ga, c, t, W, H, k, false);
        if (nx.type !== 'fx') drawClip(gb, nx, t, W, H, k, record);
        composeTransition(g, A, B, nx.trans.id, pr, W, H, j + 1);
        g.globalAlpha = 1; g.filter = 'none';
        break;
      }
      if (c.type === 'fx') applyFxClip(g, c, t, W, H);
      else drawClip(g, c, t, W, H, k, record);
    }
  }
}

/* ======================= sincronização de mídia ======================= */

function clipGain(c, tr, t) {
  if (tr.muted || c.muted || (c.curve && c.type === 'video')) return 0;
  const lt = t - c.start;
  let v = kfValue(c, 'volume', c.volume ?? 1, t);
  if (c.fadeIn > 0 && lt < c.fadeIn) v *= clamp(lt / c.fadeIn, 0, 1);
  if (c.fadeOut > 0 && lt > c.dur - c.fadeOut) v *= clamp((c.dur - lt) / c.fadeOut, 0, 1);
  return Math.max(0, v);
}

function syncEntry(e, c, t, playing, gain, active) {
  const v = e.v;
  if (!active) { if (!v.paused) v.pause(); e.gain.gain.value = 0; return; }
  const m = mediaOf(c);
  const target = clamp(srcTime(c, t), 0, Math.max(0, (m && m.duration ? m.duration : 1e9) - 0.001));
  e.gain.gain.setTargetAtTime(gain, engine.audio.currentTime, 0.01);
  if (playing) {
    const rate = clamp(rateAt(c, t), 0.0625, 16);
    if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
    v.preservesPitch = !c.pitch;
    if (v.paused) { v.currentTime = target; v.play().catch(() => {}); }
    else if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - target) > 0.5 / store.project.fps) v.currentTime = target;
  }
}

/** Ajusta todos os elementos de mídia para o instante t. */
export function syncMedia(t, playing) {
  for (const tr of store.project.tracks) {
    for (let j = 0; j < tr.clips.length; j++) {
      const c = tr.clips[j];
      if (c.type !== 'video' && c.type !== 'audio') continue;
      const nx = tr.clips[j + 1];
      const tIn = c.trans ? c.trans.dur / 2 : 0;
      const tOut = nx && nx.trans ? nx.trans.dur / 2 : 0;
      const visibleWin = t >= c.start - tIn - 0.0001 && t < clipEnd(c) + tOut;
      const audible = t >= c.start && t < clipEnd(c);
      const near = t >= c.start - 1.5 && t < clipEnd(c) + 0.5;
      if (!near && !engine.pool.has(c.id + ':video') && !engine.pool.has(c.id + ':audio')) continue;
      if (c.type === 'video') {
        const e = videoOf(c);
        if (!e) continue;
        const gain = c.audioPath ? 0 : clipGain(c, tr, t);
        if (visibleWin) syncEntry(e, c, t, playing && !tr.hidden || playing && gain > 0, audible ? gain : 0, true);
        else if (near) { syncEntry(e, c, clamp(t, c.start, clipEnd(c) - 0.001), false, 0, true); }
        else syncEntry(e, c, t, false, 0, false);
      }
      const ae = audioEntry(c);
      if (ae) syncEntry(ae, c, t, playing, clipGain(c, tr, t), audible);
    }
  }
}

/** Espera os vídeos chegarem ao quadro exato (usado na exportação e nas capturas). */
export async function seekExact(t) {
  for (let round = 0; round < 5; round++) {
    syncMedia(t, false);
    const pending = [...engine.pool.entries()].filter(([key, e]) => key.endsWith(':video') && (e.v.seeking || e.v.readyState < 2));
    if (!pending.length) return;
    await Promise.all(pending.map(([, e]) => new Promise(res => {
      const v = e.v;
      const done = () => { v.removeEventListener('seeked', done); v.removeEventListener('loadeddata', done); clearTimeout(to); res(); };
      const to = setTimeout(done, 5000);
      v.addEventListener('seeked', done); v.addEventListener('loadeddata', done);
    })));
  }
}

/* ======================= renderização e reprodução ======================= */

let raf = 0;
export function requestRender() {
  if (raf || engine.exporting) return;
  raf = requestAnimationFrame(() => { raf = 0; drawPreview(); });
}
export function drawPreview() {
  if (!store.project || !engine.ctx) return;
  resizePreview();
  if (store.project.tracks.some(tr => tr.clips.some(c => c.bgRemove))) loadSegmenter();
  renderFrame(engine.ctx, store.time, engine.canvas.width, engine.canvas.height, { record: true });
  store.emit('frame');
}

let playStart = 0, playFrom = 0;
export function play() {
  if (store.playing) return;
  const dur = projectDuration();
  if (dur <= 0) return;
  if (store.time >= dur - 0.05) store.time = 0;
  engine.audio.resume();
  store.playing = true;
  playStart = performance.now(); playFrom = store.time;
  store.emit('play');
  loop();
}
export function pause() {
  if (!store.playing) return;
  store.playing = false;
  syncMedia(store.time, false);
  store.emit('play');
  requestRender();
}
export const toggle = () => (store.playing ? pause() : play());

function loop() {
  if (!store.playing) return;
  const dur = projectDuration();
  let t = playFrom + (performance.now() - playStart) / 1000;
  if (store.loopRange && t >= store.loopRange[1]) { playFrom = store.loopRange[0]; playStart = performance.now(); t = playFrom; }
  if (t >= dur) { store.time = dur; pause(); store.emit('time'); return; }
  store.time = t;
  syncMedia(t, true);
  drawPreview();
  store.emit('time');
  requestAnimationFrame(loop);
}

export function seek(t) {
  store.time = clamp(t, 0, Math.max(projectDuration(), 0));
  if (store.playing) { playFrom = store.time; playStart = performance.now(); }
  syncMedia(store.time, store.playing);
  requestRender();
  store.emit('time');
}

/** Nível de áudio atual (0–1) para o medidor. */
const meterBuf = new Uint8Array(512);
export function audioLevel() {
  if (!engine.analyser) return 0;
  engine.analyser.getByteTimeDomainData(meterBuf);
  let m = 0;
  for (const v of meterBuf) m = Math.max(m, Math.abs(v - 128));
  return m / 128;
}

/** Quadro atual em PNG (resolução do projeto). */
export async function snapshotPNG(t = store.time) {
  const p = store.project;
  const cv = document.createElement('canvas');
  cv.width = p.width; cv.height = p.height;
  engine.exporting = true;
  try {
    await seekExact(t);
    renderFrame(cv.getContext('2d'), t, p.width, p.height);
  } finally { engine.exporting = false; }
  syncMedia(store.time, store.playing);
  return new Promise(r => cv.toBlob(b => r(b), 'image/png'));
}
