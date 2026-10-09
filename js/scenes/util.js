// Shared helpers for all 3D scenes: renderer setup, container + truck builders.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smooth = (t) => t * t * (3 - 2 * t);
// Progress of p inside [a, b], eased.
export const seg = (p, a, b) => smooth(clamp01((p - a) / (b - a)));
export const lerp = (a, b, t) => a + (b - a) * t;

export const PALETTE = ['#c9974f', '#151515', '#7a3b2e', '#1f3a5f', '#d9d4cc', '#b5552b', '#2f5d50', '#e3cab6'];
const LIGHT = new Set(['#d9d4cc', '#e3cab6', '#c9974f']);
export const labelFor = (hex) => (LIGHT.has(hex) ? '#151515' : '#ffffff');

export function seeded(seed = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates renderer + scene + camera bound to a canvas. Renders only while the
 * canvas is on screen and keeps size in sync with CSS size.
 */
export function createStage(canvas, opts = {}) {
  const { fov = 35, near = 0.1, far = 500, shadows = false, env = false, maxDpr = 1.75 } = opts;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  const scene = new THREE.Scene();
  if (env) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pm.dispose();
  }
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  const stage = { renderer, scene, camera, canvas, visible: true, width: 1, height: 1, onFrame: null, onResize: null };

  stage.resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    stage.width = w; stage.height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (stage.onResize) stage.onResize(w, h);
  };
  new ResizeObserver(stage.resize).observe(canvas);
  stage.resize();
  new IntersectionObserver(([e]) => { stage.visible = e.isIntersecting; }, { rootMargin: '150px' }).observe(canvas);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!stage.visible) return;
    // one bad frame must never stop the scene: report once and keep looping
    try {
      if (stage.onFrame) stage.onFrame(clock.elapsedTime, dt);
      renderer.render(scene, camera);
    } catch (err) {
      if (!stage.failed) { stage.failed = true; console.error('[3D] frame error', err); window.__sceneError = String(err && err.stack || err); }
    }
  });
  return stage;
}

// ---------- Shipping containers ----------
const texCache = new Map();
function corrugated(hex, { label = '', labelColor = '#fff', doors = false, length = 12 } = {}) {
  const key = [hex, label, labelColor, doors, length].join('|');
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = doors ? 256 : Math.round(length * 85);
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = hex;
  g.fillRect(0, 0, c.width, c.height);
  const step = doors ? 30 : 17;
  for (let x = 0; x < c.width; x += step) {
    const grd = g.createLinearGradient(x, 0, x + step, 0);
    grd.addColorStop(0, 'rgba(255,255,255,.16)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,.26)');
    g.fillStyle = grd;
    g.fillRect(x, 0, step, c.height);
  }
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(0, 0, c.width, 10);
  g.fillRect(0, c.height - 12, c.width, 12);
  g.fillRect(0, 0, 8, c.height);
  g.fillRect(c.width - 8, 0, 8, c.height);
  if (doors) {
    g.fillRect(c.width / 2 - 2, 0, 4, c.height);
    g.fillStyle = 'rgba(225,225,225,.65)';
    [0.2, 0.38, 0.62, 0.8].forEach((f) => g.fillRect(c.width * f - 2, 14, 4, c.height - 28));
  }
  if (label) {
    g.fillStyle = labelColor;
    g.font = '800 54px Archivo, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(label, 44, c.height / 2 + 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

const matCache = new Map();
/** Container with its long axis on X. Size in metres-ish units. */
export function makeContainer(hex, { label = '', labelColor = labelFor(hex), length = 12, ribTop = false } = {}) {
  const key = [hex, label, labelColor, length, ribTop].join('|');
  let mats = matCache.get(key);
  if (!mats) {
    const base = { roughness: 0.55, metalness: 0.3 };
    const side = new THREE.MeshStandardMaterial({ ...base, map: corrugated(hex, { label, labelColor, length }) });
    const end = new THREE.MeshStandardMaterial({ ...base, map: corrugated(hex, { doors: true }) });
    const top = ribTop
      ? new THREE.MeshStandardMaterial({ ...base, map: corrugated(hex, { length }) })
      : new THREE.MeshStandardMaterial({ ...base, color: new THREE.Color(hex).multiplyScalar(0.85) });
    mats = [end, end, top, top, side, side];
    matCache.set(key, mats);
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(length, 2.6, 2.45), mats);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Realistic tyre: tread band + rounded shoulders + steel rim + hub with wheel nuts
let treadTex = null;
export function buildWheel(r, width, rimColor = '#d9d9d9') {
  const w = new THREE.Group();
  if (!treadTex) {
    treadTex = canvasTex(256, 32, (g, W, H) => {
      g.fillStyle = '#141414'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#060606';
      for (let x = 0; x < W; x += 16) { g.fillRect(x, 0, 7, H * 0.45); g.fillRect(x + 8, H * 0.55, 7, H * 0.45); }
    });
    treadTex.wrapS = THREE.RepeatWrapping;
    treadTex.repeat.set(4, 1);
  }
  const rubber = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.95 });
  w.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, width * 0.8, 40, 1, true).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: treadTex, roughness: 0.95 })));
  [1, -1].forEach((s) => {
    const shoulder = new THREE.Mesh(new THREE.TorusGeometry(r - width * 0.1, width * 0.1, 10, 40), rubber);
    shoulder.position.z = s * width * 0.4;
    w.add(shoulder);
    const wall = new THREE.Mesh(new THREE.RingGeometry(r * 0.58, r - width * 0.1, 40), rubber);
    wall.position.z = s * width * 0.5;
    if (s < 0) wall.rotation.y = Math.PI;
    w.add(wall);
  });
  const steel = new THREE.MeshPhysicalMaterial({ color: rimColor, metalness: 0.85, roughness: 0.3, clearcoat: 0.4 });
  w.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.58, r * 0.58, width * 0.9, 32).rotateX(Math.PI / 2), steel));
  const hubMat = new THREE.MeshStandardMaterial({ color: '#555', metalness: 0.8, roughness: 0.35 });
  w.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.26, width * 1.02, 16).rotateX(Math.PI / 2), hubMat));
  for (let i = 0; i < 8; i++) {
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.045, r * 0.045, width * 1.04, 6).rotateX(Math.PI / 2), hubMat);
    nut.position.set(Math.cos(i * Math.PI / 4) * r * 0.36, Math.sin(i * Math.PI / 4) * r * 0.36, 0);
    w.add(nut);
  }
  w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return w;
}

