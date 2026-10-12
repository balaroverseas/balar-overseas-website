import { drawDotMap } from './fx/dotmap.js';
import { sequencePlayer } from './fx/sequence.js';
import { $, $$, range, wait, splitWords, initCommon, setupReveals, setupCurves, setupFooter, revealPage } from './common.js';

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
const IMG = 'assets/img/photos/';
const industries = [
  ['Home & Kitchenware', 'Modern household essentials & utility products.', 'home-and-kitchen-1-1200x800.webp'],
  ['Health & Personal Care', 'Wellness, hygiene & healthcare solutions.', 'Health-and-Cosmetics-1200x800.webp'],
  ['Baby Products', 'Safe, certified and trusted baby essentials.', 'baby-products-1200x800.webp'],
  ['Beauty Products', 'Skincare, cosmetics & personal grooming.', 'beauty-and-cosmetics.webp'],
  ['Home & Office Furniture', 'Functional and contemporary furniture.', 'home-and-office-furniture.webp'],
  ['Mobile Accessories', 'High-demand electronic accessories.', 'mobile-accessories.webp'],
  ['Sports, Fitness & Outdoors', 'Active lifestyle & performance gear.', 'sports-and-outdoor.webp'],
  ['Toys & Games', 'Creative, educational & recreational.', 'toys-and-games.webp'],
  ['Electronics', 'Gadgets, appliances & smart technology.', 'Electronics.webp'],
];
// bento grid: two large tiles, one wide, the rest small; each on its own soft tint
// Phones: the browser's own bars slide away and back as the page is scrolled, and innerHeight changes
// with them every time. The pinned stages are sized in svh (the height with the bars showing), so the
// scroll maths below uses that fixed height as well - otherwise sections change length, and everything
// is laid out again, each time the bars move.
const PHONE_MQ = matchMedia('(max-width:759px)');
const svhProbe = document.createElement('div');
svhProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100svh;visibility:hidden;pointer-events:none';
document.body.appendChild(svhProbe);
const VH = () => (PHONE_MQ.matches && svhProbe.offsetHeight) || innerHeight;

const IND_TINT = ['#e9edff', '#ffe9dc', '#e3f6ee', '#ffe6ef', '#eef0f3', '#e6f3ff', '#fff3d6', '#f1e8ff', '#e2f4f7'];
const IND_SIZE = { 0: 'big', 7: 'big', 8: 'wide' };
$('#indGrid').innerHTML = industries.map(([t, d, img], i) =>
  `<div class="ind-cell ${IND_SIZE[i] || ''}" style="--t:${IND_TINT[i]}"><span class="ind-no">${String(i + 1).padStart(2, '0')}</span><span class="ind-go" aria-hidden="true">→</span><img src="${IMG}${img}" alt="${t}" loading="lazy"><h3>${t}</h3><p>${d}</p></div>`).join('');

const { lenis } = initCommon({ startStopped: true });

// ---------------------------------------------------------------- preloader
const CITIES = ['Surat', 'Mumbai', 'Delhi', 'Ahmedabad', 'Kolkata', 'Chennai', 'Bengaluru', 'Hyderabad', 'Jaipur', 'Pune', 'Nhava Sheva', 'Mundra', 'Hazira', 'Kandla'];
const PORTS = ['Guangzhou', 'Yiwu', 'Shenzhen', 'Ningbo', 'Shanghai', 'Qingdao', 'Xiamen', 'Foshan', 'Dongguan', 'Tianjin', 'Hong Kong', 'Singapore', 'Dubai', 'Colombo'];
// Timings and eases are the reference's own (read off its loader): only the motion is taken, the
// words, the lists and the map are ours.
const PL_FIRST = sessionStorage.getItem('bo-loaded') !== '1';
const pre = $('#preloader');
const PL_ROWS = 9;                                       // rows on show in each list window
$('#plLeft').innerHTML = [...CITIES, ...CITIES].map((c) => `<li>${c}</li>`).join('');
$('#plRight').innerHTML = [...PORTS, ...PORTS].map((c) => `<li>${c}</li>`).join('');
const plMapReady = drawDotMap($('#plMap'), {
  gap: 6, dot: 2, color: '#5a5a5a', flicker: true,
  markers: [{ lat: 21.17, lon: 72.83, color: '#ff8a3d' }, { lat: 23.13, lon: 113.26, color: '#3b2cff' }],
}).catch(() => null);

