// FreeCut — catálogo de recursos (tudo liberado, sem plano pago)

export const RATIOS = [
  { id: '16:9', name: 'Paisagem 16:9', w: 1920, h: 1080, hint: 'YouTube' },
  { id: '9:16', name: 'Vertical 9:16', w: 1080, h: 1920, hint: 'TikTok, Reels, Shorts' },
  { id: '1:1', name: 'Quadrado 1:1', w: 1080, h: 1080, hint: 'Feed' },
  { id: '4:5', name: 'Retrato 4:5', w: 1080, h: 1350, hint: 'Instagram' },
  { id: '4:3', name: 'Clássico 4:3', w: 1440, h: 1080, hint: 'TV' },
  { id: '3:4', name: 'Retrato 3:4', w: 1080, h: 1440, hint: '' },
  { id: '21:9', name: 'Cinema 21:9', w: 2560, h: 1080, hint: 'Ultrawide' }
];

export const ADJUST_KEYS = [
  ['brightness', 'Brilho', -100, 100], ['contrast', 'Contraste', -100, 100], ['saturation', 'Saturação', -100, 100],
  ['exposure', 'Exposição', -100, 100], ['temperature', 'Temperatura', -100, 100], ['tint', 'Matiz verde/rosa', -100, 100],
  ['hue', 'Tonalidade', -180, 180], ['highlights', 'Realces', -100, 100], ['shadows', 'Sombras', -100, 100],
  ['vibrance', 'Vibração', -100, 100], ['sharpen', 'Nitidez', 0, 100], ['vignette', 'Vinheta', 0, 100],
  ['fade', 'Esmaecer', 0, 100], ['grain', 'Granulado', 0, 100]
];

// sh/hi = tonalização de sombras e realces (r,g,b de -1 a 1)
export const FILTERS = [
  { id: 'none', name: 'Nenhum', a: {} },
  { id: 'vivid', name: 'Vívido', a: { saturation: 35, contrast: 15, vibrance: 25 } },
  { id: 'warm', name: 'Quente', a: { temperature: 35, saturation: 10 } },
  { id: 'cool', name: 'Frio', a: { temperature: -35, tint: -5 } },
  { id: 'cinema', name: 'Cinema', a: { contrast: 20, saturation: -10, sh: [-0.12, 0.05, 0.14], hi: [0.14, 0.05, -0.1] } },
  { id: 'retro', name: 'Retrô', a: { fade: 35, saturation: -20, temperature: 20, grain: 25, sh: [0.05, 0.02, -0.06] } },
  { id: 'sepia', name: 'Sépia', a: { saturation: -100, sh: [0.18, 0.08, -0.08], hi: [0.12, 0.05, -0.08] } },
  { id: 'bw', name: 'P&B', a: { saturation: -100, contrast: 10 } },
  { id: 'noir', name: 'Noir', a: { saturation: -100, contrast: 55, vignette: 50, brightness: -8 } },
  { id: 'faded', name: 'Desbotado', a: { fade: 45, contrast: -15, saturation: -25 } },
  { id: 'sunset', name: 'Pôr do sol', a: { temperature: 45, tint: 12, saturation: 20, hi: [0.15, 0.04, -0.06] } },
  { id: 'summer', name: 'Verão', a: { brightness: 10, saturation: 30, temperature: 18, vibrance: 20 } },
  { id: 'autumn', name: 'Outono', a: { temperature: 30, hue: -8, saturation: 15, sh: [0.08, 0.02, -0.06] } },
  { id: 'winter', name: 'Inverno', a: { temperature: -40, saturation: -20, brightness: 8, hi: [-0.04, 0.02, 0.1] } },
  { id: 'pastel', name: 'Pastel', a: { fade: 30, saturation: -15, brightness: 12, contrast: -20 } },
  { id: 'neon', name: 'Neon', a: { saturation: 60, contrast: 30, hue: 18, hi: [0.1, -0.05, 0.15] } },
  { id: 'kodak', name: 'Filme K', a: { contrast: 12, saturation: 15, temperature: 12, grain: 20, sh: [0.02, -0.02, 0.06] } },
  { id: 'fuji', name: 'Filme F', a: { contrast: 8, saturation: 10, tint: -10, sh: [-0.04, 0.05, 0.04], hi: [0.04, 0.02, -0.03] } },
  { id: 'polaroid', name: 'Polaroide', a: { fade: 25, temperature: 15, contrast: -10, vignette: 25, hi: [0.06, 0.06, 0] } },
  { id: 'lomo', name: 'Lomo', a: { contrast: 35, saturation: 35, vignette: 70 } },
  { id: 'drama', name: 'Dramático', a: { contrast: 45, highlights: -30, shadows: -20, saturation: -15, vignette: 35 } },
  { id: 'soft', name: 'Suave', a: { contrast: -18, brightness: 8, highlights: -15, fade: 10 } },
  { id: 'matte', name: 'Fosco', a: { fade: 40, contrast: 10, saturation: -10 } },
  { id: 'moody', name: 'Melancólico', a: { exposure: -15, saturation: -30, temperature: -15, sh: [-0.05, 0, 0.08] } },
  { id: 'rose', name: 'Rosado', a: { tint: 25, temperature: 10, hi: [0.1, 0, 0.06] } },
  { id: 'gold', name: 'Dourado', a: { temperature: 30, saturation: 10, hi: [0.14, 0.08, -0.1] } },
  { id: 'teal', name: 'Azul-petróleo', a: { sh: [-0.15, 0.06, 0.12], hi: [0.12, 0.04, -0.08], contrast: 15 } },
  { id: 'cyber', name: 'Cyberpunk', a: { hue: -25, saturation: 40, contrast: 25, sh: [0.1, -0.1, 0.2], hi: [0.15, -0.05, 0.2] } }
];

