import { springStep, springSettled } from './lib.mjs';

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches || document.documentElement.classList.contains('rm');

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// number tween with ease-out; reduced motion lands instantly
export function tween(from, to, ms, onFrame, onDone) {
  if (reduced() || from === to) {
    onFrame(to);
    if (onDone) onDone();
    return { stop() {} };
  }
  let raf = 0;
  let stopped = false;
  const t0 = performance.now();
  const step = (now) => {
    if (stopped) return;
    const t = clamp01((now - t0) / ms);
    onFrame(from + (to - from) * easeOut(t));
    if (t < 1) raf = requestAnimationFrame(step);
    else if (onDone) onDone();
  };
  raf = requestAnimationFrame(step);
  return { stop() { stopped = true; cancelAnimationFrame(raf); } };
}

// scroll-reveal: damped spring drives opacity, rise and scale, staggered by --i
export function initReveal() {
  const nodes = Array.from(document.querySelectorAll('[data-reveal]'));
  if (reduced() || !('IntersectionObserver' in window)) return;
  const active = new Set();
  let last = 0;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    for (const a of active) {
      if (now < a.start) continue;
      a.s = springStep(a.s, 1, dt);
      const p = a.s.x;
      a.el.style.opacity = String(clamp01(p));
      a.el.style.translate = '0 ' + ((1 - p) * 24).toFixed(2) + 'px';
      a.el.style.scale = String(0.98 + 0.02 * p);
      if (springSettled(a.s, 1)) {
        a.el.style.opacity = a.el.style.translate = a.el.style.scale = '';
        active.delete(a);
      }
    }
    if (active.size) requestAnimationFrame(frame);
    else last = 0;
  };
  for (const el of nodes) {
    el.style.opacity = '0';
    el.style.translate = '0 24px';
    el.style.scale = '0.98';
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const i = Number(getComputedStyle(e.target).getPropertyValue('--i')) || 0;
      active.add({ el: e.target, s: { x: 0, v: 0 }, start: performance.now() + i * 80 });
    }
    if (active.size && !last) { last = performance.now(); requestAnimationFrame(frame); }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  nodes.forEach((n) => io.observe(n));
}

// hero parallax: pointer + scroll, both smoothed by the same spring
export function initParallax() {
  const hero = document.getElementById('hero');
  if (!hero || reduced()) return;
  const layers = Array.from(hero.querySelectorAll('[data-depth]')).map((el) => ({ el, d: Number(el.dataset.depth) || 0 }));
  let tx = 0, ty = 0, sy = 0;
  let sx = { x: 0, v: 0 }, sY = { x: 0, v: 0 }, sS = { x: 0, v: 0 };
  let running = false, last = 0, visible = true;
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    sx = springStep(sx, tx, dt, 90, 18);
    sY = springStep(sY, ty, dt, 90, 18);
    sS = springStep(sS, sy, dt, 120, 20);
    for (const l of layers) {
      const x = sx.x * l.d * 18;
      const y = sY.x * l.d * 14 - sS.x * l.d * 0.12;
      l.el.style.translate = x.toFixed(2) + 'px ' + y.toFixed(2) + 'px';
    }
    const settled = springSettled(sx, tx, 0.002) && springSettled(sY, ty, 0.002) && springSettled(sS, sy, 0.5);
    if (visible && !settled) requestAnimationFrame(loop);
    else running = false;
  };
  const kick = () => { if (!running && visible) { running = true; last = performance.now(); requestAnimationFrame(loop); } };
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    tx = (e.clientX / window.innerWidth - 0.5) * 2;
    ty = (e.clientY / window.innerHeight - 0.5) * 2;
    kick();
  }, { passive: true });
  window.addEventListener('scroll', () => { sy = window.scrollY; kick(); }, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((en) => { visible = en[0].isIntersecting; if (visible) kick(); }).observe(hero);
  }
}

export function initProgress() {
  const bar = document.getElementById('progress');
  if (!bar) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? clamp01(window.scrollY / max) : 0) + ')';
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
  window.addEventListener('resize', paint);
  paint();
}

export function initSpotlight() {
  let queued = false, ev = null;
  document.addEventListener('pointermove', (e) => {
    ev = e;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const t = ev.target.closest && ev.target.closest('.spot, .row.data');
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (ev.clientX - r.left).toFixed(0) + 'px');
      t.style.setProperty('--my', (ev.clientY - r.top).toFixed(0) + 'px');
    });
  }, { passive: true });
}

export function initTabs() {
  const list = document.querySelector('[role="tablist"]');
  if (!list) return;
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  const select = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t, false));
    t.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowRight') { e.preventDefault(); select(tabs[(i + 1) % tabs.length], true); }
      else if (k === 'ArrowLeft') { e.preventDefault(); select(tabs[(i - 1 + tabs.length) % tabs.length], true); }
      else if (k === 'Home') { e.preventDefault(); select(tabs[0], true); }
      else if (k === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
    });
  });
}

export function initScrollSpy() {
  const links = Array.from(document.querySelectorAll('.tabs .tab'));
  const secs = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  let queued = false;
  const paint = () => {
    queued = false;
    let cur = -1;
    secs.forEach((s, i) => { if (s.getBoundingClientRect().top <= 170) cur = i; });
    links.forEach((a, i) => a.classList.toggle('is-active', i === cur));
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
  paint();
}

let live = null;
export function announce(msg) {
  if (!live) {
    live = document.createElement('div');
    live.className = 'sr';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 30);
}

export function initCopy() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('[data-copy]');
    if (!btn || btn.disabled) return;
    const text = btn.getAttribute('data-copy');
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    if (!ok) return;
    btn.classList.add('is-copied');
    announce('Address copied');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => btn.classList.remove('is-copied'), 1500);
  });
}