// the count climbs in fits and starts, like something really loading
const FAKE = [[0, 0], [0.1, 0.3], [0.35, 0.4], [0.45, 0.65], [0.6, 0.7], [0.8, 0.8], [0.85, 0.95], [1, 1]];
const fakeEase = (t) => {
  for (let i = 1; i < FAKE.length; i++) if (t <= FAKE[i][0]) return FAKE[i - 1][1] + (FAKE[i][1] - FAKE[i - 1][1]) * ((t - FAKE[i - 1][0]) / (FAKE[i][0] - FAKE[i - 1][0]));
  return 1;
};
const load = { v: 0, ready: false };
function paintLoad() {
  const v = Math.min(load.ready ? 100 : 99, Math.round(load.v));     // 100 only once the page really is ready
  $('#plPct').textContent = String(v).padStart(3, '0');
  $('#plBar').style.width = v + '%';
}

let plIntro, plExit;
if (PL_FIRST) {
  const lists = [$('#plLeft'), $('#plRight')], rise = $$('.pl-rise');
  const rows = lists.map((l) => [...l.children]);
  // where brand and count rest (mid-height: 50% on a desktop, set per side by the phone layout), and
  // the height of a list row (19 px on a desktop, 11.45 px at 375 wide)
  rise.forEach((el) => { el._rest = getComputedStyle(el).bottom; });
  const RH = rows[0][0].offsetHeight || 19;
  plIntro = gsap.timeline()
    // map, brand and count fade up; the little ring turns once
    .to('#plMap', { autoAlpha: 1, duration: 1, ease: 'power3.inOut' }, 0)
    .to(rise, { autoAlpha: 1, duration: 1, ease: 'power3.inOut' }, 0)
    .to('.pl-ic', { rotation: '+=360', duration: 1, ease: 'none' }, 0);
  // brand and count rise to stand above the lists, whose first rows come in one by one...
  const move = gsap.timeline()
    .to(rise, { bottom: '100%', duration: 0.6, ease: 'power3.out' }, 0);
  rows.forEach((r) => {
    gsap.set(r.slice(0, PL_ROWS), { yPercent: 100 });
    move.to(r.slice(0, PL_ROWS), { yPercent: 0, autoAlpha: 1, duration: 0.3, stagger: 0.2 }, 0.2);
  });
  move.set(rows.flatMap((r) => r.slice(PL_ROWS)), { autoAlpha: 1 }, '>');
  // ...then both lists tick upward a row at a time
  for (let k = 1; k <= PL_ROWS; k++) move.to(lists, { y: -k * RH, duration: 0.3, ease: 'power2.inOut' }, '>+0.1');
  const run = Math.max(0, move.duration() - 0.4);
  move.to('.pl-ic', { rotation: '+=90', duration: 0.2, ease: 'none' }, 0)
    .to('.pl-ic', { rotation: '+=1080', duration: run, ease: fakeEase }, 0.6)
    .to(load, { v: 100, duration: run, ease: fakeEase, onUpdate: paintLoad }, 0.6);
  plIntro.add(move, '-=0.6').timeScale(1.25);
  plExit = (onPage) => gsap.timeline({ onStart: () => { load.ready = true; load.v = 100; paintLoad(); } })
    // rows drop away, brand and count sink back to the middle, then everything fades and the loader lifts
    .to(rise, { bottom: (i, el) => el._rest, duration: 0.8, ease: 'power3.inOut' }, 0)
    .to(rows[0].slice(PL_ROWS, 2 * PL_ROWS), { yPercent: 100, autoAlpha: 0, duration: 0.4, stagger: 0.05, ease: 'power3.inOut' }, 0)
    .to(rows[1].slice(PL_ROWS, 2 * PL_ROWS), { yPercent: 100, autoAlpha: 0, duration: 0.4, stagger: 0.05, ease: 'power3.inOut' }, 0)
    .to(['#plMap', '.pl-col', '.pl-bar'], { autoAlpha: 0, duration: 0.4, ease: 'power3.inOut' }, 0.8)
    .call(onPage, null, 0.7)
    .to(pre, { autoAlpha: 0, duration: 0.5, ease: 'power2.inOut' })
    .timeScale(1.25);
} else {
  pre.classList.add('again');
  const logo = $('.pl-page-logo'), circs = $$('.pl-circ');
  gsap.set(circs, { xPercent: -50, yPercent: -50 });
  plIntro = gsap.timeline()
    .fromTo(circs, { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 1, ease: 'back.out(2)', stagger: 0.08 }, 0)
    .fromTo(logo, { autoAlpha: 0, scale: 1.15 }, { autoAlpha: 1, scale: 1, duration: 0.4 }, 0.65);
  plExit = (onPage) => gsap.timeline()
    // rings blow outward and blur away from the outside in; the page opens through three discs
    .to([logo, ...circs], { scale: (i) => (i === 0 ? 0.8 : 3), filter: 'blur(6px)', autoAlpha: 0, duration: 0.6, ease: 'circ.inOut', stagger: { each: 0.1, from: 'end' } }, 0)
    .fromTo('.pl-mask', { width: '0vmax', height: '0vmax' }, { width: '135vmax', height: '135vmax', duration: 0.6, ease: 'circ.inOut', stagger: 0.18 }, 0.8)
    .call(onPage, null, 0.75);
}