// gl: id numérico no shader; tr: efeito aplicado na transformação
export const EFFECTS = [
  { id: 'glitch', name: 'Glitch', gl: 1, ico: '▦' },
  { id: 'rgb', name: 'Divisão RGB', gl: 2, ico: '◐' },
  { id: 'vhs', name: 'VHS', gl: 3, ico: '📼' },
  { id: 'blur', name: 'Desfoque', gl: 4, ico: '◌' },
  { id: 'pixel', name: 'Pixelado', gl: 5, ico: '▩' },
  { id: 'mirror', name: 'Espelho', gl: 6, ico: '⇋' },
  { id: 'invert', name: 'Inverter', gl: 7, ico: '◑' },
  { id: 'flash', name: 'Flash', gl: 8, ico: '✦' },
  { id: 'scan', name: 'Linhas de TV', gl: 9, ico: '☰' },
  { id: 'kaleido', name: 'Caleidoscópio', gl: 10, ico: '❋' },
  { id: 'fisheye', name: 'Olho de peixe', gl: 11, ico: '◉' },
  { id: 'wave', name: 'Ondas', gl: 12, ico: '〰' },
  { id: 'sketch', name: 'Desenho', gl: 13, ico: '✎' },
  { id: 'poster', name: 'Pôster', gl: 14, ico: '▤' },
  { id: 'leak', name: 'Vazamento de luz', gl: 15, ico: '☀' },
  { id: 'strobe', name: 'Estroboscópio', gl: 16, ico: '⚡' },
  { id: 'dream', name: 'Sonho', gl: 17, ico: '☁' },
  { id: 'rain', name: 'Chuva', gl: 18, ico: '☔' },
  { id: 'split3', name: 'Tela tripla', gl: 19, ico: '▥' },
  { id: 'shake', name: 'Tremor', tr: 'shake', ico: '〜' },
  { id: 'zoompulse', name: 'Pulso de zoom', tr: 'zoompulse', ico: '⊕' },
  { id: 'heartbeat', name: 'Batimento', tr: 'heartbeat', ico: '♥' },
  { id: 'swing', name: 'Balanço', tr: 'swing', ico: '↺' }
];

