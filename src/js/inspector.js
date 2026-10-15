// FreeCut — painel de propriedades
import {
  store, selected, clipById, trackOf, mediaOf, commit, kfValue, setKeyframe, hasKeyframeAt, removeKeyframe, setSpeed, srcLen,
  clipEnd, prevAdjacent, splitClip, makeClip, insertClip, compactMain, sortTracks, mainTrack, select
} from './store.js';
import {
  ADJUST_KEYS, FILTERS, EFFECTS, ANIM_IN, ANIM_OUT, ANIM_LOOP, SPEED_CURVES, VOICE_FX, FONTS, TEXT_PRESETS, BLENDS, MASKS,
  TRANSITIONS, RATIOS, TEXT_DEFAULT
} from './catalog.js';
import { requestRender, seek, snapshotPNG, resizePreview } from './engine.js';
import { importPaths } from './media.js';
import { $, el, clamp, deep, toast, fmtSec, progressBox } from './util.js';

const fc = window.fc;
let root, tab = {}, selfEdit = false, liveUpdaters = [];
const TABS = {
  video: ['Básico', 'Ajustes', 'Filtros', 'Efeitos', 'Animação', 'Velocidade', 'Áudio', 'Recursos'],
  image: ['Básico', 'Ajustes', 'Filtros', 'Efeitos', 'Animação', 'Recursos'],
  text: ['Texto', 'Estilo', 'Básico', 'Animação'],
  sticker: ['Básico', 'Animação'],
  audio: ['Áudio', 'Velocidade'],
  fx: ['Ajustes', 'Filtros', 'Efeitos']
};
const TYPE_NAME = { video: 'Vídeo', image: 'Imagem', text: 'Texto', sticker: 'Figurinha', audio: 'Áudio', fx: 'Camada de ajuste' };

export function initInspector() {
  root = $('#inspector');
  store.on('select', render);
  store.on('change', () => { if (!selfEdit) render(); });
  store.on('time', () => liveUpdaters.forEach(f => f()));
  render();
}

/* ---------------- edição ---------------- */
const live = () => { requestRender(); };
function done(label) { selfEdit = true; commit(label); selfEdit = false; }

/* ---------------- controles ---------------- */
function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.');
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]] = cur[ks[i]] || {};
  cur[ks[ks.length - 1]] = v;
}

/**
 * Controle deslizante. prop = caminho no clipe ('x', 'adjust.brightness', 'text.size'...).
 * kf = nome do keyframe (normalmente igual a prop) quando a propriedade aceita animação.
 */
function slider(c, label, prop, { min = 0, max = 100, step = 1, kf = null, scale = 1, unit = '', def = 0, onSet = null } = {}) {
  const read = () => {
    const base = getPath(c, prop) ?? def;
    return (kf ? kfValue(c, kf, base, store.time) : base) * scale;
  };
  const range = el('input', { type: 'range', min, max, step });
  const num = el('input', { type: 'number', min, max, step });
  const kbtn = kf ? el('button', { class: 'kf', title: 'Keyframe (◆) no tempo atual' }, '◆') : null;
  const show = () => {
    const v = read();
    range.value = v; if (document.activeElement !== num) num.value = Math.round(v * 100) / 100;
    if (kbtn) {
      const inRange = store.time >= c.start - 1e-6 && store.time <= clipEnd(c) + 1e-6;
      kbtn.className = 'kf' + (hasKeyframeAt(c, kf, store.time) ? ' on' : c.kf && c.kf[kf] ? ' has' : '');
      kbtn.disabled = !inRange;
    }
  };
  const write = (v, final) => {
    v = clamp(parseFloat(v), min, max) / scale;
    if (isNaN(v)) return;
    if (kf && c.kf && c.kf[kf] && c.kf[kf].length) {
      if (store.time >= c.start && store.time <= clipEnd(c)) setKeyframe(c, kf, v, store.time);
    } else setPath(c, prop, v);
    if (onSet) onSet(v);
    live();
    if (final) { done('ajuste'); show(); } else if (document.activeElement === range) num.value = Math.round(v * scale * 100) / 100;
  };
  range.addEventListener('input', () => write(range.value, false));
  range.addEventListener('change', () => write(range.value, true));
  num.addEventListener('change', () => write(num.value, true));
  range.addEventListener('dblclick', () => write(def * scale, true));
  if (kbtn) kbtn.addEventListener('click', () => {
    if (hasKeyframeAt(c, kf, store.time)) removeKeyframe(c, kf, store.time);
    else setKeyframe(c, kf, read() / scale, store.time);
    done('keyframe'); show(); store.emit('change');
  });
  show();
  if (kf) liveUpdaters.push(show);
  return el('div', { class: 'row' }, el('label', { title: label }, label), range, num, unit ? el('span', { style: { color: 'var(--dim)', width: '14px' } }, unit) : null, kbtn);
}