// ---------------------------------------------------------------- hero text: painted in line by line
// As the reference brings its hero text in (read off its page): every line is filled from the left
// by a gradient - text colour behind, the brand blue at the leading edge, nothing ahead of it - over
// 1.2 s (power1.inOut), each line 0.1 s after the one before. Each word carries the gradient at the
// width of its line (--lw) and shifted by its place in it (--wx), so the sweep runs unbroken.
function paintIn(els, delay = 0) {
  const lines = [];
  els.filter(Boolean).forEach((el) => {
    if (!el.querySelector('.wi, .pw')) splitWords(el, 'pw', null);
    const col = getComputedStyle(el).color, words = $$('.wi, .pw', el);
    let cur = null, top = -1e9;
    words.forEach((w) => {
      const r = w.getBoundingClientRect();
      if (Math.abs(r.top - top) > r.height * 0.5) { cur = { words: [], l: r.left, r: r.right }; lines.push(cur); top = r.top; }
      cur.words.push([w, r]); cur.l = Math.min(cur.l, r.left); cur.r = Math.max(cur.r, r.right);
      w.style.setProperty('--pc', col);
    });
  });
  lines.forEach((ln, i) => {
    const ws = ln.words.map(([w, r]) => { w.style.setProperty('--lw', `${ln.r - ln.l}px`); w.style.setProperty('--wx', `${r.left - ln.l}px`); w.classList.add('paint'); return w; });
    gsap.fromTo(ws, { '--g': -4 }, { '--g': 130, duration: 1.2, ease: 'power1.inOut', delay: delay + i * 0.1, onComplete: () => ws.forEach((w) => w.classList.remove('paint')) });
  });
}

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
    const k = 720 / VH();                                    // keep the same pace on other screen heights
    const top = (1.02 - 0.00143 * Math.max(0, s * k - 300)) * VH();
    atmo.style.transform = `translate3d(0,${top}px,0)`;
  };
  ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', onUpdate: placeAtmo, onRefresh: placeAtmo });
}

