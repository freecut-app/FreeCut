// Gera build/icon.ico (16–256 px, PNG) e build/icon.png (512) a partir de build/icon.svg
// Uso: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const w = new BrowserWindow({ show: false, width: 600, height: 600, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,<body style="margin:0;background:transparent"></body>');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const pngs = await w.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    await img.decode();
    const out = {};
    for (const s of ${JSON.stringify(sizes)}) {
      const c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL('image/png').split(',')[1];
    }
    return out;
  })()`);
  const buf = s => Buffer.from(pngs[s], 'base64');
  fs.writeFileSync(path.join(__dirname, 'icon.png'), buf(512));
  // ICO com imagens PNG embutidas
  const list = sizes.filter(s => s <= 256);
  const header = Buffer.alloc(6 + 16 * list.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(list.length, 4);
  let offset = header.length;
  const datas = list.map(buf);
  list.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);
    header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(datas[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += datas[i].length;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...datas]));
  console.log('ícones gerados');
  app.quit();
});