function toggle(label, get, set) {
  const i = el('input', { type: 'checkbox' });
  i.checked = !!get();
  i.addEventListener('change', () => { set(i.checked); live(); done('opção'); });
  return el('div', { class: 'row' }, el('label', {}, label), el('span', { class: 'grow' }), el('label', { class: 'switch' }, i, el('i')));
}
function selectRow(label, options, get, set) {
  const s = el('select', {}, options.map(([v, n]) => el('option', { value: v }, n)));
  s.value = get();
  s.addEventListener('change', () => { set(s.value); live(); done('opção'); });
  return el('div', { class: 'row' }, el('label', {}, label), s);
}
function colorRow(label, get, set) {
  const i = el('input', { type: 'color', value: get() });
  i.addEventListener('input', () => { set(i.value); live(); });
  i.addEventListener('change', () => done('cor'));
  return el('div', { class: 'row' }, el('label', {}, label), i, el('span', { class: 'grow' }));
}
function segRow(label, options, get, set) {
  const box = el('div', { class: 'seg' });
  const draw = () => {
    box.textContent = '';
    for (const [v, n] of options) box.append(el('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); live(); done('opção'); draw(); } }, n));
  };
  draw();
  return el('div', { class: 'row' }, label ? el('label', {}, label) : null, box);
}
const sec = (title, ...kids) => el('div', { class: 'sec' }, el('div', { class: 'sec-t' }, title), ...kids);
const btn = (label, fn, cls = 'btn sm') => el('button', { class: cls, onclick: fn }, label);

/* ---------------- render ---------------- */
function render() {
  if (!root || !store.project) return;
  liveUpdaters = [];
  root.textContent = '';
  if (store.selTrans) { const c = clipById(store.selTrans); if (c) return renderTransition(c); }
  const sel = selected();
  if (sel.length > 1) {
    root.append(el('div', { class: 'ins-head' }, el('h3', {}, `${sel.length} clipes selecionados`)),
      el('div', { class: 'ins-body' }, el('p', { class: 'empty-ins' }, 'Use Delete para excluir, Ctrl+D para duplicar ou arraste para mover todos juntos.')));
    return;
  }
  if (!sel.length) return renderProject();
  const c = sel[0];
  const tabs = TABS[c.type] || ['Básico'];
  const cur = tabs.includes(tab[c.type]) ? tab[c.type] : tabs[0];
  const head = el('div', { class: 'ins-head' },
    el('h3', {}, TYPE_NAME[c.type] || 'Clipe', el('span', { style: { color: 'var(--dim)', fontWeight: 400, fontSize: '12px' } }, ' · ' + fmtSec(c.dur))),
    el('div', { class: 'ins-tabs' }, tabs.map(t => el('button', { class: t === cur ? 'on' : '', onclick: () => { tab[c.type] = t; render(); } }, t))));
  const body = el('div', { class: 'ins-body' });
  const fn = PANELS[cur];
  if (fn) fn(c, body);
  root.append(head, body);
}

const PANELS = {
  'Básico': (c, b) => {
    b.append(sec('Posição e tamanho',
      slider(c, 'Posição X', 'x', { min: -4000, max: 4000, kf: 'x' }),
      slider(c, 'Posição Y', 'y', { min: -4000, max: 4000, kf: 'y' }),
      slider(c, 'Escala', 'scale', { min: 1, max: 500, scale: 100, kf: 'scale', unit: '%', def: 1 }),
      slider(c, 'Rotação', 'rot', { min: -360, max: 360, kf: 'rot', unit: '°' }),
      slider(c, 'Opacidade', 'opacity', { min: 0, max: 100, scale: 100, kf: 'opacity', unit: '%', def: 1 }),
      el('div', { class: 'row' }, el('label', {}, 'Espelhar'),
        btn('↔ Horizontal', () => { c.flipH = !c.flipH; live(); done('espelhar'); }),
        btn('↕ Vertical', () => { c.flipV = !c.flipV; live(); done('espelhar'); }))));
    if (c.type === 'video' || c.type === 'image') {
      b.append(sec('Enquadramento',
        segRow('Modo', [['contain', 'Ajustar'], ['cover', 'Preencher']], () => c.fit || 'contain', v => { c.fit = v; }),
        slider(c, 'Corte esq.', 'crop.l', { min: 0, max: 90, scale: 100, unit: '%' }),
        slider(c, 'Corte dir.', 'crop.r', { min: 0, max: 90, scale: 100, unit: '%' }),
        slider(c, 'Corte sup.', 'crop.t', { min: 0, max: 90, scale: 100, unit: '%' }),
        slider(c, 'Corte inf.', 'crop.b', { min: 0, max: 90, scale: 100, unit: '%' })));
    }
    b.append(sec('Mesclagem', selectRow('Modo', BLENDS, () => c.blend || 'normal', v => { c.blend = v; })));
    b.append(el('div', { class: 'row' },
      btn('Redefinir transformação', () => { Object.assign(c, { x: 0, y: 0, scale: c.type === 'sticker' ? 0.6 : 1, rot: 0, opacity: 1, flipH: false, flipV: false, crop: { l: 0, t: 0, r: 0, b: 0 } }); for (const k of ['x', 'y', 'scale', 'rot', 'opacity']) if (c.kf) delete c.kf[k]; live(); done('redefinir'); render(); }),
      c.kf && Object.keys(c.kf).length ? btn('Limpar keyframes', () => { c.kf = {}; live(); done('keyframes'); render(); }) : null));
  },

  'Ajustes': (c, b) => {
    b.append(sec('Ajustes de cor', ...ADJUST_KEYS.map(([k, n, min, max]) => slider(c, n, 'adjust.' + k, { min, max, kf: 'adjust.' + k }))));
    b.append(btn('Redefinir ajustes', () => { c.adjust = {}; if (c.kf) for (const k of Object.keys(c.kf)) if (k.startsWith('adjust.')) delete c.kf[k]; live(); done('ajustes'); render(); }));
  },

  'Filtros': (c, b) => {
    const grid = el('div', { class: 'tiles' });
    for (const f of FILTERS) {
      grid.append(el('div', { class: 'tile' + ((c.filter || {}).id === f.id ? ' on' : ''), onclick: () => { c.filter = { id: f.id, amount: (c.filter && c.filter.amount) || 100 }; live(); done('filtro'); render(); } },
        el('div', { class: 'sw', style: { filter: previewCss(f.a) } }, '🏞'), f.name));
    }
    b.append(sec('Filtros', grid));
    if (c.filter && c.filter.id !== 'none') b.append(sec('Intensidade', slider(c, 'Intensidade', 'filter.amount', { min: 0, max: 100, def: 100 })));
  },

  'Efeitos': (c, b) => {
    c.effects = c.effects || [];
    const list = el('div');
    for (const e of c.effects) {
      const def = EFFECTS.find(x => x.id === e.id);
      if (!def) continue;
      const r = el('input', { type: 'range', min: 0, max: 100, value: e.amount ?? 60 });
      r.addEventListener('input', () => { e.amount = +r.value; live(); });
      r.addEventListener('change', () => done('efeito'));
      list.append(el('div', { class: 'fx-item' }, el('span', {}, def.ico), el('b', {}, def.name), r,
        el('button', { class: 'icon-btn', title: 'Remover', onclick: () => { c.effects = c.effects.filter(x => x !== e); live(); done('efeito'); render(); } }, '×')));
    }
    if (!c.effects.length) list.append(el('p', { class: 'note', style: { color: 'var(--muted)' } }, 'Nenhum efeito. Escolha abaixo (pode combinar vários).'));
    b.append(sec('Aplicados', list));
    const grid = el('div', { class: 'tiles' });
    for (const e of EFFECTS) grid.append(el('div', { class: 'tile', onclick: () => { c.effects.push({ id: e.id, amount: 60 }); live(); done('efeito'); render(); } }, el('div', { class: 'sw' }, e.ico), e.name));
    b.append(sec('Adicionar efeito', grid));
  },

  'Animação': (c, b) => {
    c.anim = c.anim || { in: null, out: null, loop: null };
    const which = tab.anim || 'in';
    b.append(segRow('', [['in', 'Entrada'], ['out', 'Saída'], ['loop', 'Contínua']], () => which, v => { tab.anim = v; render(); }));
    const list = which === 'in' ? ANIM_IN : which === 'out' ? ANIM_OUT : ANIM_LOOP;
    const cur = c.anim[which];
    const grid = el('div', { class: 'tiles' });
    grid.append(el('div', { class: 'tile' + (!cur ? ' on' : ''), onclick: () => { c.anim[which] = null; live(); done('animação'); render(); } }, el('div', { class: 'sw' }, '∅'), 'Nenhuma'));
    for (const [id, name] of list) {
      if (id === 'typewriter' && c.type !== 'text') continue;
      grid.append(el('div', {
        class: 'tile' + (cur && cur.id === id ? ' on' : ''), onclick: () => {
          c.anim[which] = which === 'loop' ? { id, speed: 1 } : { id, dur: Math.min(id === 'typewriter' ? 1.5 : 0.6, c.dur / 2) };
          live(); done('animação'); render();
          seek(which === 'out' ? Math.max(c.start, clipEnd(c) - c.anim[which].dur - 0.1) : c.start);
        }
      }, el('div', { class: 'sw' }, '➚'), name));
    }
    b.append(sec(which === 'in' ? 'Animação de entrada' : which === 'out' ? 'Animação de saída' : 'Animação contínua', grid));
    if (cur) {
      b.append(which === 'loop'
        ? slider(c, 'Velocidade', `anim.loop.speed`, { min: 0.1, max: 5, step: 0.1, def: 1 })
        : slider(c, 'Duração', `anim.${which}.dur`, { min: 0.1, max: Math.max(0.2, c.dur), step: 0.05, unit: 's', def: 0.5 }));
    }
  },

  'Velocidade': (c, b) => {
    const mode = c.curve ? 'curve' : 'normal';
    b.append(segRow('', [['normal', 'Normal'], ['curve', 'Curva']], () => mode, v => { if (v === 'normal') c.curve = null; else c.curve = c.curve || 'montage'; render(); }));
    if (mode === 'normal') {
      const lab = el('div', { class: 'note', style: { color: 'var(--muted)', fontSize: '12px' } });
      const upd = () => { lab.textContent = `Duração: ${fmtSec(c.dur)} · Velocidade: ${(Math.round(c.speed * 100) / 100).toString().replace('.', ',')}x`; };
      const r = el('input', { type: 'range', min: -100, max: 200, step: 1, value: Math.round(Math.log10(c.speed) * 100) });
      r.addEventListener('input', () => { setSpeed(c, Math.pow(10, r.value / 100)); upd(); live(); store.emit('change'); });
      r.addEventListener('change', () => done('velocidade'));
      b.append(sec('Velocidade (0,1x a 100x)', el('div', { class: 'row' }, r), lab,
        el('div', { class: 'chips' }, [0.25, 0.5, 1, 1.5, 2, 3, 5, 10].map(v => el('button', { class: 'chip' + (Math.abs(c.speed - v) < 1e-3 ? ' on' : ''), onclick: () => { setSpeed(c, v); live(); done('velocidade'); render(); } }, String(v).replace('.', ',') + 'x')))));
      upd();
      if (c.type !== 'image') b.append(toggle('Alterar tom com a velocidade', () => c.pitch, v => { c.pitch = v; }));
    } else {
      const grid = el('div', { class: 'tiles' });
      for (const cv of SPEED_CURVES) grid.append(el('div', { class: 'tile' + (c.curve === cv.id ? ' on' : ''), onclick: () => { c.curve = cv.id; live(); done('curva'); render(); } },
        curveSvg(cv.pts), cv.name));
      b.append(sec('Curvas de velocidade', grid), el('p', { class: 'note', style: { color: 'var(--muted)', fontSize: '12px' } }, 'A curva redistribui a velocidade dentro do clipe mantendo a duração. O áudio do clipe fica mudo durante a curva.'));
    }
  },

  'Áudio': (c, b) => {
    b.append(sec('Volume',
      slider(c, 'Volume', 'volume', { min: 0, max: 500, scale: 100, kf: 'volume', unit: '%', def: 1 }),
      slider(c, 'Fade in', 'fadeIn', { min: 0, max: Math.min(10, c.dur / 2), step: 0.1, unit: 's' }),
      slider(c, 'Fade out', 'fadeOut', { min: 0, max: Math.min(10, c.dur / 2), step: 0.1, unit: 's' }),
      toggle('Silenciar clipe', () => c.muted, v => { c.muted = v; })));
    const fxState = el('div', { class: 'note', style: { color: 'var(--muted)', fontSize: '12px' } }, c.audioPath ? '✓ Áudio processado em uso' : '');
    const has = id => (c.voiceFx || []).includes(id);
    b.append(sec('Aprimorar (IA)',
      toggle('Redução de ruído', () => has('denoise'), v => setFx(c, 'denoise', v, fxState)),
      toggle('Normalizar volume', () => has('normalize'), v => setFx(c, 'normalize', v, fxState)), fxState));
    const voice = (c.voiceFx || []).find(f => VOICE_FX.some(([id]) => id === f));
    b.append(sec('Mudança de voz', el('div', { class: 'chips' },
      el('button', { class: 'chip' + (!voice ? ' on' : ''), onclick: () => setVoice(c, null, fxState) }, 'Nenhuma'),
      VOICE_FX.map(([id, n]) => el('button', { class: 'chip' + (voice === id ? ' on' : ''), onclick: () => setVoice(c, id, fxState) }, n)))));
    if (c.type === 'audio' || (mediaOf(c) && mediaOf(c).hasAudio)) b.append(sec('Ritmo', btn('♪ Detectar batidas (marcadores)', () => detectBeats(c))));
  },

  'Recursos': (c, b) => {
    b.append(sec('Remover fundo (IA)',
      toggle('Remover fundo automaticamente', () => c.bgRemove, v => { c.bgRemove = v; if (v) toast('Carregando IA de segmentação (pessoas)...'); }),
      el('p', { class: 'note', style: { color: 'var(--muted)', fontSize: '12px', margin: '0' } }, 'Detecta pessoas e remove o fundo, quadro a quadro, na sua GPU.')));
    const ck = c.chroma;
    b.append(sec('Chroma key (tela verde)',
      toggle('Ativar chroma key', () => ck.on, v => { ck.on = v; }),
      colorRow('Cor', () => ck.color, v => { ck.color = v; }),
      el('div', { class: 'row' }, el('label', {}, ''), btn('💧 Conta-gotas no player', () => store.emit('eyedropper', col => { ck.color = col; ck.on = true; live(); done('chroma'); render(); }))),
      slider(c, 'Intensidade', 'chroma.sim', { min: 0, max: 100, def: 40 }),
      slider(c, 'Suavizar', 'chroma.smooth', { min: 0, max: 100, def: 10 }),
      slider(c, 'Remover reflexo', 'chroma.spill', { min: 0, max: 100, def: 50 })));
    const m = c.mask;
    b.append(sec('Máscara',
      el('div', { class: 'chips' }, MASKS.map(([id, n]) => el('button', { class: 'chip' + (m.type === id ? ' on' : ''), onclick: () => { m.type = id; live(); done('máscara'); render(); } }, n))),
      m.type !== 'none' ? el('div', { style: { marginTop: '10px' } },
        slider(c, 'Centro X', 'mask.x', { min: -100, max: 100, scale: 100 }), slider(c, 'Centro Y', 'mask.y', { min: -100, max: 100, scale: 100 }),
        slider(c, 'Largura', 'mask.w', { min: 1, max: 200, scale: 100 }), slider(c, 'Altura', 'mask.h', { min: 1, max: 200, scale: 100 }),
        slider(c, 'Rotação', 'mask.rot', { min: -180, max: 180 }), slider(c, 'Suavizar borda', 'mask.feather', { min: 0, max: 100 }),
        toggle('Inverter máscara', () => m.invert, v => { m.invert = v; })) : null));
    const tools = el('div', { class: 'chips' });
    if (c.type === 'video') {
      tools.append(btn('🛠 Estabilizar', () => processClip(c, 'stabilize')), btn('⇆ Reverter', () => processClip(c, 'reverse')),
        btn('🔊 Extrair áudio', () => extractAudio(c)));
    }
    tools.append(btn('❄ Congelar quadro', () => freezeFrame(c)));
    b.append(sec('Ferramentas', tools));
  },

  'Texto': (c, b) => {
    const T = c.text;
    const ta = el('textarea', { class: 'text-edit', spellcheck: 'true' });
    ta.value = T.content;
    ta.addEventListener('input', () => { T.content = ta.value || ' '; live(); store.emit('textEdit'); });
    ta.addEventListener('change', () => done('texto'));
    b.append(sec('Conteúdo', ta));
    b.append(sec('Fonte',
      selectRow('Fonte', FONTS.map(f => [f, f]), () => T.font, v => { T.font = v; }),
      slider(c, 'Tamanho', 'text.size', { min: 8, max: 600, def: 96 }),
      colorRow('Cor', () => T.color, v => { T.color = v; }),
      el('div', { class: 'row' }, el('label', {}, 'Estilo'), el('div', { class: 'chips' },
        ...[['bold', 'N'], ['italic', 'I'], ['underline', 'S'], ['upper', 'AA']].map(([k, n]) =>
          el('button', { class: 'chip' + (T[k] ? ' on' : ''), style: k === 'bold' ? { fontWeight: 800 } : k === 'italic' ? { fontStyle: 'italic' } : {}, onclick: () => { T[k] = !T[k]; live(); done('estilo'); render(); } }, n)))),
      segRow('Alinhar', [['left', 'Esq.'], ['center', 'Centro'], ['right', 'Dir.']], () => T.align, v => { T.align = v; }),
      slider(c, 'Espaçamento', 'text.spacing', { min: -10, max: 80 }),
      slider(c, 'Entre linhas', 'text.lineHeight', { min: 0.6, max: 3, step: 0.05, def: 1.15 })));
    b.append(el('div', { class: 'row' }, btn('Aplicar este estilo a todas as legendas', () => {
      let n = 0;
      for (const tr of store.project.tracks) for (const x of tr.clips) if (x.type === 'text' && x !== c && x.caption) { const content = x.text.content; x.text = deep(T); x.text.content = content; x.y = c.y; x.x = c.x; x.scale = c.scale; n++; }
      live(); done('estilo'); toast(n + ' legendas atualizadas', 'ok');
    })));
  },

  'Estilo': (c, b) => {
    const T = c.text;
    const grid = el('div', { class: 'tiles' });
    for (const p of TEXT_PRESETS) {
      const s = p.s;
      grid.append(el('div', {
        class: 'tile', onclick: () => { const content = T.content; const size = T.size; c.text = Object.assign(deep(TEXT_DEFAULT), deep(s)); c.text.content = content; c.text.size = size; live(); done('estilo'); render(); }
      }, el('div', {
        class: 'tx', style: {
          fontFamily: s.font, color: s.color, fontStyle: s.italic ? 'italic' : '',
          WebkitTextStroke: s.stroke && s.stroke.on ? `1px ${s.stroke.color}` : '', background: s.bg && s.bg.on ? s.bg.color : '#0b0d11',
          textShadow: s.glow && s.glow.on ? `0 0 8px ${s.glow.color}` : ''
        }
      }, 'Aa'), p.name));
    }
    b.append(sec('Estilos prontos', grid));
    b.append(sec('Contorno', toggle('Ativar', () => T.stroke.on, v => { T.stroke.on = v; }), colorRow('Cor', () => T.stroke.color, v => { T.stroke.color = v; }), slider(c, 'Espessura', 'text.stroke.width', { min: 0, max: 40 })));
    b.append(sec('Sombra', toggle('Ativar', () => T.shadow.on, v => { T.shadow.on = v; }), colorRow('Cor', () => T.shadow.color, v => { T.shadow.color = v; }),
      slider(c, 'Desfoque', 'text.shadow.blur', { min: 0, max: 80 }), slider(c, 'Distância X', 'text.shadow.x', { min: -60, max: 60 }),
      slider(c, 'Distância Y', 'text.shadow.y', { min: -60, max: 60 }), slider(c, 'Opacidade', 'text.shadow.opacity', { min: 0, max: 100, scale: 100 })));
    b.append(sec('Fundo', toggle('Ativar', () => T.bg.on, v => { T.bg.on = v; }), colorRow('Cor', () => T.bg.color, v => { T.bg.color = v; }),
      slider(c, 'Opacidade', 'text.bg.opacity', { min: 0, max: 100, scale: 100 }), slider(c, 'Arredondar', 'text.bg.radius', { min: 0, max: 100 }),
      slider(c, 'Margem', 'text.bg.pad', { min: 0, max: 100 })));
    b.append(sec('Brilho (neon)', toggle('Ativar', () => T.glow.on, v => { T.glow.on = v; }), colorRow('Cor', () => T.glow.color, v => { T.glow.color = v; }), slider(c, 'Tamanho', 'text.glow.size', { min: 0, max: 100 })));
    b.append(sec('Karaokê', toggle('Destacar progressivamente', () => T.karaoke.on, v => { T.karaoke.on = v; }), colorRow('Cor de destaque', () => T.karaoke.color, v => { T.karaoke.color = v; })));
  }
};

function previewCss(a) {
  const f = [];
  if (a.brightness) f.push(`brightness(${1 + a.brightness / 150})`);
  if (a.contrast) f.push(`contrast(${1 + a.contrast / 100})`);
  if (a.saturation) f.push(`saturate(${Math.max(0, 1 + a.saturation / 100)})`);
  if (a.hue) f.push(`hue-rotate(${a.hue}deg)`);
  if (a.temperature > 0) f.push(`sepia(${a.temperature / 150})`);
  if (a.fade) f.push(`opacity(${1 - a.fade / 300})`);
  return f.join(' ') || 'none';
}
function curveSvg(pts) {
  const max = Math.max(...pts) * 1.1;
  const d = pts.map((v, i) => `${(i / (pts.length - 1) * 100).toFixed(1)},${(40 - v / max * 36).toFixed(1)}`).join(' ');
  const s = el('div', { class: 'sw', html: `<svg viewBox="0 0 100 40" width="100%" height="100%" preserveAspectRatio="none"><polyline points="${d}" fill="none" stroke="#ffb23d" stroke-width="2.5"/></svg>` });
  return s;
}

/* ---------------- processamento de áudio ---------------- */
async function runAudioFx(c, note) {
  const m = mediaOf(c);
  if (!c.voiceFx.length) { c.audioPath = null; live(); done('voz'); return; }
  if (note) note.textContent = '⏳ Processando áudio...';
  try {
    c.audioPath = await fc.invoke('media:process', { op: 'audiofx', file: m.path, fx: c.voiceFx, mediaDuration: m.duration });
    done('voz');
    toast('Áudio processado', 'ok');
  } catch (e) { toast('Falha no processamento: ' + e.message, 'bad', 6000); if (note) note.textContent = ''; }
  requestRender();
}
function setFx(c, id, on, note) {
  c.voiceFx = (c.voiceFx || []).filter(x => x !== id);
  if (on) c.voiceFx.unshift(id);
  runAudioFx(c, note);
}
function setVoice(c, id, note) {
  c.voiceFx = (c.voiceFx || []).filter(x => !VOICE_FX.some(([v]) => v === x));
  if (id) c.voiceFx.push(id);
  runAudioFx(c, note).then(render);
}

/* ---------------- ferramentas de vídeo ---------------- */
async function processClip(c, op) {
  if (op === 'reverse' && c.reversed) {
    c.mediaId = c.origMedia; c.in = c.origIn; c.reversed = false;
    done('reverter'); toast('Clipe voltou ao sentido normal', 'ok'); requestRender(); return;
  }
  const m = mediaOf(c);
  const len = srcLen(c);
  if (op === 'reverse' && len > 180) { toast('Reverter funciona em trechos de até 3 minutos. Divida o clipe antes.', 'bad', 5000); return; }
  const pb = progressBox(op === 'reverse' ? 'Revertendo clipe' : 'Estabilizando vídeo');
  const id = 'p' + Date.now();
  const off = fc.on('task:progress', d => { if (d.id === id) pb.set(d.pct, d.label || `${Math.round(d.pct * 100)}%`); });
  pb.onCancel = () => fc.invoke('task:cancel');
  try {
    const out = await fc.invoke('media:process', { op, file: m.path, start: c.in, dur: len, taskId: id });
    const [nm] = await importPaths([out], { silent: true });
    nm.name = (op === 'reverse' ? 'Revertido · ' : 'Estabilizado · ') + m.name;
    if (op === 'reverse') { c.origMedia = c.mediaId; c.origIn = c.in; c.reversed = true; }
    c.mediaId = nm.id; c.in = 0;
    done(op);
    toast(op === 'reverse' ? 'Clipe revertido' : 'Vídeo estabilizado', 'ok');
  } catch (e) { toast('Falhou: ' + e.message, 'bad', 6000); }
  finally { off(); pb.close(); requestRender(); }
}

function extractAudio(c) {
  const a = makeClip('audio', { mediaId: c.mediaId, start: c.start, dur: c.dur, in: c.in, speed: c.speed, volume: c.volume || 1, fadeIn: c.fadeIn, fadeOut: c.fadeOut, name: 'Áudio · ' + (mediaOf(c) || {}).name, audioPath: c.audioPath, voiceFx: deep(c.voiceFx || []) });
  insertClip(a, 'audio');
  c.volume = 0; c.audioPath = null;
  done('extrair áudio');
  toast('Áudio separado em uma faixa própria', 'ok');
}

async function freezeFrame(c) {
  const t = clamp(store.time, c.start, clipEnd(c) - 0.01);
  const blob = await snapshotPNG(t);
  const p = await fc.invoke('fs:writeCache', `congelado-${Date.now()}.png`, new Uint8Array(await blob.arrayBuffer()));
  const [m] = await importPaths([p], { silent: true });
  m.name = 'Quadro congelado';
  const tr = trackOf(c.id);
  const right = t > c.start + 0.01 ? splitClip(c, t) : c;
  const img = makeClip('image', { mediaId: m.id, start: t, dur: 3, name: m.name });
  // o quadro já contém todos os efeitos, então a imagem entra limpa
  if (tr.kind === 'main') { tr.clips.splice(tr.clips.indexOf(right), 0, img); for (const x of tr.clips) if (x !== img && x.start >= t - 1e-6) x.start += 3; compactMain(); }
  else { for (const x of tr.clips) if (x.start >= t - 1e-6) x.start += 3; tr.clips.push(img); }
  sortTracks();
  select(img.id);
  done('congelar');
  toast('Quadro congelado por 3 s', 'ok');
}

function detectBeats(c) {
  const m = mediaOf(c);
  const peaks = m && store.cache[m.id] && store.cache[m.id].peaks;
  if (!peaks) { toast('Ainda analisando o áudio, tente em instantes.'); return; }
  const s0 = Math.floor(c.in * 100), s1 = Math.min(peaks.length, Math.ceil((c.in + srcLen(c)) * 100));
  const found = [];
  let last = -1e9;
  for (let i = s0 + 8; i < s1; i++) {
    let avg = 0;
    for (let j = i - 8; j < i; j++) avg += peaks[j];
    avg /= 8;
    const v = peaks[i];
    if (v > 0.25 && v > avg * 1.6 && v >= (peaks[i + 1] || 0) && i - last > 28) {
      found.push(c.start + (i / 100 - c.in) / c.speed);
      last = i;
    }
  }
  const set = new Set(store.project.markers.map(x => x.toFixed(2)));
  for (const t of found) if (!set.has(t.toFixed(2))) store.project.markers.push(t);
  store.project.markers.sort((a, b) => a - b);
  done('batidas');
  toast(found.length ? `${found.length} batidas marcadas na régua` : 'Nenhuma batida forte encontrada', found.length ? 'ok' : '');
}

/* ---------------- transição ---------------- */
function renderTransition(c) {
  const tr = trackOf(c.id);
  const prev = prevAdjacent(tr, c);
  const maxDur = Math.max(0.1, Math.min(2.5, c.dur, prev ? prev.dur : 1));
  const head = el('div', { class: 'ins-head' }, el('h3', {}, 'Transição'), el('div', { class: 'ins-tabs' }));
  const body = el('div', { class: 'ins-body' });
  const grid = el('div', { class: 'tiles' });
  for (const t of TRANSITIONS) grid.append(el('div', {
    class: 'tile' + (c.trans && c.trans.id === t.id ? ' on' : ''),
    onclick: () => { c.trans = { id: t.id, dur: c.trans ? c.trans.dur : Math.min(0.6, maxDur) }; live(); done('transição'); seek(c.start - c.trans.dur / 2); renderTransition(c); }
  }, el('div', { class: 'sw' }, '⇄'), t.name));
  body.append(sec('Tipo', grid));
  if (c.trans) {
    body.append(sec('Duração', slider(c, 'Duração', 'trans.dur', { min: 0.1, max: maxDur, step: 0.05, unit: 's', def: 0.6 })),
      el('div', { class: 'chips' },
        btn('Aplicar a todos os cortes', () => {
          let n = 0;
          for (const t of store.project.tracks) for (const x of t.clips) if (x !== c && x.type !== 'audio' && prevAdjacent(t, x)) { x.trans = deep(c.trans); n++; }
          live(); done('transições'); toast(`Transição aplicada a ${n} cortes`, 'ok');
        }),
        btn('Remover', () => { c.trans = null; live(); done('transição'); renderTransition(c); })));
  }
  root.textContent = '';
  root.append(head, body);
}

/* ---------------- projeto ---------------- */
function renderProject() {
  const p = store.project;
  const head = el('div', { class: 'ins-head' }, el('h3', {}, 'Projeto'), el('div', { class: 'ins-tabs' }));
  const body = el('div', { class: 'ins-body' });
  const grid = el('div', { class: 'tiles' });
  for (const r of RATIOS) {
    const [w, h] = r.id.split(':').map(Number);
    const s = 34 / Math.max(w, h);
    grid.append(el('div', { class: 'tile' + (p.ratio === r.id ? ' on' : ''), onclick: () => { p.ratio = r.id; p.width = r.w; p.height = r.h; resizePreview(); live(); done('proporção'); store.emit('ratio'); renderProject(); } },
      el('div', { style: { width: w * s + 'px', height: h * s + 'px', border: '2px solid currentColor', borderRadius: '3px', margin: '4px auto' } }), r.id));
  }
  body.append(sec('Proporção da tela', grid));
  body.append(sec('Taxa de quadros', segRow('', [['24', '24'], ['25', '25'], ['30', '30'], ['50', '50'], ['60', '60']], () => String(p.fps), v => { p.fps = +v; })));
  const bg = p.background;
  body.append(sec('Fundo da tela',
    segRow('', [['color', 'Cor'], ['blur', 'Desfoque']], () => bg.type, v => { bg.type = v; renderProject(); }),
    bg.type === 'color' ? colorRow('Cor', () => bg.color, v => { bg.color = v; }) : slider({ background: bg, start: 0, dur: 1 }, 'Desfoque', 'background.blur', { min: 5, max: 100, def: 30 })));
  body.append(el('p', { class: 'empty-ins', style: { padding: '0' } }, `Resolução base: ${p.width}×${p.height} · ${p.fps} fps. Selecione um clipe na linha do tempo para editar.`));
  root.textContent = '';
  root.append(head, body);
}

void mainTrack;