// ---------------------------------------------------------------- journey overlays
function setupJourney(journey, port) {
  const sec = $('#services');
  const giant = $('#jGiant'), panel = $('#jPanel'), cards = $('#jCards'), rel = $('#jRel'), speed = $('.j-speed');
  const feats = $$('.j-feat'), relTitle = $('#jRel h2'), relL = $('.j-rel-left'), relR = $('.j-rel-right');
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

  // Phones (as the reference lays this section out there): no services panel. Once the truck is
  // on the road seen from above it moves over to a strip on the left, a dark panel the colour of
  // the road comes in from the right, and everything — services heading, the services as a list,
  // then the reliability heading and features — scrolls up that panel as one column at page
  // speed. The truck is back mid-screen for the ship.
  const phone = matchMedia('(max-width:759px)');
  const col = document.createElement('div'), panelHead = $('.j-panel-head');
  col.className = 'j-col';
  const place = () => {
    if (phone.matches) { col.append(panelHead, cards, relL, relR); rel.append(col); }
    else { panel.append(panelHead, cards); rel.append(relL, relR); col.remove(); }
  };
  place();
  // the phone staging (see journey.js): its own portrait frames, then the live scene, on the dark page
  const mobNew = new URLSearchParams(location.search).has('mob') || phone.matches, sticky = $('.journey-sticky');
  // Phones, new staging - the reference's own flow there, read off its page every 150 px at 375x812
  // (all px below are at a 375 px wide screen and scale with the width): the stage is pinned for the
  // first 1478 px (spreader down 520-600, lift 680-780, view tips up 810-930, truck in 1050-1350, box
  // down by ~1440); from 1478 the stage leaves upward at page speed while the truck stays put and the
  // text column comes up from the bottom edge at page speed; the big word slides left 1:1 with the
  // scroll from 199 px (stopping after 1299 px) and leaves upward at page speed from 1573.
  const K = () => innerWidth / 375;
  const fitPhone = () => {
    sec.classList.toggle('mob-new', mobNew && phone.matches);
    giant.dataset.full ??= giant.textContent;
    giant.textContent = mobNew && phone.matches ? 'Our services' : giant.dataset.full;      // the reference shows the words once there
    if (mobNew && phone.matches) { seqWrap.style.background = 'transparent'; if (!MOB_SEQ) { seqWrap.style.opacity = 0; seqWrap.style.visibility = 'hidden'; } else jCanvas.style.opacity = 0; sticky.style.background = 'linear-gradient(#fff 0 40.6%, #111 40.6%)'; }
    sec.style.height = mobNew && phone.matches ? `${1478 * K() + col.offsetHeight + 1.4 * VH() + 2 * VH()}px` : '';
  };
  fitPhone();
  // (a phone's height-only changes are its bars moving, not a new layout)
  let fitW = innerWidth;
  addEventListener('resize', () => { if (phone.matches && innerWidth === fitW) return; fitW = innerWidth; fitPhone(); });
  phone.addEventListener('change', () => { place(); fitPhone(); ScrollTrigger.refresh(); });

  // P runs to 1 one screen before the section ends: that last screen is the ship sliding over
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom 200%',
    onUpdate: (s) => {
      const raw = s.progress, H = VH(), mob = phone.matches;
      let P = raw, P0 = 0, Pb = 0;
      if (mob) {
        // the scene is run through faster (up to the top view on the last road, 0.9) so that the
        // rest of the section is left for the column, which ends its travel at 0.95
        const span = sec.offsetHeight - 2 * H;
        P0 = 0.95 - (col.offsetHeight + 0.05 * H) / span;
        Pb = P0 - 0.02;
        P = raw < Pb ? (raw / Pb) * 0.9 : 0.9 + ((raw - Pb) / (1 - Pb)) * 0.1;
        if (mobNew) P = (raw * span) / K() / 4200;      // the scene's clock runs on with the scroll (see journey.js, MOB)
      }
      journey && journey.setProgress(P);
      if (port) port.setProgress(Math.min(1, P / P_PORT));
      const seqOn = mob && mobNew && !MOB_SEQ ? 0 : 1 - range(P, P_PORT - 0.015, P_PORT);
      if (MOB_SEQ) { jCanvas.style.opacity = seqOn >= 1 ? 0 : 1; journey && journey.pause(seqOn >= 1); }   // the frames are see-through: no live scene behind them
      seqWrap.style.opacity = seqOn;
      seqWrap.style.visibility = seqOn > 0 ? 'visible' : 'hidden';
      giant.style.opacity = range(P, 0.44, 0.48) - range(P, 0.69, 0.71);
      giant.style.transform = `translateX(${-range(P, 0.44, 0.72) * 55}%)`;
      speed.style.opacity = range(P, 0.42, 0.45);
      if (mob) {
        if (mobNew) {
          const span = sec.offsetHeight - 2 * H, d = raw * span, k = K();
          const t = range(P, 0.193, 0.221), dk = t * t * (3 - 2 * t), g = Math.round(255 - 238 * dk);
          sticky.style.background = `linear-gradient(rgb(${g},${g},${g}) 0 40.6%, #111 40.6%)`;
          if (journey) {
            const zz = range(d, span - 0.6 * H, span - 0.1 * H); journey.mobZoom = zz * zz * (3 - 2 * zz);
            const pp = range(d, 2100 * k, span - 0.1 * H); journey.mobPaint = pp * pp * (3 - 2 * pp);
          }
          giant.style.opacity = 1;
          giant.style.transform = `translate(${(15 - Math.min(1299, Math.max(0, d / k - 199))) * k}px,${-Math.max(0, d - 1573 * k)}px)`;
          jCanvas.style.transform = rel.style.transform = '';
          rel.style.opacity = 1;
          col.style.transform = `translateY(${H - (d - 1478 * k)}px)`;
          cards.style.transform = relTitle.style.transform = '';
          feats.forEach((f) => { f.style.transform = ''; });
          sec.dataset.dynTheme = P > 0.207 ? 'dark' : '';
          return;
        }
        const u = range(raw, Pb, Pb + 0.03) - range(raw, 0.965, 0.995), sh = u * u * (3 - 2 * u);
        jCanvas.style.transform = `translateX(${-36 * sh}vw)`;
        rel.style.opacity = sh > 0 ? 1 : 0;
        rel.style.transform = `translateX(${(1 - sh) * 76}vw)`;
        const y = Math.max(0.8 * H - col.offsetHeight, 0.85 * H - (raw - P0) * (sec.offsetHeight - 2 * H));
        col.style.transform = `translateY(${y}px)`;
        cards.style.transform = relTitle.style.transform = '';
        feats.forEach((f) => { f.style.transform = ''; });
        sec.dataset.dynTheme = sh > 0.5 ? 'dark' : '';
        return;
      }
      jCanvas.style.transform = rel.style.transform = '';
      sec.dataset.dynTheme = '';
      // B: services panel
      // timings measured off the reference (fractions of the section)
      const show = range(P, 0.46, 0.52) - range(P, 0.69, 0.72);
      panel.style.transform = `translateY(${(1 - show) * 105}%)`;
      panel.style.visibility = show > 0 ? 'visible' : 'hidden';   // its glow otherwise peeks in at the bottom
      cards.style.transform = `translateX(${-range(P, 0.53, 0.69) * cardsMax}px)`;
      // C: reliability overlay
      // text only appears once the truck has turned and the junction has left the screen
      // measured off the reference (1280×720): heading enters at ~0.855 and parks at 15.5% by
      // 0.92; features follow each other 51% of the screen apart, first one at 75% at 0.9
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
  // Phones (followed off the reference there every 500 px): the whole beam is in view within the
  // first half screen (~90% of the width) and stays near that for two screens, then the ship
  // shrinks steadily to ~12% by the end; no haze. The frames hold those sizes at these points
  // of the sequence (ship width on a 375x812 screen: ~100% at 0.56, 85% at 0.64, 52% at 0.80, 22% at 0.86).
  const phone = matchMedia('(max-width:759px)');
  // (hull width on a 375 px screen, read off a contact sheet of the frames: f64 70%, f68 58%, f72 50%,
  // f78 40%, f82 27%, f86 16%, f88 13%, f96 9%; the reference: 67% from the moment the ship comes in
  // under the truck until 0.43, then 40% at 0.53, 27% at 0.64, 17% at 0.74, 13% at 0.85, 9% at 0.96)
  const PACE = [[0, 0.625], [0.43, 0.657], [0.53, 0.778], [0.64, 0.818], [0.74, 0.854], [0.85, 0.879], [0.96, 0.96], [1, 1]];
  const pace = (S) => {
    for (let i = 1; i < PACE.length; i++) if (S <= PACE[i][0]) { const [a, b] = PACE[i - 1], [c, d] = PACE[i]; return b + ((S - a) / (c - a)) * (d - b); }
    return 1;
  };
  const apply = (S) => {
    // Blender frames are spread linearly over the section (frame = 1 + 199·S/0.97)
    ship && ship.setProgress(phone.matches ? pace(S) : Math.min(1, S / 0.97));
    veil.style.opacity = phone.matches ? 0 : 0.6 * range(S, 0.9, 1);   // the reference ends in a pale haze
    const span = sec.offsetHeight - 2.2 * VH();
    const titleMid = 0.5 * VH() - 0.5 * title.offsetHeight;   // title centred at S = 0.7
    const y = titleMid - (S - (phone.matches ? 0.62 : 0.7)) * span * 0.88;
    flow.style.transform = `translate3d(0,${Math.min(y, VH() + 10)}px,0)`;
    sec.dataset.dynTheme = 'dark';
  };
  // onUpdate never fires while the section is still scrolling in (progress stays 0), so set the
  // start state up front too — otherwise the title shows over the ship as the section enters
  apply(0);
  // phones: how far the section still has to rise (see the ship player's view)
  const slide = () => {
    if (!phone.matches) { SHIP_IN = 1; return; }
    const v = 1 - range(sec.getBoundingClientRect().top, 0, 0.32 * VH());
    if (v !== SHIP_IN) { SHIP_IN = v; ship && ship.redraw(); }
  };
  slide();
  ScrollTrigger.create({ trigger: sec, start: 'top bottom', end: 'top top', onUpdate: slide, onLeave: slide, onRefresh: slide });
  ScrollTrigger.create({
    trigger: sec, start: 'top top', end: 'bottom 220%',     // the section's last 1.2 screens only hold the final view
    onUpdate: (s) => apply(s.progress),
    onRefresh: (s) => apply(s.progress),
  });
}

// ---------------------------------------------------------------- jet over the testimonials
// As the reference runs it (read off its page): from 0.2 to 2.2 screens of scroll past the
// section top, eased with cubic-bezier(.25,.1,.25,1), the jet's centre travels from −60vw to
// +180vw at mid-height while the jet (a square as wide as the screen) grows 1 → 1.3. The white
// page is clipped to an arrow edge at the same x (CSS, --clip), so it is drawn in behind the jet.
// The shadow sits in the jet's box: offset (−5 %, 0) → (3 %, 2 %), scale 0.9 → 0.5. The page
// itself holds still for 1.2 screens (sticky) while this happens.
function setupPlane() {
  const sec = $('#testimonials'), wrap = $('.plane-stage .jet-wrap'), sh = $('.plane-stage .jet-shadow');
  if (!sec || !wrap) return;
  // y of cubic-bezier(.25,.1,.25,1) at x = t
  const ease = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const bx = (u) => 3 * (1 - u) * (1 - u) * u * 0.25 + 3 * (1 - u) * u * u * 0.25 + u * u * u;
    const by = (u) => 3 * (1 - u) * (1 - u) * u * 0.1 + 3 * (1 - u) * u * u * 1 + u * u * u;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (bx(m) < t) lo = m; else hi = m; }
    return by((lo + hi) / 2);
  };
  // Phones (as the reference runs it there, measured at 375x812): the jet points up, 1.5 screen
  // widths long, and climbs from below the screen at 1.21x page speed (nose at the bottom edge 658 px
  // before the section top, at the top edge 13 px after it); the white page is drawn in below a
  // level line just behind its tail, and scrolls normally (no hold).
  const phone = matchMedia('(max-width:759px)');
  // phones: the white page is opened from a level line by two layer moves (a clipping box slid down,
  // its content slid back up by the same amount) - see the note in style.css
  const inner = $('.testi-content-inner', sec);
  let clipIn = null;
  const place = () => {
    const H = VH(), W = innerWidth;
    const d = -sec.getBoundingClientRect().top;
    if (phone.matches && inner && !clipIn) {
      clipIn = document.createElement('div');
      clipIn.className = 'testi-clip';
      while (inner.firstChild) clipIn.appendChild(inner.firstChild);
      inner.appendChild(clipIn);
    }
    if (!phone.matches && clipIn) inner.style.transform = clipIn.style.transform = '';
    if (phone.matches) {
      // (re-measured: nose to tail is 684 px there, so the jet square is 1.9 screen widths; the page
      // opens 620 px behind the nose, i.e. just inside the tail, so the heading comes out from under it)
      // (read off the reference's own numbers with its tab in front: the jet climbs at 1.25x page speed,
      // nose 18 px down as the section top reaches the top of the screen; its white page opens along a
      // level line that stays under the wings, which span the whole screen and so hide it - never out
      // in the open behind the tail. On our jet the wings cover the full width 298-327 px behind the
      // nose, so the line rides 0.438 of the jet square behind it.)
      const S = 1.9 * W, c = (18 / 812) * H - 1.25 * d + 0.4766 * S;       // jet square, its centre y
      wrap.style.transform = `translate3d(0,${c - 0.5 * W - Math.max(-d, 0)}px,0) rotate(-90deg) scale(1.9)`;
      sh.style.transform = 'translate(-3%,4%) scale(0.8)';
      // (the line's height on screen; once it is above the screen nothing visible is cut any more and
      // the box goes back to rest, so it never hangs over the sections below)
      const line = Math.max(0, c - 0.4766 * S + 0.438 * S), dpr = devicePixelRatio || 1;
      const e = line > 0 ? Math.round(Math.max(0, line + d) * dpr) / dpr : 0;
      inner.style.transform = `translate3d(0,${e}px,0)`;
      clipIn.style.transform = `translate3d(0,${-e}px,0)`;
      return;
    }
    const q = ease(range(d, 0.2 * H, 2.2 * H));
    const clip = -60 + 240 * q;
    sec.style.setProperty('--clip', clip.toFixed(3));
    wrap.style.transform = `translate3d(${(clip / 100 - 0.5) * W}px,${0.5 * H - 0.5 * W}px,0) scale(${1 + 0.3 * q})`;
    sh.style.transform = `translate(${-5 + 8 * q}%,${2 * q}%) scale(${0.9 - 0.4 * q})`;
  };
  place();
  ScrollTrigger.create({ trigger: sec, start: 'top bottom', end: 'bottom top', onUpdate: place, onRefresh: place });
  addEventListener('resize', place);
}
// ---------------------------------------------------------------- boot
// ?mob on a phone = the phone staging being built; add &live to see the live scene instead of its frames
const QS = new URLSearchParams(location.search);
// The ship frames' own camera (blender/ship.py: straight down, height cam_z(f) x 3 on a 144 mm lens, so
// the 2560 px frame spans 0.75 x cam_z metres; it glides along the ship until timeline frame 136). The
// 100 frames on disk are every other one of that 200-frame timeline. shipWarp gives, for a position
// between two frames, how frame j must be scaled and shifted to look as from that position.
const SHIP_Z = [[1, 86], [21, 70], [38, 70], [54, 79], [75, 93], [128, 152], [136, 194], [157, 267], [177, 790], [200, 1000]];
const shipZ = (f) => {
  for (let i = 1; i < SHIP_Z.length; i++) if (f <= SHIP_Z[i][0]) { const [a, za] = SHIP_Z[i - 1], [b, zb] = SHIP_Z[i]; return Math.exp(Math.log(za) + (Math.log(zb) - Math.log(za)) * ((f - a) / (b - a))); }
  return 1000;
};
const shipSm = (f, a, b) => { const u = Math.min(1, Math.max(0, (f - a) / (b - a))); return u * u * (3 - 2 * u); };
const shipY = (f) => { const y = -16 + 48 * shipSm(f, 1, 75); return y + (6 - y) * shipSm(f, 75, 136); };
const shipT = (i) => 1 + (i * 199) / 99;
const shipWarp = (pos, j) => {
  const F = shipT(pos), fj = Math.round(shipT(j)), zF = shipZ(F);
  return { m: shipZ(fj) / zF, dy: (shipY(F) - shipY(fj)) * (2560 / (0.75 * zF)) };
};
const SHIP_PHONE = matchMedia('(max-width:759px)').matches;
let SHIP_IN = 1;      // phones: 0 as the ship comes in under the truck -> 1 once it is over it (see the ship player's view)
const MOB_SEQ = !QS.has('live') && matchMedia('(max-width:759px)').matches;
async function boot() {
  await Promise.race([document.fonts.ready, wait(2500)]);
  const [globe, journey, port, ship] = await Promise.all([
    scene('globe', './scenes/globe.js', 'initGlobe', $('#globe'), $('#globeLabels'), { fadeOnScroll: true }),
    scene('journey', './scenes/journey.js', 'initJourney', $('#journeyCanvas'), (v) => { $('#jSpeed').textContent = String(v).padStart(2, '0'); }),
    // port phase: Cycles render of the stacker loading the truck
    // (?mob on a phone: the phone staging's own portrait frames, rendered through the live phone camera at
    // 375x812 - drawn across the width, with the ground line / box centre kept where that camera puts them
    // on a screen of another shape: 40.6% down in the side view, 27% once overhead)
    sequencePlayer($('#stackSeq'), MOB_SEQ ? {
      dir: 'seq/port_ms', count: 240, fit: 'width', cache: 9,      // (port_ms = the 1125 px renders of seq/port_mf2 at 750 px, what a phone draws)
      view: ({ h, H, frame }) => {
        const u = range((frame / 239) * 0.5, 0.193, 0.221), k = u * u * (3 - 2 * u);
        return { s: 1, dx: 0, dy: (0.406 + (0.27 - 0.406) * k - 0.5) * (H - h) };
      },
    } : {
      dir: 'seq/port', count: 120, fit: 'width',
      // The frames were rendered through the live camera on a 16:9 screen. That camera keeps the
      // ground at a fixed share of the screen height (about 90% down while the stacker works, 40%
      // once the truck pulls away), so on any other screen shape the frame is slid up or down to
      // put its ground line where the live scene's is — otherwise the two trucks stand apart
      // during the cross-fade.
      view: ({ w, h, W, H, frame }) => {
        const t = range((frame / 119) * 0.5, 0.37, 0.47), k = 0.81 + (-0.2 - 0.81) * t * t * (3 - 2 * t);
        const dy = (k * (H - h)) / 2;
        if (W >= 760) return { s: 1, dx: 0, dy };
        // phones (as the reference does there): the stacker at the stack is shown close up, its
        // ground line mid-screen, instead of as a thin strip at the bottom; the zoom is let go as
        // the render's own camera moves in on the box (frames 40–64)
        const u = range(frame, 40, 64), m = 1 - u * u * (3 - 2 * u), z = 1 + 0.6 * m;
        const xt = 0.5 * W - 0.505 * w * z, yt = 0.46 * H - 0.86 * h * z;
        const x1 = m * xt, y1 = m * yt + (1 - m) * ((H - h) / 2 + dy);
        return { s: z, dx: x1 - (W / 2) * (1 - z), dy: y1 - (H / 2 - (h / 2) * z) };
      },
    }),
    // ship: pre-rendered Blender sequence (top-down, climbs into the clouds)
    // (phones: the frame the ship arrives with has a blue box where the truck's grey one meets it, the
    // light one being a bay further down. While the section is still sliding up over the truck the
    // frame is drawn one bay higher, so the light box is the one that comes in under the truck; it
    // settles back over the last 0.32 screen of the slide, when its lower edge is still off-screen,
    // so no gap ever shows. SHIP_IN - 0 while sliding in, 1 from there on - is set by setupShip.)
    sequencePlayer($('#shipCanvas'), {
      // phones show only the last 40 frames (see PACE in setupShip): the earlier ones are not fetched, and
      // on an upright screen the frames come from seq/ship_m - the same frames cut to their middle
      // 1000 px, which is all such a screen can show (a wider phone-width window keeps the full ones)
      dir: SHIP_PHONE && innerWidth / innerHeight <= 0.6 ? 'seq/ship_m' : 'seq/ship', from: SHIP_PHONE ? 60 : 0,
      count: 100, fit: 'cover', lazy: true, blend: SHIP_PHONE, warp: shipWarp, cache: SHIP_PHONE ? 5 : 0,
      view: ({ h, W, H }) => {
        if (W >= 760) return { s: 1, dx: 0, dy: 0 };
        return { s: 1, dx: 0, dy: -0.234 * h * (1 - SHIP_IN) };
      },
    }),
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

  // the loader's opening always plays out; its ending waits for the page to be ready
  await new Promise((done) => (plIntro.progress() >= 1 ? done() : plIntro.eventCallback('onComplete', done)));
  plExit(() => {
    document.body.classList.remove('loading');
    lenis && lenis.start();
    globe && globe.intro();
    paintIn([$('.hero .kicker'), $('.hero-copy h1'), $('.hero-copy p')], 0.3);
    gsap.from('.hero .cta-row', { y: 24, opacity: 0, duration: 1, ease: 'power3.out', delay: 0.3 });
    ScrollTrigger.refresh();
  }).eventCallback('onComplete', () => { pre.remove(); sessionStorage.setItem('bo-loaded', '1'); });
}
boot();
