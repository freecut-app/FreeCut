// FreeCut — exportação (vídeo H.264 por hardware + áudio mixado pelo ffmpeg), áudio, SRT
import { Muxer, StreamTarget } from '../vendor/mp4-muxer.mjs';
import { store, mediaOf, srcLen, projectDuration, clipEnd, commit, newTrack, makeClip } from './store.js';
import { engine, renderFrame, seekExact, pause, requestRender, resizePreview, syncMedia } from './engine.js';
import { EXPORT_RES } from './catalog.js';
import { el, modal, progressBox, toast, fmtTime, clamp, deep } from './util.js';
import { TEXT_PRESETS, TEXT_DEFAULT } from './catalog.js';

const fc = window.fc;

/* ---------------- plano de áudio (para ffmpeg) ---------------- */
function volumeExpr(c) {
  const list = c.kf && c.kf.volume;
  if (!list || !list.length) return null;
  const pts = list.map(k => [k.t, k.v]);
  let expr = pts[pts.length - 1][1].toFixed(4);
  for (let i = pts.length - 2; i >= 0; i--) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    const seg = `${v0.toFixed(4)}+(${(v1 - v0).toFixed(4)})*(t-${t0.toFixed(3)})/${Math.max(0.001, t1 - t0).toFixed(3)}`;
    expr = `if(lt(t,${t1.toFixed(3)}),${seg},${expr})`;
  }
  return `if(lt(t,${pts[0][0].toFixed(3)}),${pts[0][1].toFixed(4)},${expr})`;
}

export function audioPlan(only = null) {
  const items = [];
  for (const tr of store.project.tracks) {
    if (tr.muted) continue;
    for (const c of tr.clips) {
      if (only && !only.includes(c.id)) continue;
      if (c.type !== 'video' && c.type !== 'audio') continue;
      const m = mediaOf(c);
      if (!m || c.muted) continue;
      if (c.type === 'video' && (c.curve || (!m.hasAudio && !c.audioPath))) continue;
      const vexpr = volumeExpr(c);
      if (!vexpr && !(c.volume > 0)) continue;
      items.push({
        path: c.audioPath || m.path, in: c.in, srcDur: srcLen(c), start: c.start, dur: c.dur, speed: c.speed,
        volume: c.volume ?? 1, volExpr: vexpr, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, pitch: !!c.pitch
      });
    }
  }
  return { duration: projectDuration(), items };
}

/* ---------------- nível H.264 adequado à resolução ---------------- */
function avcCodec(W, H, fps) {
  const mbs = Math.ceil(W / 16) * Math.ceil(H / 16) * fps;
  if (mbs <= 245760) return 'avc1.640028';
  if (mbs <= 522240) return 'avc1.64002A';
  if (mbs <= 983040) return 'avc1.640033';
  return 'avc1.640034';
}
export function exportSize(resH) {
  const p = store.project;
  const k = resH / Math.min(p.width, p.height);
  return [Math.round(p.width * k / 2) * 2, Math.round(p.height * k / 2) * 2];
}

