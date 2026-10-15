// FreeCut — importação de mídia, miniaturas, ondas, efeitos sonoros e narração
import { store, addMedia, commit, allClips, insertClip, makeClip } from './store.js';
import { toast, clamp } from './util.js';

const fc = window.fc;
const SUPPORTED = /\.(mp4|mov|m4v|webm|mkv|avi|png|jpe?g|gif|webp|bmp|mp3|wav|m4a|aac|ogg|opus|flac)$/i;

export function cacheOf(id) { return store.cache[id] || (store.cache[id] = {}); }
export const mediaUsed = id => allClips().some(c => c.mediaId === id);

export async function importPaths(paths, { silent = false } = {}) {
  const out = [];
  for (const p of paths) {
    if (!SUPPORTED.test(p)) { toast('Formato não suportado: ' + p.split(/[\\/]/).pop(), 'bad'); continue; }
    const existing = Object.values(store.project.media).find(m => m.path === p);
    if (existing) { out.push(existing); continue; }
    try {
      const info = await fc.invoke('media:probe', p);
      if (info.type === 'unknown') throw new Error('sem trilhas de vídeo ou áudio');
      const m = addMedia({ path: p, name: p.split(/[\\/]/).pop(), ...info });
      out.push(m);
      loadMediaAssets(m);
    } catch (e) {
      toast('Não foi possível importar ' + p.split(/[\\/]/).pop() + ': ' + e.message, 'bad', 5000);
    }
  }
  if (out.length) { commit('importar'); if (!silent) toast(`${out.length} arquivo(s) importado(s)`, 'ok'); }
  store.emit('media');
  return out;
}

export async function loadMediaAssets(m) {
  const c = cacheOf(m.id);
  if (c.loading) return;
  c.loading = true;
  try {
    if (m.type === 'video' || m.type === 'image') {
      const count = m.type === 'video' ? clamp(Math.round(m.duration / 2), 6, 60) : 1;
      const p = await fc.invoke('media:thumbs', m.path, m.type === 'video' ? m.duration : 0, count);
      c.thumbs = fc.mediaUrl(p); c.thumbCount = count;
      store.emit('media');
    }
    if (m.type === 'audio' || m.hasAudio) {
      c.peaks = new Float32Array(await fc.invoke('media:peaks', m.path));
      store.emit('media');
    }
  } catch (e) { console.warn('miniaturas', e); }
}

export async function loadAllAssets() {
  for (const m of Object.values(store.project.media)) {
    if (!(await fc.invoke('fs:exists', m.path))) { m.missing = true; continue; }
    loadMediaAssets(m);
  }
}

/* ---------------- WAV ---------------- */
export function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, clamp(data[c][i], -1, 1) * 0x7fff, true); o += 2; }
  return out.buffer;
}

