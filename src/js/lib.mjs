const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolAddress(s) {
  return typeof s === 'string' && B58.test(s);
}

export function backoffDelay(failures, base = 2000, cap = 60000) {
  if (failures <= 0) return cap;
  return Math.min(cap, base * Math.pow(2, failures - 1));
}

export function compactUsd(n) {
  if (!Number.isFinite(n)) return '\u2014';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

export function priceUsd(n) {
  if (!Number.isFinite(n)) return '\u2014';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  if (n === 0) return '$0';
  const lead = Math.floor(-Math.log10(n));
  return '$' + n.toFixed(Math.min(lead + 3, 12));
}

export function pct(n) {
  if (!Number.isFinite(n)) return '\u2014';
  const sign = n > 0 ? '+' : n < 0 ? '\u2212' : '';
  return sign + Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 2) + '%';
}

export function safeImage(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' ? x.href : '';
  } catch (e) {
    return '';
  }
}

// boosts payload -> unique solana addresses (capped by the pairs endpoint batch limit)
export function solanaAddresses(boosts, cap = 30) {
  const seen = new Set();
  const out = [];
  if (!Array.isArray(boosts)) return out;
  for (const b of boosts) {
    if (!b || b.chainId !== 'solana' || !isSolAddress(b.tokenAddress) || seen.has(b.tokenAddress)) continue;
    seen.add(b.tokenAddress);
    out.push(b.tokenAddress);
    if (out.length >= cap) break;
  }
  return out;
}

// pairs payload -> top tokens by 24h volume (best-liquidity pair per base token)
export function topByVolume(pairs, wanted, limit = 10) {
  const best = new Map();
  if (!Array.isArray(pairs)) return [];
  const allow = new Set(wanted);
  for (const p of pairs) {
    const addr = p && p.baseToken && p.baseToken.address;
    if (!addr || !allow.has(addr) || p.chainId !== 'solana') continue;
    const liq = Number(p.liquidity && p.liquidity.usd) || 0;
    const cur = best.get(addr);
    if (!cur || liq > cur.liq) best.set(addr, { p, liq });
  }
  const rows = [];
  for (const [addr, { p, liq }] of best) {
    rows.push({
      address: addr,
      name: String(p.baseToken.name || p.baseToken.symbol || ''),
      symbol: String(p.baseToken.symbol || ''),
      image: safeImage(p.info && p.info.imageUrl),
      price: Number(p.priceUsd),
      change: Number(p.priceChange && p.priceChange.h24),
      volume: Number(p.volume && p.volume.h24),
      liquidity: liq
    });
  }
  rows.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  return rows.slice(0, limit);
}

// damped spring, semi-implicit Euler, fixed substeps for stability
export function springStep(state, target, dt, k = 170, c = 22) {
  let { x, v } = state;
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
  }
  return { x, v };
}

export function springSettled(state, target, eps = 0.001) {
  return Math.abs(state.x - target) < eps && Math.abs(state.v) < eps;
}
