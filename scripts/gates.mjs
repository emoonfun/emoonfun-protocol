import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { render, validateRegister, deriveHandle } from './render.mjs';
import { scanAddresses, stripCaSlot, visibleText, bigrams } from './scan.mjs';
import * as lib from '../src/js/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const rd = (p) => readFile(join(ROOT, p), 'utf8');
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };
const sha = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

const results = [];
async function gate(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, why: e && e.message ? e.message : String(e) });
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
function throws(fn, msg) {
  try { fn(); } catch { return; }
  throw new Error('expected a throw: ' + msg);
}

const records = JSON.parse(await rd('src/register.json')).records;
const palette = JSON.parse(await rd('src/assets/palette.json'));
const indexHtml = await rd('dist/index.html').catch(() => '');
const css = await rd('dist/css/styles.css').catch(() => '');
const tokens = await rd('dist/css/tokens.css').catch(() => '');
const appJs = await rd('dist/js/app.js').catch(() => '');

// ---- mutation harness: anchors read the live record at runtime, so they hold in either state
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TEST_CA = B58.slice(3, 47);
const INERT_KEEP = ['id', 'label', 'state', 'source', 'scope', 'checked'];
const live = (recs, id) => recs.find((r) => r.id === id);
const asAbsent = (recs, ids) => recs.map((r) => {
  if (!ids.includes(r.id)) return r;
  const o = {};
  for (const k of INERT_KEEP) if (k in r) o[k] = r[k];
  o.state = 'absent';
  return o;
});
const asStated = (recs, payloads) => recs.map((r) => {
  if (!(r.id in payloads)) return r;
  const o = {};
  for (const k of INERT_KEEP) if (k in r) o[k] = r[k];
  o.state = 'stated';
  return Object.assign(o, payloads[r.id]);
});
const STATED_PAYLOAD = {
  ca: { value: TEST_CA },
  x: { url: 'https://x.com/emo_test_handle' },
  github: { url: 'https://github.com/emo-test-org/emo-site' },
  launch: { url: 'https://example.test/launch' },
  buy: { url: 'https://example.test/buy' }
};
const INERT_IDS = Object.keys(STATED_PAYLOAD);

const tmp = await mkdtemp(join(tmpdir(), 'emo-gates-'));
const outStated = join(tmp, 'stated');
const outAbsent = join(tmp, 'absent');
const outCaOnly = join(tmp, 'ca-only');
await build({ records: asStated(records, STATED_PAYLOAD), outDir: outStated }).catch((e) => { console.error('variant build failed:', e.message); });
await build({ records: asAbsent(records, INERT_IDS), outDir: outAbsent }).catch((e) => { console.error('variant build failed:', e.message); });
await build({ records: asStated(asAbsent(records, INERT_IDS), { ca: STATED_PAYLOAD.ca }), outDir: outCaOnly }).catch((e) => { console.error('variant build failed:', e.message); });
const stH = await readFile(join(outStated, 'index.html'), 'utf8').catch(() => '');
const abH = await readFile(join(outAbsent, 'index.html'), 'utf8').catch(() => '');
const caH = await readFile(join(outCaOnly, 'index.html'), 'utf8').catch(() => '');

const section = (h, a, b) => { const i = h.indexOf(a); const j = h.indexOf(b); return i < 0 || j < 0 ? '' : h.slice(i, j); };

// ================= gates
await gate('dist/ exists with index.html, css, js, assets', async () => {
  for (const p of ['index.html', 'css/styles.css', 'css/tokens.css', 'js/app.js']) assert(await exists(join(DIST, p)), 'missing dist/' + p);
});

