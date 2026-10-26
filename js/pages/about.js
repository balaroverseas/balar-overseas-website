import { $, $$, range, bootInnerPage } from '../common.js';
import { drawDotMap } from '../fx/dotmap.js';
import { routeGlobe } from '../fx/routeglobe.js';

const { gsap, ScrollTrigger } = window;

// Hero background slowly settles and drifts as you scroll
function hero() {
  gsap.to('#phBg', { scale: 1, duration: 2.4, ease: 'power3.out' });
  gsap.to('#phBg', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.page-hero', start: 'top top', end: 'bottom top', scrub: true } });
}

// "Our difference": one word stays active while the section is pinned
function difference() {
  const words = $$('#diff .dw'), leads = $$('#diff .dl');
  ScrollTrigger.create({
    trigger: '#diff', start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      const i = Math.min(words.length - 1, Math.floor(s.progress * words.length));
      words.forEach((w, k) => w.classList.toggle('on', k === i));
      leads.forEach((w, k) => w.classList.toggle('on', k === i));
    },
  });
}

// Vision → Mission → Objective: globe from space, then up into the blue sky
async function vmo() {
  let globe = null;
  try {
    const { initGlobe } = await import('../scenes/globe.js');
    globe = await initGlobe($('#vmoGlobe'), $('#vmoLabels'));
    globe.intro();
  } catch (e) { console.warn('[3D] globe unavailable', e); }
  const titles = $$('#vmo .vt'), copies = $$('#vmo .vmo-copy p');
  const sky = $('#vmoSky'), trails = $$('#vmo .vmo-trail'), jet = $('#vmo .vmo-jet');
  ScrollTrigger.create({
    trigger: '#vmo', start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      const p = s.progress;
      const i = Math.min(2, Math.floor(p * 3));
      titles.forEach((t, k) => t.classList.toggle('on', k === i));
      copies.forEach((t, k) => t.classList.toggle('on', k === i));
      globe && globe.setScroll(range(p, 0.3, 0.75) * 0.8);
      const skyIn = range(p, 0.55, 0.75);
      sky.style.opacity = skyIn;
      jet.style.opacity = skyIn;
      jet.style.transform = `translateY(${(1 - range(p, 0.6, 1)) * 30 - range(p, 0.6, 1) * 40}vh)`;
      trails.forEach((t) => { t.style.opacity = skyIn * 0.8; t.style.transform = `translateY(${(1 - range(p, 0.6, 1)) * 30 - range(p, 0.6, 1) * 40}vh)`; });
    },
  });
}

function faqTabs() {
  const cats = $$('#faqCats button'), panels = $$('.faq-panel');
  cats.forEach((b) => b.addEventListener('click', () => {
    cats.forEach((c) => c.classList.toggle('on', c === b));
    panels.forEach((p, k) => p.classList.toggle('on', k === +b.dataset.cat));
    setTimeout(() => ScrollTrigger.refresh(), 50);
  }));
}

bootInnerPage(async () => {
  hero();
  difference();
  routeGlobe($('#diffGlobe'), { phone: matchMedia('(max-width:759px)').matches }).catch(() => {});
  faqTabs();
  drawDotMap($('#tradeMap'), {
    gap: 8, dot: 2.6, color: 'rgba(255,255,255,.45)', flicker: true,
    markers: [{ lat: 21.17, lon: 72.83, color: '#ffb36b' }, { lat: 23.13, lon: 113.26, color: '#ffffff' }, { lat: 29.31, lon: 120.08, color: '#ffffff' }],
  }).catch(() => {});
  await vmo();
});
