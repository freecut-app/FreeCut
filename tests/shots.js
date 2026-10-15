// Capturas de tela de vários estados da interface (para revisão visual)
const { _electron: electron } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const MEDIA = path.join(__dirname, 'media');
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT], env: { ...process.env, FREECUT_TEST: '1' } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1600, 960); w.center(); });
  const ev = (fn, a) => win.evaluate(fn, a);
  for (let i = 0; i < 300 && !(await ev(() => !!(window.FC && window.FC.ready)).catch(() => false)); i++) await new Promise(r => setTimeout(r, 100));
  const shot = async (n, wait = 600) => { await new Promise(r => setTimeout(r, wait)); await win.screenshot({ path: path.join(OUT, n + '.png') }); };

  await ev(async f => {
    const ms = await FC.importPaths(f);
    const a = FC.insertMedia(ms[0], 0, 'main'); FC.insertMedia(ms[1], 1e9, 'main');
    a.filter = { id: 'warm', amount: 100 };
    FC.store.time = 1;
    const t = FC.newText(); t.text.content = 'Meu vídeo incrível'; t.y = -320;
    FC.store.time = 2.5;
    FC.addAtPlayhead(FC.makeClip('sticker', { sticker: '😎', x: 650, y: 280 }));
    FC.commit('x');
    FC.select(a.id);
    FC.seek(1.6);
  }, ['clipeA.mp4', 'clipeB.mp4'].map(f => path.join(MEDIA, f)));
  await shot('ui-1-video-selecionado', 1500);
  await win.click('.ins-tabs button:has-text("Ajustes")'); await shot('ui-2-ajustes');
  await win.click('.ins-tabs button:has-text("Velocidade")'); await win.click('.seg button:has-text("Curva")'); await shot('ui-3-curvas');
  await ev(() => { const t = FC.store.project.tracks.flatMap(x => x.clips).find(c => c.type === 'text'); FC.select(t.id); FC.seek(2); });
  await win.click('.ins-tabs button:has-text("Estilo")'); await shot('ui-4-texto-estilo');
  await win.click('[data-panel="effects"]'); await shot('ui-5-efeitos');
  await win.click('[data-panel="captions"]'); await shot('ui-6-legendas');
  await win.click('[data-panel="ai"]'); await shot('ui-7-ia');
  await ev(() => FC.select([]));
  await win.click('.export-btn'); await shot('ui-8-exportar');
  await win.keyboard.press('Escape');
  console.log(errors.length ? 'ERROS: ' + errors.join(' | ') : 'sem erros');
  await app.evaluate(({ app }) => app.exit(0));
})().catch(e => { console.error(e); process.exit(1); });
