import { drawDotMap } from './fx/dotmap.js';
import { sequencePlayer } from './fx/sequence.js';
import { $, $$, range, wait, initCommon, setupReveals, setupCurves, setupFooter, revealPage } from './common.js';

const { gsap, ScrollTrigger } = window;
const smooth = (t) => t * t * (3 - 2 * t);
// Scenes are loaded lazily so one failing WebGL scene never breaks the page.
async function scene(name, path, fn, ...args) {
  try {
    const mod = await import(path);
    return await mod[fn](...args);
  } catch (err) {
    console.warn(`[3D] ${name} unavailable:`, err);
    return null;
  }
}

// ---------------------------------------------------------------- content
const IMG = 'https://balaroverseas.com/wp-content/uploads/2026/02/';
const industries = [
  ['Home & Kitchenware', 'Modern household essentials & utility products.', 'home-and-kitchen-1-1200x800.png'],
  ['Health & Personal Care', 'Wellness, hygiene & healthcare solutions.', 'Health-and-Cosmetics-1200x800.png'],
  ['Baby Products', 'Safe, certified and trusted baby essentials.', 'baby-products-1200x800.png'],
  ['Beauty Products', 'Skincare, cosmetics & personal grooming.', 'beauty-and-cosmetics.png'],
  ['Home & Office Furniture', 'Functional and contemporary furniture.', 'home-and-office-furniture.png'],
  ['Mobile Accessories', 'High-demand electronic accessories.', 'mobile-accessories.png'],
  ['Sports, Fitness & Outdoors', 'Active lifestyle & performance gear.', 'sports-and-outdoor.png'],
  ['Toys & Games', 'Creative, educational & recreational.', 'toys-and-games.png'],
  ['Electronics', 'Gadgets, appliances & smart technology.', 'Electronics.png'],
];
$('#indGrid').innerHTML = industries.map(([t, d, img]) =>
  `<a class="ind-cell" href="industries.html"><img src="${IMG}${img}" alt="${t}" loading="lazy"><h3>${t}</h3><p>${d}</p></a>`).join('');

const { lenis } = initCommon({ startStopped: true });

// ---------------------------------------------------------------- preloader
const CITIES = ['Surat', 'Mumbai', 'Delhi', 'Ahmedabad', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Jaipur', 'Pune', 'Nhava Sheva', 'Mundra', 'Hazira', 'Kandla'];
const PORTS = ['Guangzhou', 'Yiwu', 'Shenzhen', 'Ningbo', 'Shanghai', 'Qingdao', 'Xiamen', 'Foshan', 'Dongguan', 'Tianjin', 'Hong Kong', 'Singapore', 'Dubai', 'Colombo'];
$('#plLeft').innerHTML = CITIES.map((c) => `<li>${c}</li>`).join('');
$('#plRight').innerHTML = PORTS.map((c) => `<li>${c}</li>`).join('');
const plItems = $$('.pl-list li');
const plMapReady = drawDotMap($('#plMap'), {
  gap: 6, dot: 2, color: '#5a5a5a', flicker: true,
  markers: [{ lat: 21.17, lon: 72.83, color: '#ff8a3d' }, { lat: 23.13, lon: 113.26, color: '#3b2cff' }],
}).catch(() => null);

const load = { v: 0 };
function paintLoad() {
  const v = Math.round(load.v);
  $('#plPct').textContent = String(v).padStart(3, '0');
  $('#plBar').style.width = v + '%';
  plItems.forEach((li, i) => li.classList.toggle('on', (i * 7 + v) % 9 === 0));
}
const fakeLoad = gsap.to(load, { v: 86, duration: 3, ease: 'power1.out', onUpdate: paintLoad });

// ---------------------------------------------------------------- hero (globe → atmosphere)
function setupHero(globe) {
  const hero = $('.hero');
  ScrollTrigger.create({
    trigger: hero, start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      const p = s.progress;
      globe && globe.setScroll(p);
      hero.dataset.dynTheme = p > 0.9 ? 'light' : 'dark';
    },
  });
  // copy is gone within the first ~200px, like the reference
  gsap.to('.hero-copy', { y: -90, opacity: 0, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: '+=200', scrub: true } });
  // glowing horizon: its top edge enters at the bottom after ~300px and climbs ~1.43 screen
  // heights per 1000px scrolled (measured off the reference at 720px tall: 100% @300, 64% @500,
  // 40% @700, 12% @900); the intro's own white fade takes over at the end
  const atmo = $('#atmo');
  const placeAtmo = () => {
    const s = Math.max(0, scrollY - (hero.getBoundingClientRect().top + scrollY));
    const k = 720 / innerHeight;                             // keep the same pace on other screen heights
    const top = (1.02 - 0.00143 * Math.max(0, s * k - 300)) * innerHeight;
    atmo.style.transform = `translate3d(0,${top}px,0)`;
  };
  ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', onUpdate: placeAtmo, onRefresh: placeAtmo });
}