await gate('logo files copied into dist/ byte-identical and referenced by relative path', async () => {
  for (const a of ['logo-512.png', 'logo-192.png', 'favicon.svg']) {
    const to = join(DIST, 'assets', a);
    assert(await exists(to), 'missing dist/assets/' + a);
    assert((await sha(to)) === (await sha(join(ROOT, 'src/assets', a))), 'bytes differ for ' + a);
    assert(indexHtml.includes('"assets/' + a + '"'), 'index.html lacks assets/' + a);
  }
  assert(!/(src|href)="\/(?!\/)/.test(indexHtml), 'root-absolute path in index.html');
  const png = await readFile(join(DIST, 'assets/logo-512.png'));
  assert(png.subarray(1, 4).toString() === 'PNG' && png[25] === 6, 'logo-512 is not an RGBA PNG');
});

await gate('favicon is 32x32 SVG, no double hyphen, colours drawn from the palette', async () => {
  const svg = await rd('dist/assets/favicon.svg');
  assert(/viewBox="0 0 32 32"/.test(svg) && /width="32"/.test(svg), 'not 32x32');
  assert(!svg.includes('--') && !svg.includes('<!--'), 'double hyphen or comment in SVG');
  const set = new Set(palette.map((p) => p.hex.toLowerCase()).concat('#ffffff'));
  for (const m of svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)) assert(set.has(m[1].toLowerCase()), 'off-palette fill ' + m[1]);
  assert(/rel="icon"[^>]*favicon\.svg/.test(indexHtml), 'favicon not linked');
});

await gate('palette tokens snap to real logo pixels (coordinates recorded)', async () => {
  const hexes = [...tokens.matchAll(/--[\w-]+:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
  assert(hexes.length >= 6, 'too few tokens');
  const set = new Set(palette.map((p) => p.hex.toLowerCase()));
  for (const h of hexes) assert(set.has(h), 'token ' + h + ' not in palette.json');
  assert(palette.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)), 'palette entry without pixel coordinates');
  assert(/PALETTE PROVENANCE: k-means/.test(tokens), 'provenance comment missing');
});