// ---------- Semi truck (faces +X, ~16 units long) ----------
// Same build as blender/truck.py (its x shifted by -1.1: the container centre sits at x = -1.1 here):
// high-roof dark cab-over on a two-axle tractor, plain chassis trailer with the tri-axle bogie
// forward of the rear overhang, chrome side guard, spare wheel + toolbox at the back, nothing
// written between the wheels.
export function buildTruck({ cab = '#1a1c21', container = null } = {}) {
  const truck = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: cab, metalness: 0.5, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16181c', metalness: 0.4, roughness: 0.5 });
  const grey = new THREE.MeshStandardMaterial({ color: '#8d939b', metalness: 0.6, roughness: 0.35 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d4d8de', metalness: 1, roughness: 0.18 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0e151d', metalness: 0.9, roughness: 0.06 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 2.5 });
  const tail = new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff2a1a', emissiveIntensity: 1.5 });
  const amber = new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: '#ff9000', emissiveIntensity: 1.5 });

  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    truck.add(m);
    return m;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const SIDES = [1, -1];
  const STEER = 6.6, DRIVE = 3.1, BOGIE = [-4.4, -3.1, -1.8];

  // ---- tractor
  SIDES.forEach((s) => add(B(5.8, 0.32, 0.18), dark, 5.1, 0.98, s * 0.48));                  // frame rails
  add(new THREE.CylinderGeometry(0.75, 0.75, 0.16, 24), dark, 3.4, 1.22, 0);                  // fifth wheel
  add(new RoundedBoxGeometry(2.62, 2.85, 2.5, 4, 0.2), paint, 6.81, 2.525, 0);                // high-roof cab
  add(B(0.06, 0.9, 2.2), glass, 8.11, 3.0, 0);                                                // windscreen
  add(B(0.3, 0.1, 2.3), dark, 8.08, 3.56, 0);                                                 // sun visor
  add(B(0.75, 0.8, 2.52), glass, 7.52, 3.0, 0);                                               // side windows
  for (let i = 0; i < 4; i++) add(B(0.05, 0.07, 1.4), dark, 8.12, 1.75 + i * 0.16, 0);        // grille slats
  add(B(0.3, 0.5, 2.5), dark, 8.05, 1.0, 0);                                                  // bumper
  SIDES.forEach((s) => {
    add(B(0.06, 0.16, 0.45), lamp, 8.18, 1.42, s * 0.95);
    add(B(0.06, 0.12, 0.14), amber, 8.18, 1.42, s * 1.14);
    add(B(0.08, 0.7, 0.16), dark, 8.15, 2.95, s * 1.55);                                      // mirror
    add(B(0.06, 0.06, 0.35), dark, 8.1, 3.25, s * 1.38);
    add(B(2.05, 0.62, 0.06), paint, 4.75, 0.82, s * 1.22);                                    // fairing between the axles
    add(B(0.55, 0.5, 0.07), grey, 5.5, 0.78, s * 1.24);                                       // step panel
    add(B(0.02, 1.9, 0.02), dark, 7.05, 2.2, s * 1.255);                                      // door line
    add(B(2.3, 0.03, 0.02), dark, 6.75, 2.35, s * 1.255);                                     // cab crease
  });
  add(new THREE.CylinderGeometry(0.09, 0.09, 1.8, 12), chrome, 5.4, 4.0, -1.05);              // exhaust stack
  // drive-axle mudguard: half ring over the wheels
  const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 2.5, 24, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.6, side: THREE.DoubleSide }));
  guard.position.set(DRIVE, 0.52, 0);
  truck.add(guard);
  // cab logo, both doors
  const logoTex = canvasTex(256, 64, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#e9ebef'; g.font = '600 44px Arial, sans-serif'; g.textBaseline = 'middle';
    g.fillText('BALAR', 8, H / 2 + 2);
  });
  const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, toneMapped: false });
  SIDES.forEach((s) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), logoMat);
    l.position.set(6.4, 2.78, s * 1.256);
    if (s < 0) l.rotation.y = Math.PI;
    truck.add(l);
  });

  // ---- trailer (skeletal 40ft, centre at x = -1.1)
  const TX = -1.1, L = 12.6;
  SIDES.forEach((s) => {
    add(B(L, 0.36, 0.2), dark, TX, 1.25, s * 0.52);                                           // main rails
    add(B(L, 0.14, 0.08), dark, TX, 1.42, s * 1.2);                                           // outer side beams
    [TX - L / 2 + 0.25, TX + L / 2 - 0.25].forEach((x) => add(B(0.25, 0.12, 0.2), chrome, x, 1.54, s * 1.1)); // twistlocks
    add(B(0.16, 0.95, 0.16), dark, 1.6, 0.62, s * 0.85);                                      // landing legs
    add(B(0.3, 0.06, 0.3), dark, 1.6, 0.15, s * 0.85);
    // chrome side guard between the bogie and the landing legs
    [0.72, 0.98].forEach((y) => add(B(2.3, 0.1, 0.05), chrome, 0.1, y, s * 1.18));
    [-0.95, 0.1, 1.15].forEach((x) => add(B(0.07, 0.42, 0.05), dark, x, 0.95, s * 1.17));
    add(B(0.03, 0.55, 0.6), dark, BOGIE[0] - 0.65, 0.42, s * 0.95);                           // mudflaps
    add(B(0.06, 0.16, 0.38), tail, TX - L / 2 - 0.15, 0.85, s * 0.95);                         // tail lights
    add(B(0.3, 0.4, 0.06), dark, TX - L / 2 - 0.02, 0.95, s * 1.1);
  });
  for (let i = 0; i < 9; i++) add(B(0.16, 0.14, 2.44), dark, TX - L / 2 + 0.4 + i * (L - 0.8) / 8, 1.42, 0); // cross members
  add(B(0.18, 0.2, 2.3), dark, TX - L / 2 - 0.05, 0.6, 0);                                    // rear bumper
  add(new THREE.CylinderGeometry(0.5, 0.5, 0.28, 24), new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.9 }), -6.25, 0.82, 0); // spare wheel
  add(B(0.7, 0.48, 0.5), dark, -5.4, 0.86, 0.9);                                              // toolbox
  BOGIE.forEach((x) => add(B(0.12, 0.12, 2.2), dark, x, 0.5, 0));                             // axles

  if (container) {
    container.position.set(TX, 2.9, 0);
    truck.add(container);
  }

  const wheels = [];
  const wheelAt = (x, z, r, w) => {
    const wh = buildWheel(r, w, '#c9ced6');
    wh.position.set(x, r, z);
    wh.userData.r = r;
    truck.add(wh);
    wheels.push(wh);
  };
  SIDES.forEach((s) => wheelAt(STEER, s * 1.05, 0.52, 0.32));
  [DRIVE, ...BOGIE].forEach((x) => [1.08, 0.74, -0.74, -1.08].forEach((z) => wheelAt(x, z, x === DRIVE ? 0.52 : 0.5, 0.3)));
  truck.userData.spin = (dist) => wheels.forEach((w) => { w.rotation.z -= dist / w.userData.r; });
  return truck;
}
