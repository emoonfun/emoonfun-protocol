// shared text helpers for the gates

const B58_RUN = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const HEX_RUN = /\b0x[0-9a-fA-F]{40}\b/g;

// address-shaped strings must match a stated registry value; nothing is rejected just for its shape
export function scanAddresses(text, statedValues) {
  const ok = new Set(statedValues);
  const bad = [];
  for (const re of [B58_RUN, HEX_RUN]) {
    for (const m of text.matchAll(re)) if (!ok.has(m[0])) bad.push(m[0]);
  }
  return bad;
}

// the CA slot is exempt from the scanner
export function stripCaSlot(html) {
  return html.replace(/<div class="ca[^"]*" data-ca[\s\S]*?<\/button><\/div>/, '');
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export function visibleText(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ');
  const attrs = [...body.matchAll(/\s(?:aria-label|alt|title)="([^"]*)"/g), ...body.matchAll(/name="description" content="([^"]*)"/g)].map((m) => m[1]).join(' ');
  const text = body.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ');
  return (text + ' ' + attrs).replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m]).replace(/\s+/g, ' ').trim();
}

const STOP = new Set('a an the of to in on at by for and or but with from as is are was be it its this that these those you your we our they their i me my us not no so if than then too very can will just into out up down over under about after before while do does did has have had'.split(' '));

export function words(t) {
  return t.toLowerCase().replace(/[\u2019]/g, "'").match(/[a-z0-9$][a-z0-9$'.]*[a-z0-9$]|[a-z0-9$]/g) || [];
}

// word 2-grams, ignoring pairs made only of function words
export function bigrams(t) {
  const w = words(t).map((x) => x.replace(/\.+$/, ''));
  const out = new Set();
  for (let i = 0; i + 1 < w.length; i++) {
    if (STOP.has(w[i]) && STOP.has(w[i + 1])) continue;
    out.add(w[i] + ' ' + w[i + 1]);
  }
  return out;
}