// ---------------------------------------------------------------- journey overlays
function setupJourney(journey, port) {
  const sec = $('#services');
  const giant = $('#jGiant'), panel = $('#jPanel'), cards = $('#jCards'), rel = $('#jRel'), speed = $('.j-speed');
  const feats = $$('.j-feat'), relTitle = $('#jRel h2');
  // The port phase (P 0–0.5: stacker, stack, truck pulling away) is a Cycles render of the live
  // scene (blender/journey_render.py), shown over the page white; the live three.js scene takes
  // over in a short cross-fade once the stacker is out of shot.
  const P_PORT = 0.5;
  const seqWrap = $('#jSeq');
  seqWrap.style.background = '#fff';
  const ground = seqWrap.querySelector('.j-ground');
  if (ground) ground.style.display = 'none';      // the road is in the render
  const jCanvas = $('#journeyCanvas');
  jCanvas.style.opacity = 1;
  let cardsMax = 0;
  const measure = () => { cardsMax = Math.max(0, cards.scrollWidth - innerWidth + 40); };
  measure();
  addEventListener('resize', measure);

  // P runs to 1 one screen before the section ends: that last screen is the ship sliding over
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom 200%',
    onUpdate: (s) => {
      const P = s.progress;
      journey && journey.setProgress(P);
      if (port) port.setProgress(Math.min(1, P / P_PORT));
      const seqOn = 1 - range(P, P_PORT - 0.015, P_PORT);
      seqWrap.style.opacity = seqOn;
      seqWrap.style.visibility = seqOn > 0 ? 'visible' : 'hidden';
      // B: services panel
      // timings measured off the reference (fractions of the section)
      const show = range(P, 0.46, 0.52) - range(P, 0.69, 0.72);
      panel.style.transform = `translateY(${(1 - show) * 105}%)`;
      panel.style.visibility = show > 0 ? 'visible' : 'hidden';   // its glow otherwise peeks in at the bottom
      cards.style.transform = `translateX(${-range(P, 0.53, 0.69) * cardsMax}px)`;
      giant.style.opacity = range(P, 0.44, 0.48) - range(P, 0.69, 0.71);
      giant.style.transform = `translateX(${-range(P, 0.44, 0.72) * 55}%)`;
      speed.style.opacity = range(P, 0.42, 0.45);
      // C: reliability overlay
      // text only appears once the truck has turned and the junction has left the screen
      // measured off the reference (1280×720): heading enters at ~0.855 and parks at 15.5% by
      // 0.92; features follow each other 51% of the screen apart, first one at 75% at 0.9
      const H = innerHeight;
      rel.style.opacity = P > 0.845 ? 1 : 0;
      relTitle.style.transform = `translateY(${H * (1 - 0.845 * range(P, 0.855, 0.92))}px)`;
      feats.forEach((f, i) => { f.style.transform = `translateY(${H * (0.75 - 11.1 * (P - 0.9) + 0.51 * i)}px)`; });
    },
  });
}

// ---------------------------------------------------------------- ship overlays
function setupShip(ship) {
  const sec = $('#why');
  const flow = $('#whyFlow'), title = $('#whyTitle'), veil = $('#shipVeil');
  // Like the reference: no text for the first ~65% (just the ship), then the title + 2-column
  // cards scroll up over it as one block at ~0.88× page speed (title centred at S≈0.7).
  const apply = (S) => {
    // Blender frames are spread linearly over the section (frame = 1 + 199·S/0.97)
    ship && ship.setProgress(Math.min(1, S / 0.97));
    veil.style.opacity = 0.6 * range(S, 0.9, 1);   // the reference ends in a pale haze
    const span = sec.offsetHeight - innerHeight;
    const titleMid = 0.5 * innerHeight - 0.5 * title.offsetHeight;   // title centred at S = 0.7
    const y = titleMid - (S - 0.7) * span * 0.88;
    flow.style.transform = `translate3d(0,${Math.min(y, innerHeight + 10)}px,0)`;
    sec.dataset.dynTheme = 'dark';
  };
  // onUpdate never fires while the section is still scrolling in (progress stays 0), so set the
  // start state up front too — otherwise the title shows over the ship as the section enters
  apply(0);
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => apply(s.progress),
    onRefresh: (s) => apply(s.progress),
  });
}