export const TRANSITIONS = [
  { id: 'fade', name: 'Dissolver' }, { id: 'black', name: 'Fundo preto' }, { id: 'white', name: 'Flash branco' },
  { id: 'slideL', name: 'Deslizar ←' }, { id: 'slideR', name: 'Deslizar →' }, { id: 'slideU', name: 'Deslizar ↑' }, { id: 'slideD', name: 'Deslizar ↓' },
  { id: 'pushL', name: 'Empurrar ←' }, { id: 'pushR', name: 'Empurrar →' },
  { id: 'wipeL', name: 'Cortina ←' }, { id: 'wipeR', name: 'Cortina →' }, { id: 'wipeU', name: 'Cortina ↑' }, { id: 'wipeD', name: 'Cortina ↓' },
  { id: 'zoomIn', name: 'Zoom para dentro' }, { id: 'zoomOut', name: 'Zoom para fora' }, { id: 'spin', name: 'Girar' },
  { id: 'blur', name: 'Desfoque' }, { id: 'circle', name: 'Círculo' }, { id: 'doors', name: 'Portas' }, { id: 'clock', name: 'Relógio' },
  { id: 'glitch', name: 'Glitch' }, { id: 'stripes', name: 'Listras' }
];

export const ANIM_IN = [
  ['fade', 'Surgir'], ['zoomIn', 'Ampliar'], ['zoomOut', 'Reduzir'], ['slideL', 'Entrar ←'], ['slideR', 'Entrar →'],
  ['slideU', 'Subir'], ['slideD', 'Descer'], ['spin', 'Girar'], ['bounce', 'Quicar'], ['pop', 'Pop'], ['blur', 'Desfoque'],
  ['swing', 'Balançar'], ['typewriter', 'Máquina de escrever (texto)']
];
export const ANIM_OUT = [
  ['fade', 'Sumir'], ['zoomIn', 'Ampliar'], ['zoomOut', 'Reduzir'], ['slideL', 'Sair ←'], ['slideR', 'Sair →'],
  ['slideU', 'Subir'], ['slideD', 'Descer'], ['spin', 'Girar'], ['pop', 'Pop'], ['blur', 'Desfoque']
];
export const ANIM_LOOP = [
  ['pulse', 'Pulsar'], ['shake', 'Tremer'], ['wiggle', 'Mexer'], ['float', 'Flutuar'], ['rotate', 'Rodar'],
  ['flicker', 'Piscar'], ['heartbeat', 'Coração'], ['zoomSlow', 'Zoom lento (Ken Burns)']
];

export const SPEED_CURVES = [
  { id: 'montage', name: 'Montagem', pts: [1, 1, 3, 0.4, 0.4, 3, 1] },
  { id: 'hero', name: 'Herói', pts: [1, 3, 0.25, 0.25, 3, 1] },
  { id: 'bullet', name: 'Bala', pts: [2, 2, 0.2, 0.2, 2, 2] },
  { id: 'jump', name: 'Saltos', pts: [0.6, 3, 0.6, 3, 0.6, 3] },
  { id: 'flashIn', name: 'Flash de entrada', pts: [5, 3, 1, 0.6, 0.6] },
  { id: 'flashOut', name: 'Flash de saída', pts: [0.6, 0.6, 1, 3, 5] },
  { id: 'rampUp', name: 'Acelerar', pts: [0.4, 0.8, 1.6, 3] },
  { id: 'rampDown', name: 'Desacelerar', pts: [3, 1.6, 0.8, 0.4] }
];

export const VOICE_FX = [
  ['esquilo', 'Esquilo'], ['grave', 'Grave'], ['monstro', 'Monstro'], ['robo', 'Robô'], ['eco', 'Eco'],
  ['telefone', 'Telefone'], ['radio', 'Rádio antigo'], ['megafone', 'Megafone'], ['caverna', 'Caverna'],
  ['alien', 'Alienígena'], ['sussurro', 'Sussurro']
];

