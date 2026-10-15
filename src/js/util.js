// FreeCut — utilidades compartilhadas
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const uid = (p = 'id') => p + Math.random().toString(36).slice(2, 9);
export const deep = o => JSON.parse(JSON.stringify(o));
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

export function fmtTime(t, fps = 30, frames = false) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t) % 60;
  const base = (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
  if (!frames) return base;
  return base + ':' + String(Math.floor((t % 1) * fps + 1e-6)).padStart(2, '0');
}
export const fmtSec = t => (Math.round(t * 10) / 10).toFixed(1).replace('.', ',') + 's';

export function debounce(fn, ms) {
  let t = 0;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}

export class Emitter {
  constructor() { this.h = {}; }
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.h[ev] = (this.h[ev] || []).filter(f => f !== fn); }
  emit(ev, ...a) { for (const f of this.h[ev] || []) f(...a); }
}

/* ---------- notificações e diálogos ---------- */
let toastTimer = 0;
export function toast(msg, kind = '', ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
}

export function modal({ title, body, ok = 'OK', cancel = 'Cancelar', wide = false, onOpen, validate }) {
  return new Promise(resolve => {
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal' + (wide ? ' wide' : '') },
      el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'icon-btn', 'data-x': 1, html: '&times;' })),
      el('div', { class: 'modal-body', html: typeof body === 'string' ? body : '' }),
      el('div', { class: 'modal-foot' },
        cancel ? el('button', { class: 'btn ghost', 'data-x': 1 }, cancel) : null,
        ok ? el('button', { class: 'btn primary', 'data-ok': 1 }, ok) : null));
    if (body && body.nodeType) box.querySelector('.modal-body').append(body);
    back.append(box);
    document.body.append(back);
    const values = () => {
      const o = {};
      $$('[name]', box).forEach(i => { o[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      return o;
    };
    const close = v => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const okClick = () => { const v = values(); if (validate && !validate(v, box)) return; close(v); };
    const key = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); okClick(); }
    };
    document.addEventListener('keydown', key, true);
    box.addEventListener('click', e => {
      if (e.target.closest('[data-x]')) close(null);
      else if (e.target.closest('[data-ok]')) okClick();
    });
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    if (onOpen) onOpen(box, close);
    const f = box.querySelector('input,textarea,select');
    if (f) f.focus();
  });
}

/** Painel de tarefa longa com barra de progresso. */
export function progressBox(title) {
  const bar = el('div', { class: 'pbar' }, el('i'));
  const label = el('div', { class: 'plabel' }, 'Preparando...');
  const back = el('div', { class: 'modal-back' },
    el('div', { class: 'modal small' }, el('div', { class: 'modal-head' }, el('h3', {}, title)),
      el('div', { class: 'modal-body' }, label, bar),
      el('div', { class: 'modal-foot' }, el('button', { class: 'btn ghost', onclick: () => api.onCancel && api.onCancel() }, 'Cancelar'))));
  document.body.append(back);
  const api = {
    set(p, text) { bar.firstChild.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; if (text) label.textContent = text; },
    close() { back.remove(); },
    onCancel: null
  };
  return api;
}

export function easing(name, t) {
  switch (name) {
    case 'in': return t * t;
    case 'out': return 1 - (1 - t) * (1 - t);
    case 'inout': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'back': { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
    case 'bounce': {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
    case 'hold': return 0;
    default: return t;
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