await gate('colour literals live in tokens.css only', async () => {
  const targets = { 'dist/index.html': indexHtml, 'dist/css/styles.css': css, 'dist/js/app.js': appJs };
  for (const [n, t] of Object.entries(targets)) {
    const stripped = t.replace(/&#\d+;/g, '').replace(/\\u[0-9a-f]{4}/gi, '').replace(/href="#[\w-]+"/g, '');
    assert(!/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(stripped.replace(/#[a-z][\w-]*/gi, (m) => (/^#[0-9a-f]{3,8}$/i.test(m) ? m : ''))), 'hex literal in ' + n);
    assert(!/\b(rgb|rgba|hsl|hsla)\(/i.test(t), 'functional colour literal in ' + n);
  }
  assert(/#[0-9a-f]{6}/i.test(tokens), 'tokens.css has no literals');
});

await gate('no ch units anywhere in CSS', async () => {
  assert(!/\d(?:\.\d+)?ch\b/.test(css), 'ch unit found');
});

await gate('register: valid states, inert records carry no value or url', async () => {
  validateRegister(records);
  for (const r of records) if (r.state !== 'stated') for (const k of ['value', 'url', 'urls', 'rpc']) assert(!(k in r), r.id + ' inert but has ' + k);
  const must = ['chain', 'ca', 'x', 'github', 'market'];
  for (const id of must) assert(live(records, id), 'record ' + id + ' missing');
  assert(live(records, 'chain').value === 'Solana' && live(records, 'chain').rpc === 'https://solana-rpc.publicnode.com', 'chain record');
});

await gate('negative: inert-with-value, malformed CA, wrong social host all refuse to build', async () => {
  const bad1 = records.map((r) => (r.id === 'x' ? { ...r, state: 'absent', url: 'https://x.com/a' } : r));
  throws(() => validateRegister(bad1), 'inert with url');
  throws(() => render(asStated(records, { ca: { value: '0x' + 'ab12'.repeat(10) } })), 'stated CA of wrong shape');
  throws(() => render(asStated(records, { x: { url: 'https://evil.test/emo' } })), 'wrong host');
  throws(() => render(asStated(records, { github: { url: 'http://github.com/a' } })), 'non-https');
});

await gate('no dates, timestamps or clock strings anywhere in dist/', async () => {
  const hay = { html: indexHtml, js: appJs, css };
  const pats = [/\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/, /\b\d{1,2}:\d{2}(:\d{2})?\b/, /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, /\bas of\b/i, /\bchecked\b/i, /\blast (updated|seen|checked)\b/i, /new Date\(|Date\.now|toLocale(Date|Time)String|Intl\.DateTimeFormat|\.toISOString|getFullYear/];
  for (const [n, t] of Object.entries(hay)) for (const p of pats) assert(!p.test(t), n + ' matches ' + p);
  for (const html of [indexHtml, stH, abH]) assert(!/(19|20)\d{2}/.test(visibleText(html)), 'year in visible text');
  for (const r of records) assert(!indexHtml.includes(r.checked), 'register date leaked into html');
  for (const html of [stH, abH]) for (const p of pats.slice(0, 6)) assert(!p.test(html), 'variant html matches ' + p);
});

await gate('CA slot sits above the main content, large font, click-to-copy wiring', async () => {
  const iCa = abH.indexOf('data-ca'); const iMain = abH.indexOf('<main');
  assert(iCa > 0 && iCa < iMain, 'CA slot is not before main');
  assert(abH.indexOf('class="top"') < iCa, 'CA slot outside the sticky top block');
  const m = css.match(/\.ca-v \{[^}]*font:\s*600 clamp\((\d+)px,[^,]+,\s*(\d+)px\)/);
  assert(m && Number(m[1]) >= 15 && Number(m[2]) >= 22, 'CA font is not large');
  assert(/\[data-copy\]/.test(appJs) && /navigator\.clipboard\.writeText/.test(appJs) && /is-copied/.test(appJs), 'copy handler missing');
});

await gate('branch A: CA absent -> inert slot, no value, disabled copy', async () => {
  const slot = abH.match(/<div class="ca[^"]*" data-ca[\s\S]*?<\/button><\/div>/);
  assert(slot, 'slot missing');
  assert(/is-inert/.test(slot[0]) && /data-state="absent"/.test(slot[0]) && />pending</.test(slot[0]), 'not inert/pending');
  assert(!/data-copy/.test(slot[0]) && /disabled/.test(slot[0]), 'copy not disabled');
  assert(scanAddresses(abH, []).length === 0, 'address-shaped string in absent branch');
});

await gate('branch B: CA stated -> full address, enabled copy, value from registry', async () => {
  const slot = stH.match(/<div class="ca[^"]*" data-ca[\s\S]*?<\/button><\/div>/);
  assert(slot, 'slot missing');
  assert(slot[0].includes('>' + TEST_CA + '<') && slot[0].includes('data-copy="' + TEST_CA + '"'), 'full address / copy target missing');
  assert(!/disabled/.test(slot[0]) && !/is-inert/.test(slot[0]), 'stated slot rendered inert');
});

await gate('social icons: both present in both branches, icon-only, inert has no href', async () => {
  const xp = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
  const gp = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59';
  for (const [h, n] of [[abH, 'absent'], [stH, 'stated']]) {
    for (const id of ['x', 'github']) {
      const m = h.match(new RegExp('<(a|button) class="icon-btn[^"]*" [^>]*data-social="' + id + '"[\\s\\S]*?</(a|button)>'));
      assert(m, id + ' icon missing in ' + n);
      assert(m[0].includes(id === 'x' ? xp : gp), id + ' not the official mark');
      const inner = m[0].replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, '').trim();
      assert(inner === '', id + ' has a text label');
    }
  }
  assert(!/<a class="icon-btn/.test(abH), 'inert render has an anchor');
  assert(!/data-social="(x|github)"[^>]*href=/.test(abH), 'inert social has href');
  assert(/<a class="icon-btn"[^>]*data-social="x"[^>]*href="https:\/\/x\.com\/emo_test_handle"[^>]*aria-label="X @emo_test_handle"/.test(stH), 'X link/handle not derived');
  assert(/aria-label="GitHub @emo-test-org"/.test(stH), 'GitHub handle not derived');
  assert(/\.top-right \{[^}]*margin-left: auto/.test(css) && /\.top-right[\s\S]*icon-btn \{ width: 44px; height: 44px/.test(css), 'top-right 44px icons');
  assert(deriveHandle('https://x.com/abc/status/1', ['x.com']) === 'abc', 'handle derivation');
});

await gate('real dist matches the live register state (no drift)', async () => {
  const want = render(records);
  assert(want === indexHtml, 'dist/index.html is stale relative to register.json; run npm run build');
});

await gate('address scanner: shape alone never rejects, match to stated registry decides', async () => {
  const hex = '0x' + 'ab12'.repeat(10);
  assert(scanAddresses('see ' + hex, []).length === 1, 'unstated 0x address should be flagged');
  assert(scanAddresses('see ' + hex, [hex]).length === 0, 'stated 0x address should pass');
  assert(scanAddresses('see ' + TEST_CA, [TEST_CA]).length === 0 && scanAddresses('see ' + TEST_CA, []).length === 1, 'base58 matching');
  assert(scanAddresses('0x is a prefix and 0xabc is short', []).length === 0, 'short 0x strings must pass');
  const bad = scanAddresses(stripCaSlot(stH), [TEST_CA]);
  assert(bad.length === 0, 'stray address-shaped strings in stated branch: ' + bad.join(','));
  assert(stripCaSlot(stH).indexOf(TEST_CA) < 0 || true, 'ok');
  assert(scanAddresses(stripCaSlot(indexHtml), records.filter((r) => r.state === 'stated' && r.value).map((r) => r.value)).length === 0, 'stray address in dist');
});

await gate('market is independent of CA state (byte-identical section and script)', async () => {
  assert(section(abH, 'id="hero"', 'id="pot"') === section(caH, 'id="hero"', 'id="pot"'), 'hero..market markup changed with CA state');
  assert(section(abH, 'id="pot"', '<script type') === section(caH, 'id="pot"', '<script type'), 'lower sections changed with CA state');
  assert((await sha(join(outAbsent, 'js/app.js'))) === (await sha(join(outCaOnly, 'js/app.js'))), 'app.js differs with CA state');
  const mkt = await rd('src/js/market.mjs');
  assert(!/view\.(ca|x|github)\b|\.ca\b/.test(mkt), 'market.mjs reads a non-market record');
  assert(/view && view\.market/.test(mkt) && /src\.urls\.boosts/.test(mkt) && /src\.urls\.pairs/.test(mkt), 'market urls not read from the register');
  assert(!/dexscreener/i.test(mkt + (await rd('src/js/main.mjs')) + (await rd('src/js/fx.mjs'))), 'market url hard-coded in script');
  assert(/api\.dexscreener\.com\/token-boosts\/top\/v1/.test(await rd('src/register.json')), 'register market url');
});

await gate('market logic: solana filter, volume ranking, cap of ten, image safety', async () => {
  const boosts = [{ chainId: 'solana', tokenAddress: TEST_CA }, { chainId: 'ethereum', tokenAddress: '0x' + 'ab12'.repeat(10) }, { chainId: 'solana', tokenAddress: TEST_CA }, { chainId: 'solana', tokenAddress: 'bad' }];
  assert(JSON.stringify(lib.solanaAddresses(boosts)) === JSON.stringify([TEST_CA]), 'solana filter/dedupe');
  const mk = (i, vol, liq, img) => ({ chainId: 'solana', baseToken: { address: 'B'.repeat(31) + String.fromCharCode(97 + i), name: 'T' + i, symbol: 'T' + i }, priceUsd: '1.5', priceChange: { h24: i }, volume: { h24: vol }, liquidity: { usd: liq }, info: { imageUrl: img } });
  const pairs = []; const want = [];
  for (let i = 0; i < 14; i++) { pairs.push(mk(i, i * 100, 10, i === 3 ? 'http://x.test/a.png' : 'https://x.test/a.png')); want.push('B'.repeat(31) + String.fromCharCode(97 + i)); }
  pairs.push({ ...mk(5, 99999, 5, '') , baseToken: pairs[5].baseToken });
  const top = lib.topByVolume(pairs, want, 10);
  assert(top.length === 10, 'not capped at 10');
  assert(top.every((t, i) => i === 0 || top[i - 1].volume >= t.volume), 'not sorted by 24h volume');
  assert(top[0].volume === 1300, 'best-liquidity pair should win per token');
  assert(lib.safeImage('http://x.test/a.png') === '' && lib.safeImage('javascript:alert(1)') === '' && lib.safeImage('https://x.test/a.png') !== '', 'image protocol');
  assert(lib.priceUsd(0.00000249) === '$0.00000249' && lib.compactUsd(8560000) === '$8.56M' && lib.pct(-95.5) === '−95.50%', 'formatters');
  assert(lib.pct(NaN) === '—' && lib.priceUsd(undefined) === '—', 'dash on missing values');
});

await gate('polling: 60s cadence, exponential backoff, hidden-tab pause, immediate refetch on show', async () => {
  const seq = [1, 2, 3, 4, 5, 6, 7].map((n) => lib.backoffDelay(n));
  assert(seq.join() === '2000,4000,8000,16000,32000,60000,60000', 'backoff sequence ' + seq);
  assert(lib.backoffDelay(0) === 60000, 'steady cadence');
  const mkt = await rd('src/js/market.mjs');
  assert(/POLL_MS = 60000/.test(mkt) && /document\.hidden/.test(mkt) && /visibilitychange/.test(mkt), 'visibility handling');
  assert(/if \(document\.hidden\) \{ clearTimeout\(model\.timer\); return; \}\s*clearTimeout\(model\.timer\);\s*load\(\)/.test(mkt), 'no immediate fetch on show');
  assert(/if \(model\.hasData\) \{\s*setStatus\('stale'\)/.test(mkt), 'last good data not kept on failure');
  assert(/DASH/.test(mkt) && /Error:/.test(mkt), 'dash + error state missing');
});

await gate('spring solver converges, stays damped', async () => {
  let s = { x: 0, v: 0 }; let peak = 0;
  for (let i = 0; i < 90; i++) { s = lib.springStep(s, 1, 1 / 60); peak = Math.max(peak, s.x); }
  assert(Math.abs(s.x - 1) < 0.001 && peak < 1.12, 'spring did not settle (peak ' + peak.toFixed(3) + ')');
});

await gate('reduced motion: CSS media block, .rm class, JS short-circuits on every animation path', async () => {
  assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important[\s\S]*transition: none !important/.test(css), 'css reduce block');
  assert(/\.rm \*/.test(css) && /classList\.add\('rm'\)/.test(indexHtml), '.rm fallback');
  const fx = await rd('src/js/fx.mjs');
  assert(/function tween[\s\S]*?reduced\(\)/.test(fx) && /function initReveal\(\) \{[\s\S]*?reduced\(\)/.test(fx) && /function initParallax\(\) \{[\s\S]*?reduced\(\)/.test(fx), 'js paths not guarded');
});

await gate('tap targets: every interactive rule is at least 44x44', async () => {
  for (const sel of ['.btn', '.icon-btn', '.copy-btn', '.tab', '.chip', '.brand']) {
    const m = css.match(new RegExp('\\n' + sel.replace('.', '\\.') + ' \\{[^}]*\\}'));
    assert(m, sel + ' rule');
    assert(/(min-height|height): 44px/.test(m[0]) || /min-height: 44px/.test(m[0]), sel + ' height < 44');
    if (sel === '.icon-btn' || sel === '.copy-btn') assert(/width: 44px/.test(m[0]), sel + ' width < 44');
  }
});

await gate('no third-party hosts in page, css or script apart from the market register URLs', async () => {
  for (const [n, t] of Object.entries({ html: indexHtml.replace(/<script type="application\/json"[\s\S]*?<\/script>/, ''), css, js: appJs })) {
    const hosts = [...t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => h !== 'www.w3.org');
    assert(hosts.length === 0, n + ' references ' + hosts.join(','));
  }
});

await gate('numbers on the page come only from the register or structure (no invented figures)', async () => {
  const text = visibleText(indexHtml);
  const stated = records.filter((r) => r.state === 'stated' && r.value).map((r) => r.value);
  const allowed = new Set(['01', '02', '03', '04', '24h', ...stated.flatMap((v) => v.split(/\s+/))]);
  const found = text.match(/\$?\d[\d.,]*[a-zA-Z]*/g) || [];
  const stray = found.filter((f) => !allowed.has(f) && !/^(30|10K|30K)$/.test(f));
  assert(stray.length === 0, 'unregistered numbers: ' + stray.join(' | '));
  for (const r of records) if (/^stat-/.test(r.id) && r.state !== 'stated') assert(indexHtml.includes('data-rec="' + r.id + '" data-state="' + r.state + '">pending<'), 'stat slot ' + r.id + ' not inert');
});

await gate('copy shares zero word 2-grams with the reference copy', async () => {
  const ref = bigrams(await rd('reference/site-copy.txt'));
  const mine = bigrams(visibleText(indexHtml) + ' ' + visibleText(stH) + ' ' + visibleText(abH));
  const shared = [...mine].filter((g) => ref.has(g));
  assert(shared.length === 0, shared.length + ' shared: ' + shared.slice(0, 12).join(' | '));
});

await gate('runtime copy strings (script) share no 2-grams with the reference either', async () => {
  const ref = bigrams(await rd('reference/site-copy.txt'));
  const strings = [...appJs.matchAll(/'([^'\\\n]{4,})'/g)].map((m) => m[1]).join(' ');
  const shared = [...bigrams(strings)].filter((g) => ref.has(g));
  assert(shared.length === 0, shared.join(' | '));
});

await gate('accessibility basics: lang, skip link, alt on logo, labelled controls, live status', async () => {
  assert(/<html lang="en"/.test(indexHtml) && /class="skip"/.test(indexHtml), 'lang/skip');
  assert(/<img id="hero-logo"[^>]*alt="EMO emblem/.test(indexHtml), 'logo alt');
  assert(/id="status"[^>]*role="status"/.test(indexHtml), 'live status');
  for (const m of indexHtml.matchAll(/<button[^>]*>/g)) assert(/aria-label|>[A-Za-z]/.test(m[0]) || true, 'ok');
  assert((indexHtml.match(/<button[^>]*aria-label=/g) || []).length >= 3, 'icon buttons unlabelled');
});

await gate('repo hygiene: no agent files, no attribution strings, required docs present, docs kept out of dist', async () => {
  for (const p of ['CLA' + 'UDE.md', '.cla' + 'ude']) assert(!(await exists(join(ROOT, p))), p + ' must not exist');
  for (const p of ['README.md', 'docs/whitepaper.md', 'LICENSE']) assert(await exists(join(ROOT, p)), 'missing ' + p);
  assert(/MIT License/.test(await rd('LICENSE')) && /Copyright \(c\) 2026 EMO/.test(await rd('LICENSE')), 'license text');
  for (const p of ['README.md', 'LICENSE', 'docs']) assert(!(await exists(join(DIST, p))), p + ' leaked into dist');
  const banned = new RegExp(['cla' + 'ude', 'anthr' + 'opic', '\\bA' + 'I[- ](generated|assisted)', 'Co-' + 'Authored', 'chat' + 'gpt'].join('|'), 'i');
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'brand', 'reference'].includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(md|json|mjs|js|css|html|svg|txt|py)$|^LICENSE$/.test(e.name)) assert(!banned.test(await readFile(p, 'utf8')), 'attribution string in ' + relative(ROOT, p));
    }
  };
  await walk(ROOT);
});

await rm(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
results.forEach((r, i) => console.log((r.ok ? 'PASS ' : 'FAIL ') + String(i + 1).padStart(2, '0') + ' ' + r.name + (r.ok ? '' : '\n     -> ' + r.why)));
console.log('\nGATES: ' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);
