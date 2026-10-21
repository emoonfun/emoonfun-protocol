import { solanaAddresses, topByVolume, backoffDelay, compactUsd, priceUsd, pct } from './lib.mjs';
import { tween } from './fx.mjs';

const ICON_COPY = '<svg class="i-copy" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_CHECK = '<svg class="i-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const POLL_MS = 60000;
const TIMEOUT_MS = 12000;
const DASH = '—';

const STATUS = {
  loading: 'Connecting',
  live: 'Live',
  stale: 'Retrying, showing last data',
  error: 'Source unreachable',
  pending: 'pending'
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function avatar(t, size) {
  const letter = () => {
    const a = el('span', 'av letter', (t.symbol || t.name || '?').trim().charAt(0).toUpperCase());
    if (size) { a.style.width = a.style.height = size + 'px'; a.style.fontSize = Math.round(size * 0.45) + 'px'; }
    return a;
  };
  if (!t.image) return letter();
  const img = new Image();
  img.className = 'av';
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  if (size) { img.width = img.height = size; img.style.width = img.style.height = size + 'px'; }
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  img.src = t.image;
  return img;
}

// numeric cell: count up on first paint, tween + flash when the value moves
function setNum(cell, next, fmt, signClass) {
  const prev = cell._v;
  cell._v = next;
  if (cell._tw) cell._tw.stop();
  const paint = (v) => {
    cell.textContent = fmt(v);
  };
  if (!Number.isFinite(next)) { paint(next); if (signClass) cell.classList.remove('up', 'down'); return; }
  if (signClass) {
    cell.classList.toggle('up', next > 0);
    cell.classList.toggle('down', next < 0);
  }
  const from = Number.isFinite(prev) ? prev : 0;
  if (Number.isFinite(prev) && prev !== next) {
    const dir = next > prev ? 'flash-up' : 'flash-down';
    const host = cell.parentElement;
    cell.classList.remove('flash-up', 'flash-down');
    void cell.offsetWidth;
    cell.classList.add(dir);
    setTimeout(() => cell.classList.remove(dir), 950);
    void host;
  }
  cell._tw = tween(from, next, 700, paint, () => paint(next));
}

export function initMarket(view) {
  const rowsEl = document.getElementById('rows');
  const tickerEl = document.getElementById('ticker');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const noteEl = document.getElementById('note');
  const src = view && view.market;

  const setStatus = (key) => {
    statusEl.dataset.status = key;
    statusText.textContent = STATUS[key];
  };

  if (!src || src.state !== 'stated' || !src.urls) {
    setStatus('pending');
    rowsEl.setAttribute('aria-busy', 'false');
    rowsEl.replaceChildren();
    noteEl.hidden = false;
    noteEl.textContent = 'The market source is pending.';
    return;
  }

  const model = { rows: new Map(), tick: new Map(), order: '', hasData: false, failures: 0, timer: 0, inflight: false };

  function buildRow(t, k) {
    const li = el('li', 'row data in');
    li.style.setProperty('--k', k);
    li.dataset.addr = t.address;
    const rank = el('span', 'c-rank');
    const tok = el('span', 'c-tok');
    const nm = el('span', 'nm');
    nm.append(el('b', null, t.name || t.symbol), el('i', null, t.symbol));
    tok.append(avatar(t), nm);
    const price = el('span', 'c-num c-price'); price.dataset.l = 'Price';
    const chg = el('span', 'c-num c-chg chg'); chg.dataset.l = '24h';
    const vol = el('span', 'c-num c-vol'); vol.dataset.l = 'Volume';
    const liq = el('span', 'c-num c-liq'); liq.dataset.l = 'Liquidity';
    const act = el('span', 'c-act');
    const btn = el('button', 'copy-btn');
    btn.type = 'button';
    btn.setAttribute('data-copy', t.address);
    btn.setAttribute('aria-label', 'Copy address for ' + (t.symbol || t.name));
    btn.innerHTML = ICON_COPY + ICON_CHECK;
    act.append(btn);
    li.append(rank, tok, price, chg, vol, liq, act);
    return { li, rank, price, chg, vol, liq };
  }

  function paintRow(r, t, i) {
    r.rank.textContent = String(i + 1);
    setNum(r.price, t.price, priceUsd);
    setNum(r.chg, t.change, pct, true);
    setNum(r.vol, t.volume, compactUsd);
    setNum(r.liq, t.liquidity, compactUsd);
  }

  function buildTick(t) {
    const a = el('span', 'tk');
    const sym = el('b', null, t.symbol || t.name);
    const px = el('span', 'px');
    const ch = el('span', 'chg');
    a.append(avatar(t, 28), sym, px, ch);
    return { a, px, ch };
  }

  function paintTick(r, t) {
    r.px.textContent = priceUsd(t.price);
    r.ch.textContent = pct(t.change);
    r.ch.classList.toggle('up', t.change > 0);
    r.ch.classList.toggle('down', t.change < 0);
  }

  function commit(tokens) {
    const order = tokens.map((t) => t.address).join(',');
    if (!model.hasData) {
      rowsEl.querySelectorAll('.sk-row').forEach((n) => n.remove());
    }
    // rows, keyed by address
    const next = new Map();
    const frag = [];
    tokens.forEach((t, i) => {
      let r = model.rows.get(t.address);
      if (!r) { r = buildRow(t, i); r.li.addEventListener('animationend', () => r.li.classList.remove('in'), { once: true }); }
      next.set(t.address, r);
      paintRow(r, t, i);
      frag.push(r.li);
    });
    rowsEl.replaceChildren(...frag);
    model.rows = next;
    rowsEl.setAttribute('aria-busy', 'false');
    noteEl.hidden = true;

    // ticker: rebuild only when the set changes, otherwise update in place
    if (order !== model.order) {
      tickerEl.replaceChildren();
      model.tick = new Map();
      const copies = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('rm') ? 1 : 2;
      for (let c = 0; c < copies; c++) {
        tokens.forEach((t) => {
          const r = buildTick(t);
          tickerEl.append(r.a);
          const list = model.tick.get(t.address) || [];
          list.push(r);
          model.tick.set(t.address, list);
        });
      }
      model.order = order;
    }
    tokens.forEach((t) => (model.tick.get(t.address) || []).forEach((r) => paintTick(r, t)));
    model.hasData = true;
  }

  function showFailure() {
    if (model.hasData) {
      setStatus('stale');
      return;
    }
    setStatus('error');
    rowsEl.replaceChildren();
    rowsEl.setAttribute('aria-busy', 'false');
    const li = el('li', 'row data');
    li.append(el('span', 'c-rank', DASH), el('span', 'c-tok', DASH));
    ['Price', '24h', 'Volume', 'Liquidity'].forEach((l, i) => {
      const c = el('span', 'c-num ' + ['c-price', 'c-chg', 'c-vol', 'c-liq'][i], DASH);
      c.dataset.l = l;
      li.append(c);
    });
    li.append(el('span', 'c-act'));
    rowsEl.append(li);
    noteEl.hidden = false;
    noteEl.textContent = 'Error: the market source did not answer. Trying again shortly.';
    tickerEl.replaceChildren(el('span', 'tk-empty', DASH + ' market source unreachable'));
    model.order = '';
  }

  async function getJson(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(to);
    }
  }

  function schedule() {
    clearTimeout(model.timer);
    if (document.hidden) return;
    model.timer = setTimeout(load, model.failures ? backoffDelay(model.failures) : POLL_MS);
  }

  async function load() {
    if (model.inflight || document.hidden) return;
    model.inflight = true;
    try {
      const boosts = await getJson(src.urls.boosts);
      const addrs = solanaAddresses(boosts);
      if (!addrs.length) throw new Error('no solana entries');
      const pairs = await getJson(src.urls.pairs + addrs.join(','));
      const top = topByVolume(pairs, addrs, 10);
      if (!top.length) throw new Error('no pairs');
      commit(top);
      model.failures = 0;
      setStatus('live');
    } catch (e) {
      model.failures += 1;
      showFailure();
    } finally {
      model.inflight = false;
      schedule();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(model.timer); return; }
    clearTimeout(model.timer);
    load();
  });

  setStatus('loading');
  load();
}
