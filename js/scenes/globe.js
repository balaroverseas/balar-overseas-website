// Hero: dotted 3D globe with glowing trade routes between India, China and the world.
// Built the way the reference builds its own: the canvas draws only the land (a ring of dots along
// every coast, a finer staggered grid inside), the pins and the routes; the body of the planet and
// its orange / blue light are four CSS box-shadow discs under the canvas (.globe-glow in the
// stylesheet). The globe turns steadily and can be dragged.
import * as THREE from 'three';
import { createStage, isMobile } from './util.js';

const LAND = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json';
const ORANGE = '#f45300';
const FOV = 55, STEP = 1.2;                     // camera angle; spacing of the land dots in degrees
const TURN = 0.09;                              // radians a second

const HUBS = [
  { name: 'Surat', lat: 21.17, lon: 72.83, home: true },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, label: false },
  { name: 'Delhi', lat: 28.61, lon: 77.21 },
  { name: 'Guangzhou', lat: 23.13, lon: 113.26, home: true },
  { name: 'Yiwu', lat: 29.31, lon: 120.08 },
  { name: 'Shenzhen', lat: 22.54, lon: 114.06, label: false },
  { name: 'Dubai', lat: 25.2, lon: 55.27 },
  { name: 'Singapore', lat: 1.35, lon: 103.82 },
  { name: 'Rotterdam', lat: 51.92, lon: 4.48 },
  { name: 'New York', lat: 40.71, lon: -74.0 },
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
];
const ROUTES = [
  ['Guangzhou', 'Surat'], ['Yiwu', 'Surat'], ['Shenzhen', 'Mumbai'], ['Guangzhou', 'Delhi'],
  ['Surat', 'Dubai'], ['Singapore', 'Mumbai'], ['Surat', 'Rotterdam'], ['Shenzhen', 'New York'],
  ['Yiwu', 'Singapore'], ['Guangzhou', 'Sydney'],
];

export function ll(lat, lon, r = 1) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const th = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}

// ---- land outlines (TopoJSON) → polygons of [lon, lat] rings
async function landPolygons() {
  const topo = await (await fetch(LAND)).json();
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
  });
  const ring = (ids) => {
    const out = [];
    ids.forEach((i) => {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      a.forEach((p, k) => { if (k || !out.length) out.push(p); });
    });
    return out;
  };
  const polys = [];
  const take = (g) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach(take);
    else if (g.type === 'Polygon') polys.push(g.arcs.map(ring));
    else if (g.type === 'MultiPolygon') g.arcs.forEach((p) => polys.push(p.map(ring)));
  };
  take(topo.objects.land);
  return polys;
}

const inRing = (x, y, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

async function sampleLand() {
  const polys = await landPolygons();
  const edge = [], fill = [];
  const push = (arr, lon, lat) => { const p = ll(lat, lon, 1); arr.push(p.x, p.y, p.z); };
  polys.forEach((rings) => {
    // coast: a dot every 0.7 step along each ring
    rings.forEach((r) => {
      let carry = 0;
      for (let i = 0; i < r.length - 1; i++) {
        const [lon1, lat1] = r[i], [lon2, lat2] = r[i + 1];
        const dLon = lon2 - lon1, dLat = lat2 - lat1;
        const len = Math.hypot(dLon * Math.cos(((lat1 + lat2) * Math.PI) / 360), dLat);
        if (!len) continue;
        let t = 0, remain = len;
        while (carry + remain >= STEP * 0.7) {
          const move = STEP * 0.7 - carry;
          t += move / len;
          push(edge, lon1 + dLon * t, lat1 + dLat * t);
          remain -= move; carry = 0;
        }
        carry += remain;
      }
    });
    // inside: rows a step apart, every other row shifted half a step
    let x0 = 1e9, x1 = -1e9, y0 = 90, y1 = -90;
    rings[0].forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    for (let lat = Math.floor(y0 / STEP) * STEP; lat <= y1; lat += STEP) {
      const odd = Math.round(Math.abs(lat / STEP)) % 2;
      const lonStep = STEP / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
      for (let lon = Math.floor(x0 / lonStep) * lonStep + (odd ? lonStep / 2 : 0); lon <= x1; lon += lonStep) {
        if (!inRing(lon, lat, rings[0])) continue;
        if (rings.slice(1).some((h) => inRing(lon, lat, h))) continue;
        push(fill, lon, Math.max(-90, Math.min(90, lat)));
      }
    }
  });
  return { edge: new Float32Array(edge), fill: new Float32Array(fill) };
}

function arcCurve(a, b) {
  const lift = 0.02 + Math.min(0.5, a.distanceTo(b) * 0.01);
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const s = i / 32;
    pts.push(new THREE.Vector3().copy(a).lerp(b, s).normalize().multiplyScalar(1.002 + 4 * lift * s * (1 - s)));
  }
  return new THREE.CatmullRomCurve3(pts);
}

function dotMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 2 }, uNear: { value: 1.2 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      uniform float uSize; uniform float uNear;
      varying float vFacing;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * world;
        // the globe sits at the origin, so a point's own direction is its normal
        vFacing = dot(normalize(cameraPosition - world.xyz), normalize(world.xyz));
        gl_PointSize = uSize * (uNear / -mv.z) * mix(0.6, 1.0, smoothstep(0.0, 0.25, vFacing));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      varying float vFacing;
      void main() {
        if (vFacing <= 0.0) discard;
        float d = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.41, 0.5, d);
        if (a <= 0.0) discard;
        gl_FragColor = vec4(uColor, a * uOpacity);
      }`,
    transparent: true, depthWrite: false,
  });
}

export async function initGlobe(canvas, labelLayer, opts = {}) {
  const { fadeOnScroll = false } = opts;
  const land = await sampleLand();
  const stage = createStage(canvas, { fov: FOV, maxDpr: 2 });
  const { scene, camera, renderer } = stage;

  // the planet's body and light: four discs under the canvas
  const glow = document.createElement('div');
  glow.className = 'globe-glow';
  glow.innerHTML = '<div><i class="o"></i><i class="b"></i><i class="bp"></i><i class="op"></i></div>';
  canvas.before(glow);

  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  scene.add(tilt); tilt.add(spin);
  tilt.rotation.set(0.15, 0, 0.05);

  // unseen core: keeps the far side's pins and routes hidden
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.99, 48, 48), new THREE.MeshBasicMaterial({ colorWrite: false }));
  core.renderOrder = -1;
  tilt.add(core);

  const edgeMat = dotMaterial('#ffffff', 1), fillMat = dotMaterial('#e2e8f0', 0.9);
  [[land.edge, edgeMat], [land.fill, fillMat]].forEach(([pos, mat]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    spin.add(new THREE.Points(g, mat));
  });

  // pins: a small orange stud with a soft halo, and a ring that pulses
  const time = { value: 3.8 };
  const byName = Object.fromEntries(HUBS.map((h) => [h.name, h]));
  const halo = document.createElement('canvas');
  halo.width = halo.height = 64;
  const hg = halo.getContext('2d'), grad = hg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.4)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  hg.fillStyle = grad; hg.fillRect(0, 0, 64, 64);
  const haloMat = new THREE.SpriteMaterial({ color: ORANGE, map: new THREE.CanvasTexture(halo), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pinGeo = new THREE.CircleGeometry(0.006, 14);
  const pinMat = new THREE.MeshBasicMaterial({ color: ORANGE });
  const ringGeo = new THREE.RingGeometry(0.95, 1, 32);
  const rings = [];
  HUBS.forEach((h, i) => {
    h.v = ll(h.lat, h.lon, 1);
    const g = new THREE.Group();
    g.position.copy(ll(h.lat, h.lon, 1.004));
    g.lookAt(g.position.clone().multiplyScalar(2));
    const s = new THREE.Sprite(haloMat);
    s.scale.setScalar(0.045);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    g.add(new THREE.Mesh(pinGeo, pinMat), s, ring);
    spin.add(g);
    rings.push({ ring, off: (i * 0.618) % 1 });
  });

  // routes: each one draws itself from end to end, then is drawn away again from the start
  ROUTES.forEach(([a, b], i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: time, uOffset: { value: 2.5 * ((i * 0.6180339887) % 1) }, uColor: { value: new THREE.Color(ORANGE) } },
      vertexShader: /* glsl */ `varying float vP; void main(){ vP = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOffset; uniform vec3 uColor; varying float vP;
        void main() {
          float pr = mod(uTime * 2.0 + uOffset, 2.5);
          float st = clamp(pr - 1.0, 0.0, 1.0), en = clamp(pr, 0.0, 1.0);
          if (vP < st || vP > en) discard;
          gl_FragColor = vec4(uColor, smoothstep(st, en + 0.001, vP));
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    spin.add(new THREE.Mesh(new THREE.TubeGeometry(arcCurve(byName[a].v, byName[b].v), 32, 0.0024, 4, false), mat));
  });

  // HTML labels
  const labels = HUBS.filter((h) => h.label !== false).map((h) => {
    const el = document.createElement('div');
    el.className = 'glabel' + (h.home ? ' home' : '');
    el.textContent = h.name;
    labelLayer.appendChild(el);
    return { el, v: ll(h.lat, h.lon, 1.01), on: null };
  });

  // Where the disc sits (canvas pixels). Desktop is the reference's own arrangement: a disc 93% of
  // the screen height across, centred half way down and a little short of the right edge, so its
  // right side runs off the screen. The dotted sphere is a touch larger than the lit disc under it.
  const lay = { cx: 0, cy: 0, r: 1 };
  const place = (scale) => {
    const w = stage.width, h = stage.height, r = lay.r * scale;
    Object.assign(glow.style, { left: `${lay.cx - r}px`, top: `${lay.cy - r}px`, width: `${2 * r}px`, height: `${2 * r}px`, fontSize: `${(2 * r) / 90.4}px` });
    // camera distance that gives a unit sphere this radius on screen; the view is slid so the
    // sphere (at the origin, so it stays a true circle) lands on the disc
    const k = h / 2 / Math.tan((FOV * Math.PI) / 360) / (r * 1.036);
    camera.position.set(0, 0, Math.sqrt(1 + k * k));
    camera.setViewOffset(w, h, w / 2 - lay.cx, h / 2 - lay.cy, w, h);
    const near = camera.position.z - 1, px = Math.max(1.3, 0.0042 * r * 1.036) * renderer.getPixelRatio();
    edgeMat.uniforms.uNear.value = fillMat.uniforms.uNear.value = near;
    edgeMat.uniforms.uSize.value = px;
    fillMat.uniforms.uSize.value = Math.max(1.1 * renderer.getPixelRatio(), px * 0.75);
  };
  stage.onResize = (w, h) => {
    // phones (measured off the reference at 375x812): a disc 74% of the screen height across, its centre 86.5% across at mid-height
    if (fadeOnScroll && innerWidth < 760) Object.assign(lay, { cx: w * 0.865, cy: h / 2, r: h * 0.37 });
    else if (isMobile()) Object.assign(lay, { cx: w / 2, cy: h / 2, r: Math.min(h * 0.42, w * 0.3) });
    else if (w < 992) Object.assign(lay, { cx: w * 0.98, cy: h / 2, r: h * 0.355 });
    else Object.assign(lay, { cx: 1.1445 * w - h / 2, cy: h / 2, r: h * 0.465 });
  };
  stage.resize();

  // Dragging (mouse only so touch keeps scrolling the page); the disc is the handle
  const state = { intro: 0, scroll: 0 };
  let drag = false, lastX = 0, lastY = 0, offX = 0;
  // start with India and China towards the viewer
  const home = ll(23, 96, 1);
  let phi = Math.atan2(-home.x, home.z);
  glow.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    drag = true; lastX = e.clientX; lastY = e.clientY;
    glow.classList.add('dragging');
  });
  window.addEventListener('pointerup', () => { drag = false; glow.classList.remove('dragging'); });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    phi += (e.clientX - lastX) * 0.005;
    offX = THREE.MathUtils.clamp(offX + (e.clientY - lastY) * 0.003, -0.5, 0.5);
    lastX = e.clientX; lastY = e.clientY;
  });

  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3(), toCam = new THREE.Vector3();
  const expo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

  stage.onFrame = (t, dt) => {
    if (!drag) { phi += TURN * dt; offX *= Math.pow(0.4, dt); }
    time.value += TURN * dt;
    spin.rotation.y = phi;
    tilt.rotation.x = 0.15 + offX;

    // arrival: grows from 40% and slides in; leaving: fades and dims as the page scrolls on (home),
    // or drifts up and swells (the About page's flight into the sky)
    const intro = expo(state.intro), s = state.scroll;
    const fade = fadeOnScroll ? 1 - THREE.MathUtils.clamp((s * 1.81 - 0.2) / 0.73, 0, 1) : 1;
    const baseY = lay.cy;
    if (!fadeOnScroll) lay.cy = baseY - Math.pow(s, 1.4) * 0.9 * lay.r;
    const baseX = lay.cx;
    lay.cx = baseX + (1 - intro) * 0.4 * lay.r;
    place((0.4 + 0.6 * intro) * (fadeOnScroll ? 1 : 1 + s * 0.25));
    lay.cx = baseX; lay.cy = baseY;
    const show = Math.min(1, state.intro * 2) * fade;
    glow.style.opacity = show.toFixed(3);
    canvas.style.opacity = show.toFixed(3);
    glow.style.filter = canvas.style.filter = fade < 1 ? `brightness(${(0.2 + 0.8 * fade).toFixed(3)})` : '';

    rings.forEach(({ ring, off }) => {
      const f = (time.value * 2 + 2.5 * off) % 2.5;
      if (f > 1 && f < 1.5) {
        const k = 1 - Math.pow(1 - (f - 1) / 0.5, 3);
        ring.scale.setScalar(0.02 + 0.02 * k);
        ring.material.opacity = 1 - k;
      } else ring.material.opacity = 0;
    });

    scene.updateMatrixWorld(true);
    const W = stage.width, H = stage.height;
    labels.forEach((L) => {
      tmp.copy(L.v).applyMatrix4(spin.matrixWorld);
      nrm.copy(tmp).normalize();
      toCam.copy(camera.position).sub(tmp).normalize();
      const on = nrm.dot(toCam) > 0.05 && state.intro > 0.6 && fade > 0.5 && (fadeOnScroll || s < 0.4);
      tmp.project(camera);
      L.el.style.transform = `translate3d(${((tmp.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * H).toFixed(1)}px, 0) translateY(-100%)`;
      if (on !== L.on) { L.on = on; L.el.classList.toggle('on', on); }
    });
  };

  return {
    setScroll(p) { state.scroll = p; },
    intro() { window.gsap.to(state, { intro: 1, duration: 1.4, ease: 'none' }); },
  };
}
