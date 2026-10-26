// Shared behaviour for every page: smooth scroll, header, menu, cursor, FAQ,
// reveals, curved section hand-offs, footer effects and page-to-page transitions.
import { drawDotMap } from './fx/dotmap.js';
import { particleText } from './fx/particles.js';
import { avifPhotos } from './fx/avif.js';

const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const range = (p, a, b) => clamp01((p - a) / (b - a));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const LOGO = 'assets/img/logo-on-dark.webp';

export function splitWords(el, cls = 'w', inner = 'wi') {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) { frag.append(' '); return; }
      const w = document.createElement('span');
      w.className = cls;
      if (inner) {
        const i = document.createElement('span');
        i.className = inner;
        i.textContent = part;
        w.append(i);
      } else w.textContent = part;
      frag.append(w);
    });
    n.replaceWith(frag);
  });
}

// Every page starts at the top (scroll-driven scenes assume it)
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) scrollTo(0, 0);

// ---------------------------------------------------------------- page transition
const pt = document.createElement('div');
pt.className = 'pt';
pt.setAttribute('aria-hidden', 'true');
pt.innerHTML = `<div class="pt-panel"><img src="${LOGO}" alt=""><span class="mono">Balar Overseas</span></div>`;
document.body.append(pt);
const ptPanel = pt.querySelector('.pt-panel');
const arriving = sessionStorage.getItem('bo-pt') === '1';
sessionStorage.removeItem('bo-pt');
if (arriving) gsap.set(ptPanel, { yPercent: 0, '--top': '0vh', '--bottom': '0vh' });
else gsap.set(ptPanel, { yPercent: 100 });

/** Lift the transition curtain off the freshly loaded page. */
export function revealPage() {
  if (!arriving) return Promise.resolve();
  return new Promise((done) => {
    gsap.to(ptPanel, {
      yPercent: -100, '--bottom': '18vh', duration: 1.1, ease: 'power4.inOut', delay: 0.1,
      onComplete: () => { gsap.set(ptPanel, { yPercent: 100, '--bottom': '0vh' }); done(); },
    });
  });
}

function leaveTo(href) {
  gsap.fromTo(ptPanel, { yPercent: 100, '--top': '18vh' }, {
    yPercent: 0, '--top': '0vh', duration: 0.85, ease: 'power4.inOut',
    onComplete: () => { sessionStorage.setItem('bo-pt', '1'); location.href = href; },
  });
}
// back/forward cache: never show a stale curtain
addEventListener('pageshow', (e) => { if (e.persisted) gsap.set(ptPanel, { yPercent: 100 }); });

