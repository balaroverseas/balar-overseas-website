// Hero: dotted 3D globe with glowing trade routes between India, China and the world.
import * as THREE from 'three';
import { createStage, isMobile } from './util.js';

const WATER_MAP = 'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/earth-water.png';

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

async function sampleLand() {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = WATER_MAP;
  await img.decode();
  const W = 720, H = 360;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H).data;
  // Water is bright in this map; auto-detect in case it is inverted.
  let dark = 0;
  for (let i = 0; i < data.length; i += 16) if (data[i] < 128) dark++;
  const landIsDark = dark / (data.length / 16) < 0.5;

  const pos = [], rnd = [];
  const rows = 170;
  for (let i = 0; i < rows; i++) {
    const lat = 90 - ((i + 0.5) * 180) / rows;
    const count = Math.max(1, Math.round(Math.cos((lat * Math.PI) / 180) * rows * 2));
    for (let j = 0; j < count; j++) {
      const lon = -180 + ((j + 0.5) * 360) / count;
      const px = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
      const py = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
      const v = data[(py * W + px) * 4];
      if ((v < 128) === landIsDark) {
        const p = ll(lat, lon, 1);
        pos.push(p.x, p.y, p.z);
        rnd.push(Math.random());
      }
    }
  }
  return { pos: new Float32Array(pos), rnd: new Float32Array(rnd) };
}

