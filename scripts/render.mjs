import { isSolAddress } from '../src/js/lib.mjs';

const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const GH_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';
const ICON_X = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${X_PATH}"/></svg>`;
const ICON_GH = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="${GH_PATH}"/></svg>`;
const ICON_COPY = '<svg class="i-copy" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_CHECK = '<svg class="i-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function validateRegister(records) {
  const ids = new Set();
  for (const r of records) {
    if (ids.has(r.id)) throw new Error('duplicate record ' + r.id);
    ids.add(r.id);
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) throw new Error('bad state on ' + r.id);
    const carries = ['value', 'url', 'urls', 'rpc', 'display'].filter((k) => k in r);
    if (r.state !== 'stated' && carries.length) throw new Error('inert record ' + r.id + ' carries ' + carries.join(','));
    if (r.state === 'stated' && !carries.length) throw new Error('stated record ' + r.id + ' has no payload');
  }
  const ca = records.find((r) => r.id === 'ca');
  if (ca && ca.state === 'stated' && !isSolAddress(ca.value)) throw new Error('stated CA is not a Solana address');
  return records;
}

// store URL, derive handle
export function deriveHandle(url, hosts) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname.replace(/^www\./, ''))) throw new Error('unexpected host ' + u.hostname);
  const seg = u.pathname.split('/').filter(Boolean)[0];
  if (!seg) throw new Error('no handle in ' + url);
  return seg;
}

// runtime view: no dates, no inert payloads
export function viewModel(records) {
  const out = {};
  for (const r of records) {
    const v = { state: r.state };
    if (r.state === 'stated') for (const k of ['value', 'url', 'urls', 'display']) if (k in r) v[k] = r[k];
    out[r.id] = v;
  }
  return out;
}

export function render(records) {
  validateRegister(records);
  const R = Object.fromEntries(records.map((r) => [r.id, r]));
  const stated = (id) => R[id] && R[id].state === 'stated';
  const pend = (id) => (stated(id) ? esc(R[id].value) : 'pending');

  const social = (id, icon, hosts) => {
    const r = R[id];
    if (stated(id)) {
      const h = deriveHandle(r.url, hosts);
      return `<a class="icon-btn" data-social="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(r.label)} @${esc(h)}">${icon}</a>`;
    }
    return `<button class="icon-btn is-inert" type="button" data-social="${id}" data-state="${r.state}" disabled aria-disabled="true" aria-label="${esc(r.label)} pending">${icon}</button>`;
  };

  const cta = (id, cls, text) => {
    const r = R[id];
    if (stated(id)) return `<a class="btn ${cls}" data-cta="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    return `<button class="btn ${cls} is-inert" type="button" data-cta="${id}" data-state="${r.state}" disabled aria-disabled="true">${text}<span class="tag">pending</span></button>`;
  };

  const val = (id) => (stated(id) ? `<b data-rec="${id}">${esc(R[id].value)}</b>` : `<b class="pending" data-rec="${id}" data-state="${R[id].state}">pending</b>`);

  const caSlot = stated('ca')
    ? `<div class="ca" data-ca data-state="stated"><span class="ca-l">${esc(R.ca.label)}</span><span class="ca-v" data-ca-slot>${esc(R.ca.value)}</span><button class="copy-btn ca-copy" type="button" data-copy="${esc(R.ca.value)}" aria-label="Copy contract address">${ICON_COPY}${ICON_CHECK}<span class="copy-tip" aria-hidden="true">Copied</span></button></div>`
    : `<div class="ca is-inert" data-ca data-state="${R.ca.state}"><span class="ca-l">${esc(R.ca.label)}</span><span class="ca-v ca-pending" data-ca-slot>pending</span><button class="copy-btn ca-copy" type="button" disabled aria-disabled="true" aria-label="Copy contract address, pending">${ICON_COPY}${ICON_CHECK}</button></div>`;

  const stat = (id, k) => `<li class="tile spot" data-reveal style="--i:${k}"><span class="tile-l">${esc(R[id].label)}</span>${val(id)}</li>`;

  const skRows = Array.from({ length: 10 }, (_, i) => `<li class="row sk-row" style="--k:${i}" aria-hidden="true"><span class="c-rank sk"></span><span class="c-tok"><i class="sk sk-av"></i><i class="sk sk-t"></i></span><span class="c-num sk"></span><span class="c-num sk"></span><span class="c-num sk"></span><span class="c-num sk"></span><span class="c-act"></span></li>`).join('');

  const ladder = [
    ['I', 'Stage one', 'Where every token starts'],
    ['II', 'Stage two', pend('form2')],
    ['III', 'Top stage', pend('final')],
    ['\u2605', 'Graduation', 'pending']
  ];
  const ladderHtml = ladder.map((l, i) => `<li class="rung" style="--i:${i}"><span class="rung-n">${l[0]}</span><span class="rung-t"><b>${l[1]}</b><em>${l[2]}</em></span></li>`).join('');

  const lockText = stated('lock') ? esc(R.lock.display || R.lock.value) : 'a fixed window';
  const f2 = stated('form2') ? esc(R.form2.value) : 'its second threshold';
  const f3 = stated('final') ? esc(R.final.value) : 'its final threshold';

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EMO | Tokens that change shape</title>
<meta name="description" content="EMO ties a token's market-value climb to a ladder of forms on ${esc(R.chain.value)}, with live market data on the same page.">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<link rel="preload" as="image" href="assets/logo-512.png">
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/styles.css">
<script>document.documentElement.classList.add('js');if(matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('rm');</script>
</head>
<body>
<div class="progress" aria-hidden="true"><i id="progress"></i></div>
<a class="skip" href="#main">Jump to the page body</a>

<div class="top" id="top">
  <header class="bar wrap">
    <a class="brand" href="#top" aria-label="EMO home"><img src="assets/logo-192.png" width="44" height="44" alt="" decoding="async"><span>EMO</span></a>
    <div class="top-right">
      ${social('x', ICON_X, ['x.com', 'twitter.com'])}
      ${social('github', ICON_GH, ['github.com'])}
    </div>
  </header>
  <div class="wrap">${caSlot}</div>
</div>

<nav class="tabs wrap" aria-label="Sections">
  <a href="#market" class="tab">Market</a>
  <a href="#pot" class="tab">Treasury</a>
  <a href="#journey" class="tab">Journey</a>
  <a href="#forms" class="tab">Forms</a>
  <a href="#mechanics" class="tab">Mechanics</a>
</nav>

<main id="main">
<section class="hero" id="hero">
  <div class="mesh" aria-hidden="true"><i class="blob b1" data-depth="0.25"></i><i class="blob b2" data-depth="0.4"></i><i class="blob b3" data-depth="0.15"></i></div>
  <div class="wrap hero-in">
    <div class="hero-copy">
      <span class="eyebrow" data-reveal style="--i:0">Evolving tokens on ${esc(R.chain.value)}</span>
      <h1 data-reveal style="--i:1">Every token gets a next form.<br><span class="grad">See it level up.</span></h1>
      <p class="lead" data-reveal style="--i:2">EMO ties a token's growth to a ladder of forms. As its market value passes each rung, the creature on its card changes shape and a treasury wallet backs the climb with a purchase held under lock for ${lockText}.</p>
      <div class="hero-cta" data-reveal style="--i:3">
        ${cta('launch', 'btn-primary btn-lg', 'Start a token')}
        ${cta('buy', 'btn-ghost btn-lg', 'Get EMO')}
        <a class="btn btn-ghost btn-lg" href="#journey">See the mechanics</a>
      </div>
    </div>
    <div class="stage" data-reveal style="--i:2">
      <div class="layer l-ring" data-depth="0.35" aria-hidden="true"></div>
      <i class="layer spark s1" data-depth="0.9" aria-hidden="true"></i>
      <i class="layer spark s2" data-depth="0.7" aria-hidden="true"></i>
      <i class="layer dot d1" data-depth="1.1" aria-hidden="true"></i>
      <i class="layer dot d2" data-depth="0.6" aria-hidden="true"></i>
      <div class="layer l-logo" data-depth="0.55"><img id="hero-logo" src="assets/logo-512.png" width="512" height="512" alt="EMO emblem: a flame inside a swirl of blue and gold petals" fetchpriority="high"></div>
      <ol class="ladder spot layer" data-depth="0.2" aria-label="Form ladder">${ladderHtml}</ol>
    </div>
  </div>
  <ul class="wrap tiles">
    ${stat('stat-launched', 0)}${stat('stat-form2', 1)}${stat('stat-final', 2)}${stat('stat-cap', 3)}
  </ul>
</section>

<section class="ticker" aria-label="Live ticker">
  <div class="ticker-track" id="ticker" aria-hidden="true"></div>
</section>

<section class="sec wrap" id="market">
  <div class="sec-head" data-reveal>
    <div><span class="eyebrow">Live board</span><h2>Busiest ${esc(R.chain.value)} tokens right now</h2></div>
    <div class="pill" id="status" data-status="loading" role="status" aria-live="polite"><i class="live-dot"></i><span id="status-text">Connecting</span></div>
  </div>
  <div class="panel spot" data-reveal>
    <div class="row head" aria-hidden="true"><span class="c-rank">#</span><span class="c-tok">Token</span><span class="c-num">Price</span><span class="c-num">24h</span><span class="c-num">Volume</span><span class="c-num">Liquidity</span><span class="c-act"></span></div>
    <ol class="rows" id="rows" aria-busy="true">${skRows}</ol>
    <p class="note" id="note" hidden></p>
  </div>
</section>

<section class="sec wrap" id="pot">
  <div class="sec-head" data-reveal><div><span class="eyebrow">Treasury</span><h2>A single treasury behind every token</h2></div></div>
  <div class="chips" role="tablist" aria-label="Pot stages" data-reveal>
    <button class="chip" role="tab" aria-selected="true" aria-controls="p-in" id="t-in" type="button">Inflow</button>
    <button class="chip" role="tab" aria-selected="false" aria-controls="p-buy" id="t-buy" type="button" tabindex="-1">Purchases</button>
    <button class="chip" role="tab" aria-selected="false" aria-controls="p-lock" id="t-lock" type="button" tabindex="-1">Lock</button>
  </div>
  <div class="card-sec spot" data-reveal>
    <div id="p-in" role="tabpanel" aria-labelledby="t-in"><h3>A cut from each fee flows in</h3><p>A portion of what the product earns is routed into one common wallet. Its size is ${stated('feeshare') ? esc(R.feeshare.value) : 'still to be announced'}, and it pays for the purchases below.</p></div>
    <div id="p-buy" role="tabpanel" aria-labelledby="t-buy" hidden><h3>Purchases land at each rung</h3><p>Passing ${f2} triggers a treasury purchase, and passing ${f3} triggers another, both from other traders. A last one follows graduation; its size is ${stated('bondbuy') ? esc(R.bondbuy.value) : 'still to be announced'}.</p></div>
    <div id="p-lock" role="tabpanel" aria-labelledby="t-lock" hidden><h3>Everything bought is frozen</h3><p>Whatever the wallet acquires is held back for ${lockText}, so it cannot turn into a seller against the very market it just backed.</p></div>
  </div>
  <ul class="cards3">
    <li class="card spot" data-reveal style="--i:0"><span class="ico" aria-hidden="true">\u25C6</span><b>Inflow</b><p>Fees top up the wallet as tokens trade.</p></li>
    <li class="card spot" data-reveal style="--i:1"><span class="ico" aria-hidden="true">\u21C4</span><b>Milestone purchases</b><p>Crossing a rung triggers a real purchase, not a promise.</p></li>
    <li class="card spot" data-reveal style="--i:2"><span class="ico" aria-hidden="true">\u2693</span><b>Frozen holdings</b><p>Everything it acquires stays locked for ${lockText}.</p></li>
  </ul>
</section>

<section class="sec wrap" id="journey">
  <div class="sec-head" data-reveal><div><span class="eyebrow">Journey</span><h2>From first spark to peak form</h2></div></div>
  <ol class="steps">
    <li class="spot" data-reveal style="--i:0"><span class="num">01</span><b>Start</b><p>Create the token through pump.fun and choose its character. It opens at stage one.</p></li>
    <li class="spot" data-reveal style="--i:1"><span class="num">02</span><b>Stage two</b><p>Past ${stated('form2') ? esc(R.form2.value) : 'the first rung'} the card is redrawn and the wallet steps in with a locked purchase.</p></li>
    <li class="spot" data-reveal style="--i:2"><span class="num">03</span><b>Top stage</b><p>Beyond ${stated('final') ? esc(R.final.value) : 'the top rung'} comes its best look, along with a second purchase.</p></li>
    <li class="spot" data-reveal style="--i:3"><span class="num">04</span><b>Graduation</b><p>When the token leaves its starting curve, one more purchase is made and locked.</p></li>
  </ol>
</section>

<section class="sec wrap" id="forms">
  <div class="sec-head" data-reveal><div><span class="eyebrow">Forms</span><h2>Four stops along every card</h2></div></div>
  <ul class="forms">
    <li class="form spot" data-reveal style="--i:0"><span class="orb o1"><img src="assets/logo-192.png" width="96" height="96" alt="" loading="lazy"></span><b>One</b><em>Where it begins</em></li>
    <li class="form spot" data-reveal style="--i:1"><span class="orb o2"><img src="assets/logo-192.png" width="96" height="96" alt="" loading="lazy"></span><b>Two</b><em>${pend('form2')}</em></li>
    <li class="form spot" data-reveal style="--i:2"><span class="orb o3"><img src="assets/logo-192.png" width="96" height="96" alt="" loading="lazy"></span><b>Top</b><em>${pend('final')}</em></li>
    <li class="form spot" data-reveal style="--i:3"><span class="orb o4"><img src="assets/logo-192.png" width="96" height="96" alt="" loading="lazy"></span><b>Graduated</b><em>pending</em></li>
  </ul>
</section>

<section class="sec wrap" id="mechanics">
  <div class="sec-head" data-reveal><div><span class="eyebrow">Mechanics</span><h2>What runs behind the scenes</h2></div></div>
  <ul class="tech">
    <li class="spot" data-reveal style="--i:0"><span class="ico" aria-hidden="true">\u25CE</span><b>Market watching</b><p>Every threshold is judged from live market-value readings, never from a manual switch.</p></li>
    <li class="spot" data-reveal style="--i:1"><span class="ico" aria-hidden="true">\u26D3</span><b>Locked purchases</b><p>Treasury buys are time-locked, and the holdings are meant to be inspectable by anyone.</p></li>
    <li class="spot" data-reveal style="--i:2"><span class="ico" aria-hidden="true">\u2726</span><b>Creature link</b><p>A token carries its creature from day one, so every explorer displays the same card.</p></li>
    <li class="spot" data-reveal style="--i:3"><span class="ico" aria-hidden="true">\u2713</span><b>Self-custody</b><p>Every action is signed inside the holder's own app, and nothing on this page ever requests recovery words.</p></li>
    <li class="spot" data-reveal style="--i:4"><span class="ico" aria-hidden="true">\u2699</span><b>Open code</b><p>${stated('github') ? 'Browse the repository from the icon above.' : 'The repository link is pending.'}</p></li>
    <li class="spot" data-reveal style="--i:5"><span class="ico" aria-hidden="true">\u2605</span><b>Community ladder</b><p>Holders watch milestones together; progress is shared, not private.</p></li>
  </ul>
</section>

<section class="sec wrap cta-band spot" data-reveal>
  <div><h2>Your next token has a next form.</h2><p>Open the board, choose a character, and let the climb do the talking.</p></div>
  ${cta('launch', 'btn-primary btn-lg', 'Start a token')}
</section>
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <a class="brand" href="#top" aria-label="EMO home"><img src="assets/logo-192.png" width="44" height="44" alt="" loading="lazy"><span>EMO</span></a>
    <span class="foot-chip">emoonfun.ink</span>
    <span class="foot-chip">${esc(R.chain.value)}</span>
    <nav aria-label="Footer"><a href="#market">Market</a><a href="#pot">Treasury</a><a href="#journey">Journey</a><a href="#forms">Forms</a></nav>
  </div>
</footer>

<script type="application/json" id="register-view">${JSON.stringify(viewModel(records)).replace(/</g, '\\u003c')}</script>
<script src="js/app.js" defer></script>
</body>
</html>
`;
}