// ---------------------------------------------------------------- init
export function initCommon({ startStopped = false } = {}) {
  const yr = $('#yr');
  if (yr) yr.textContent = new Date().getFullYear();
  $$('.split').forEach((el) => splitWords(el));
  $$('.reveal-words').forEach((el) => splitWords(el, 'rw', null));
  avifPhotos();

  // phones: do not re-measure every trigger each time the browser's bars slide in or out
  ScrollTrigger.config({ ignoreMobileResize: true });
  // Smooth scroll
  let lenis = null;
  if (!reduceMotion && window.Lenis) {
    // lerp 0.12: the page settles sooner after the wheel stops, so text spends less time in motion
    // (it reads as faded while it glides). The position is also kept on whole pixels on its way,
    // so the letters are drawn sharp at every step instead of smeared between two rows.
    lenis = new window.Lenis({ lerp: 0.12, smoothWheel: true });
    if (typeof lenis.setScroll === 'function') { const put = lenis.setScroll.bind(lenis); lenis.setScroll = (v) => put(Math.round(v)); }
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    if (startStopped) lenis.stop();
    window.lenis = lenis;
  }

  // Menu
  const menu = $('#menuPanel'), menuBtn = $('#menuBtn');
  const setMenu = (open) => { menu.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', open); };
  menuBtn.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
  $('#menuClose').addEventListener('click', () => setMenu(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  addEventListener('pointerdown', (e) => { if (menu.classList.contains('open') && !menu.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false); });

  // Links: same-page anchors scroll smoothly, other pages get the curtain transition
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    const url = new URL(a.getAttribute('href'), location.href);
    if (url.origin !== location.origin) return;
    const samePage = url.pathname === location.pathname || (url.pathname.endsWith('/') && location.pathname.endsWith('/index.html')) || (location.pathname.endsWith('/') && url.pathname.endsWith('/index.html'));
    if (samePage && url.hash) {
      const target = $(url.hash);
      if (!target) return;
      e.preventDefault();
      setMenu(false);
      if (lenis) lenis.scrollTo(target, { duration: 2, offset: url.hash === '#top' ? 0 : -40 });
      else target.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (samePage && !url.hash) { e.preventDefault(); setMenu(false); lenis ? lenis.scrollTo(0, { duration: 2 }) : scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (/\.(html?)$|\/$/.test(url.pathname)) {
      e.preventDefault();
      setMenu(false);
      leaveTo(url.href);
    }
  });

  // Header: colour follows the section underneath, hides while scrolling down
  const head = $('.site-head');
  head.classList.add('at-top');
  let lastY = 0;
  // (a hit-test through every layer under the header: run a few times a second, not on every scroll
  // step - with one more when the scrolling stops)
  let probeAt = 0, probeLater = 0;
  const themeProbe = () => {
    const now = performance.now();
    clearTimeout(probeLater);
    if (now - probeAt < 120) { probeLater = setTimeout(themeProbe, 130); return; }
    probeAt = now;
    const probe = document.elementsFromPoint(innerWidth / 2, 80).find((el) => el.closest('[data-theme]') && !el.closest('.site-head') && !el.closest('.pt'));
    const sec = probe && probe.closest('[data-theme]');
    if (sec) head.dataset.theme = sec.dataset.dynTheme || sec.dataset.theme;
  };
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: (s) => {
      const y = s.scroll();
      head.classList.toggle('hide', y > 300 && y > lastY + 2 && !menu.classList.contains('open'));
      if (y < lastY - 2) head.classList.remove('hide');
      head.classList.toggle('at-top', y < 120);
      lastY = y;
      themeProbe();
    },
  });
  requestAnimationFrame(themeProbe);

  // Mono labels (nav, buttons, small links) shuffle their own letters on hover and settle from the left
  // in about half a second, like the reference's. One text node per label; the font is monospaced, so
  // the label keeps its width while it runs. Mouse only.
  if (finePointer && !reduceMotion) {
    const pick = (el) => {
      if (el._shNode !== undefined) return el._shNode;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim().length > 1) nodes.push(n);
      const n = nodes.length === 1 && /mono/i.test(getComputedStyle(nodes[0].parentElement).fontFamily) ? nodes[0] : null;
      return (el._shNode = n);
    };
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('a,button');
      if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
      const node = pick(el);
      if (!node || node._busy) return;
      node._busy = true;
      const orig = node.nodeValue, chars = [...orig], n = chars.length, steps = Math.min(12, Math.max(7, Math.round(n / 2)));
      let i = 0;
      const tick = () => {
        i++;
        if (i >= steps) { node.nodeValue = orig; node._busy = false; return; }
        const done = Math.floor((i / steps) * n);
        const rest = chars.slice(done).filter((c) => c.trim());
        for (let k = rest.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
        let r = 0;
        node.nodeValue = chars.map((c, k) => (k < done || !c.trim() ? c : rest[r++])).join('');
        setTimeout(tick, 55);
      };
      tick();
    });
  }

  // Cursor
  if (finePointer && !reduceMotion) {
    const c = $('.cursor');
    const qx = gsap.quickTo(c, 'x', { duration: 0.35, ease: 'power3' });
    const qy = gsap.quickTo(c, 'y', { duration: 0.35, ease: 'power3' });
    addEventListener('pointermove', (e) => { qx(e.clientX); qy(e.clientY); });
    document.addEventListener('pointerover', (e) => c.classList.toggle('hover', !!e.target.closest('a,button,input,select,textarea,.ind-cell,.d-card,.svc-row,.ind-row')));
  }

  // FAQ accordions
  $$('.qa button').forEach((b) => b.addEventListener('click', () => {
    const qa = b.parentElement, open = qa.classList.contains('open');
    $$('.qa', qa.parentElement).forEach((q) => { q.classList.remove('open'); $('.ans', q).style.maxHeight = 0; });
    if (!open) { qa.classList.add('open'); $('.ans', qa).style.maxHeight = $('.ans', qa).scrollHeight + 'px'; }
    setTimeout(() => ScrollTrigger.refresh(), 480);
  }));
  // home page: the first answer starts open, so the list does not read as six closed bars
  const firstQ = $('#faqList .qa');
  if (firstQ) {
    firstQ.classList.add('open');
    // measured again once fonts and layout have settled, or the last line is cut off
    const fit = () => { const q = $('#faqList .qa.open'); if (q) $('.ans', q).style.maxHeight = $('.ans', q).scrollHeight + 'px'; };
    fit();
    addEventListener('load', fit);
    addEventListener('resize', fit);
    setTimeout(fit, 1500);
  }

  // endless decorative animations run only while their element is on screen
  const rest = new IntersectionObserver((es) => es.forEach((e) => { e.target.style.animationPlayState = e.isIntersecting ? 'running' : 'paused'; }), { rootMargin: '100px' });
  $$('.intro-media img, .rings i, .f-track, .cycle-track, .route-dash').forEach((el) => rest.observe(el));

  // Keep trigger positions right when late images change the page height
  let refreshTimer = 0, lastH = 0;
  new ResizeObserver(() => {
    const h = document.body.scrollHeight;
    if (Math.abs(h - lastH) < 2) return;
    lastH = h;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
  }).observe(document.body);

  return { lenis };
}

