// Scroll-driven reach stacker section: mounts the live three.js machine into a sticky
// full-screen section and maps the section's scroll progress onto the lift sequence.
//   <section class="rs3d" data-rs3d> … <canvas class="rs3d-canvas"></canvas> … </section>
import * as THREE from 'three';
import { createStage, isMobile, lerp, seg } from '../scenes/util.js';
import { buildReachStacker3D, buildYard, choreography, STAGES, DEG } from '../scenes/reachstacker3d.js';

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

export function mountReachStacker(section) {
  const canvas = section.querySelector('.rs3d-canvas');
  const label = section.querySelector('.rs3d-step');
  const count = section.querySelector('.rs3d-count');
  const bar = section.querySelector('.rs3d-bar i');
  if (!canvas || !webglOK()) {
    section.classList.add('rs3d--fallback');
    return null;
  }
  let stage;
  try {
    stage = createStage(canvas, { fov: 32, near: 0.5, far: 600, shadows: true, env: true, maxDpr: isMobile() ? 1.5 : 2 });
  } catch (e) {
    console.error('[rs3d] WebGL init failed', e);
    section.classList.add('rs3d--fallback');
    return null;
  }
  const { scene, camera, renderer } = stage;
  renderer.toneMappingExposure = 1.05;

  // sky + haze
  const sky = document.createElement('canvas');
  sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d');
  const grd = sg.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#9fb9d6'); grd.addColorStop(0.6, '#dfe7ef'); grd.addColorStop(1, '#eef1f4');
  sg.fillStyle = grd; sg.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog('#e4eaf0', 45, 150);

  // light: soft sky fill + low warm sun for long shadows
  scene.add(new THREE.HemisphereLight('#e6eef8', '#5a5650', 0.75));
  const sun = new THREE.DirectionalLight('#fff3e2', 2.4);
  sun.position.set(14, 22, 16);
  sun.target.position.set(2, 0, 0);
  sun.castShadow = true;
  const sm = isMobile() ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -16, right: 18, top: 16, bottom: -10, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  scene.add(buildYard());
  const rig = buildReachStacker3D();
  scene.add(rig.root);
  const poseAt = choreography(rig, 9.0);

  // camera: three-quarter front view; drifts round and in/out with the action
  const target = new THREE.Vector3();
  const frameCam = (p) => {
    // mostly side-on (the boom's whole travel reads), easing round a little as the box comes up
    const az = lerp(18, 30, p) * DEG;
    const el = lerp(8, 12, seg(p, 0.6, 1)) * DEG;
    const look = new THREE.Vector3(lerp(1.8, 3.4, seg(p, 0.25, 0.55)), lerp(3.2, 4.6, seg(p, 0.15, 0.9)), 0);
    // keep the machine + container (≈ 18 m) across even on narrow screens
    const vFov = camera.fov * DEG;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fitW = 21 / (2 * Math.tan(hFov / 2));
    const dist = Math.max(lerp(33, 30, seg(p, 0.35, 0.6)) + lerp(0, 3, seg(p, 0.75, 1)), fitW);
    target.lerp(look, 0.12);
    camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
    camera.lookAt(target);
  };
  target.set(1.8, 3.2, 0);

  // scroll → progress (damped so wheel steps never jump)
  let goal = 0, prog = 0, lastStage = -1;
  const read = () => {
    const r = section.getBoundingClientRect();
    const span = section.offsetHeight - innerHeight;
    goal = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
  };
  if (window.ScrollTrigger) {
    window.ScrollTrigger.create({ trigger: section, start: 'top top', end: 'bottom bottom', onUpdate: (s) => { goal = s.progress; } });
  } else {
    addEventListener('scroll', read, { passive: true });
  }
  read();

  stage.onFrame = (t, dt) => {
    prog = THREE.MathUtils.damp(prog, goal, 6, dt);
    if (Math.abs(prog - goal) < 1e-4) prog = goal;
    rig.apply(poseAt(prog));
    frameCam(prog);
    // caption + progress
    let si = 0;
    STAGES.forEach(([at], i) => { if (prog >= at) si = i; });
    if (si !== lastStage) {
      lastStage = si;
      if (label) { label.textContent = STAGES[si][1]; label.classList.remove('in'); void label.offsetWidth; label.classList.add('in'); }
      if (count) count.textContent = String(si + 1).padStart(2, '0') + ' / ' + String(STAGES.length).padStart(2, '0');
    }
    if (bar) bar.style.transform = `scaleX(${prog})`;
  };
  // first frame immediately (no pop when the section comes into view)
  rig.apply(poseAt(0));
  frameCam(0);
  return { stage, rig };
}

document.querySelectorAll('[data-rs3d]').forEach((s) => {
  try { mountReachStacker(s); } catch (e) { console.error('[rs3d]', e); s.classList.add('rs3d--fallback'); }
});