/* ---------------- efeitos sonoros sintetizados ---------------- */
function noise(ctx, dur) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = b; return s;
}
function tone(ctx, type, f0, f1, t0, dur, vol, out) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  o.connect(g).connect(out); o.start(t0); o.stop(t0 + dur + 0.02);
}
const SFX_RECIPES = {
  whoosh: (ctx, out) => {
    const n = noise(ctx, 0.8), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(3500, 0.35); f.frequency.exponentialRampToValueAtTime(400, 0.8);
    g.gain.setValueAtTime(0.001, 0); g.gain.exponentialRampToValueAtTime(0.9, 0.3); g.gain.exponentialRampToValueAtTime(0.001, 0.8);
    n.connect(f).connect(g).connect(out); n.start(0); return 0.85;
  },
  pop: (ctx, out) => { tone(ctx, 'sine', 700, 140, 0, 0.12, 0.9, out); return 0.15; },
  ding: (ctx, out) => { tone(ctx, 'sine', 1320, 1320, 0, 1.4, 0.6, out); tone(ctx, 'sine', 2640, 2640, 0, 0.8, 0.2, out); return 1.4; },
  click: (ctx, out) => {
    const n = noise(ctx, 0.02), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 2000; g.gain.setValueAtTime(0.8, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.02);
    n.connect(f).connect(g).connect(out); n.start(0); return 0.05;
  },
  boom: (ctx, out) => {
    tone(ctx, 'sine', 90, 30, 0, 1.6, 1, out);
    const n = noise(ctx, 1.2), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.frequency.value = 400; g.gain.setValueAtTime(0.8, 0); g.gain.exponentialRampToValueAtTime(0.001, 1.2);
    n.connect(f).connect(g).connect(out); n.start(0); return 1.7;
  },
  rise: (ctx, out) => {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(180, 0); o.frequency.exponentialRampToValueAtTime(1400, 1.3);
    f.type = 'lowpass'; f.frequency.setValueAtTime(500, 0); f.frequency.exponentialRampToValueAtTime(6000, 1.3);
    g.gain.setValueAtTime(0.001, 0); g.gain.exponentialRampToValueAtTime(0.35, 1.2); g.gain.linearRampToValueAtTime(0, 1.35);
    o.connect(f).connect(g).connect(out); o.start(0); o.stop(1.4); return 1.4;
  },
  swipe: (ctx, out) => {
    const n = noise(ctx, 0.3), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(5000, 0); f.frequency.exponentialRampToValueAtTime(800, 0.28);
    g.gain.setValueAtTime(0.7, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.3);
    n.connect(f).connect(g).connect(out); n.start(0); return 0.32;
  },
  notify: (ctx, out) => { tone(ctx, 'sine', 880, 880, 0, 0.18, 0.5, out); tone(ctx, 'sine', 1320, 1320, 0.15, 0.4, 0.5, out); return 0.6; },
  camera: (ctx, out) => { SFX_RECIPES.click(ctx, out); const n = noise(ctx, 0.12), g = ctx.createGain(); g.gain.setValueAtTime(0.001, 0.06); g.gain.linearRampToValueAtTime(0.5, 0.08); g.gain.exponentialRampToValueAtTime(0.001, 0.18); n.connect(g).connect(out); n.start(0.06); return 0.25; },
  wrong: (ctx, out) => { tone(ctx, 'square', 230, 230, 0, 0.22, 0.25, out); tone(ctx, 'square', 170, 170, 0.22, 0.4, 0.25, out); return 0.65; },
  coin: (ctx, out) => { tone(ctx, 'square', 988, 988, 0, 0.08, 0.25, out); tone(ctx, 'square', 1319, 1319, 0.08, 0.45, 0.25, out); return 0.55; },
  drum: (ctx, out) => { tone(ctx, 'sine', 160, 45, 0, 0.45, 1, out); SFX_RECIPES.click(ctx, out); return 0.5; }
};

export async function makeSfx(id, label) {
  const rate = 48000;
  const probeCtx = new OfflineAudioContext(1, rate * 2, rate);
  const len = SFX_RECIPES[id](probeCtx, probeCtx.destination);
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * (len + 0.05)), rate);
  SFX_RECIPES[id](ctx, ctx.destination);
  const buf = await ctx.startRendering();
  const path = await fc.invoke('fs:writeCache', `sfx-${id}.wav`, new Uint8Array(encodeWav(buf)));
  const [m] = await importPaths([path], { silent: true });
  if (m) { m.name = `SFX ${label}`; }
  return m;
}

/* ---------------- narração (microfone) ---------------- */
let rec = null;
export const isRecording = () => !!rec;
export async function toggleVoiceover() {
  if (rec) { rec.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { toast('Microfone indisponível: ' + e.message, 'bad'); return; }
  const startAt = store.time;
  const chunks = [];
  const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  mr.ondataavailable = e => chunks.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    rec = null;
    store.emit('recording', false);
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const raw = await fc.invoke('fs:writeCache', `narracao-${Date.now()}.webm`, new Uint8Array(await blob.arrayBuffer()));
    // WebM do gravador não tem índice de busca: converte para WAV
    const path = await fc.invoke('media:process', { op: 'audiofx', file: raw, fx: [] });
    const [m] = await importPaths([path], { silent: true });
    if (!m) return;
    m.name = 'Narração ' + new Date().toLocaleTimeString('pt-BR');
    const c = makeClip('audio', { mediaId: m.id, start: startAt, dur: m.duration, name: m.name });
    insertClip(c, 'audio');
    commit('narração');
    toast('Narração adicionada à linha do tempo', 'ok');
  };
  mr.start(250);
  rec = mr;
  store.emit('recording', true);
  toast('Gravando narração... clique em 🎙 novamente para parar');
}