// ---------------------------------------------------------------- reveals
export function setupReveals() {
  $$('.split').forEach((el) => {
    if (el.closest('.hero') || el.closest('.page-hero')) return;
    gsap.from($$('.wi', el), {
      yPercent: 115, duration: 1.1, ease: 'power4.out', stagger: 0.05,
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });
  $$('[data-count]').forEach((el) => {
    const end = +el.dataset.count, suf = el.dataset.suffix || '', o = { v: 0 };
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(o, { v: end, duration: 2.2, ease: 'power3.out', onStart: () => el.closest('.stat')?.classList.add('in'), onUpdate: () => { el.innerHTML = Math.round(o.v).toLocaleString('en-IN') + (suf ? `<i>${suf}</i>` : ''); } }),
    });
  });
  $$('.reveal-words').forEach((el) => {
    const words = $$('.rw', el);
    // desktop: every word is lit by the time the whole paragraph is in view (its last line 62% down), so
    // none is still pale when it reaches the middle of the screen, where it is read; it used to finish
    // only once the paragraph was in the top third
    const wide = matchMedia('(min-width:760px)').matches;
    ScrollTrigger.create({
      trigger: el, start: wide ? 'top 88%' : 'top 75%', end: wide ? 'bottom 62%' : 'bottom 35%',
      onUpdate: (s) => { const n = Math.round(s.progress * words.length); words.forEach((w, i) => w.classList.toggle('on', i < n)); },
    });
  });
  $$('.rise').forEach((el) => gsap.from(el, {
    y: 50, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 92%', once: true },
  }));
}

// Curved section hand-offs: the rounded top flattens as the section rises into view
export function setupCurves() {
  $$('.curve').forEach((el) => {
    gsap.fromTo(el, { '--r': '16vh' }, {
      '--r': '0vh', ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'top top', scrub: true },
    });
  });
}

const FOOT_LISTS = {
  ind: ['Home & Kitchenware', 'Health & Personal Care', 'Baby Products', 'Beauty Products', 'Home & Office Furniture', 'Mobile Accessories', 'Sports & Fitness', 'Toys & Games', 'Electronics'],
  svc: ['Market Research', 'Product Sourcing', 'Price Negotiation', 'Quality Control', 'Loading & Warehousing', 'Sea & Air Freight', 'Customs Clearance', 'Door-to-door Delivery'],
};