export const FONTS = ['Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free',
  'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black', 'Sitka Heading',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

export const TEXT_DEFAULT = {
  content: 'Seu texto aqui', font: 'Arial Black', size: 96, color: '#ffffff', bold: false, italic: false, underline: false,
  align: 'center', spacing: 0, lineHeight: 1.15, upper: false,
  stroke: { on: true, color: '#000000', width: 6 },
  shadow: { on: false, color: '#000000', blur: 12, x: 4, y: 4, opacity: 0.6 },
  bg: { on: false, color: '#000000', opacity: 0.6, radius: 16, pad: 24 },
  glow: { on: false, color: '#00e5ff', size: 24 },
  karaoke: { on: false, color: '#ffd400' }
};

export const TEXT_PRESETS = [
  { id: 'classic', name: 'Clássico', s: { font: 'Arial Black', color: '#ffffff', stroke: { on: true, color: '#000000', width: 6 } } },
  { id: 'caption', name: 'Legenda', s: { font: 'Segoe UI', bold: true, color: '#ffffff', stroke: { on: false }, bg: { on: true, color: '#000000', opacity: 0.55, radius: 10, pad: 18 } } },
  { id: 'yellow', name: 'Amarelo', s: { font: 'Arial Black', color: '#ffd400', stroke: { on: true, color: '#000000', width: 8 } } },
  { id: 'neon', name: 'Neon', s: { font: 'Segoe UI Black', color: '#e9fdff', stroke: { on: false }, glow: { on: true, color: '#00e5ff', size: 28 } } },
  { id: 'neonpink', name: 'Neon rosa', s: { font: 'Segoe UI Black', color: '#fff0fb', stroke: { on: false }, glow: { on: true, color: '#ff2bd6', size: 28 } } },
  { id: 'impact', name: 'Impacto', s: { font: 'Impact', upper: true, color: '#ffffff', stroke: { on: true, color: '#000000', width: 7 }, shadow: { on: true, color: '#000000', blur: 0, x: 6, y: 6, opacity: 1 } } },
  { id: 'elegant', name: 'Elegante', s: { font: 'Georgia', italic: true, color: '#fff8e7', stroke: { on: false }, shadow: { on: true, color: '#000000', blur: 18, x: 0, y: 4, opacity: 0.7 } } },
  { id: 'typewriter', name: 'Máquina', s: { font: 'Courier New', bold: true, color: '#111111', stroke: { on: false }, bg: { on: true, color: '#ffffff', opacity: 1, radius: 4, pad: 16 } } },
  { id: 'label', name: 'Etiqueta', s: { font: 'Bahnschrift', bold: true, color: '#111111', stroke: { on: false }, bg: { on: true, color: '#ffffff', opacity: 1, radius: 40, pad: 22 } } },
  { id: 'highlight', name: 'Destaque', s: { font: 'Arial Black', color: '#111111', stroke: { on: false }, bg: { on: true, color: '#ffd400', opacity: 1, radius: 6, pad: 16 } } },
  { id: 'fire', name: 'Fogo', s: { font: 'Impact', color: '#ffb000', stroke: { on: true, color: '#c41200', width: 8 }, glow: { on: true, color: '#ff5500', size: 22 } } },
  { id: 'ice', name: 'Gelo', s: { font: 'Segoe UI Black', color: '#dff7ff', stroke: { on: true, color: '#0077b6', width: 5 }, glow: { on: true, color: '#7fdcff', size: 18 } } },
  { id: 'cinema', name: 'Título de cinema', s: { font: 'Times New Roman', upper: true, spacing: 18, color: '#f5f5f5', stroke: { on: false }, shadow: { on: true, color: '#000000', blur: 20, x: 0, y: 0, opacity: 0.8 } } },
  { id: 'comic', name: 'Gibi', s: { font: 'Comic Sans MS', bold: true, color: '#ffffff', stroke: { on: true, color: '#1d3fff', width: 8 }, shadow: { on: true, color: '#000000', blur: 0, x: 5, y: 5, opacity: 1 } } },
  { id: 'red', name: 'Alerta', s: { font: 'Arial Black', upper: true, color: '#ffffff', stroke: { on: false }, bg: { on: true, color: '#e00000', opacity: 1, radius: 8, pad: 18 } } },
  { id: 'karaoke', name: 'Karaokê', s: { font: 'Arial Black', color: '#ffffff', stroke: { on: true, color: '#000000', width: 6 }, karaoke: { on: true, color: '#ffd400' } } }
];

export const STICKERS = {
  'Rostos': '😀 😂 🤣 😍 🥰 😎 🤩 🥳 😭 😱 🤯 😡 🤔 🙄 😴 🤫 🫠 🥺 😇 🤡 💀 👻 👽 🤖',
  'Gestos': '👍 👎 👏 🙌 🙏 💪 ✌️ 🤞 👌 🤙 👉 👈 👆 👇 ✋ 🫶 🤝 👀',
  'Símbolos': '❤️ 🧡 💛 💚 💙 💜 🖤 💔 💯 🔥 ✨ ⭐ 🌟 💥 💢 💫 ⚡ ✅ ❌ ❗ ❓ ⚠️ 🚫 🔴 🟢 🔵',
  'Objetos': '🎉 🎊 🎁 🎈 🏆 🥇 💰 💎 📱 💻 🎮 🎧 🎤 🎬 📸 🔔 📌 💡 🔑 ⏰ 🚀 💣',
  'Natureza': '🌈 ☀️ 🌙 ⛅ ❄️ 🌊 🌸 🌹 🌻 🍀 🌴 🐶 🐱 🦁 🐵 🦄 🐸 🦋',
  'Comida': '🍕 🍔 🍟 🌭 🍿 🍩 🍰 🍫 🍦 🍓 🍉 🍌 ☕ 🧃 🍺 🥂',
  'Setas': '⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ ↙️ ↖️ 🔄 🔁 ▶️ ⏸️ ⏩ ⏪'
};

// gerados por síntese de áudio, sem arquivos externos
export const SFX = [
  ['whoosh', 'Whoosh'], ['pop', 'Pop'], ['ding', 'Ding'], ['click', 'Clique'], ['boom', 'Explosão'],
  ['rise', 'Subida'], ['swipe', 'Deslize'], ['notify', 'Notificação'], ['camera', 'Câmera'], ['wrong', 'Erro'],
  ['coin', 'Moeda'], ['drum', 'Bumbo']
];

export const BLENDS = [
  ['normal', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Tela'], ['overlay', 'Sobrepor'], ['darken', 'Escurecer'],
  ['lighten', 'Clarear'], ['color-dodge', 'Subexpor cor'], ['color-burn', 'Superexpor cor'], ['hard-light', 'Luz forte'],
  ['soft-light', 'Luz suave'], ['difference', 'Diferença'], ['exclusion', 'Exclusão'], ['hue', 'Matiz'],
  ['saturation', 'Saturação'], ['color', 'Cor'], ['luminosity', 'Luminosidade']
];

export const MASKS = [['none', 'Nenhuma'], ['linear', 'Linear'], ['mirror', 'Espelho'], ['circle', 'Círculo'], ['rect', 'Retângulo'], ['heart', 'Coração'], ['star', 'Estrela']];

export const EXPORT_RES = [
  { id: '480', name: '480p', h: 480 }, { id: '720', name: '720p', h: 720 }, { id: '1080', name: '1080p (Full HD)', h: 1080 },
  { id: '1440', name: '2K', h: 1440 }, { id: '2160', name: '4K', h: 2160 }
];
