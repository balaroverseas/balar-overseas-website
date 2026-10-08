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
  gsap.to('.hero-copy', { y: -160, opacity: 0, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: '22% top', scrub: true } });
  // the atmosphere is fully white exactly when the hero ends, so the intro follows with no gap
  gsap.fromTo('#atmo', { y: 0 }, {
    y: () => -2.85 * innerHeight, ease: 'none',
    scrollTrigger: { trigger: hero, start: '12% top', end: 'bottom bottom', scrub: true, invalidateOnRefresh: true },
  });
  gsap.to('.hero-globe', { opacity: 0, ease: 'none', scrollTrigger: { trigger: hero, start: '30% top', end: '50% top', scrub: true } });
}

// ---------------------------------------------------------------- journey overlays
function setupJourney(journey) {
  const sec = $('#services');
  const giant = $('#jGiant'), panel = $('#jPanel'), cards = $('#jCards'), rel = $('#jRel'), speed = $('.j-speed');
  const feats = $$('.j-feat');
  // Blender stacker render plays over the first part of phase A, then hands over to the live scene
  const seqWrap = $('#jSeq');
  // frames are placed so the resting ground line (87% down) sits at 90% of the screen; the black
  // band's top edge follows the ground line Blender reports for each frame (meta.json)
  let ground = null;
  fetch('seq/stacker/meta.json').then((r) => r.json()).then((m) => { ground = m.ground; }).catch(() => {});
  const seq = sequencePlayer($('#stackSeq'), {
    dir: 'seq/stacker', count: 300, bleed: 0.15, anchor: [0.87, 0.9],
    onLayout: ({ y, h, H, frame }) => {
      const g = ground ? ground[frame] : 0.87;
      seqWrap.style.setProperty('--gh', `${Math.max(0, H - (y + h * g))}px`);
    },
  });
  // whole of phase A (journey.js A_END = 0.28); the fade happens just after it, while the live
  // scene is still holding the sequence's last framing
  const SEQ_END = 0.29, SEQ_PLAY = 0.28;
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
      const show = range(P, 0.3, 0.37) - range(P, 0.6, 0.65);
      panel.style.transform = `translateY(${(1 - show) * 105}%)`;
      panel.style.visibility = show > 0 ? 'visible' : 'hidden';   // its glow otherwise peeks in at the bottom
      cards.style.transform = `translateX(${-range(P, 0.37, 0.59) * cardsMax}px)`;
      giant.style.opacity = range(P, 0.25, 0.3) - range(P, 0.6, 0.64);
      giant.style.transform = `translateX(${-range(P, 0.25, 0.64) * 55}%)`;
      speed.style.opacity = range(P, 0.27, 0.3);
      // C: reliability overlay
      // text only appears once the truck has turned and the junction has left the screen
      const r = range(P, 0.75, 0.79);
      rel.style.opacity = r;
      const idx = Math.min(feats.length - 1, Math.floor(range(P, 0.79, 0.99) * feats.length));
      feats.forEach((f, i) => f.classList.toggle('on', r > 0.5 && i === idx));
    },
  });
}

// ---------------------------------------------------------------- ship overlays
function setupShip(ship) {
  const sec = $('#why');
  const title = $('#whyTitle'), veil = $('#shipVeil');
  const cards = $$('.why-card');
  const layout = () => {
    const mob = innerWidth < 900;
    cards.forEach((c, i) => {
      const left = i % 2 === 0;
      c.style.left = mob ? `calc(50% - ${c.offsetWidth / 2}px)` : left ? '8vw' : 'auto';
      c.style.right = !mob && !left ? '8vw' : 'auto';
      c.style.top = '50%';
    });
  };
  layout();
  addEventListener('resize', layout);
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => {
      const S = s.progress;
      ship && ship.setProgress(S);
      title.style.opacity = 1 - range(S, 0.1, 0.16);
      title.style.transform = `translateY(${-range(S, 0.06, 0.16) * 120}px)`;
      cards.forEach((c, i) => {
        const a = 0.14 + i * 0.105, t = range(S, a, a + 0.24);
        const y = (1 - t * 2) * innerHeight * 0.55;
        c.style.transform = `translateY(calc(-50% + ${y}px))`;
        c.style.opacity = Math.min(1, Math.sin(t * Math.PI) * 2.2);
      });
      veil.style.opacity = range(S, 0.9, 1);
      sec.dataset.dynTheme = S > 0.93 ? 'light' : 'dark';
    },
  });
}

// ---------------------------------------------------------------- plane + arc
function setupPlane(plane) {
  if (!plane) return;
  const stage = $('.plane-stage'), why = $('#why'), testi = $('#testimonials');
  const pageTop = (el) => el.getBoundingClientRect().top + scrollY;
  // from the cloudy end of the ship climb until the testimonials are one screen in
  ScrollTrigger.create({
    start: () => pageTop(why) + why.offsetHeight - 2.1 * innerHeight,
    end: () => pageTop(testi) + 0.9 * innerHeight,
    invalidateOnRefresh: true,
    onUpdate: (s) => plane.setProgress(s.progress),
    onToggle: (s) => { stage.style.visibility = s.isActive ? 'visible' : 'hidden'; },
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  await Promise.race([document.fonts.ready, wait(2500)]);
  const [globe, journey, ship, plane] = await Promise.all([
    scene('globe', './scenes/globe.js', 'initGlobe', $('#globe'), $('#globeLabels')),
    scene('journey', './scenes/journey.js', 'initJourney', $('#journeyCanvas'), (v) => { $('#jSpeed').textContent = String(v).padStart(2, '0'); }),
    // ship: pre-rendered Blender sequence (top-down, climbs into the clouds)
    sequencePlayer($('#shipCanvas'), { dir: 'seq/ship', count: 200, fit: 'cover', lazy: true }),
    // jet: pre-rendered Blender sequence on a transparent background
    sequencePlayer($('#planeCanvas'), { dir: 'seq/plane', count: 180, bleed: 0.6, lazy: true }),
    plMapReady,
  ]);

  setupHero(globe);
  setupJourney(journey);
  setupShip(ship);
  setupPlane(plane);
  // fetch the ship and jet frames a few screens before they are needed
  ScrollTrigger.create({ trigger: '#why', start: 'top 400%', once: true, onEnter: () => ship.load() });
  ScrollTrigger.create({ trigger: '#why', start: 'top bottom', once: true, onEnter: () => plane.load() });
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