export function setupFooter() {
  // industries / services marquee with tabs (the list is doubled so the loop is seamless)
  const track = $('#fTrack');
  const fill = (key) => {
    const row = FOOT_LISTS[key].map((s) => `<span>${s} –</span>`).join('');
    track.innerHTML = row + row;
  };
  if (track) {
    fill('ind');
    $$('.f-tabbar button').forEach((b) => b.addEventListener('click', () => {
      $$('.f-tabbar button').forEach((x) => x.classList.toggle('on', x === b));
      fill(b.dataset.t);
    }));
  }
  const map = $('#footMap');
  if (map) drawDotMap(map, { gap: 9, dot: 3, color: '#dadada', markers: [{ lat: 21.17, lon: 72.83, color: '#3b2cff' }, { lat: 23.13, lon: 113.26, color: '#3b2cff' }] }).catch(() => {});
  const pts = $('#footParticles');
  if (pts) particleText(pts, 'BALAROVERSEAS');
  // back to the top of this page, from the footer of every page
  const legal = $('.f-legal');
  if (legal && !$('.f-up')) {
    // a round badge: "back to top" turning around a blue core, the arrow flies off and comes back on hover
    legal.insertAdjacentHTML('beforeend', `<button class="f-up" type="button" aria-label="Back to top">
      <svg class="f-up-ring" viewBox="0 0 100 100" aria-hidden="true"><defs><path id="fUpPath" d="M50 50m-39 0a39 39 0 1 1 78 0a39 39 0 1 1-78 0"/></defs>
        <text><textPath href="#fUpPath" textLength="244">&#160;BACK TO TOP&#160;&#160;•&#160;&#160;BACK TO TOP&#160;&#160;•&#160;</textPath></text></svg>
      <span class="f-up-core" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" transform="translate(.5 0)" fill="currentColor"/></svg></span>
    </button>`);
    $('.f-up').addEventListener('click', () => (window.lenis ? window.lenis.scrollTo(0, { duration: 1.6 }) : scrollTo({ top: 0, behavior: 'smooth' })));
  }
  setupSocialProof();
}

// Instagram follower count. The number lives in data/social.json (kept fresh by the scheduled job
// in .github/workflows/instagram-count.yml), never in the markup, so every page shows the same,
// current figure. 11000 -> "11K+", 11480 -> "11.4K+", 1250000 -> "1.2M+".
const shortCount = (n) => {
  const cut = (v, unit) => `${(Math.floor(v * 10) / 10).toString().replace(/\.0$/, '')}${unit}+`;
  if (n >= 1e6) return cut(n / 1e6, 'M');
  if (n >= 1e3) return cut(n / 1e3, 'K');
  return String(n);
};
async function setupSocialProof() {
  // footer: the Instagram link becomes a wide button that carries the count
  const ig = $('.f-soc-icons a[href*="instagram"]');
  if (ig && !ig.classList.contains('ig-wide')) {
    ig.classList.add('ig-wide');
    ig.insertAdjacentHTML('beforeend', '<b data-ig-count></b><i>followers</i><u>Follow →</u>');
  }
  let n = 0;
  try {
    const r = await fetch(`data/social.json?t=${Math.floor(Date.now() / 3.6e6)}`);   // at most an hour stale
    n = Number((await r.json()).instagram.followers) || 0;
  } catch (e) { /* offline or missing: the fallback below stands */ }
  const label = n ? shortCount(n) : '';
  $$('[data-ig-count]').forEach((el) => { if (label) el.textContent = label; else if (!el.textContent) el.closest('.ig-proof,.ig-wide')?.classList.add('no-count'); });
}

// Horizontal scrollers: a tall section whose sticky track slides sideways as you scroll
export function setupHScroll() {
  $$('.hscroll').forEach((sec) => {
    const track = $('.hs-track', sec);
    const size = () => { sec.style.height = `${track.scrollWidth - innerWidth + innerHeight * 1.2}px`; };
    size();
    addEventListener('resize', size);
    gsap.to(track, {
      x: () => -(track.scrollWidth - innerWidth + 40), ease: 'none',
      scrollTrigger: { trigger: sec, start: 'top top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true },
    });
  });
}

/** Standard boot for inner pages. */
export async function bootInnerPage(extra) {
  initCommon();
  await Promise.race([document.fonts.ready, wait(2000)]);
  if (extra) await extra();
  avifPhotos();          // (rows built by the page itself)
  setupHScroll();
  setupCurves();
  setupReveals();
  setupFooter();
  ScrollTrigger.refresh();
  await revealPage();
  gsap.from('.page-hero .wi', { yPercent: 115, duration: 1.2, ease: 'power4.out', stagger: 0.06 });
  gsap.from('.page-hero .ph-fade', { y: 24, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.1, delay: 0.3 });
}
