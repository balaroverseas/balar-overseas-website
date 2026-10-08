import { drawDotMap } from './fx/dotmap.js';
import { sequencePlayer } from './fx/sequence.js';
import { $, $$, range, wait, initCommon, setupReveals, setupCurves, setupFooter, revealPage } from './common.js';

const { gsap, ScrollTrigger } = window;
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
function setupJourney(journey) {
  const sec = $('#services');
  const giant = $('#jGiant'), panel = $('#jPanel'), cards = $('#jCards'), rel = $('#jRel'), speed = $('.j-speed');
  const feats = $$('.j-feat'), relTitle = $('#jRel h2');
  // Blender stacker render plays over the first part of phase A, then hands over to the live scene
  const seqWrap = $('#jSeq');
  // frames are placed so the resting ground line (87% down) sits at 90% of the screen; the black
  // band's top edge follows the ground line Blender reports for each frame (meta.json)
  let ground = null;
  fetch('seq/stacker/meta.json').then((r) => r.json()).then((m) => { ground = m.ground; }).catch(() => {});
  const seq = sequencePlayer($('#stackSeq'), {
    dir: 'seq/stacker', count: 300, bleed: 0.15, anchor: [0.87, 0.9],
    // the reference shows the port scene smaller at first and closes in as the box turns:
    // draw the opening frames at 72% and grow to full size by the time the truck arrives
    scaleAt: (i) => 0.72 + 0.28 * Math.min(1, Math.max(0, (i - 95) / 85)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (i - 95) / 85))),
    onLayout: ({ y, h, H, frame }) => {
      const g = ground ? ground[frame] : 0.87;
      seqWrap.style.setProperty('--gh', `${Math.max(0, H - (y + h * g))}px`);
    },
  });
  // whole of phase A (journey.js A_END = 0.42); the fade happens just after it, while the live
  // scene is still holding the sequence's last framing
  const SEQ_END = 0.43, SEQ_PLAY = 0.42;
  let cardsMax = 0;
  const measure = () => { cardsMax = Math.max(0, cards.scrollWidth - innerWidth + 40); };
  measure();
  addEventListener('resize', measure);

  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      const P = s.progress;
      journey && journey.setProgress(P);
      seq.setProgress(range(P, 0, SEQ_PLAY));
      const so = 1 - range(P, SEQ_PLAY + 0.001, SEQ_END);
      seqWrap.style.opacity = so;
      seqWrap.style.visibility = so > 0 ? 'visible' : 'hidden';
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
  const flow = $('#whyFlow'), title = $('#whyTitle');
  // Like the reference: no text for the first ~65% (just the ship), then the title + 2-column
  // cards scroll up over it as one block at ~0.88× page speed (title centred at S≈0.7).
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      const S = s.progress;
      ship && ship.setProgress(S);
      const range = sec.offsetHeight - innerHeight;
      const titleMid = 0.5 * innerHeight - 0.5 * title.offsetHeight;   // title centred at S = 0.7
      const y = titleMid - (S - 0.7) * range * 0.88;
      flow.style.transform = `translate3d(0,${Math.min(y, innerHeight + 10)}px,0)`;
      sec.dataset.dynTheme = 'dark';
    },
  });
}

// ---------------------------------------------------------------- jet is a sticky still (CSS) — see .plane-stage
// ---------------------------------------------------------------- boot
async function boot() {
  await Promise.race([document.fonts.ready, wait(2500)]);
  const [globe, journey, ship] = await Promise.all([
    scene('globe', './scenes/globe.js', 'initGlobe', $('#globe'), $('#globeLabels')),
    scene('journey', './scenes/journey.js', 'initJourney', $('#journeyCanvas'), (v) => { $('#jSpeed').textContent = String(v).padStart(2, '0'); }),
    // ship: pre-rendered Blender sequence (top-down, climbs into the clouds)
    sequencePlayer($('#shipCanvas'), { dir: 'seq/ship', count: 200, fit: 'cover', lazy: true }),
    plMapReady,
  ]);

  setupHero(globe);
  setupJourney(journey);
  setupShip(ship);
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
