import { initReveal, initParallax, initProgress, initSpotlight, initTabs, initScrollSpy, initCopy } from './fx.mjs';
import { initMarket } from './market.mjs';

function readView() {
  try {
    return JSON.parse(document.getElementById('register-view').textContent);
  } catch (e) {
    return {};
  }
}

const view = readView();

// browser chrome colour follows the token, not a literal
const navy = getComputedStyle(document.documentElement).getPropertyValue('--navy').trim();
if (navy) {
  const m = document.createElement('meta');
  m.name = 'theme-color';
  m.content = navy;
  document.head.appendChild(m);
}

initProgress();
initSpotlight();
initTabs();
initScrollSpy();
initCopy();
initReveal();
initParallax();
initMarket(view);