/* ---------------- diálogo ---------------- */
export async function exportDialog() {
  const dur = projectDuration();
  if (dur <= 0) { toast('Adicione clipes à linha do tempo antes de exportar.', 'bad'); return; }
  pause();
  const info = await fc.invoke('app:info');
  const p = store.project;
  const body = el('div');
  body.innerHTML = `
    <label class="f">Nome do arquivo<input name="name" value="${(p.name || 'video').replace(/[\\/:*?"<>|]/g, '_')}"></label>
    <label class="f">Pasta<div class="row" style="margin:0"><input name="dir" value="${info.docs}" style="flex:1"><button class="btn sm" data-pick type="button">Escolher...</button></div></label>
    <div class="grid2">
      <label class="f">Formato<select name="format"><option value="mp4">Vídeo MP4 (H.264 + AAC)</option><option value="mp3">Somente áudio (MP3)</option><option value="wav">Somente áudio (WAV)</option><option value="srt">Legendas (SRT)</option></select></label>
      <label class="f">Resolução<select name="res">${EXPORT_RES.map(r => `<option value="${r.h}" ${r.h === 1080 ? 'selected' : ''}>${r.name}</option>`).join('')}</select></label>
      <label class="f">Taxa de quadros<select name="fps">${[24, 25, 30, 50, 60].map(f => `<option ${f === p.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label class="f">Qualidade<select name="q"><option value="0.09">Recomendada</option><option value="0.14" selected>Alta</option><option value="0.22">Máxima</option></select></label>
    </div>
    <p class="plabel" data-est></p>
    <p class="plabel">✓ Sem marca d'água · ✓ Até 4K 60 fps · ✓ Codificação na GPU</p>`;
  const est = () => {
    const f = body.querySelector('[name=format]').value;
    const [W, H] = exportSize(+body.querySelector('[name=res]').value);
    const fps = +body.querySelector('[name=fps]').value, q = +body.querySelector('[name=q]').value;
    const mb = (W * H * fps * q + 192000) * dur / 8 / 1e6;
    body.querySelector('[data-est]').textContent = f === 'mp4'
      ? `${W}×${H} · ${fps} fps · duração ${fmtTime(dur)} · tamanho estimado ~${mb < 1000 ? Math.round(mb) + ' MB' : (mb / 1000).toFixed(1).replace('.', ',') + ' GB'}`
      : `Duração ${fmtTime(dur)}`;
  };
  body.addEventListener('change', est);
  est();
  body.querySelector('[data-pick]').addEventListener('click', async () => {
    const f = body.querySelector('[name=format]').value;
    const out = await fc.invoke('dialog:save', { title: 'Salvar como', name: body.querySelector('[name=name]').value + '.' + f, dir: body.querySelector('[name=dir]').value, filters: [{ name: f.toUpperCase(), extensions: [f] }] });
    if (out) {
      const parts = out.split(/[\\/]/);
      body.querySelector('[name=name]').value = parts.pop().replace(/\.[^.]+$/, '');
      body.querySelector('[name=dir]').value = parts.join('\\');
    }
  });
  const v = await modal({ title: 'Exportar', body, ok: 'Exportar', wide: false });
  if (!v) return;
  const out = `${v.dir.replace(/[\\/]+$/, '')}\\${v.name}.${v.format}`;
  if (await fc.invoke('fs:exists', out)) {
    const ok = await modal({ title: 'Arquivo existente', body: `<p>${out}<br>já existe. Substituir?</p>`, ok: 'Substituir' });
    if (!ok) return;
  }
  if (v.format === 'mp4') return exportVideo(out, +v.res, +v.fps, +v.q);
  if (v.format === 'srt') return exportSrt(out);
  return exportAudio(out, v.format);
}

/* ---------------- vídeo ---------------- */
export async function exportVideo(outPath, resH, fps, bpp, { quiet = false } = {}) {
  const [W, H] = exportSize(resH);
  const dur = projectDuration();
  const total = Math.max(1, Math.ceil(dur * fps - 1e-6));
  const bitrate = Math.round(clamp(W * H * fps * bpp, 1e6, 150e6));
  const codec = avcCodec(W, H, fps);
  const cfg = { codec, width: W, height: H, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality', avc: { format: 'avc' } };
  let sup = await VideoEncoder.isConfigSupported(cfg);
  if (!sup.supported) { cfg.hardwareAcceleration = 'no-preference'; sup = await VideoEncoder.isConfigSupported(cfg); }
  if (!sup.supported) { toast('Seu sistema não suporta codificar H.264 nesta resolução.', 'bad', 6000); return null; }

  const pb = quiet ? { set() {}, close() {} } : progressBox('Exportando vídeo');
  let cancelled = false;
  pb.onCancel = () => { cancelled = true; fc.invoke('task:cancel'); };
  const taskId = 'e' + Date.now();
  const offProg = fc.on('task:progress', d => { if (d.id === taskId) pb.set(0.9 + d.pct * 0.1, 'Mixando áudio e finalizando...'); });
  const id = await fc.invoke('export:begin', { outPath });
  const writes = [];
  let writeErr = null;
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, position) => writes.push(fc.invoke('export:chunk', id, data.slice(), position).catch(e => { writeErr = e; })), chunked: true, chunkSize: 8 * 1024 * 1024 }),
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    fastStart: false, firstTimestampBehavior: 'offset'
  });
  let encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
  enc.configure(cfg);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { alpha: false });
  engine.exporting = true;
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (cancelled) throw new Error('cancelado');
      if (encErr) throw encErr;
      if (writeErr) throw writeErr;
      const t = Math.min(dur - 1e-4, i / fps);
      await seekExact(t);
      renderFrame(g, t, W, H);
      const frame = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % Math.round(fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 2));
      if (i % 5 === 0) {
        const el = (performance.now() - t0) / 1000, rate = (i + 1) / el, left = (total - i - 1) / rate;
        pb.set(0.9 * (i + 1) / total, `Quadro ${i + 1} de ${total} · ${rate.toFixed(0)} q/s · faltam ~${fmtTime(left)}`);
      }
    }
    await enc.flush();
    muxer.finalize();
    await Promise.all(writes);
    if (writeErr) throw writeErr;
    pb.set(0.9, 'Mixando áudio e finalizando...');
    const result = await fc.invoke('export:finish', { id, plan: audioPlan(), taskId });
    pb.close();
    const secs = ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',');
    if (!quiet) {
      const r = await modal({ title: 'Exportação concluída ✓', body: `<p>${W}×${H} · ${fps} fps · em ${secs} s</p><p class="plabel">${result}</p>`, ok: 'Mostrar na pasta', cancel: 'Fechar' });
      if (r) fc.invoke('shell:show', result);
    }
    return result;
  } catch (e) {
    pb.close();
    fc.invoke('export:abort', id);
    if (String(e.message || e) !== 'cancelado') { console.error(e); toast('Erro na exportação: ' + (e.message || e), 'bad', 8000); }
    else toast('Exportação cancelada');
    return null;
  } finally {
    offProg();
    try { enc.close(); } catch { /* já fechado */ }
    engine.exporting = false;
    resizePreview();
    syncMedia(store.time, false);
    requestRender();
  }
}

