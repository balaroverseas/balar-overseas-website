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
export function buildTruck({ cab = '#121212', trim = '#e3cab6', skirt = '#1b1b1b', container = null } = {}) {
  const truck = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: cab, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.85 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d8d8d8', metalness: 1, roughness: 0.18 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0b141c', metalness: 0.9, roughness: 0.08 });
  const gold = new THREE.MeshStandardMaterial({ color: trim, metalness: 0.75, roughness: 0.3 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 2.5 });
  const tail = new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff2a1a', emissiveIntensity: 1.5 });

  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    truck.add(m);
    return m;
  };

  add(new THREE.BoxGeometry(15.6, 0.45, 1.9), dark, 0, 1.05, 0); // chassis
  add(new RoundedBoxGeometry(2.6, 3.0, 2.5, 4, 0.22), paint, 6.6, 2.75, 0); // cab
  add(new RoundedBoxGeometry(2.1, 0.75, 2.3, 3, 0.22), paint, 6.35, 4.5, 0); // roof fairing
  add(new THREE.BoxGeometry(0.06, 1.15, 2.2), glass, 7.92, 3.45, 0); // windshield
  add(new THREE.BoxGeometry(1.05, 0.95, 2.52), glass, 7.15, 3.45, 0); // side windows
  add(new THREE.BoxGeometry(2.62, 0.12, 2.52), gold, 6.6, 2.2, 0); // brand stripe
  add(new THREE.BoxGeometry(0.08, 1.0, 1.55), chrome, 7.93, 2.0, 0); // grille
  add(new THREE.BoxGeometry(0.36, 0.45, 2.5), dark, 7.95, 1.15, 0); // bumper
  add(new THREE.BoxGeometry(0.06, 0.24, 0.45), lamp, 7.98, 1.6, 0.92);
  add(new THREE.BoxGeometry(0.06, 0.24, 0.45), lamp, 7.98, 1.6, -0.92);
  const stack = new THREE.CylinderGeometry(0.09, 0.09, 2.3, 12);
  add(stack, chrome, 5.15, 3.5, 1.0);
  add(stack, chrome, 5.15, 3.5, -1.0);
  const tank = new THREE.CylinderGeometry(0.38, 0.38, 1.3, 20).rotateZ(Math.PI / 2);
  add(tank, chrome, 5.6, 1.2, 1.05);
  add(tank, chrome, 5.6, 1.2, -1.05);
  add(new THREE.BoxGeometry(12.6, 0.3, 2.45), dark, -1.1, 1.45, 0); // trailer bed
  // side skirts between the axle groups
  const skirtMat = new THREE.MeshPhysicalMaterial({ color: skirt, metalness: 0.3, roughness: 0.35, clearcoat: 1 });
  [1.24, -1.24].forEach((z) => {
    add(new THREE.BoxGeometry(7.3, 1.15, 0.06), skirtMat, -0.7, 0.85, z);   // trailer side skirt
    add(new THREE.BoxGeometry(1.0, 0.75, 0.06), dark, 5.75, 0.6, z);   // step box between axles
  });
  add(new THREE.BoxGeometry(0.08, 0.2, 0.4), tail, -7.42, 1.35, 1.0);
  add(new THREE.BoxGeometry(0.08, 0.2, 0.4), tail, -7.42, 1.35, -1.0);

  if (container) {
    container.position.set(-1.1, 2.9, 0);
    truck.add(container);
  }

  const wheels = [];
  [6.9, 4.6, 3.5, -5.0, -6.1, -7.2].forEach((x) => [1.0, -1.0].forEach((z) => {
    const w = buildWheel(0.56, 0.46, x === 6.9 ? '#d8d8d8' : '#9a9a9a');
    w.position.set(x, 0.56, z);
    truck.add(w);
    wheels.push(w);
  }));
  truck.userData.spin = (dist) => wheels.forEach((w) => { w.rotation.z -= dist / 0.56; });
  return truck;
}