// ---------------------------------------------------------------- jet over the testimonials
// Measured off the reference (1280×720, d = px scrolled past the section top): the white panel
// pins for 800px; the jet image (square, ~1.03× the screen width) crosses from x −1340 to +1444
// between d 200 and 1400 (eased, see Q), growing 1289 → 1660px and rising −282 → −466px; its
// shadow (0.857× size) slides from (+8, +50) to (+466, +432) relative to the jet.
function setupPlane() {
  const sec = $('#testimonials'), jet = $('.plane-stage .jet'), sh = $('.plane-stage .jet-shadow');
  if (!sec || !jet) return;
  const Q = [[0, 0], [0.167, 0.23], [0.333, 0.54], [0.5, 0.75], [0.667, 0.89], [0.833, 0.96], [1, 1]];
  const ease = (t) => {
    for (let i = 1; i < Q.length; i++) if (t <= Q[i][0]) return Q[i - 1][1] + (Q[i][1] - Q[i - 1][1]) * ((t - Q[i - 1][0]) / (Q[i][0] - Q[i - 1][0]));
    return 1;
  };
  const place = () => {
    const k = innerWidth / 1280;
    const d = (scrollY - (sec.getBoundingClientRect().top + scrollY)) * (720 / innerHeight);
    const q = ease(range(d, 200, 1400));
    const w = (1289 + 371 * q) * k, x = (-1340 + 2784 * q) * k, y = (-282 - 184 * q) * k;
    jet.style.transform = `translate3d(${x}px,${y}px,0) scale(${w / innerWidth})`;
    const sw = w * 0.857, sx = x + (8 + 458 * q) * k, sy = y + (50 + 382 * q) * k;
    sh.style.transform = `translate3d(${sx}px,${sy}px,0) scale(${sw / innerWidth})`;
  };
  ScrollTrigger.create({ trigger: sec, start: 'top bottom', end: 'bottom top', onUpdate: place, onRefresh: place });
  // the white panel (heading) holds still for 800px of scrolling while the jet passes
  ScrollTrigger.create({ trigger: '.testi-head', start: 'top top', end: () => '+=' + 800 * (innerHeight / 720), pin: true, invalidateOnRefresh: true });
}
// ---------------------------------------------------------------- boot
async function boot() {
  await Promise.race([document.fonts.ready, wait(2500)]);
  const [globe, journey, port, ship] = await Promise.all([
    scene('globe', './scenes/globe.js', 'initGlobe', $('#globe'), $('#globeLabels')),
    scene('journey', './scenes/journey.js', 'initJourney', $('#journeyCanvas'), (v) => { $('#jSpeed').textContent = String(v).padStart(2, '0'); }),
    // port phase: Cycles render of the stacker loading the truck
    sequencePlayer($('#stackSeq'), { dir: 'seq/port', count: 240, fit: 'cover' }),
    // ship: pre-rendered Blender sequence (top-down, climbs into the clouds)
    sequencePlayer($('#shipCanvas'), { dir: 'seq/ship', count: 200, fit: 'cover', lazy: true }),
    plMapReady,
  ]);

  setupHero(globe);
  setupJourney(journey, port);
  window.__journey = journey;   // frame-by-frame inspection handle (journey.inspect(p))
  setupShip(ship);
  setupPlane();
  // fetch the ship and jet frames a few screens before they are needed
  ScrollTrigger.create({ trigger: '#why', start: 'top 400%', once: true, onEnter: () => ship.load() });
  setupCurves();
  setupReveals();
  setupFooter();
  revealPage();

  fakeLoad.kill();
  gsap.to(load, {
    v: 100, duration: 0.6, onUpdate: paintLoad,
    onComplete: () => {
      gsap.to('#preloader', { yPercent: -100, duration: 1.1, ease: 'power4.inOut', delay: 0.15, onComplete: () => $('#preloader').remove() });
      document.body.classList.remove('loading');
      lenis && lenis.start();
      globe && globe.intro();
      gsap.from('.hero .wi', { yPercent: 115, duration: 1.3, ease: 'power4.out', stagger: 0.06, delay: 0.6 });
      gsap.from(['.hero .kicker', '.hero-copy p', '.hero .cta-row'], { y: 24, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.1, delay: 0.8 });
      ScrollTrigger.refresh();
    },
  });
}
boot();
