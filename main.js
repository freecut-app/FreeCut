/* FreeCut — processo principal (Electron)
 * Janela, protocolo freecut://, diálogos e todo o trabalho pesado:
 * ffprobe/ffmpeg (miniaturas, ondas, reverso, estabilização, efeitos de voz, mixagem, mux),
 * Whisper (legendas automáticas) e SAPI do Windows (texto para fala).
 */
'use strict';
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const RES = app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(ROOT, 'resources');
const FFMPEG = path.join(RES, 'bin', 'ffmpeg.exe');
const FFPROBE = path.join(RES, 'bin', 'ffprobe.exe');

app.setName('FreeCut');
if (process.platform === 'win32') app.setAppUserModelId('com.freecut.editor');
const CACHE = path.join(app.getPath('userData'), 'cache');
fs.mkdirSync(CACHE, { recursive: true });

protocol.registerSchemesAsPrivileged([{
  scheme: 'freecut',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.tflite': 'application/octet-stream'
};
const mimeOf = p => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

/* ---------- protocolo: app e arquivos de mídia (com suporte a Range) ---------- */
async function serveFile(file, req) {
  let st;
  try { st = await fsp.stat(file); } catch { return new Response('não encontrado', { status: 404 }); }
  const headers = { 'content-type': mimeOf(file), 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' };
  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${st.size}` } });
    headers['content-range'] = `bytes ${start}-${end}/${st.size}`;
    headers['content-length'] = String(end - start + 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers });
  }
  headers['content-length'] = String(st.size);
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

function registerProtocol() {
  protocol.handle('freecut', req => {
    const u = new URL(req.url);
    if (u.pathname === '/media') return serveFile(u.searchParams.get('p'), req);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || !rel) rel = '/index.html';
    const file = path.normalize(path.join(SRC, rel));
    if (!file.startsWith(SRC)) return new Response('proibido', { status: 403 });
    return serveFile(file, req);
  });
}

/* ---------- utilidades de processo ---------- */
function run(cmd, args, { onStderr, onStdout, input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; if (onStdout) onStdout(d); });
    p.stderr.on('data', d => { err += d; if (onStderr) onStderr(d.toString()); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve({ out, err }) : reject(new Error(`${path.basename(cmd)} saiu com código ${code}: ${err.slice(-800)}`)));
    if (input) { p.stdin.end(input); }
    tasks.set(p.pid, p);
    p.on('close', () => tasks.delete(p.pid));
  });
}
const tasks = new Map();
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
async function fileKey(p) { const st = await fsp.stat(p); return hash(`${p}|${st.size}|${st.mtimeMs}`); }

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

/** Executa ffmpeg com barra de progresso (0–1) enviada ao renderizador. */
function ffmpeg(args, { taskId, duration } = {}) {
  const full = ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats', ...args];
  let buf = '';
  return run(FFMPEG, full, {
    onStdout: d => {
      if (!taskId || !duration) return;
      buf += d.toString();
      const m = buf.match(/out_time_us=(\d+)/g);
      if (m) {
        const us = parseInt(m[m.length - 1].split('=')[1], 10);
        send('task:progress', { id: taskId, pct: Math.min(1, us / 1e6 / duration) });
        buf = buf.slice(-200);
      }
    }
  });
}

/* ---------- análise de mídia ---------- */
async function probe(file) {
  const { out } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(out);
  const v = j.streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = j.streams.find(s => s.codec_type === 'audio');
  const ext = path.extname(file).toLowerCase();
  const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext);
  let w = v ? v.width : 0, h = v ? v.height : 0;
  const rot = v ? Math.abs(parseInt((v.tags && v.tags.rotate) || ((v.side_data_list || []).find(s => s.rotation != null) || {}).rotation || 0, 10)) : 0;
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  let fps = 30;
  if (v && v.avg_frame_rate && v.avg_frame_rate !== '0/0') { const [n, d] = v.avg_frame_rate.split('/').map(Number); if (d) fps = n / d; }
  return {
    type: isImage ? 'image' : v ? 'video' : a ? 'audio' : 'unknown',
    duration: isImage ? 0 : parseFloat(j.format.duration) || 0,
    width: w, height: h, fps: Math.round(fps * 100) / 100,
    hasAudio: !!a, codec: v ? v.codec_name : a ? a.codec_name : '', size: parseInt(j.format.size, 10) || 0
  };
}

async function thumbs(file, duration, count) {
  const key = await fileKey(file);
  const out = path.join(CACHE, `thumbs-${key}-${count}.jpg`);
  if (fs.existsSync(out)) return out;
  if (!duration) {
    await run(FFMPEG, ['-hide_banner', '-y', '-i', file, '-frames:v', '1', '-vf', 'scale=-2:72', '-q:v', '4', out]);
    return out;
  }
  const step = duration / count;
  const vf = `fps=1/${step.toFixed(4)},scale=128:72:force_original_aspect_ratio=increase,crop=128:72,tile=${count}x1`;
  await run(FFMPEG, ['-hide_banner', '-y', '-skip_frame', 'nokey', '-i', file, '-vf', vf, '-frames:v', '1', '-q:v', '5', out]).catch(() =>
    run(FFMPEG, ['-hide_banner', '-y', '-i', file, '-vf', vf, '-frames:v', '1', '-q:v', '5', out]));
  return out;
}

/** Envoltória de áudio: 100 picos por segundo (0–1). Usada nas ondas e na detecção de batidas. */
async function peaks(file) {
  const key = await fileKey(file);
  const cacheFile = path.join(CACHE, `peaks-${key}.bin`);
  if (fs.existsSync(cacheFile)) return new Float32Array((await fsp.readFile(cacheFile)).buffer.slice(0));
  const rate = 8000, per = rate / 100;
  const chunks = [];
  await new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { windowsHide: true });
    p.stdout.on('data', d => chunks.push(d));
    p.on('error', reject);
    p.on('close', resolve);
  });
  const buf = Buffer.concat(chunks);
  const n = Math.floor(buf.length / 2);
  const res = new Float32Array(Math.ceil(n / per));
  for (let i = 0; i < res.length; i++) {
    let m = 0;
    for (let j = i * per; j < Math.min(n, (i + 1) * per); j++) { const v = Math.abs(buf.readInt16LE(j * 2)); if (v > m) m = v; }
    res[i] = m / 32768;
  }
  await fsp.writeFile(cacheFile, Buffer.from(res.buffer));
  return res;
}

/* ---------- processamento (reverso, estabilizar, voz) ---------- */
const VOICE_FX = {
  denoise: 'afftdn=nf=-25:tn=1',
  normalize: 'loudnorm=I=-16:TP=-1.5:LRA=11',
  esquilo: 'rubberband=pitch=1.6:formant=preserved',
  grave: 'rubberband=pitch=0.7',
  monstro: 'rubberband=pitch=0.55,aecho=0.8:0.6:40:0.3',
  robo: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  eco: 'aecho=0.8:0.88:120|240:0.45|0.25',
  telefone: 'highpass=f=300,lowpass=f=3400,acompressor=threshold=0.1:ratio=6',
  radio: 'highpass=f=500,lowpass=f=4000,acrusher=bits=10:mode=log:aa=1',
  megafone: 'highpass=f=600,lowpass=f=3000,volume=2,alimiter=limit=0.8',
  caverna: 'aecho=0.8:0.9:500|1000:0.4|0.3,lowpass=f=4000',
  alien: 'rubberband=pitch=1.3,vibrato=f=8:d=0.4',
  sussurro: 'highpass=f=1000,volume=1.5,aphaser=type=t:speed=0.5'
};

async function processMedia(job) {
  const { op, file, start = 0, dur, fx = [], taskId } = job;
  const key = hash(JSON.stringify({ op, k: await fileKey(file), start, dur, fx }));
  if (op === 'reverse' || op === 'stabilize') {
    const out = path.join(CACHE, `${op}-${key}.mp4`);
    if (fs.existsSync(out)) return out;
    const seg = ['-ss', String(start), '-t', String(dur), '-i', file];
    if (op === 'reverse') {
      await ffmpeg([...seg, '-vf', 'reverse', '-af', 'areverse', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', out], { taskId, duration: dur });
    } else {
      const trf = path.join(CACHE, `${key}.trf`).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
      send('task:progress', { id: taskId, pct: 0.02, label: 'Analisando tremores (1/2)' });
      await ffmpeg([...seg, '-vf', `vidstabdetect=shakiness=6:accuracy=15:result='${trf}'`, '-f', 'null', '-'], { taskId, duration: dur * 2 });
      send('task:progress', { id: taskId, pct: 0.5, label: 'Estabilizando (2/2)' });
      await ffmpeg([...seg, '-vf', `vidstabtransform=input='${trf}':smoothing=20:zoom=4,unsharp=5:5:0.8:3:3:0.4`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', out], { taskId, duration: dur });
    }
    return out;
  }
  if (op === 'audiofx') {
    const out = path.join(CACHE, `afx-${key}.wav`);
    if (fs.existsSync(out)) return out;
    const chain = fx.map(f => VOICE_FX[f]).filter(Boolean);
    const af = ['aresample=48000', ...chain].join(',');
    await ffmpeg(['-i', file, '-vn', '-af', af, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out], { taskId, duration: job.mediaDuration || 0 });
    return out;
  }
  throw new Error('operação desconhecida: ' + op);
}

/* ---------- mixagem de áudio da linha do tempo ---------- */
function atempoChain(s) {
  const parts = [];
  let r = s;
  while (r > 2.0001) { parts.push('atempo=2'); r /= 2; }
  while (r < 0.4999) { parts.push('atempo=0.5'); r /= 0.5; }
  if (Math.abs(r - 1) > 1e-4) parts.push(`atempo=${r.toFixed(5)}`);
  return parts;
}

/**
 * plan = { duration, items: [{ path, in, srcDur, start, dur, speed, volume, fadeIn, fadeOut, pitch }] }
 * Cada item: corta a fonte, ajusta velocidade, volume e fades, posiciona com adelay e mistura tudo.
 */
async function buildAudioGraph(plan, firstInput) {
  const inputs = [], parts = [], labels = [];
  const D = Math.max(0.05, plan.duration);
  plan.items.forEach((it, i) => {
    const idx = firstInput + i;
    inputs.push('-i', it.path);
    const f = [`atrim=start=${it.in.toFixed(4)}:end=${(it.in + it.srcDur).toFixed(4)}`, 'asetpts=PTS-STARTPTS',
      'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
    if (Math.abs(it.speed - 1) > 1e-4) {
      if (it.pitch) f.push(`asetrate=${Math.round(48000 * it.speed)}`, 'aresample=48000');
      else f.push(...atempoChain(it.speed));
    }
    if (it.volExpr) f.push(`volume='${it.volExpr}':eval=frame`);
    else if (Math.abs(it.volume - 1) > 1e-4) f.push(`volume=${it.volume.toFixed(4)}`);
    if (it.fadeIn > 0) f.push(`afade=t=in:st=0:d=${it.fadeIn.toFixed(3)}`);
    if (it.fadeOut > 0) f.push(`afade=t=out:st=${Math.max(0, it.dur - it.fadeOut).toFixed(3)}:d=${it.fadeOut.toFixed(3)}`);
    f.push(`atrim=end=${it.dur.toFixed(4)}`);
    const ms = Math.max(0, Math.round(it.start * 1000));
    if (ms) f.push(`adelay=${ms}|${ms}`);
    parts.push(`[${idx}:a]${f.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  let graph;
  if (!labels.length) graph = `anullsrc=r=48000:cl=stereo,atrim=end=${D.toFixed(4)}[aout]`;
  else graph = parts.join(';') + `;${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad=whole_dur=${D.toFixed(4)},atrim=end=${D.toFixed(4)},alimiter=limit=0.98[aout]`;
  const script = path.join(CACHE, `graph-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await fsp.writeFile(script, graph);
  return { inputs, script };
}

async function mixdown(plan, out, { rate = 48000, mono = false, codec } = {}, taskId) {
  const { inputs, script } = await buildAudioGraph(plan, 0);
  const extra = codec === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '256k'] : ['-c:a', 'pcm_s16le'];
  try {
    await ffmpeg([...inputs, '-/filter_complex', script, '-map', '[aout]', '-ar', String(rate), '-ac', mono ? '1' : '2', ...extra, out], { taskId, duration: plan.duration });
  } finally { fsp.unlink(script).catch(() => {}); }
  return out;
}

/* ---------- exportação: recebe o vídeo H.264 do renderizador e junta o áudio ---------- */
const exportsOpen = new Map();

/* ---------- Whisper (legendas automáticas) ---------- */
function whisperBin(useGpu) {
  const gpu = path.join(RES, 'whisper', 'cuda', 'whisper-cli.exe');
  const cpu = path.join(RES, 'whisper', 'cpu', 'whisper-cli.exe');
  return useGpu && fs.existsSync(gpu) ? gpu : cpu;
}
function whisperModel(name) {
  const f = { turbo: 'ggml-large-v3-turbo-q5_0.bin', small: 'ggml-small-q5_1.bin' }[name] || 'ggml-large-v3-turbo-q5_0.bin';
  const p = path.join(RES, 'models', f);
  return fs.existsSync(p) ? p : path.join(RES, 'models', 'ggml-small-q5_1.bin');
}

async function captions({ plan, lang = 'pt', model = 'turbo', maxLen = 32, taskId }) {
  const wav = path.join(CACHE, `cap-${Date.now()}.wav`);
  send('task:progress', { id: taskId, pct: 0.02, label: 'Extraindo áudio' });
  await mixdown(plan, wav, { rate: 16000, mono: true });
  const base = wav.replace(/\.wav$/, '');
  const args = ['-m', whisperModel(model), '-f', wav, '-l', lang || 'auto', '-oj', '-of', base,
    '-ml', String(maxLen), '-sow', '-t', String(Math.max(2, Math.min(8, os.cpus().length - 2))), '-pp'];
  const onStderr = s => { const m = /progress\s*=\s*(\d+)%/.exec(s); if (m) send('task:progress', { id: taskId, pct: 0.1 + 0.9 * parseInt(m[1], 10) / 100, label: 'Transcrevendo' }); };
  send('task:progress', { id: taskId, pct: 0.1, label: 'Transcrevendo' });
  try {
    try { await run(whisperBin(true), args, { onStderr, cwd: path.dirname(whisperBin(true)) }); }
    catch (e) { await run(whisperBin(false), args, { onStderr, cwd: path.dirname(whisperBin(false)) }); }
    const j = JSON.parse(await fsp.readFile(base + '.json', 'utf8'));
    return (j.transcription || []).map(s => ({ from: s.offsets.from / 1000, to: s.offsets.to / 1000, text: s.text.trim() })).filter(s => s.text);
  } finally {
    fsp.unlink(wav).catch(() => {}); fsp.unlink(base + '.json').catch(() => {});
  }
}

/* ---------- texto para fala (SAPI do Windows) ---------- */
const TTS_PS = `param([string]$TextFile,[string]$Out,[string]$Voice,[int]$Rate)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) { try { $s.SelectVoice($Voice) } catch {} }
$s.Rate = $Rate
$s.SetOutputToWaveFile($Out)
$s.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
$s.Dispose()
`;
async function ttsVoices() {
  const { out } = await run('powershell', ['-NoProfile', '-Command',
    "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture + '|' + $_.VoiceInfo.Gender }"]);
  return out.split(/\r?\n/).filter(Boolean).map(l => { const [name, culture, gender] = l.split('|'); return { name, culture, gender }; });
}
async function tts({ text, voice, rate = 0 }) {
  const id = hash(text + voice + rate + Date.now());
  const ps = path.join(CACHE, 'tts.ps1'), txt = path.join(CACHE, `tts-${id}.txt`), out = path.join(CACHE, `tts-${id}.wav`);
  await fsp.writeFile(ps, '﻿' + TTS_PS, 'utf8');
  await fsp.writeFile(txt, text, 'utf8');
  await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-TextFile', txt, '-Out', out, '-Voice', voice || '', '-Rate', String(rate)]);
  fsp.unlink(txt).catch(() => {});
  return out;
}

/* ---------- IPC ---------- */
function handlers() {
  const h = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => fn(...a));

  h('app:info', () => ({ cache: CACHE, docs: path.join(app.getPath('documents'), 'FreeCut'), version: app.getVersion() }));
  h('dialog:openMedia', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importar mídia', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Mídia', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'] }]
    });
    return r.canceled ? [] : r.filePaths;
  });
  h('dialog:openProject', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Abrir projeto', properties: ['openFile'], filters: [{ name: 'Projeto FreeCut', extensions: ['freecut'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('dialog:save', async (opts) => {
    const docs = path.join(app.getPath('documents'), 'FreeCut');
    fs.mkdirSync(docs, { recursive: true });
    const r = await dialog.showSaveDialog(win, { title: opts.title, defaultPath: path.join(opts.dir || docs, opts.name), filters: opts.filters });
    return r.canceled ? null : r.filePath;
  });
  h('dialog:open', async (opts) => {
    const r = await dialog.showOpenDialog(win, { title: opts.title, properties: ['openFile'], filters: opts.filters });
    return r.canceled ? null : r.filePaths[0];
  });
  h('fs:readText', p => fsp.readFile(p, 'utf8'));
  h('fs:writeText', async (p, s) => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, s, 'utf8'); return p; });
  h('fs:exists', p => fs.existsSync(p));
  h('fs:writeFile', async (p, data) => { await fsp.writeFile(p, Buffer.from(data)); return p; });
  h('fs:writeCache', async (name, data) => { const p = path.join(CACHE, name); await fsp.writeFile(p, Buffer.from(data)); return p; });
  h('fs:autosavePath', () => path.join(app.getPath('userData'), 'autosave.freecut'));
  h('fs:recent', async (add) => {
    const f = path.join(app.getPath('userData'), 'recent.json');
    let list = [];
    try { list = JSON.parse(await fsp.readFile(f, 'utf8')); } catch { /* vazio */ }
    if (add) { list = [add, ...list.filter(x => x !== add)].slice(0, 12); await fsp.writeFile(f, JSON.stringify(list)); }
    return list.filter(p => fs.existsSync(p));
  });
  h('shell:show', p => shell.showItemInFolder(p));
  h('shell:open', p => shell.openPath(p));

  h('media:probe', probe);
  h('media:thumbs', (p, d, n) => thumbs(p, d, n));
  h('media:peaks', async p => Array.from(await peaks(p)));
  h('media:process', processMedia);
  h('audio:mixdown', ({ plan, out, codec, taskId }) => mixdown(plan, out, { codec }, taskId));
  h('ai:captions', captions);
  h('ai:voices', ttsVoices);
  h('ai:tts', tts);
  h('task:cancel', () => { for (const p of tasks.values()) p.kill(); });

  h('export:begin', async ({ outPath }) => {
    const id = hash(outPath + Date.now());
    const tmp = path.join(CACHE, `export-${id}.mp4`);
    exportsOpen.set(id, { fd: await fsp.open(tmp, 'w'), tmp, outPath });
    return id;
  });
  h('export:chunk', async (id, data, position) => {
    const e = exportsOpen.get(id);
    if (!e) throw new Error('exportação cancelada');
    const b = Buffer.from(data);
    await e.fd.write(b, 0, b.length, position);
  });
  h('export:finish', async ({ id, plan, taskId }) => {
    const e = exportsOpen.get(id);
    await e.fd.close();
    exportsOpen.delete(id);
    const { inputs, script } = await buildAudioGraph(plan, 1);
    try {
      await ffmpeg(['-i', e.tmp, ...inputs, '-/filter_complex', script, '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-t', plan.duration.toFixed(4), e.outPath],
        { taskId, duration: plan.duration });
    } finally {
      fsp.unlink(script).catch(() => {});
      fsp.unlink(e.tmp).catch(() => {});
    }
    return e.outPath;
  });
  h('export:abort', async id => {
    const e = exportsOpen.get(id);
    if (!e) return;
    exportsOpen.delete(id);
    await e.fd.close().catch(() => {});
    fsp.unlink(e.tmp).catch(() => {});
  });
}

/* ---------- janela ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 680,
    backgroundColor: '#101217', title: 'FreeCut', autoHideMenuBar: true, icon: path.join(ROOT, 'build', 'icon.png'),
    show: !process.env.FREECUT_HIDDEN,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.setMenuBarVisibility(false);
  win.loadURL('freecut://app/index.html' + (process.env.FREECUT_TEST ? '?test=1' : ''));
  win.on('close', e => {
    if (win.__allowClose) return;
    e.preventDefault();
    win.webContents.send('app:closing');
  });
  ipcMain.handle('app:close', () => { win.__allowClose = true; win.close(); });
}

app.whenReady().then(() => {
  registerProtocol();
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'clipboard-read', 'fullscreen'].includes(perm)));
  handlers();
  createWindow();
});
app.on('window-all-closed', () => app.quit());

module.exports = { buildAudioGraph, atempoChain };
