// FreeCut — painéis da biblioteca (lado esquerdo)
import {
  store, selected, insertMedia, makeClip, insertClip, commit, select, clipEnd, mediaOf, srcLen, splitClip, deleteClips,
  trackOf, prevAdjacent, mainTrack, projectDuration, newTrack
} from './store.js';
import { FILTERS, EFFECTS, TRANSITIONS, TEXT_PRESETS, TEXT_DEFAULT, STICKERS, SFX } from './catalog.js';
import { importPaths, makeSfx, mediaUsed, toggleVoiceover, isRecording, cacheOf } from './media.js';
import { audioPlan, addCaptions, parseSrt, exportSrt } from './exporter.js';
import { seek, requestRender } from './engine.js';
import { $, $$, el, toast, fmtTime, progressBox, deep, modal } from './util.js';

const fc = window.fc;
let current = 'media';
let drawer;
const MAP = {};

export function initPanels() {
  drawer = $('#drawer');
  $('#rail').addEventListener('click', e => { const b = e.target.closest('[data-panel]'); if (b) show(b.dataset.panel); });
  store.on('openPanel', show);
  store.on('media', () => { if (current === 'media' || current === 'audio') show(current); });
  store.on('recording', () => { if (current === 'audio') show('audio'); });
  show('media');
}

