/* Teste ponta a ponta do FreeCut: abre o app Electron real, monta uma edição e exporta.
 * Uso: node tests/e2e.js           (completo, inclui IA)
 *      node tests/e2e.js --rapido  (sem legendas/estabilização)
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MEDIA = path.join(__dirname, 'media');
const OUT = path.join(__dirname, 'out');
const FFPROBE = path.join(ROOT, 'resources', 'bin', 'ffprobe.exe');
const quick = process.argv.includes('--rapido');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FALHA') + ' ' + msg); if (!ok) fails++; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // FREECUT_EXE=caminho\FreeCut.exe testa a versão empacotada
  const exe = process.env.FREECUT_EXE;
  if (exe) console.log('Testando executável: ' + exe);
  const app = await electron.launch({
    executablePath: exe || require('electron'), args: exe ? [] : [ROOT],
    env: { ...process.env, FREECUT_TEST: '1' }
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', e => errors.push(e.message));
  win.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await win.setViewportSize?.({ width: 1600, height: 960 });
  const ev = (fn, arg) => win.evaluate(fn, arg);
  for (let i = 0; i < 300 && !(await ev(() => !!(window.FC && window.FC.ready)).catch(() => false)); i++) await new Promise(r => setTimeout(r, 100));

  // ---------- importação ----------
  const files = ['clipeA.mp4', 'clipeB.mp4', 'verde.mp4', 'fala.mp4'].map(f => path.join(MEDIA, f));
  const media = await ev(async fs => (await FC.importPaths(fs)).map(m => ({ id: m.id, type: m.type, dur: m.duration, w: m.width, audio: m.hasAudio })), files);
  check(media.length === 4 && media[0].type === 'video' && Math.abs(media[0].dur - 6) < 0.1 && media[0].w === 1280 && media[0].audio, 'importa e analisa vídeos (ffprobe)');

  // ---------- montagem ----------
  const r = await ev(async ids => {
    const { store } = FC;
    const [a, b, g] = ids.map(i => store.project.media[i]);
    const ca = FC.insertMedia(a, 0, 'main');
    const cb = FC.insertMedia(b, 1e9, 'main');
    // sobreposição com chroma key, em escala menor
    const cg = FC.insertMedia(g, 1, 'overlay');
    cg.chroma.on = true; cg.scale = 0.4; cg.x = 500; cg.y = -250;
    // efeito, filtro, animação, keyframes, transição
    ca.filter = { id: 'cinema', amount: 100 };
    ca.effects = [{ id: 'vhs', amount: 60 }];
    cb.trans = { id: 'circle', dur: 0.8 };
    cb.anim.in = { id: 'zoomIn', dur: 0.6 };
    ca.kf = { scale: [{ t: 0, v: 1, e: 'ease' }, { t: 3, v: 1.3, e: 'ease' }] };
    store.time = 0.5;
    const t = FC.newText({ s: { color: '#ffd400' } });
    t.text.content = 'FreeCut'; t.y = -300; t.anim.in = { id: 'pop', dur: 0.5 };
    store.time = 2;
    FC.addAtPlayhead(FC.makeClip('sticker', { sticker: '🔥', x: -600, y: 250 }));
    FC.commit('teste');
    return { tracks: store.project.tracks.map(t => t.kind + ':' + t.clips.length).join(' '), main: store.project.tracks.find(t => t.kind === 'main').clips.map(c => [c.start, c.dur]) };
  }, media.slice(0, 3).map(m => m.id));
  check(/main:2/.test(r.tracks) && Math.abs(r.main[1][0] - 6) < 0.01, 'faixa principal magnética: clipes em sequência ' + JSON.stringify(r.main));
  check((r.tracks.match(/visual/g) || []).length >= 2, 'sobreposições, texto e figurinha em faixas próprias: ' + r.tracks);

  // ---------- divisão, velocidade, desfazer ----------
  const sp = await ev(() => {
    const { store } = FC;
    const main = store.project.tracks.find(t => t.kind === 'main');
    const before = main.clips.length;
    FC.select(main.clips[1].id);
    store.time = 8;
    FC.splitAtPlayhead(); FC.commit('dividir');
    const after = main.clips.length;
    window.__undoOk = (() => { FC.store.emit; return true; })();
    return { before, after, inB: main.clips[2].in };
  });
  check(sp.after === sp.before + 1 && Math.abs(sp.inB - 2) < 0.01, `dividir no cursor (${sp.before}→${sp.after} clipes, ponto de entrada ${sp.inB.toFixed(2)}s)`);
  await win.keyboard.press('Control+Z');
  const undone = await ev(() => FC.store.project.tracks.find(t => t.kind === 'main').clips.length);
  check(undone === sp.before, 'desfazer (Ctrl+Z) volta a divisão');
  await win.keyboard.press('Control+Y');

  // ---------- prévia ----------
  await ev(async () => { FC.seek(6.1); await new Promise(r => setTimeout(r, 1200)); FC.drawPreview(); });
  await win.screenshot({ path: path.join(OUT, 'freecut-editor.png') });
  const px = await ev(() => {
    const c = document.querySelector('#preview');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0; for (let i = 0; i < d.length; i += 400) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return lit / (d.length / 400);
  });
  check(px > 0.3, `prévia renderiza quadros (${Math.round(px * 100)}% de pixels com imagem)`);

  // ---------- áudio processado ----------
  const afx = await ev(async f => {
    try { return await window.fc.invoke('media:process', { op: 'audiofx', file: f, fx: ['denoise', 'robo'] }); } catch (e) { return 'ERRO ' + e.message; }
  }, files[0]);
  check(/\.wav$/.test(afx), 'efeito de voz + redução de ruído (ffmpeg): ' + path.basename(afx));

  // ---------- texto para fala ----------
  const tts = await ev(async () => { try { return await window.fc.invoke('ai:tts', { text: 'Teste de voz do FreeCut.', voice: 'Microsoft Maria Desktop', rate: 0 }); } catch (e) { return 'ERRO ' + e.message; } });
  check(/\.wav$/.test(tts) && fs.existsSync(tts) && fs.statSync(tts).size > 20000, 'texto para fala (voz Maria pt-BR)');

  if (!quick) {
    // ---------- estabilização e reverso ----------
    const st = await ev(async f => { try { return await window.fc.invoke('media:process', { op: 'stabilize', file: f, start: 0, dur: 2 }); } catch (e) { return 'ERRO ' + e.message; } }, files[1]);
    check(/\.mp4$/.test(st), 'estabilização (vidstab 2 passes)');
    const rv = await ev(async f => { try { return await window.fc.invoke('media:process', { op: 'reverse', file: f, start: 0, dur: 2 }); } catch (e) { return 'ERRO ' + e.message; } }, files[0]);
    check(/\.mp4$/.test(rv), 'reverter clipe');

    // ---------- legendas automáticas ----------
    const t0 = Date.now();
    const caps = await ev(async mid => {
      const { store } = FC;
      const m = store.project.media[mid];
      const c = FC.insertMedia(m, 0, 'auto');
      const fala = FC.freeTrack('audio', 0, m.duration);
      void fala;
      const plan = FC.audioPlan([c.id]);
      const segs = await window.fc.invoke('ai:captions', { plan, lang: 'pt', model: 'turbo', maxLen: 36, taskId: 'x' });
      FC.addCaptions(segs);
      // remove o clipe de fala de novo para não poluir a exportação
      for (const t of store.project.tracks) t.clips = t.clips.filter(x => x.id !== c.id);
      store.project.tracks = store.project.tracks.filter(t => t.kind === 'main' || t.clips.length);
      FC.commit('limpar');
      return segs;
    }, media[3].id);
    const text = caps.map(s => s.text).join(' ');
    check(caps.length >= 2 && /FreeCut|Free Cut|legendas/i.test(text), `legendas por IA em ${((Date.now() - t0) / 1000).toFixed(1)}s: "${text}"`);
  }

  // ---------- exportação ----------
  const outFile = path.join(OUT, 'freecut-export.mp4');
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  const te = Date.now();
  const res = await ev(async f => { try { return await FC.exportVideo(f, 720, 30, 0.09, { quiet: true }); } catch (e) { return 'ERRO ' + e.message; } }, outFile);
  const secs = (Date.now() - te) / 1000;
  check(res === outFile && fs.existsSync(outFile), `exportação MP4 concluída em ${secs.toFixed(1)}s`);
  if (fs.existsSync(outFile)) {
    const info = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outFile]).toString());
    const v = info.streams.find(s => s.codec_type === 'video'), a = info.streams.find(s => s.codec_type === 'audio');
    const expected = await ev(() => { const d = []; for (const t of FC.store.project.tracks) for (const c of t.clips) d.push(c.start + c.dur); return Math.max(...d); });
    check(v && v.codec_name === 'h264' && v.width === 1280 && v.height === 720, `vídeo H.264 1280×720 (${v && v.codec_name} ${v && v.width}×${v && v.height})`);
    check(a && a.codec_name === 'aac', 'áudio AAC mixado');
    check(Math.abs(parseFloat(info.format.duration) - expected) < 0.2, `duração ${parseFloat(info.format.duration).toFixed(2)}s (esperado ${expected.toFixed(2)}s)`);
    execFileSync(path.join(ROOT, 'resources', 'bin', 'ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '6.2', '-i', outFile, '-frames:v', '1', path.join(OUT, 'quadro-exportado.png')]);
  }

  check(errors.length === 0, 'sem erros de JavaScript' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await win.screenshot({ path: path.join(OUT, 'freecut-final.png') });
  await app.evaluate(({ app }) => app.exit(0));
  console.log(fails ? `\n${fails} falha(s).` : '\nTodos os testes passaram.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