function arcCurve(a, b) {
  const omega = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  const h = 0.06 + omega * 0.2;
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const s = i / 60;
    const p = new THREE.Vector3()
      .addScaledVector(a, Math.sin((1 - s) * omega) / Math.sin(omega))
      .addScaledVector(b, Math.sin(s * omega) / Math.sin(omega));
    p.normalize().multiplyScalar(1 + h * Math.sin(Math.PI * s));
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

export async function initGlobe(canvas, labelLayer) {
  const land = await sampleLand();
  const stage = createStage(canvas, { fov: 35, maxDpr: 2 });
  const { scene, camera, renderer } = stage;
  camera.position.set(0, 0, 3.3);

  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  scene.add(root); root.add(tilt); tilt.add(spin);

  const time = { value: 0 };
  const BLUE = new THREE.Color('#5266ff');
  const GOLD = new THREE.Color('#ffae5c');

  // Dark core hides the back side of the globe
  spin.add(new THREE.Mesh(new THREE.SphereGeometry(0.992, 64, 64), new THREE.MeshBasicMaterial({ color: '#04060d' })));

  // Land dots
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(land.pos, 3));
  dotGeo.setAttribute('aRand', new THREE.BufferAttribute(land.rnd, 1));
  const dotMat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uSize: { value: 10 }, uA: { value: new THREE.Color('#c9d3ff') }, uB: { value: new THREE.Color('#ffc98a') } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uSize;
      attribute float aRand;
      varying float vR; varying float vF;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * position);
        vF = smoothstep(0.0, 0.5, n.z);
        vR = aRand;
        float tw = 0.75 + 0.25 * sin(uTime * 1.5 + aRand * 40.0);
        gl_PointSize = uSize * tw / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uA; uniform vec3 uB;
      varying float vR; varying float vF;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.15, d) * (0.2 + 0.8 * vF);
        gl_FragColor = vec4(vR > 0.94 ? uB : uA, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  spin.add(new THREE.Points(dotGeo, dotMat));

  // Lit rim on the globe surface
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(1.003, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: { uA: { value: BLUE }, uB: { value: GOLD } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uA; uniform vec3 uB; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.5);
          vec3 col = mix(uA, uB, smoothstep(-0.3, 0.6, vN.x * 0.7 + vN.y * 0.7));
          gl_FragColor = vec4(col * f * 1.4, f);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  tilt.add(rim);

  // Outer atmosphere halo
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.24, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: { uA: { value: BLUE }, uB: { value: GOLD } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uA; uniform vec3 uB; varying vec3 vN;
        void main() {
          float d = clamp(-vN.z, 0.0, 1.0);
          float i = pow(min(d / 0.62, 1.0), 3.0) * 0.9;
          vec3 col = mix(uA, uB, smoothstep(-0.4, 0.6, vN.x * 0.7 + vN.y * 0.7));
          gl_FragColor = vec4(col, 1.0) * i;
        }`,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  root.add(halo);

  // Hubs + pulsing rings
  const byName = Object.fromEntries(HUBS.map((h) => [h.name, h]));
  const ringGeo = new THREE.RingGeometry(0.011, 0.015, 40);
  const hubDotGeo = new THREE.CircleGeometry(0.009, 20);
  const rings = [];
  HUBS.forEach((h, i) => {
    h.v = ll(h.lat, h.lon, 1);
    const g = new THREE.Group();
    g.position.copy(ll(h.lat, h.lon, 1.004));
    g.lookAt(g.position.clone().multiplyScalar(2));
    const col = h.home ? '#ffc98a' : '#ffffff';
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    g.add(new THREE.Mesh(hubDotGeo, new THREE.MeshBasicMaterial({ color: col })), ring);
    spin.add(g);
    rings.push({ ring, off: i * 0.37 });
  });

  // Animated routes
  ROUTES.forEach(([a, b], i) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: time, uOffset: { value: i * 0.173 }, uColor: { value: i % 3 === 2 ? new THREE.Color('#9fb2ff') : GOLD } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOffset; uniform vec3 uColor; varying vec2 vUv;
        void main() {
          float head = fract(uTime * 0.2 + uOffset) * 1.6 - 0.3;
          float d = head - vUv.x;
          float trail = smoothstep(0.38, 0.0, d) * step(0.0, d);
          gl_FragColor = vec4(uColor * (0.7 + trail), 0.12 + trail * 0.9);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    spin.add(new THREE.Mesh(new THREE.TubeGeometry(arcCurve(byName[a].v, byName[b].v), 100, 0.0035, 6, false), mat));
  });

  // Background stars
  const starPos = new Float32Array(1400 * 3);
  const sv = new THREE.Vector3();
  for (let i = 0; i < 1400; i++) {
    sv.randomDirection().multiplyScalar(18 + Math.random() * 30);
    starPos.set([sv.x, sv.y, sv.z - 10], i * 3);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: '#ffffff', size: 0.05, transparent: true, opacity: 0.55, depthWrite: false })));

  // HTML labels
  const labels = HUBS.filter((h) => h.label !== false).map((h) => {
    const el = document.createElement('div');
    el.className = 'glabel' + (h.home ? ' home' : '');
    el.textContent = h.name;
    labelLayer.appendChild(el);
    return { el, v: ll(h.lat, h.lon, 1.01) };
  });

  // Face India/China towards the camera
  const home = ll(23, 96, 1);
  const base = Math.atan2(-home.x, home.z);
  const layout = { x: 0, y: 0, z: 3.3 };
  stage.onResize = (w, h) => {
    const mob = isMobile();
    // desktop: like the reference, a big globe (radius ≈ 53vh) centred at ~88vw / 46vh,
    // running off the right and top edges
    layout.x = mob ? 0 : 0.45;
    layout.y = mob ? 0.02 : 0.08;
    camera.position.z = mob ? 4.1 : 3.0;
    dotMat.uniforms.uSize.value = (Math.min(h, w * 1.1) / 330) * camera.position.z * renderer.getPixelRatio();
  };
  stage.resize();

  // Interaction (mouse only so touch keeps scrolling the page)
  const state = { intro: 0, scroll: 0 };
  let drag = false, lastX = 0, lastY = 0, offY = 0, offX = 0, mx = 0, my = 0;
  const hit = canvas.parentElement;
  hit.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    drag = true; lastX = e.clientX; lastY = e.clientY;
    hit.classList.add('dragging');
  });
  window.addEventListener('pointerup', () => { drag = false; hit.classList.remove('dragging'); });
  window.addEventListener('pointermove', (e) => {
    mx = e.clientX / innerWidth - 0.5;
    my = e.clientY / innerHeight - 0.5;
    if (!drag) return;
    offY += (e.clientX - lastX) * 0.005;
    offX = THREE.MathUtils.clamp(offX + (e.clientY - lastY) * 0.003, -0.5, 0.5);
    lastX = e.clientX; lastY = e.clientY;
  });

  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3(), toCam = new THREE.Vector3(), center = new THREE.Vector3();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  stage.onFrame = (t, dt) => {
    time.value = t;
    if (!drag) { offY *= Math.pow(0.55, dt); offX *= Math.pow(0.4, dt); }
    const intro = ease(state.intro);
    spin.rotation.y = base + Math.sin(t * 0.12) * 0.22 + offY - (1 - intro) * 1.8 + state.scroll * 0.9;
    tilt.rotation.x = 0.38 + offX + my * 0.08;
    tilt.rotation.z = -0.08 + mx * 0.05;
    root.position.x = layout.x;
    root.position.y = layout.y + Math.pow(state.scroll, 1.4) * 0.9;   // drifts up a little; the horizon covers it
    root.scale.setScalar((0.6 + 0.4 * intro) * (1 + state.scroll * 0.25));

    rings.forEach(({ ring, off }) => {
      const f = (t * 0.7 + off) % 1;
      ring.scale.setScalar(1 + f * 1.8);
      ring.material.opacity = 1 - f;
    });

    root.updateMatrixWorld(true);
    root.getWorldPosition(center);
    const W = stage.width, H = stage.height;
    labels.forEach((L) => {
      tmp.copy(L.v).applyMatrix4(spin.matrixWorld);
      nrm.copy(tmp).sub(center).normalize();
      toCam.copy(camera.position).sub(tmp).normalize();
      const facing = nrm.dot(toCam);
      tmp.project(camera);
      L.el.style.transform = `translate3d(${((tmp.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * H).toFixed(1)}px, 0)`;
      L.el.style.opacity = (THREE.MathUtils.clamp((facing - 0.25) * 4, 0, 1) * intro * Math.max(0, 1 - state.scroll * 2)).toFixed(2);
    });
  };

  return {
    setScroll(p) { state.scroll = p; },
    intro() { window.gsap.to(state, { intro: 1, duration: 2.6, ease: 'power2.out' }); },
  };
}