export function show(name) {
  current = name;
  $$('#rail [data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === name));
  drawer.textContent = '';
  drawer.scrollTop = 0;
  if (!store.project) return;
  (MAP[name] || MAP.media)(drawer);
}

export async function importDialog() {
  const paths = await fc.invoke('dialog:openMedia');
  if (paths.length) await importPaths(paths);
}

const visualTarget = () => selected().find(c => c.type === 'video' || c.type === 'image' || c.type === 'fx');
const drag = (node, type, value) => {
  node.draggable = true;
  node.addEventListener('dragstart', e => { e.dataTransfer.setData('freecut/' + type, value); e.dataTransfer.effectAllowed = 'copy'; });
  return node;
};

/** Adiciona um clipe visual (texto, figurinha, ajuste) no cursor de reprodução. */
export function addAtPlayhead(c) {
  c.start = store.time;
  insertClip(c, 'visual');
  select(c.id);
  commit('adicionar');
  requestRender();
  return c;
}
export function newText(preset) {
  const c = makeClip('text');
  if (preset) Object.assign(c.text, deep(preset.s));
  const p = store.project;
  c.text.size = Math.round(Math.min(p.width, p.height) * 0.08);
  return addAtPlayhead(c);
}

/* ---------------- Mídia ---------------- */
MAP.media = d => {
  d.append(el('h3', {}, 'Mídia'),
    el('button', { class: 'btn primary block', onclick: importDialog }, '＋ Importar arquivos'),
    el('p', { class: 'note' }, 'Vídeos, imagens e áudios. Arraste para a linha do tempo ou clique em + para inserir no cursor.'));
  const list = Object.values(store.project.media).filter(m => m.type !== 'audio');
  if (!list.length) { d.append(el('div', { class: 'dropzone' }, 'Nenhuma mídia ainda.', el('br'), 'Solte arquivos aqui ou no player.')); return; }
  const grid = el('div', { class: 'media-grid' });
  for (const m of list) grid.append(mediaCard(m));
  d.append(grid);
};

function mediaCard(m) {
  const cache = store.cache[m.id] || {};
  const thumb = el('div', { class: 'thumb' }, cache.thumbs ? '' : m.type === 'image' ? '🖼' : '🎞');
  if (cache.thumbs) {
    thumb.style.backgroundImage = `url("${cache.thumbs}")`;
    thumb.style.backgroundSize = `${(cache.thumbCount || 1) * 100}% 100%`;
    thumb.style.backgroundPosition = cache.thumbCount > 1 ? `${100 * Math.floor(cache.thumbCount / 3) / (cache.thumbCount - 1)}% 0` : 'center';
  }
  const card = el('div', { class: 'mcard', title: `${m.name}\n${m.width}×${m.height} · ${m.fps || ''} fps` },
    thumb,
    m.type === 'video' ? el('span', { class: 'dur' }, fmtTime(m.duration)) : null,
    mediaUsed(m.id) ? el('span', { class: 'used' }, 'EM USO') : null,
    el('div', { class: 'meta' }, m.missing ? '⚠ ' + m.name : m.name),
    el('button', { class: 'add', title: 'Inserir no cursor', onclick: e => { e.stopPropagation(); const c = insertMedia(m, store.time, 'main'); select(c.id); commit('inserir'); } }, '+'));
  card.addEventListener('contextmenu', async e => {
    e.preventDefault();
    if (mediaUsed(m.id)) { toast('Esta mídia está em uso na linha do tempo.'); return; }
    if (await modal({ title: 'Remover mídia', body: `<p>Remover "${m.name}" do projeto? O arquivo no disco não é apagado.</p>`, ok: 'Remover' })) {
      delete store.project.media[m.id]; commit('remover mídia'); store.emit('media');
    }
  });
  return drag(card, 'media', m.id);
}

/* ---------------- Áudio ---------------- */
let previewAudio = null;
MAP.audio = d => {
  d.append(el('h3', {}, 'Áudio'),
    el('div', { class: 'chips' },
      el('button', { class: 'btn primary', onclick: importDialog }, '＋ Importar música'),
      el('button', { class: 'btn' + (isRecording() ? ' rec' : ''), onclick: toggleVoiceover }, isRecording() ? '■ Parar gravação' : '🎙 Gravar narração')));
  const list = Object.values(store.project.media).filter(m => m.type === 'audio');
  d.append(el('h4', {}, 'Seus áudios'));
  if (!list.length) d.append(el('p', { class: 'note' }, 'Importe MP3, WAV, M4A, OGG ou FLAC.'));
  for (const m of list) {
    const row = el('div', { class: 'list-row' },
      el('button', { class: 'icon-btn', title: 'Ouvir', onclick: () => {
        if (previewAudio && !previewAudio.paused) { previewAudio.pause(); return; }
        previewAudio = new Audio(fc.mediaUrl(m.path)); previewAudio.play();
      } }, '▶'),
      el('div', { style: { flex: 1, minWidth: 0 } }, el('div', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, m.name), el('small', { style: { color: 'var(--dim)' } }, fmtTime(m.duration))),
      el('button', { class: 'btn sm', onclick: () => { const c = insertMedia(m, store.time); select(c.id); commit('áudio'); } }, '+'));
    d.append(drag(row, 'media', m.id));
  }
  d.append(el('h4', {}, 'Efeitos sonoros'));
  const grid = el('div', { class: 'tiles' });
  for (const [id, name] of SFX) grid.append(el('div', {
    class: 'tile', onclick: async () => {
      const m = await makeSfx(id, name);
      if (!m) return;
      const c = insertMedia(m, store.time); select(c.id); commit('efeito sonoro');
      toast(`${name} adicionado em ${fmtTime(store.time)}`, 'ok');
    }
  }, el('div', { class: 'sw' }, '🔊'), name));
  d.append(grid);
  d.append(el('p', { class: 'note' }, 'Os efeitos são gerados por síntese, sem direitos autorais.'));
};

/* ---------------- Texto ---------------- */
MAP.text = d => {
  d.append(el('h3', {}, 'Texto'), el('button', { class: 'btn primary block', onclick: () => newText() }, '＋ Adicionar texto'));
  d.append(el('h4', {}, 'Estilos'));
  const grid = el('div', { class: 'tiles' });
  for (const p of TEXT_PRESETS) {
    const s = Object.assign(deep(TEXT_DEFAULT), deep(p.s));
    const tile = el('div', { class: 'tile', onclick: () => newText(p) },
      el('div', { class: 'tx', style: { fontFamily: s.font, color: s.color, fontStyle: s.italic ? 'italic' : '', textTransform: s.upper ? 'uppercase' : '',
        WebkitTextStroke: s.stroke.on ? `1px ${s.stroke.color}` : '', background: s.bg.on ? s.bg.color : '#0b0d11', textShadow: s.glow.on ? `0 0 8px ${s.glow.color}` : '' } }, 'Aa'), p.name);
    grid.append(drag(tile, 'text', p.id));
  }
  d.append(grid);
  d.append(el('h4', {}, 'Texto para fala'), el('button', { class: 'btn block', onclick: () => show('ai') }, '🗣 Transformar texto em voz'));
};

/* ---------------- Legendas ---------------- */
MAP.captions = d => {
  const sel = selected().find(c => c.type === 'video' || c.type === 'audio');
  d.append(el('h3', {}, 'Legendas automáticas ', el('span', { class: 'pill' }, 'GRÁTIS')),
    el('p', { class: 'note' }, 'Reconhece a fala com IA (Whisper) no seu computador, sem internet, e cria as legendas sincronizadas.'));
  const form = el('div');
  form.innerHTML = `
    <div class="row"><label>Idioma</label><select name="lang"><option value="pt">Português</option><option value="en">Inglês</option><option value="es">Espanhol</option><option value="auto">Detectar</option></select></div>
    <div class="row"><label>Precisão</label><select name="model"><option value="turbo">Alta (Large v3 Turbo)</option><option value="small">Rápida (Small)</option></select></div>
    <div class="row"><label>Tamanho</label><select name="maxLen"><option value="24">Curtas (estilo Reels)</option><option value="36" selected>Médias</option><option value="60">Longas</option></select></div>
    <div class="row"><label>Estilo</label><select name="preset">${TEXT_PRESETS.map(p => `<option value="${p.id}" ${p.id === 'classic' ? 'selected' : ''}>${p.name}</option>`).join('')}</select></div>
    <div class="row"><label>Fonte do áudio</label><select name="scope"><option value="all">Todo o projeto</option>${sel ? '<option value="sel">Clipe selecionado</option>' : ''}</select></div>`;
  d.append(form, el('button', { class: 'btn primary block', onclick: () => runCaptions(form) }, '✨ Gerar legendas'));
  d.append(el('h4', {}, 'Arquivo de legendas'),
    el('div', { class: 'chips' },
      el('button', { class: 'btn sm', onclick: importSrt }, '⬆ Importar .srt'),
      el('button', { class: 'btn sm', onclick: async () => {
        const out = await fc.invoke('dialog:save', { title: 'Exportar legendas', name: (store.project.name || 'legendas') + '.srt', filters: [{ name: 'SRT', extensions: ['srt'] }] });
        if (out) exportSrt(out);
      } }, '⬇ Exportar .srt'),
      el('button', { class: 'btn sm', onclick: () => {
        for (const tr of store.project.tracks) tr.clips = tr.clips.filter(c => !c.caption);
        store.project.tracks = store.project.tracks.filter(t => t.kind === 'main' || t.clips.length);
        commit('remover legendas'); requestRender();
      } }, '🗑 Remover legendas')));
};

async function runCaptions(form) {
  const v = Object.fromEntries([...form.querySelectorAll('[name]')].map(i => [i.name, i.value]));
  const sel = selected().find(c => c.type === 'video' || c.type === 'audio');
  const plan = audioPlan(v.scope === 'sel' && sel ? [sel.id] : null);
  if (!plan.items.length) { toast('Não há áudio na linha do tempo para transcrever.', 'bad'); return; }
  const pb = progressBox('Gerando legendas com IA');
  const taskId = 'c' + Date.now();
  const off = fc.on('task:progress', d => { if (d.id === taskId) pb.set(d.pct, (d.label || 'Transcrevendo') + ` · ${Math.round(d.pct * 100)}%`); });
  pb.onCancel = () => fc.invoke('task:cancel');
  try {
    const segs = await fc.invoke('ai:captions', { plan, lang: v.lang, model: v.model, maxLen: +v.maxLen, taskId });
    pb.close();
    if (!segs.length) { toast('Nenhuma fala reconhecida.', 'bad'); return; }
    addCaptions(segs, { replace: true, preset: v.preset });
    requestRender();
    toast(`${segs.length} legendas criadas`, 'ok');
  } catch (e) { pb.close(); toast('Falha ao gerar legendas: ' + e.message, 'bad', 8000); }
  finally { off(); }
}

async function importSrt() {
  const p = await fc.invoke('dialog:open', { title: 'Importar legendas', filters: [{ name: 'Legendas', extensions: ['srt'] }] });
  if (!p) return;
  const segs = parseSrt(await fc.invoke('fs:readText', p));
  if (!segs.length) { toast('Arquivo SRT vazio ou inválido.', 'bad'); return; }
  addCaptions(segs, { replace: true });
  requestRender();
  toast(`${segs.length} legendas importadas`, 'ok');
}

/* ---------------- Figurinhas ---------------- */
MAP.stickers = d => {
  d.append(el('h3', {}, 'Figurinhas'), el('p', { class: 'note' }, 'Clique para adicionar no cursor. Use a guia Animação para dar vida.'));
  for (const [cat, list] of Object.entries(STICKERS)) {
    d.append(el('h4', {}, cat));
    const g = el('div', { class: 'emoji-grid' });
    for (const s of list.split(' ')) g.append(drag(el('button', { onclick: () => addAtPlayhead(makeClip('sticker', { sticker: s })) }, s), 'sticker', s));
    d.append(g);
  }
};

/* ---------------- Efeitos / Filtros ---------------- */
MAP.effects = d => {
  const tgt = visualTarget();
  d.append(el('h3', {}, 'Efeitos'), el('p', { class: 'note' }, tgt ? 'Clique para aplicar ao clipe selecionado.' : 'Sem clipe selecionado: o efeito vira uma camada de ajuste que afeta tudo abaixo dela.'));
  const grid = el('div', { class: 'tiles' });
  for (const e of EFFECTS) grid.append(drag(el('div', { class: 'tile', onclick: () => applyEffect(e.id) }, el('div', { class: 'sw' }, e.ico), e.name), 'effect', e.id));
  d.append(grid);
};
export function applyEffect(id, target = visualTarget()) {
  if (target) { target.effects = target.effects || []; target.effects.push({ id, amount: 60 }); commit('efeito'); requestRender(); toast('Efeito aplicado', 'ok'); return; }
  const c = makeClip('fx', { effects: [{ id, amount: 60 }] });
  addAtPlayhead(c);
}
MAP.filters = d => {
  const tgt = visualTarget();
  d.append(el('h3', {}, 'Filtros'), el('p', { class: 'note' }, tgt ? 'Clique para aplicar ao clipe selecionado.' : 'Sem clipe selecionado: o filtro vira uma camada de ajuste.'));
  const grid = el('div', { class: 'tiles' });
  for (const f of FILTERS.slice(1)) grid.append(drag(el('div', { class: 'tile' + (tgt && tgt.filter && tgt.filter.id === f.id ? ' on' : ''), onclick: () => applyFilter(f.id) }, el('div', { class: 'sw' }, '🏞'), f.name), 'filter', f.id));
  d.append(grid);
  if (tgt) d.append(el('button', { class: 'btn block', style: { marginTop: '10px' }, onclick: () => { tgt.filter = { id: 'none', amount: 100 }; commit('filtro'); requestRender(); show('filters'); } }, 'Remover filtro'));
};
export function applyFilter(id, target = visualTarget()) {
  if (target) { target.filter = { id, amount: (target.filter && target.filter.amount) || 100 }; commit('filtro'); requestRender(); show('filters'); return; }
  addAtPlayhead(makeClip('fx', { filter: { id, amount: 100 } }));
}

/* ---------------- Transições ---------------- */
MAP.transitions = d => {
  d.append(el('h3', {}, 'Transições'), el('p', { class: 'note' }, 'Clique em um corte (+) na linha do tempo e escolha aqui, ou clique para aplicar no corte mais próximo do cursor.'));
  const grid = el('div', { class: 'tiles' });
  for (const t of TRANSITIONS) grid.append(drag(el('div', { class: 'tile', onclick: () => applyTransition(t.id) }, el('div', { class: 'sw' }, '⇄'), t.name), 'transition', t.id));
  d.append(grid);
};
export function applyTransition(id, clip = null) {
  let c = clip || (store.selTrans && store.project.tracks.flatMap(t => t.clips).find(x => x.id === store.selTrans));
  if (!c) {
    let best = null, bd = Infinity;
    for (const tr of store.project.tracks) if (tr.kind !== 'audio') for (const x of tr.clips) {
      if (!prevAdjacent(tr, x)) continue;
      const dd = Math.abs(x.start - store.time);
      if (dd < bd) { bd = dd; best = x; }
    }
    c = best;
  }
  if (!c) { toast('Coloque dois clipes encostados na mesma faixa para usar transições.', 'bad', 5000); return; }
  const prev = prevAdjacent(trackOf(c.id), c);
  c.trans = { id, dur: Math.min(0.6, c.dur, prev ? prev.dur : 1) };
  commit('transição');
  store.selTrans = c.id;
  store.emit('select');
  seek(Math.max(0, c.start - c.trans.dur / 2 - 0.3));
  toast('Transição aplicada', 'ok');
}

/* ---------------- IA ---------------- */
MAP.ai = d => {
  d.append(el('h3', {}, 'Ferramentas de IA ', el('span', { class: 'pill' }, 'TUDO GRÁTIS')));
  const card = (ico, title, desc, fn) => d.append(el('div', { class: 'ai-card', onclick: fn }, el('div', { class: 'ai-ico' }, ico), el('div', {}, el('b', {}, title), el('span', {}, desc))));
  const needSel = (types, fn) => () => {
    const c = selected().find(x => types.includes(x.type));
    if (!c) { toast('Selecione um clipe de ' + (types.includes('audio') ? 'vídeo ou áudio' : 'vídeo ou imagem') + ' primeiro.', 'bad'); return; }
    fn(c);
  };
  card('💬', 'Legendas automáticas', 'Transcreve a fala e cria legendas sincronizadas', () => show('captions'));
  card('🗣', 'Texto para fala', 'Gera narração a partir de texto (voz Maria pt-BR e outras)', () => ttsDialog());
  card('👤', 'Remover fundo', 'Recorta pessoas do fundo sem tela verde', needSel(['video', 'image'], c => { c.bgRemove = true; commit('remover fundo'); requestRender(); toast('Remoção de fundo ativada', 'ok'); }));
  card('▣', 'Chroma key', 'Remove fundo verde/azul (ajuste em Recursos)', needSel(['video', 'image'], c => { c.chroma.on = true; commit('chroma'); requestRender(); store.emit('select'); }));
  card('🔇', 'Remover silêncios', 'Corta automaticamente as pausas da fala', needSel(['video', 'audio'], c => removeSilences(c)));
  card('🎚', 'Redução de ruído', 'Limpa chiado e ruído de fundo da voz', needSel(['video', 'audio'], c => { store.emit('select'); toast('Ative em Áudio → Redução de ruído'); }));
  card('🛠', 'Estabilizar vídeo', 'Suaviza tremores de câmera na mão', needSel(['video'], () => toast('Use Recursos → Estabilizar no painel à direita')));
  card('♪', 'Detectar batidas', 'Marca o ritmo da música na régua para cortes no tempo', needSel(['audio', 'video'], () => toast('Use Áudio → Detectar batidas no painel à direita')));
  card('🎭', 'Mudança de voz', 'Robô, esquilo, monstro, eco, rádio e mais', needSel(['video', 'audio'], () => toast('Escolha a voz em Áudio → Mudança de voz')));
};

async function ttsDialog() {
  let voices = [];
  try { voices = await fc.invoke('ai:voices'); } catch { /* sem vozes */ }
  const selText = selected().find(c => c.type === 'text');
  const body = el('div');
  body.innerHTML = `
    <label class="f">Texto<textarea name="text" rows="5" style="width:100%">${selText ? selText.text.content : ''}</textarea></label>
    <div class="grid2">
      <label class="f">Voz<select name="voice">${voices.map(v => `<option value="${v.name}" ${v.culture === 'pt-BR' ? 'selected' : ''}>${v.name.replace('Microsoft ', '').replace(' Desktop', '')} (${v.culture})</option>`).join('')}</select></label>
      <label class="f">Velocidade<input type="range" name="rate" min="-6" max="6" value="0"></label>
    </div>
    <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="caption" ${selText ? '' : 'checked'}> Criar legenda com o mesmo texto</label>`;
  const v = await modal({ title: 'Texto para fala', body, ok: 'Gerar voz' });
  if (!v || !v.text.trim()) return;
  const pb = progressBox('Gerando voz');
  pb.set(0.4, 'Sintetizando...');
  try {
    const p = await fc.invoke('ai:tts', { text: v.text, voice: v.voice, rate: +v.rate });
    const [m] = await importPaths([p], { silent: true });
    m.name = 'Voz: ' + v.text.slice(0, 30);
    const start = selText ? selText.start : store.time;
    const a = makeClip('audio', { mediaId: m.id, start, dur: m.duration, name: m.name });
    insertClip(a, 'audio');
    if (v.caption) {
      const t = makeClip('text', { start, dur: m.duration, caption: true });
      Object.assign(t.text, deep(TEXT_PRESETS[0].s), { content: v.text, size: Math.round(Math.min(store.project.width, store.project.height) * 0.055) });
      t.y = Math.round(store.project.height * 0.33);
      insertClip(t, 'visual');
    }
    commit('texto para fala');
    toast('Narração criada', 'ok');
  } catch (e) { toast('Falha na síntese de voz: ' + e.message, 'bad', 6000); }
  finally { pb.close(); }
}

/** Divide o clipe nas pausas silenciosas e remove os trechos mudos. */
function removeSilences(c) {
  const m = mediaOf(c);
  const peaks = m && store.cache[m.id] && store.cache[m.id].peaks;
  if (!peaks) { toast('Ainda analisando o áudio, tente em instantes.'); return; }
  const thr = 0.035, minLen = 0.6, pad = 0.12;
  const s0 = Math.floor(c.in * 100), s1 = Math.min(peaks.length, Math.floor((c.in + srcLen(c)) * 100));
  const regions = [];
  let runStart = -1;
  for (let i = s0; i <= s1; i++) {
    const quiet = i < s1 && peaks[i] < thr;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      if ((i - runStart) / 100 >= minLen) regions.push([runStart / 100 + pad, i / 100 - pad]);
      runStart = -1;
    }
  }
  if (!regions.length) { toast('Nenhuma pausa longa encontrada.'); return; }
  const toTl = s => c.start + (s - c.in) / c.speed;
  const tr = trackOf(c.id);
  let removed = 0;
  for (const [a, b] of regions.reverse()) {
    const ta = toTl(a), tb = toTl(b);
    const host = tr.clips.find(x => ta > x.start && tb < clipEnd(x) + 1e-6 && (x === c || x.mediaId === c.mediaId));
    if (!host || tb - ta < 0.2) continue;
    const mid = splitClip(host, ta);
    if (!mid) continue;
    const tail = splitClip(mid, tb);
    void tail;
    deleteClips([mid.id], true);
    removed += tb - ta;
  }
  commit('remover silêncios');
  requestRender();
  toast(`${regions.length} pausas removidas (${removed.toFixed(1).replace('.', ',')} s a menos)`, 'ok', 5000);
}

export { newTrack, mainTrack, projectDuration, cacheOf };