/* ---------------- somente áudio ---------------- */
export async function exportAudio(outPath, codec) {
  const pb = progressBox('Exportando áudio');
  const taskId = 'a' + Date.now();
  const off = fc.on('task:progress', d => { if (d.id === taskId) pb.set(d.pct, Math.round(d.pct * 100) + '%'); });
  pb.onCancel = () => fc.invoke('task:cancel');
  try {
    const out = await fc.invoke('audio:mixdown', { plan: audioPlan(), out: outPath, codec, taskId });
    pb.close();
    const r = await modal({ title: 'Áudio exportado ✓', body: `<p class="plabel">${out}</p>`, ok: 'Mostrar na pasta', cancel: 'Fechar' });
    if (r) fc.invoke('shell:show', out);
  } catch (e) { pb.close(); toast('Erro: ' + e.message, 'bad', 6000); }
  finally { off(); }
}

/* ---------------- legendas SRT ---------------- */
const srtTime = t => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export function captionClips() {
  const all = store.project.tracks.flatMap(t => t.clips).filter(c => c.type === 'text');
  const caps = all.filter(c => c.caption);
  return (caps.length ? caps : all).sort((a, b) => a.start - b.start);
}
export async function exportSrt(outPath) {
  const caps = captionClips();
  if (!caps.length) { toast('Não há textos ou legendas para exportar.', 'bad'); return; }
  const srt = caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(clipEnd(c))}\n${c.text.content}\n`).join('\n');
  await fc.invoke('fs:writeText', outPath, srt);
  toast('Legendas salvas: ' + outPath, 'ok', 5000);
}
export function parseSrt(text) {
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/.exec(block);
    if (!m) continue;
    const t = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    const lines = block.split('\n');
    const idx = lines.findIndex(l => l.includes('-->'));
    out.push({ from: t(m[1], m[2], m[3], m[4]), to: t(m[5], m[6], m[7], m[8]), text: lines.slice(idx + 1).join('\n').replace(/<[^>]+>/g, '').trim() });
  }
  return out.filter(s => s.text);
}

/** Cria clipes de legenda a partir de segmentos {from, to, text}. */
export function addCaptions(segs, { replace = true, preset = 'caption' } = {}) {
  if (replace) for (const tr of store.project.tracks) tr.clips = tr.clips.filter(c => !c.caption);
  store.project.tracks = store.project.tracks.filter(t => t.kind === 'main' || t.clips.length);
  const tr = newTrack('visual', 'top');
  const p = store.project;
  const style = (TEXT_PRESETS.find(x => x.id === preset) || TEXT_PRESETS[1]).s;
  const size = Math.round(Math.min(p.width, p.height) * 0.055);
  for (const s of segs) {
    const c = makeClip('text', { start: s.from, dur: Math.max(0.3, s.to - s.from), caption: true });
    c.text = Object.assign(deep(TEXT_DEFAULT), deep(style), { content: s.text, size });
    c.y = Math.round(p.height * 0.33);
    tr.clips.push(c);
  }
  tr.clips.sort((a, b) => a.start - b.start);
  for (let i = 0; i < tr.clips.length - 1; i++) {
    const a = tr.clips[i], b = tr.clips[i + 1];
    if (clipEnd(a) > b.start) a.dur = Math.max(0.1, b.start - a.start);
  }
  commit('legendas');
}
