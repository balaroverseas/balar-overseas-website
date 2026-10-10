// Real-time reach stacker for the scroll section (three.js, no external model).
// No photoreal GLB of a reach stacker ships with this project, so the machine is built
// procedurally to real-world proportions (Kalmar/Konecranes class, metres):
//   wheelbase 6 m, front tyres Ø1.6 m, overall ≈ 11 m long without the boom,
//   boom pivot 4.2 m up over the rear axle, telescopic boom 9.7–14 m, 20 ft container.
// Every moving part is its own Object3D (see `parts`), with its pivot where the real pin is:
//   parts.boom        — rotates about the boom foot pin (z axis)
//   parts.boomInner   — slides along the boom (telescope)
//   parts.cylinders[] — barrel turns about the chassis pin, rod slides out to the boom pin
//   parts.spreader    — hangs level from the boom head pin
//   parts.container   — sits on the ground until the twistlocks lock, then rides the spreader
// Axes: +X forward (towards the container), +Y up, +Z towards the camera side.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildWheel, canvasTex, seg, lerp, clamp01, mergeByMaterial, loadGLB } from './util.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ materials
function materials() {
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    blue: phys({ color: '#1e4f9e', metalness: 0.35, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
    blueDark: phys({ color: '#163c78', metalness: 0.35, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    grey: phys({ color: '#2b3038', metalness: 0.55, roughness: 0.42, clearcoat: 0.3 }),
    greyMid: std({ color: '#4a525d', metalness: 0.6, roughness: 0.38 }),
    steel: std({ color: '#8d96a2', metalness: 0.9, roughness: 0.32 }),
    chrome: std({ color: '#eef1f5', metalness: 1, roughness: 0.1 }),
    black: std({ color: '#141619', metalness: 0.2, roughness: 0.75 }),
    rubber: std({ color: '#0f1012', roughness: 0.9 }),
    yellow: phys({ color: '#f2b705', metalness: 0.2, roughness: 0.4, clearcoat: 0.5 }),
    glass: phys({ color: '#a9c3d8', metalness: 0, roughness: 0.04, transparent: true, opacity: 0.26, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false }),
    seat: std({ color: '#1d1f23', roughness: 0.8 }),
    lampW: std({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 2.2 }),
    lampA: std({ color: '#ffb020', emissive: '#ff9000', emissiveIntensity: 1.8 }),
    lampR: std({ color: '#ff3b2f', emissive: '#ff2010', emissiveIntensity: 1.6 }),
  };
}

// ------------------------------------------------------------------ geometry helpers
function adder(parent) {
  return (geo, mat, x = 0, y = 0, z = 0, p = parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    p.add(m);
    return m;
  };
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const RB = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
// cylinder along an axis ('x' | 'y' | 'z')
const CY = (r, len, axis = 'y', seg_ = 24, r2 = r) => {
  const g = new THREE.CylinderGeometry(r2, r, len, seg_);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
};
// side profile drawn in X/Y, extruded across Z (centred), with a small bevel
function profile(pts, depth, bevel = 0.04) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, y]) => s.lineTo(x, y));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  g.computeVertexNormals();
  return g;
}
function textPlane(text, w, h, { color = '#ffffff', weight = 800, px = 150 } = {}) {
  const tex = canvasTex(1024, Math.round(1024 * h / w), (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = color;
    g.font = `${weight} ${px}px Archivo, Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(text, W / 2, H / 2 + 6);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
}

// ------------------------------------------------------------------ 40 ft container with real ribs
// (40 ft: same length as the skeletal trailer it is loaded onto)
export const CONT = { L: 12.192, W: 2.438, H: 2.591 };
export function buildRibbedContainer(color = '#b4372c', label = 'BALAR OVERSEAS', labelColor = '#ffffff') {
  const g = new THREE.Group();
  const add = adder(g);
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55 });
  const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.72), metalness: 0.45, roughness: 0.5 });
  const casting = new THREE.MeshStandardMaterial({ color: '#2a2c30', metalness: 0.6, roughness: 0.5 });
  const { L, W, H } = CONT;
  // origin: centre of the bottom face; length along Z
  add(B(W - 0.12, H - 0.16, L - 0.12), paint, 0, H / 2, 0);                       // shell
  // vertical corrugation on both long sides (instanced trapezoid ribs)
  const ribGeo = B(0.05, H - 0.34, 0.11);
  const n = Math.floor((L - 0.4) / 0.27);
  const ribs = new THREE.InstancedMesh(ribGeo, paint, n * 2);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + 0.28 + i * 0.27;
    m4.makeTranslation(W / 2 - 0.055, H / 2, z); ribs.setMatrixAt(i * 2, m4);
    m4.makeTranslation(-W / 2 + 0.055, H / 2, z); ribs.setMatrixAt(i * 2 + 1, m4);
  }
  ribs.castShadow = ribs.receiveShadow = true;
  g.add(ribs);
  // roof stiffeners
  const nRoof = Math.round(L * 3);
  const roofRibs = new THREE.InstancedMesh(B(W - 0.3, 0.03, 0.09), paint, nRoof);
  for (let i = 0; i < nRoof; i++) { m4.makeTranslation(0, H - 0.07, -L / 2 + 0.35 + i * (L - 0.7) / (nRoof - 1)); roofRibs.setMatrixAt(i, m4); }
  g.add(roofRibs);
  // frame: corner posts, top/bottom side rails, end rails
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => add(B(0.16, H, 0.16), frame, sx * (W / 2 - 0.08), H / 2, sz * (L / 2 - 0.08))));
  [-1, 1].forEach((sx) => [0.08, H - 0.08].forEach((y) => add(B(0.16, 0.16, L), frame, sx * (W / 2 - 0.08), y, 0)));
  [-1, 1].forEach((sz) => [0.1, H - 0.1].forEach((y) => add(B(W, 0.2, 0.16), frame, 0, y, sz * (L / 2 - 0.08))));
  // corner castings (the twistlocks drop into the top ones)
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => [0.06, H - 0.06].forEach((y) => add(B(0.18, 0.12, 0.18), casting, sx * (W / 2 - 0.09), y, sz * (L / 2 - 0.09)))));
  // door end (+Z): two leaves, four locking bars with handles, hinges
  add(B(0.02, H - 0.36, 0.02), frame, 0, H / 2, L / 2 + 0.005).scale.set(1, 1, 1);
  [-0.85, -0.35, 0.35, 0.85].forEach((x) => {
    add(CY(0.022, H - 0.3, 'y', 10), new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.9, roughness: 0.3 }), x, H / 2, L / 2 + 0.03);
    add(B(0.05, 0.3, 0.04), casting, x + 0.08, H * 0.45, L / 2 + 0.05);
  });
  [-1, 1].forEach((sx) => [0.5, 1.3, 2.1].forEach((y) => add(B(0.06, 0.12, 0.05), casting, sx * (W / 2 - 0.02), y, L / 2 + 0.02)));
  if (label) {
    const t = textPlane(label, Math.min(6.4, L * 0.72), 0.75, { color: labelColor, px: 96 });
    t.position.set(W / 2 + 0.035, H * 0.62, -L * 0.08);
    t.rotation.y = Math.PI / 2;
    g.add(t);
    const t2 = t.clone();
    t2.position.x = -W / 2 - 0.035;
    t2.rotation.y = -Math.PI / 2;
    g.add(t2);
  }
  return mergeByMaterial(g);
}

// ISO 6346 markings painted on a real box: owner code + serial + check digit, size/type code,
// the weight panel on the left door, CSC safety-approval and customs plates, small owner logo.
function doorMarkings(number, iso, ink = '#1f2329') {
  const W = 1024, H = Math.round(1024 * CONT.H / CONT.W);
  const tex = canvasTex(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = ink;
    g.textBaseline = 'top';
    // owner code + serial + boxed check digit, top right, with the size/type code under it
    const [owner, serial, check] = number.split(' ');
    g.font = '700 58px Arial, sans-serif';
    const t1 = `${owner} ${serial}`;
    const w1 = g.measureText(t1).width;
    const x1 = W - 70 - w1 - 56;
    g.fillText(t1, x1, 70);
    g.lineWidth = 5; g.strokeStyle = ink; g.strokeRect(W - 70 - 46, 64, 46, 64);
    g.fillText(check, W - 70 - 38, 70);
    g.font = '700 50px Arial, sans-serif';
    g.fillText(iso, W - 70 - g.measureText(iso).width, 146);
    // weight panel, left door
    g.font = '600 25px Arial, sans-serif';
    const rows = [['MAX. GROSS', '30,480 KG', '67,200 LB'], ['TARE', '3,750 KG', '8,270 LB'], ['NET', '26,730 KG', '58,930 LB'], ['CU. CAP.', '67.7 CU.M', '2,390 CU.FT']];
    rows.forEach(([k, a, b], i) => {
      const y = 330 + i * 40;
      g.fillText(k, 70, y); g.fillText(a, 250, y); g.fillText(b, 390, y);
    });
    // CSC safety approval plate (stamped metal) + customs plate, left door, lower
    const plate = (x, y, w, h, lines) => {
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, '#d9dde2'); gr.addColorStop(1, '#a8aeb6');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.strokeStyle = '#6d737b'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
      g.fillStyle = '#3b4047'; g.font = '700 16px Arial, sans-serif';
      lines.forEach((l, i) => g.fillText(l, x + 10, y + 10 + i * 19));
      [[x + 6, y + 6], [x + w - 10, y + 6], [x + 6, y + h - 10], [x + w - 10, y + h - 10]].forEach(([px, py]) => { g.fillStyle = '#5c6168'; g.fillRect(px, py, 4, 4); });
      g.fillStyle = ink;
    };
    plate(70, 560, 300, 150, ['CSC SAFETY APPROVAL', 'GBR/L/2026/0417', 'DATE MANUFACTURED 03/2026', 'MAX GROSS 30,480 KG', 'ALLOW. STACK 192,000 KG', 'RACKING TEST LOAD 15,240 KG']);
    plate(70, 730, 300, 70, ['APPROVED FOR TRANSPORT', 'UNDER CUSTOMS SEAL']);
    // owner logo, right door
    g.font = '800 46px Arial, sans-serif';
    g.fillText('BALAR', W - 70 - g.measureText('BALAR').width, 330);
    g.font = '600 22px Arial, sans-serif';
    g.fillText('OVERSEAS', W - 70 - g.measureText('OVERSEAS').width, 382);
    // small hazard/handling stickers at eye level on the right door
    g.fillStyle = '#f2b705'; g.fillRect(W - 170, 470, 100, 60);
    g.fillStyle = ink; g.font = '800 16px Arial, sans-serif'; g.fillText('HANDLE', W - 160, 480); g.fillText('WITH CARE', W - 162, 502);
  });
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(new THREE.PlaneGeometry(CONT.W * 0.94, CONT.H * 0.94), m);
}

/**
 * Swaps a built container (buildRibbedContainer) for the real 40 ft model (assets/models/
 * container.glb, from "Container Pack" by drcrazzie, CC-BY 4.0) in the same frame: origin at the
 * bottom centre, long axis along Z, CONT dimensions. `tint` multiplies its (light grey) paint.
 */
export function upgradeContainer(group, { tint = null, label = '', labelColor = '#1e2328', number = 'BLRU 210450 7', iso = '42G1', ink = '#1f2329' } = {}) {
  return loadGLB('assets/models/container.glb').then((src) => {
    const model = src.clone(true);
    // GLB: 12.065 × 2.924 (high-cube) × 2.426 m, long axis X → standard 40 ft, long axis Z
    model.rotation.y = -Math.PI / 2;
    model.scale.set(CONT.L / 12.065, CONT.H / 2.924, CONT.W / 2.426);
    if (tint) {
      model.traverse((o) => {
        if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(tint); }
      });
    }
    group.children.slice().forEach((c) => group.remove(c));
    group.add(model);
    // door end (+Z in this frame): ISO markings, plates, stickers
    if (number) {
      const d = doorMarkings(number, iso, ink);
      d.position.set(0, CONT.H * 0.5, CONT.L / 2 + 0.012);
      group.add(d);
      // the number again at the top corner of both long sides, as painted on real boxes
      [-1, 1].forEach((s) => {
        const t = textPlane(`${number}  ${iso}`, 2.0, 0.22, { color: ink, px: 80, weight: 700 });
        t.position.set(s * (CONT.W / 2 + 0.03), CONT.H - 0.32, s * (CONT.L / 2 - 1.3));
        t.rotation.y = s * Math.PI / 2;
        group.add(t);
      });
    }
    if (label) {
      [-1, 1].forEach((s) => {
        const t = textPlane(label, Math.min(6.4, CONT.L * 0.72), 0.75, { color: labelColor, px: 96 });
        t.position.set(s * (CONT.W / 2 + 0.03), CONT.H * 0.62, -CONT.L * 0.08 * s);
        t.rotation.y = s * Math.PI / 2;
        group.add(t);
      });
    }
    return group;
  }).catch((e) => { console.warn('[3D] container model not loaded, keeping the built one', e); return group; });
}

// ------------------------------------------------------------------ the machine
// opts.container: false when the scene owns the box (it has to stay on a truck after release)
export function buildReachStacker3D({ container: withContainer = true } = {}) {
  const M = materials();
  const root = new THREE.Group();
  const parts = { root, cylinders: [], wheels: [] };

  // ---- chassis (static frame + bodywork)
  const chassis = new THREE.Group();
  root.add(chassis);
  parts.chassis = chassis;
  const add = adder(chassis);
  // main frame side profile, lower nose at the front
  add(profile([[-4.7, 0.62], [3.35, 0.62], [3.8, 0.9], [3.8, 1.34], [-4.7, 1.34]], 2.05, 0.05), M.blue);
  // front drive axle + differential
  add(B(0.62, 0.5, 2.7), M.grey, 2.6, 0.8, 0);
  add(CY(0.36, 0.7, 'z', 24), M.grey, 2.6, 0.72, 0);
  // rear steer axle
  add(B(0.5, 0.42, 2.3), M.grey, -3.4, 0.74, 0);
  // counterweight (rear) with tail lights and tow pin
  add(profile([[-5.55, 0.55], [-3.95, 0.55], [-3.95, 2.5], [-5.15, 2.5], [-5.55, 2.05]], 3.0, 0.08), M.blue);
  add(B(0.08, 0.32, 2.9), M.grey, -5.56, 0.75, 0);
  [-1, 1].forEach((s) => {
    add(B(0.06, 0.16, 0.34), M.lampR, -5.6, 1.55, s * 1.25);
    add(B(0.06, 0.16, 0.2), M.lampA, -5.6, 1.33, s * 1.25);
  });
  // engine hood with louvres (both sides)
  add(profile([[-4.0, 1.34], [-1.25, 1.34], [-1.25, 2.2], [-1.65, 2.6], [-4.0, 2.6]], 2.45, 0.06), M.blue);
  [-1, 1].forEach((s) => { for (let i = 0; i < 7; i++) add(B(0.07, 0.62, 0.03), M.grey, -3.55 + i * 0.26, 1.98, s * 1.235); });
  add(CY(0.09, 0.9, 'y', 16), M.black, -1.85, 3.0, -0.75);                                  // exhaust stack
  add(CY(0.11, 0.08, 'y', 16), M.steel, -1.85, 3.45, -0.75);
  // boom towers: twin plates rising out of the hood to the boom foot pin
  [-1, 1].forEach((s) => add(profile([[-4.25, 1.3], [-2.55, 1.3], [-3.05, 4.55], [-3.95, 4.55]], 0.14, 0.02), M.blueDark, 0, 0, s * 0.6));
  add(CY(0.17, 1.62, 'z', 24), M.steel, -3.5, 4.2, 0);                                       // foot pin
  [-1, 1].forEach((s) => {
    add(CY(0.26, 0.06, 'z', 24), M.grey, -3.5, 4.2, s * 0.8);                                 // pin keeper plates
    for (let i = 0; i < 4; i++) add(CY(0.035, 0.05, 'z', 8), M.steel, -3.5 + 0.18 * Math.cos(i * Math.PI / 2 + 0.6), 4.2 + 0.18 * Math.sin(i * Math.PI / 2 + 0.6), s * 0.84);  // bolts
  });
  // side tanks between the axles (fuel / hydraulic) with filler caps
  [-1, 1].forEach((s) => {
    add(RB(2.5, 0.72, 0.46, 0.06), M.blue, -0.75, 1.0, s * 1.28);
    add(CY(0.07, 0.06, 'y', 12), M.steel, -0.2, 1.39, s * 1.28);
    add(B(2.3, 0.05, 0.02), M.grey, -0.75, 1.0, s * 1.515);
  });
  // lift-cylinder chassis brackets (pins at x 1.6, y 1.35)
  [-1, 1].forEach((s) => {
    add(B(0.5, 0.42, 0.1), M.grey, 1.6, 1.42, s * 0.6);
    add(B(0.5, 0.42, 0.1), M.grey, 1.6, 1.42, s * 0.9);
    add(CY(0.08, 0.42, 'z', 16), M.steel, 1.6, 1.42, s * 0.75);
  });
  // front mudguards over the drive tyres
  [-1, 1].forEach((s) => {
    const guard = new THREE.CylinderGeometry(0.98, 0.98, 0.78, 32, 1, true, -Math.PI * 0.55, Math.PI * 1.1).rotateX(Math.PI / 2);
    const m = add(guard, new THREE.MeshStandardMaterial({ color: '#163c78', metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide }), 2.6, 0.8, s * 1.6);
    m.rotation.z = 0;
  });
  // front work lights + plate
  [-1, 1].forEach((s) => add(B(0.06, 0.16, 0.3), M.lampW, 3.82, 1.12, s * 0.75));
  add(B(0.04, 0.3, 1.0), M.grey, 3.81, 0.8, 0);
  // access steps (camera side) up to the cab door, and safety railings
  const stepX = 0.15;
  [0.5, 0.88, 1.26].forEach((y, i) => {
    add(B(0.55, 0.05, 0.38), M.steel, stepX + 0.25 - i * 0.12, y, 1.58);
    for (let k = 0; k < 5; k++) add(B(0.55, 0.055, 0.02), M.grey, stepX + 0.25 - i * 0.12, y + 0.003, 1.42 + k * 0.075);  // grating
  });
  [-1, 1].forEach((s) => add(B(0.05, 1.0, 0.05), M.grey, stepX + (s < 0 ? 0.55 : -0.05), 0.92, 1.8));          // stringers
  const rail = (a, b, r = 0.025) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = add(CY(r, d.length(), 'y', 10), M.yellow, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  rail(V(0.75, 1.34, 1.05), V(0.75, 2.35, 1.05)); rail(V(-1.35, 1.34, 1.05), V(-1.35, 2.35, 1.05));
  rail(V(-1.35, 2.35, 1.05), V(0.75, 2.35, 1.05)); rail(V(-1.35, 1.85, 1.05), V(0.75, 1.85, 1.05));
  rail(V(0.62, 0.5, 1.82), V(0.62, 1.9, 1.82)); rail(V(0.62, 1.9, 1.82), V(0.75, 2.35, 1.05));

  // ---- wheels (four, rubber on steel rims): front Ø1.6 m drive, rear Ø1.44 m steer
  const wheelAt = (x, z, r, w) => {
    const wh = buildWheel(r, w, '#c3c8cf');
    wh.position.set(x, r, z);
    if (z < 0) wh.rotation.y = Math.PI;
    root.add(wh);
    parts.wheels.push(wh);
  };
  [-1, 1].forEach((s) => { wheelAt(2.6, s * 1.6, 0.8, 0.68); wheelAt(-3.4, s * 1.42, 0.72, 0.58); });

  // ---- operator cabin: mid-machine, ahead of the hood, under the boom
  const cabin = new THREE.Group();
  cabin.position.set(0.15, 1.34, -0.05);
  root.add(cabin);
  parts.cabin = cabin;
  const ac = adder(cabin);
  const CW = 2.05, CD = 1.66, CH = 2.22;              // cab length (x), width (z), height
  ac(B(CW + 0.1, 0.22, CD + 0.1), M.grey, 0, 0.11, 0);                                        // floor / mounts
  ac(B(CW, 0.5, CD), M.blueDark, 0, 0.47, 0);                                                 // lower panels
  ac(RB(CW + 0.24, 0.14, CD + 0.24, 0.06), M.blue, 0.06, CH + 0.07, 0);                      // roof
  ac(B(0.28, 0.06, CD), M.grey, CW / 2 + 0.2, CH - 0.06, 0);                                  // sun visor
  // pillars
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => ac(B(0.07, CH - 0.7, 0.07), M.grey, sx * (CW / 2 - 0.035), 0.7 + (CH - 0.7) / 2, sz * (CD / 2 - 0.035))));
  ac(B(0.06, CH - 0.7, 0.06), M.grey, 0.25, 0.7 + (CH - 0.7) / 2, CD / 2 - 0.03);              // door post
  // glazing
  ac(B(0.02, CH - 0.76, CD - 0.1), M.glass, CW / 2 - 0.02, 0.72 + (CH - 0.76) / 2, 0);
  ac(B(0.02, CH - 0.76, CD - 0.1), M.glass, -CW / 2 + 0.02, 0.72 + (CH - 0.76) / 2, 0);
  [-1, 1].forEach((sz) => ac(B(CW - 0.1, CH - 0.76, 0.02), M.glass, 0, 0.72 + (CH - 0.76) / 2, sz * (CD / 2 - 0.02)));
  ac(B(CW - 0.2, 0.02, CD - 0.2), M.glass, 0, CH - 0.02, 0);                                   // roof window
  // door (camera side): frame, handle, hinges
  ac(B(0.03, 0.05, 0.03), M.grey, 0, 0, 0).visible = false;
  [[-0.78, 1.45], [0.22, 1.45]].forEach(([x]) => ac(B(0.04, CH - 0.25, 0.03), M.grey, x, (CH - 0.25) / 2 + 0.12, CD / 2 + 0.01));
  ac(B(1.0, 0.04, 0.03), M.grey, -0.28, CH - 0.12, CD / 2 + 0.01);
  ac(B(0.16, 0.04, 0.05), M.steel, 0.1, 1.15, CD / 2 + 0.04);
  [0.55, 1.75].forEach((y) => ac(B(0.08, 0.14, 0.05), M.steel, -0.8, y, CD / 2 + 0.03));
  // interior: seat, console, steering wheel
  ac(B(0.5, 0.12, 0.55), M.seat, -0.25, 0.95, 0);
  ac(B(0.12, 0.7, 0.55), M.seat, -0.52, 1.3, 0);
  ac(B(0.35, 0.65, 0.5), M.grey, 0.7, 0.98, 0);
  const sw = ac(new THREE.TorusGeometry(0.17, 0.025, 8, 24), M.black, 0.45, 1.35, 0);
  sw.rotation.y = Math.PI / 2; sw.rotation.x = 0.5;
  // wiper, mirrors, roof lights, beacon
  const wiper = ac(B(0.02, 0.75, 0.03), M.black, CW / 2 + 0.01, 1.2, 0.15);
  wiper.rotation.x = 0.5;
  [-1, 1].forEach((sz) => {
    ac(B(0.5, 0.04, 0.04), M.black, CW / 2 + 0.2, CH - 0.3, sz * (CD / 2 + 0.05));
    ac(B(0.05, 0.38, 0.22), M.black, CW / 2 + 0.44, CH - 0.48, sz * (CD / 2 + 0.08));
    ac(B(0.16, 0.12, 0.2), M.lampW, CW / 2 + 0.05, CH + 0.2, sz * 0.55);
    ac(B(0.16, 0.12, 0.2), M.lampW, -CW / 2 + 0.05, CH + 0.2, sz * 0.55);
  });
  ac(CY(0.09, 0.16, 'y', 16), M.lampA, -0.4, CH + 0.22, 0);

  // ---- boom: outer section about the foot pin, inner section telescopes out of it
  // kinematic constants live in G so a loaded model can swap in its own (upgradeStacker)
  const G = { PIVOT: new THREE.Vector2(-3.5, 4.2), TIP: new THREE.Vector2(9.65, -0.42), CYL_B: new THREE.Vector3(1.6, 1.42, 0), CYL_A: new THREE.Vector2(6.0, -0.75), model: null };
  const PIVOT = G.PIVOT;
  const boom = new THREE.Group();
  boom.position.set(PIVOT.x, PIVOT.y, 0);
  root.add(boom);
  parts.boom = boom;
  const ab = adder(boom);
  // tapered box section, heel rounded over the pin
  ab(profile([[-0.55, 0.5], [8.6, 0.42], [8.6, -0.42], [-0.55, -0.52], [-0.7, 0]], 0.92, 0.05), M.blue);
  ab(CY(0.38, 0.96, 'z', 28), M.blueDark, 0, 0, 0);
  ab(B(0.28, 0.95, 0.98), M.grey, 8.48, 0, 0);                                                // head collar / wear pads
  // lift-cylinder lugs under the boom (pins at local 6.0, -0.75)
  [-1, 1].forEach((s) => {
    ab(profile([[5.6, -0.4], [6.4, -0.4], [6.2, -0.92], [5.8, -0.92]], 0.08, 0.01), M.grey, 0, 0, s * 0.6);
    ab(profile([[5.6, -0.4], [6.4, -0.4], [6.2, -0.92], [5.8, -0.92]], 0.08, 0.01), M.grey, 0, 0, s * 0.9);
    ab(CY(0.08, 0.42, 'z', 16), M.steel, 6.0, -0.75, s * 0.75);
  });
  // hydraulic hoses along the top
  [-0.22, 0.22].forEach((z) => {
    const c = new THREE.CatmullRomCurve3([V(-0.3, 0.55, z), V(2, 0.56, z), V(5, 0.5, z), V(8.2, 0.46, z)]);
    ab(new THREE.TubeGeometry(c, 40, 0.045, 8), M.rubber);
  });
  for (let i = 0; i < 4; i++) ab(B(0.06, 0.08, 0.6), M.grey, 1.5 + i * 2, 0.55 - i * 0.02, 0);   // hose clamps
  // BALAR lettering on both boom sides
  [-1, 1].forEach((s) => {
    const t = textPlane('BALAR', 3.2, 0.62, { color: '#ffffff', px: 300 });
    t.position.set(4.0, 0.0, s * 0.468);
    if (s < 0) t.rotation.y = Math.PI;
    boom.add(t);
  });
  const boomInner = new THREE.Group();
  boom.add(boomInner);
  parts.boomInner = boomInner;
  const ai = adder(boomInner);
  ai(B(7.8, 0.68, 0.72), M.greyMid, 5.5, -0.06, 0);
  ai(RB(0.6, 0.92, 0.88, 0.08), M.blue, 9.5, -0.2, 0);                                         // boom head
  ai(CY(0.13, 1.0, 'z', 20), M.steel, 9.65, -0.42, 0);                                          // head pin
  ai(B(0.4, 0.06, 0.7), M.yellow, 9.3, 0.29, 0);
  const TIP_LOCAL = G.TIP;

  // ---- lift cylinders (two, either side of the cab front)
  const CYL_B = G.CYL_B;
  const CYL_A_LOCAL = G.CYL_A;
  const BARREL = 2.25;
  [-1, 1].forEach((s) => {
    const g = new THREE.Group();
    g.position.set(CYL_B.x, CYL_B.y, s * 0.75);
    root.add(g);
    const ag = adder(g);
    ag(CY(0.19, BARREL, 'y', 24), M.grey, 0, BARREL / 2, 0);                                     // barrel
    ag(CY(0.22, 0.18, 'y', 24), M.greyMid, 0, BARREL - 0.06, 0);                                 // gland
    ag(CY(0.24, 0.3, 'z', 20), M.greyMid, 0, 0.05, 0);                                           // base eye
    const rod = new THREE.Group();
    g.add(rod);
    const rodMesh = new THREE.Mesh(CY(0.1, 1, 'y', 20), M.chrome);
    rodMesh.castShadow = true;
    rod.add(rodMesh);
    const eye = new THREE.Mesh(CY(0.16, 0.26, 'z', 20), M.greyMid);
    rod.add(eye);
    parts.cylinders.push({ group: g, rod, rodMesh, eye });
  });

  // ---- spreader: hangs level from the head pin; origin = head pin
  const spreader = new THREE.Group();
  root.add(spreader);
  parts.spreader = spreader;
  const as = adder(spreader);
  as(B(0.32, 0.55, 0.32), M.grey, 0, -0.3, 0);                                                 // link
  as(RB(1.15, 0.42, 1.4, 0.08), M.blue, 0, -0.78, 0);                                          // rotator
  as(CY(0.5, 0.12, 'y', 28), M.steel, 0, -1.02, 0);                                             // slewing ring
  const SP_END = CONT.L / 2 - 0.09, SP_SIDE = CONT.W / 2 - 0.09;
  // main beam with the two telescopic arms run out to the box length (40 ft)
  as(B(0.62, 0.46, 6.0), M.grey, 0, -1.28, 0);                                                  // main beam
  as(B(0.46, 0.34, 2 * SP_END + 0.2), M.greyMid, 0, -1.28, 0);                                  // telescopic arms
  [-1, 1].forEach((s) => {
    as(CY(0.07, 3.2, 'z', 12), M.chrome, s * 0.36, -1.2, s * 2.6);                              // telescoping cylinders
    as(CY(0.1, 2.0, 'z', 12), M.grey, s * 0.36, -1.2, s * 1.6);
  });
  const lights = [];
  [-1, 1].forEach((sz) => {
    as(B(2.62, 0.38, 0.42), M.yellow, 0, -1.47, sz * SP_END);                                  // end beams
    as(B(2.5, 0.04, 0.3), M.black, 0, -1.27, sz * SP_END);
    [-1, 1].forEach((sx) => {
      as(B(0.24, 0.12, 0.24), M.grey, sx * SP_SIDE, -1.7, sz * SP_END);                         // twistlock housings
      as(CY(0.05, 0.14, 'y', 10), M.steel, sx * SP_SIDE, -1.81, sz * SP_END);                   // twistlock cones
      const l = new THREE.Mesh(B(0.1, 0.08, 0.1), new THREE.MeshStandardMaterial({ color: '#ff3b2f', emissive: '#ff2010', emissiveIntensity: 2 }));
      l.position.set(sx * (SP_SIDE - 0.18), -1.24, sz * SP_END);
      spreader.add(l);
      lights.push(l);
    });
  });
  const SP_H = 1.76;      // head pin → container roof when locked

  // ---- container
  const container = withContainer ? buildRibbedContainer('#b4372c') : null;
  if (container) {
    root.add(container);
    upgradeContainer(container, { tint: '#c4544a', label: 'BALAR OVERSEAS', labelColor: '#ffffff' });
  }
  parts.container = container;

  // fewer draw calls: bake the static parts of each moving assembly into one mesh per material
  [chassis, cabin, boom, boomInner, spreader, ...parts.cylinders.map((c) => c.group)].forEach(mergeByMaterial);

  // ---------------------------------------------------------------- kinematics
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  const tipFor = (angle, ext) => new THREE.Vector2(
    PIVOT.x + Math.cos(angle) * (TIP_LOCAL.x + ext) - Math.sin(angle) * TIP_LOCAL.y,
    PIVOT.y + Math.sin(angle) * (TIP_LOCAL.x + ext) + Math.cos(angle) * TIP_LOCAL.y,
  );
  // boom angle + telescope extension that put the head pin at `tip`
  const solve = (tip) => {
    const d = new THREE.Vector2(tip.x - PIVOT.x, tip.y - PIVOT.y);
    // |(TIP.x+e, TIP.y)| = |d|  →  e = sqrt(|d|² − TIP.y²) − TIP.x
    const e = Math.sqrt(Math.max(0, d.lengthSq() - TIP_LOCAL.y ** 2)) - TIP_LOCAL.x;
    const a = Math.atan2(d.y, d.x) - Math.atan2(TIP_LOCAL.y, TIP_LOCAL.x + e);
    return { angle: a, ext: e };
  };

  const apply = ({ angle, ext, attached, lock, contPos }) => {
    boom.rotation.z = angle;
    boomInner.position.x = ext;
    const tip = tipFor(angle, ext);
    spreader.position.set(tip.x, tip.y, 0);
    // cylinders: barrel from the chassis pin towards the boom pin, rod slides out to it
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const A = tmp.set(PIVOT.x + ca * CYL_A_LOCAL.x - sa * CYL_A_LOCAL.y, PIVOT.y + sa * CYL_A_LOCAL.x + ca * CYL_A_LOCAL.y, 0);
    parts.cylinders.forEach(({ group, rod, rodMesh, eye }) => {
      const dir = new THREE.Vector3(A.x - group.position.x, A.y - group.position.y, 0);
      const len = dir.length();
      group.quaternion.setFromUnitVectors(up, dir.normalize());
      const rodLen = Math.max(0.2, len - BARREL + 0.3);
      rodMesh.scale.y = rodLen;
      rodMesh.position.y = len - rodLen / 2;
      eye.position.y = len;
      rod.position.set(0, 0, 0);
    });
    if (G.model) {                                   // model's twin cylinders: turn to the boom pin, stretch
      const { cyl, len } = G.model;
      const dir = new THREE.Vector3(A.x - CYL_B.x, A.y - CYL_B.y, 0);
      cyl.scale.y = dir.length() / len;
      cyl.quaternion.setFromUnitVectors(up, dir.normalize());
    }
    lights.forEach((l) => {
      l.material.color.setRGB(lerp(1, 0.2, lock), lerp(0.23, 0.95, lock), lerp(0.18, 0.35, lock));
      l.material.emissive.setRGB(lerp(1, 0.1, lock), lerp(0.13, 0.9, lock), lerp(0.06, 0.25, lock));
    });
    if (container) {
      if (attached) container.position.set(tip.x, tip.y - SP_H - CONT.H, 0);
      else container.position.copy(contPos);
    }
    return tip;
  };

  return { root, parts, apply, solve, tipFor, SP_H, PIVOT, G };
}

/**
 * Off-the-road tyre on a steel rim, like a port machine's: a rounded, bulging carcass (lathe),
 * chunky chevron lugs across the tread, sidewall ribs, and a deep-set dark rim with hub and nuts.
 * Axle along local Z, centred on the hub. Built once per size and cloned.
 */
const otrCache = new Map();
function buildOTRWheel(R, W) {
  const key = `${R}|${W}`;
  if (otrCache.has(key)) return otrCache.get(key).clone();
  const g = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.93, metalness: 0 });
  const rim = new THREE.MeshStandardMaterial({ color: '#1d2023', roughness: 0.55, metalness: 0.4 });
  const hubM = new THREE.MeshStandardMaterial({ color: '#3b4046', roughness: 0.45, metalness: 0.6 });
  const RIM = R * 0.6, half = W / 2;
  // carcass: profile (radius, z) from bead to bead with rounded shoulders, lathed round Y → turned to Z
  const prof = [];
  const shoulder = (sign) => {
    const pts = [[RIM, 0.92], [RIM + (R - RIM) * 0.35, 1.0], [R * 0.93, 0.97], [R * 0.985, 0.86], [R, 0.72]];
    return pts.map(([r, zf]) => new THREE.Vector2(r, sign * zf * half));
  };
  prof.push(...shoulder(-1), ...shoulder(1).reverse());
  const carcass = new THREE.Mesh(new THREE.LatheGeometry(prof, 56).rotateX(Math.PI / 2), rubber);
  g.add(carcass);
  // tread lugs: two rows of angled blocks, staggered half a pitch (chevron when seen together)
  const N = 22, lug = new THREE.BoxGeometry(R * 0.2, R * 0.075, half * 0.78);
  const lugs = new THREE.InstancedMesh(lug, rubber, N * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < N * 2; i++) {
    const side = i < N ? 1 : -1, k = i % N;
    const a = (k + (side > 0 ? 0 : 0.5)) / N * Math.PI * 2;
    e.set(0, side * 0.42, a + Math.PI / 2, 'ZYX');
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(Math.cos(a) * (R + R * 0.02), Math.sin(a) * (R + R * 0.02), side * half * 0.42), q, new THREE.Vector3(1, 1, 1));
    lugs.setMatrixAt(i, m4);
  }
  g.add(lugs);
  // sidewall ribs (both faces) for a moulded look
  [1, -1].forEach((s) => {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(R * 0.8, R * 0.012, 6, 56), rubber);
    rib.position.z = s * half * 0.97;
    g.add(rib);
  });
  // rim: lip ring, deep dish, hub with nuts (outer face +Z)
  const lip = new THREE.Mesh(new THREE.TorusGeometry(RIM, R * 0.035, 10, 48), rim);
  lip.position.z = half * 0.86;
  g.add(lip);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(RIM * 0.97, RIM * 0.97, W * 0.86, 40, 1, true).rotateX(Math.PI / 2), rim);
  g.add(dish);
  const face = new THREE.Mesh(new THREE.CircleGeometry(RIM * 0.97, 40), rim);
  face.position.z = half * 0.45;                                   // set well in, like a deep steel rim
  g.add(face);
  for (let i = 0; i < 8; i++) {                                    // hand holes
    const a = (i + 0.5) / 8 * Math.PI * 2;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(RIM * 0.11, 16), new THREE.MeshBasicMaterial({ color: '#0b0c0d' }));
    hole.position.set(Math.cos(a) * RIM * 0.62, Math.sin(a) * RIM * 0.62, half * 0.451);
    g.add(hole);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(RIM * 0.36, RIM * 0.42, W * 0.22, 24).rotateX(Math.PI / 2), hubM);
  hub.position.z = half * 0.55;
  g.add(hub);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(RIM * 0.045, RIM * 0.045, W * 0.08, 6).rotateX(Math.PI / 2), hubM);
    nut.position.set(Math.cos(a) * RIM * 0.27, Math.sin(a) * RIM * 0.27, half * 0.68);
    g.add(nut);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  otrCache.set(key, g);
  return g.clone();
}

/**
 * The reference stacker's body, built clean from its side view (measured at 1280x720 against our
 * 6 m wheelbase, ~39.7 px/m): low hull between the axles with the deck at 1.8 m, a tall rounded
 * counterweight at the back, teal boom towers to the foot pin, mudguards over the wheels (which sit
 * outside the narrow hull), a black cab on the camera side with tinted glass, steps, lamps, panel
 * seams and a small white logo. Satin teal paint with clearcoat, like the reference's machine.
 */
function buildUCBody(root, pivot) {
  const g = new THREE.Group();
  root.add(g);
  // under the page's bright environment the authored teal reads pale: deeper base, dimmer reflections
  const paint = new THREE.MeshPhysicalMaterial({ color: '#2a7fa6', roughness: 0.48, metalness: 0.1, clearcoat: 0.45, clearcoatRoughness: 0.3, envMapIntensity: 0.55 });
  const black = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#0f1113', roughness: 0.8 });
  const seam = new THREE.MeshBasicMaterial({ color: '#1e4c60' });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#16222c', roughness: 0.06, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.2 });
  const lampW = new THREE.MeshStandardMaterial({ color: '#f4f6f8', emissive: '#c8d4e0', emissiveIntensity: 0.25 });
  const lampR = new THREE.MeshStandardMaterial({ color: '#b3241c', emissive: '#7a120c', emissiveIntensity: 0.4 });
  const lampA = new THREE.MeshStandardMaterial({ color: '#f39a1e', emissive: '#a35a00', emissiveIntensity: 0.4 });
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // side profile -> extrusion across the machine, centred on z, rounded edges
  const slab = (pts, depth, mat, bevel = 0.05) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16 });
    geo.translate(0, 0, -(depth - 2 * bevel) / 2);
    return add(geo, mat);
  };
  // hull: low between the axles, deck at 1.8 m, front nose sloping down to the lamps
  slab([[-2.35, 0.55], [3.2, 0.55], [3.5, 0.82], [3.5, 1.42], [3.18, 1.8], [-2.35, 1.8]], 1.44, paint);
  // counterweight: full width at the back, rounded top, sloping into the towers
  const cw = new THREE.Shape();
  cw.moveTo(-4.38, 0.66); cw.lineTo(-2.3, 0.66); cw.lineTo(-2.3, 2.05); cw.lineTo(-2.6, 2.42);
  cw.lineTo(-3.95, 2.42); cw.quadraticCurveTo(-4.38, 2.42, -4.38, 2.0); cw.lineTo(-4.38, 0.66);
  const cwGeo = new THREE.ExtrudeGeometry(cw, { depth: 1.9, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 16 });
  cwGeo.translate(0, 0, -0.95);
  add(cwGeo, paint);
  // tail lamps, tow pin
  [-1, 1].forEach((s) => {
    add(new THREE.BoxGeometry(0.05, 0.16, 0.28), lampR, -4.45, 1.95, s * 0.72);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.2), lampA, -4.45, 1.74, s * 0.72);
  });
  add(new THREE.BoxGeometry(0.12, 0.22, 0.5), black, -4.45, 0.82, 0);
  // black chassis rail along the bottom, front bumper with lamps
  add(new THREE.BoxGeometry(5.9, 0.12, 1.36), black, 0.45, 0.52, 0);
  add(new THREE.BoxGeometry(0.1, 0.3, 1.5), black, 3.53, 0.78, 0);
  [-1, 1].forEach((s) => {
    add(new THREE.BoxGeometry(0.05, 0.12, 0.26), lampW, 3.56, 1.18, s * 0.5);
    add(new THREE.BoxGeometry(0.05, 0.07, 0.14), lampA, 3.56, 1.33, s * 0.62);
  });
  // panel seams on the visible faces (both sides)
  [-1, 1].forEach((s) => {
    const z = s * 0.722;
    [-1.6, -0.2, 1.1, 2.3].forEach((x) => add(new THREE.BoxGeometry(0.012, 1.1, 0.006), seam, x, 1.17, z));
    add(new THREE.BoxGeometry(5.6, 0.012, 0.006), seam, 0.45, 1.5, z);
    add(new THREE.BoxGeometry(0.02, 1.6, 0.006), seam, -3.0, 1.55, s * 1.012);
  });
  // logo on the hull side (camera side), like the reference's small white mark
  const logo = textPlane('BALAR OVERSEAS', 1.15, 0.16, { color: '#ffffff', px: 84, weight: 800 });
  logo.position.set(0.98, 1.05, 0.725);              // between the steps and the front tyres
  g.add(logo);
  // mudguards over the wheels (outside the hull): front over the twin tyres, rear over the single
  const guard = (x, zIn, zOut, r) => {
    const s = new THREE.Shape();
    const a0 = THREE.MathUtils.degToRad(12), a1 = THREE.MathUtils.degToRad(168);
    s.absarc(0, 0, r + 0.12, a0, a1, false);
    s.absarc(0, 0, r + 0.04, a1, a0, true);
    const geo = new THREE.ExtrudeGeometry(s, { depth: zOut - zIn, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 32 });
    [1, -1].forEach((sd) => {
      const m = add(geo.clone(), paint, x, R_W, 0);
      m.position.z = sd > 0 ? zIn : -zOut;
    });
  };
  guard(2.6, 0.72, 2.02, R_W);
  guard(-3.4, 1.0, 1.92, R_W);
  // boom tower (reference): a slim teal column rising from the counterweight, front edge nearly
  // upright, back edge curving up, ~0.9 m across at the foot pin
  {
    const shp = new THREE.Shape();
    shp.moveTo(-3.62, 2.3); shp.lineTo(-2.2, 1.8); shp.lineTo(-2.28, pivot.y - 0.1);
    shp.absarc(pivot.x, pivot.y, 0.44, -0.1, Math.PI, false);
    shp.quadraticCurveTo(-3.2, pivot.y - 0.55, -3.62, 2.3);
    const geo = new THREE.ExtrudeGeometry(shp, { depth: 1.1, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 24 });
    geo.translate(0, 0, -0.55);
    add(geo, paint);
  }
  add(new THREE.CylinderGeometry(0.17, 0.17, 1.4, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8d96a2', roughness: 0.3, metalness: 0.9 }), pivot.x, pivot.y, 0);
  // hydraulic lines (reference): four black hairpin loops standing out from the tower's back edge,
  // stacked one above the other, plus the bundle dropping from them into the body
  const hoseM = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.55 });
  [-1, 1].forEach((s) => {
    const z = s * 0.66;                                         // on the tower's outer faces, in front of the boom tail
    for (let i = 0; i < 4; i++) {
      const y = 2.58 + i * 0.1, xr = -3.2, out = 0.62 - i * 0.04;
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(xr, y + 0.03, z), new THREE.Vector3(xr - out + 0.06, y + 0.03, z),
        new THREE.Vector3(xr - out, y, z), new THREE.Vector3(xr - out + 0.06, y - 0.03, z), new THREE.Vector3(xr, y - 0.03, z),
      ]);
      add(new THREE.TubeGeometry(c, 30, 0.034, 8), hoseM);
    }
    const drop = new THREE.CatmullRomCurve3([new THREE.Vector3(-3.3, 3.2, z), new THREE.Vector3(-3.55, 2.95, z), new THREE.Vector3(-3.5, 2.72, z)]);
    add(new THREE.TubeGeometry(drop, 16, 0.04, 8), hoseM);
    add(new THREE.BoxGeometry(0.3, 0.26, 0.08), black, -2.6, 2.2, s * 0.6);                    // junction box
  });
  // hoses from the lift-cylinder base down into the hull (reference: black lines at the front)
  [-1, 1].forEach((s) => {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(1.75, 1.75, s * 0.74), new THREE.Vector3(1.95, 1.45, s * 0.76), new THREE.Vector3(1.95, 1.05, s * 0.75)]);
    add(new THREE.TubeGeometry(c, 16, 0.03, 8), hoseM);
  });
  // cab: open black frame (thin pillars, solid lower panels, roof) round clear glass, so the seat,
  // the operator and the controls show through like the reference's
  const CX0 = -1.2, CX1 = 0.3, CY0 = 1.95, CY1 = 3.42, CZ = 0.98, CW = 1.18, LOW = 2.32;   // cab height as before: clear of the boom and lift cylinder
  const cx = (CX0 + CX1) / 2, cl = CX1 - CX0;
  add(new THREE.BoxGeometry(1.75, 0.16, 1.35), black, cx, 1.88, CZ);                        // plinth
  add(new THREE.BoxGeometry(cl, LOW - CY0, CW), black, cx, (CY0 + LOW) / 2, CZ);            // lower panels
  add(new RoundedBoxGeometry(cl + 0.12, 0.1, CW + 0.12, 2, 0.03), black, cx, CY1 + 0.04, CZ);   // roof
  const PIL = 0.06;
  [[CX0, -1], [CX0, 1], [CX1, -1], [CX1, 1], [CX1 - 0.42, 1]].forEach(([x, sz]) => add(new THREE.BoxGeometry(PIL, CY1 - LOW, PIL), black, x + (x === CX0 ? PIL / 2 : -PIL / 2), (LOW + CY1) / 2, CZ + sz * (CW / 2 - PIL / 2)));
  add(new THREE.BoxGeometry(cl, 0.05, PIL), black, cx, 2.95, CZ + CW / 2 - PIL / 2);         // side rail
  const clear = new THREE.MeshPhysicalMaterial({ color: '#b9c9d3', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1, envMapIntensity: 1.4, side: THREE.DoubleSide });
  const pane = (w, h, x, y, z, ry) => { const m = add(new THREE.PlaneGeometry(w, h), clear, x, y, z); m.rotation.y = ry; m.castShadow = false; m.renderOrder = 2; };
  const GH = CY1 - LOW;
  pane(CW - 0.1, GH, CX1 - 0.004, (LOW + CY1) / 2, CZ, Math.PI / 2);                       // windscreen
  pane(cl - 0.1, GH, cx, (LOW + CY1) / 2, CZ + CW / 2 - 0.004, 0);                          // side (door side)
  pane(cl - 0.1, GH, cx, (LOW + CY1) / 2, CZ - CW / 2 + 0.004, 0);                          // far side
  pane(CW - 0.1, GH, CX0 + 0.004, (LOW + CY1) / 2, CZ, -Math.PI / 2);                       // rear
  // inside: seat, operator, steering column and wheel, side console
  const seatM = new THREE.MeshStandardMaterial({ color: '#2c2f34', roughness: 0.8 });
  const suit = new THREE.MeshStandardMaterial({ color: '#2a3442', roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: '#b98a6a', roughness: 0.7 });
  add(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatM, cx - 0.2, LOW + 0.18, CZ);
  add(new THREE.BoxGeometry(0.12, 0.62, 0.48), seatM, cx - 0.47, LOW + 0.5, CZ);
  add(new THREE.CapsuleGeometry(0.14, 0.3, 4, 10), suit, cx - 0.25, LOW + 0.45, CZ);         // torso
  add(new THREE.SphereGeometry(0.09, 16, 12), skin, cx - 0.22, LOW + 0.74, CZ);                // head
  add(new THREE.SphereGeometry(0.097, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f2b51c', roughness: 0.5 }), cx - 0.22, LOW + 0.79, CZ);   // sits on top, face left clear   // hard hat
  add(new THREE.CapsuleGeometry(0.05, 0.26, 4, 8), suit, cx + 0.0, LOW + 0.46, CZ - 0.14).rotation.z = 1.2;   // arms to the wheel
  add(new THREE.CapsuleGeometry(0.05, 0.26, 4, 8), suit, cx + 0.0, LOW + 0.46, CZ + 0.14).rotation.z = 1.2;
  add(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 10), black, cx + 0.38, LOW + 0.25, CZ).rotation.z = 0.5;
  const sw = add(new THREE.TorusGeometry(0.15, 0.022, 8, 24), black, cx + 0.28, LOW + 0.5, CZ);
  sw.rotation.y = Math.PI / 2; sw.rotation.x = 0.6;
  add(new THREE.BoxGeometry(0.3, 0.35, 0.18), seatM, cx - 0.05, LOW + 0.2, CZ + 0.4);
  // mirror arm on the front corner, door handle, the yellow strip on the cab side
  add(new THREE.BoxGeometry(0.32, 0.025, 0.025), black, CX1 + 0.14, CY1 - 0.35, CZ + CW / 2 + 0.06);
  add(new THREE.BoxGeometry(0.04, 0.24, 0.14), black, CX1 + 0.3, CY1 - 0.48, CZ + CW / 2 + 0.06);
  add(new THREE.BoxGeometry(0.12, 0.03, 0.03), new THREE.MeshStandardMaterial({ color: '#9aa1aa', metalness: 0.8, roughness: 0.3 }), CX1 - 0.5, 2.45, CZ + CW / 2 + 0.03);
  add(new THREE.BoxGeometry(0.42, 0.05, 0.005), lampA, cx + 0.1, LOW - 0.1, CZ + CW / 2 + 0.004);
  add(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 16), lampA, CX0 + 0.25, CY1 + 0.15, CZ);  // beacon
  [-1, 1].forEach((s) => add(new THREE.BoxGeometry(0.06, 0.08, 0.16), lampW, CX1 + 0.04, CY1 - 0.06, CZ + s * 0.4));
  // hull side details (reference): two black inset boxes, yellow warning sticker at the front,
  // small amber side markers
  [[-1.95, 1.3], [-1.35, 1.3]].forEach(([x, y]) => add(new THREE.BoxGeometry(0.5, 0.28, 0.02), black, x, y, 0.73));
  add(new THREE.BoxGeometry(0.34, 0.14, 0.005), new THREE.MeshStandardMaterial({ color: '#f2b51c', roughness: 0.5 }), 2.95, 1.6, 0.725);
  [[-2.2, 1.65], [2.2, 1.65]].forEach(([x, y]) => add(new THREE.BoxGeometry(0.1, 0.05, 0.01), lampA, x, y, 0.726));
  // steps up to the cab (black ladder box with treads) on the camera side
  // two thin stringers, open treads
  [-0.3, 0.2].forEach((x) => add(new THREE.BoxGeometry(0.04, 1.25, 0.04), black, x, 1.18, 0.98));
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.5, 0.035, 0.24), dark, -0.05, 0.72 + i * 0.3, 0.86);
  return g;
}

/**
 * Stacker in the reference's look, all clean built parts: its body (buildUCBody), off-the-road
 * wheels, a charcoal boom with neatly clamped hoses, black lift cylinders with chrome rods and a
 * slim charcoal spreader with hazard-striped end beams. The tip contract (solve/apply, SP_H) is
 * unchanged, so every pose keeps working.
 */
const R_W = 0.82;
export function upgradeStacker(rig) {
  const { parts, G } = rig;
  [parts.chassis, parts.cabin].forEach((g) => g.children.forEach((c) => { c.visible = false; }));
  const stripes = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#f2b51c'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#16181b';
    for (let x = -64; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 16, 64); g.lineTo(x + 80, 0); g.lineTo(x + 64, 0); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const recolour = new Map();
  const dress = (group, { dullSteel }) => group.traverse((m) => {
    if (!m.isMesh || !m.visible) return;
    if (m.material.emissive && m.material.emissive.getHex() !== 0) { m.visible = false; return; }   // lamps
    if (m.material.map || m.material.transparent) return;                                        // lettering
    const key = `${m.material.uuid}|${dullSteel}`;
    if (!recolour.has(key)) {
      const mt = m.material.clone();
      const hsl = {}; mt.color.getHSL(hsl, THREE.SRGBColorSpace);   // judge the authored (sRGB) colour
      if (hsl.h > 0.1 && hsl.h < 0.18 && hsl.s > 0.5) { mt.color.set('#ffffff'); mt.map = stripes; }   // yellow -> hazard stripes
      else if (hsl.l > 0.6) { if (dullSteel) mt.color.set('#7c828a'); }                           // chrome rods stay chrome
      else mt.color.set(hsl.l < 0.3 ? '#25282d' : '#2f3237');                                     // charcoal
      if (!(hsl.l > 0.6 && !dullSteel)) { mt.metalness = 0.4; mt.roughness = 0.5; }
      recolour.set(key, mt);
    }
    m.material = recolour.get(key);
  });
  dress(parts.spreader, { dullSteel: true });
  dress(parts.boom, { dullSteel: false });
  parts.cylinders.forEach((c) => dress(c.group, { dullSteel: false }));
  parts.wheels.forEach((w) => { w.visible = false; });
  // the reference's boom foot sits further forward and higher than the built one's
  G.PIVOT.set(-2.7, 3.5);
  parts.boom.position.set(G.PIVOT.x, G.PIVOT.y, 0);
  buildUCBody(parts.root, G.PIVOT);
  // boom tail (reference): the boom runs on ~1.5 m behind the foot pin, tapering, with the amber
  // beacon on a slim mast at its end (it rides the boom)
  {
    const tailM = new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.5, metalness: 0.4 });
    const s = new THREE.Shape();
    s.moveTo(0.2, 0.46); s.lineTo(-1.55, 0.36); s.lineTo(-1.62, -0.05); s.lineTo(-1.2, -0.42); s.lineTo(0.2, -0.46);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.84, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    geo.translate(0, 0, -0.42);
    const tail = new THREE.Mesh(geo, tailM);
    tail.castShadow = true;
    parts.boom.add(tail);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.85, 8), new THREE.MeshStandardMaterial({ color: '#16181b' }));
    mast.position.set(-1.45, 0.85, 0.3);
    parts.boom.add(mast);
    const bcn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 16), new THREE.MeshStandardMaterial({ color: '#f39a1e', emissive: '#a35a00', emissiveIntensity: 0.5 }));
    bcn.position.set(-1.45, 1.32, 0.3);
    parts.boom.add(bcn);
  }
  // hoses as on the reference: a tidy bundle along each side of the boom, clamped, turning down
  // behind the foot pin into the towers (they ride the boom; the far end barely moves at the pin)
  const hoseM = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.65 });
  const clampM = new THREE.MeshStandardMaterial({ color: '#5a6068', roughness: 0.4, metalness: 0.7 });
  [-1, 1].forEach((s) => {
    [0, 1].forEach((k) => {
      const z = s * (0.5 + k * 0.07), y = -0.18 - k * 0.07;
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(6.2, y, z), new THREE.Vector3(1.0, y, z), new THREE.Vector3(-0.3, y + 0.08, z),
        new THREE.Vector3(-0.72, -0.25, z), new THREE.Vector3(-0.62, -0.85, z * 0.9),
      ]);
      const hose = new THREE.Mesh(new THREE.TubeGeometry(c, 60, 0.04, 8), hoseM);
      hose.castShadow = true;
      parts.boom.add(hose);
    });
    for (let x = 0.6; x < 6.2; x += 1.1) {
      const cl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.05), clampM);
      cl.position.set(x, -0.22, s * 0.545);
      parts.boom.add(cl);
    }
  });
  // wheels: off-the-road tyres outside the narrow hull, twin at the front, single at the rear
  const wheels = [];
  [[2.6, 1.05, 0.6], [2.6, 1.68, 0.6], [-3.4, 1.45, 0.86]].forEach(([x, z, w]) => [1, -1].forEach((s) => {
    const wh = buildOTRWheel(R_W, w);
    const g = new THREE.Group();
    g.position.set(x, R_W, s * z);
    if (s < 0) wh.rotation.y = Math.PI;
    g.add(wh);
    parts.root.add(g);
    wheels.push(g);
  }));
  parts.wheels.splice(0, parts.wheels.length, ...wheels);
  return Promise.resolve(rig);
}

// ------------------------------------------------------------------ choreography
// p ∈ [0, 1] → pose. Stages follow the brief:
// 1 rest · 2 cylinders extend · 3 boom raises · 4 telescope extends · 5 spreader locks on
// 6 container leaves the ground · 7 container rises · 8 boom comes back to the carry pose
export const STAGES = [
  [0.00, 'Resting position'],
  [0.07, 'Hydraulic cylinders extend'],
  [0.17, 'Boom raises'],
  [0.30, 'Telescopic boom extends'],
  [0.44, 'Spreader locks onto the container'],
  [0.64, 'Container lifts off the ground'],
  [0.78, 'Container rises'],
  [0.90, 'Boom returns to carry position'],
];
export function choreography(rig, XC = 9.0) {
  const { solve, tipFor, SP_H } = rig;
  const REST = { angle: 4 * DEG, ext: 0 };
  const RAISED = 22 * DEG;
  const ROOF = CONT.H;                                      // container roof height on the ground
  // telescope out until the head is right over the container
  const reachE = (() => { const a = RAISED; let e = 0; for (let i = 0; i < 40; i++) { const t = tipFor(a, e); e += XC - t.x; } return e; })();
  const over = tipFor(RAISED, reachE);
  const atRoof = (bottom) => new THREE.Vector2(XC, bottom + ROOF + SP_H);
  const CARRY = { angle: 10 * DEG, ext: 0.6 };
  const liftedTop = solve(atRoof(5.0));
  const contGround = new THREE.Vector3(XC, 0, 0);

  return (p) => {
    let pose;
    if (p < 0.30) {
      // 0.07–0.17 the cylinders push (first few degrees), 0.17–0.30 the boom swings up
      const a = lerp(REST.angle, 9 * DEG, seg(p, 0.07, 0.17));
      pose = { angle: lerp(a, RAISED, seg(p, 0.17, 0.30)), ext: 0 };
    } else if (p < 0.44) {
      pose = { angle: RAISED, ext: lerp(0, reachE, seg(p, 0.30, 0.44)) };
    } else if (p < 0.64) {
      // straight down onto the roof, then the twistlocks turn (0.58–0.64)
      const y = lerp(over.y, atRoof(0).y, seg(p, 0.44, 0.58));
      pose = solve(new THREE.Vector2(XC, y));
    } else if (p < 0.90) {
      const bottom = p < 0.78 ? lerp(0, 1.5, seg(p, 0.64, 0.78)) : lerp(1.5, 5.0, seg(p, 0.78, 0.90));
      pose = solve(atRoof(bottom));
    } else {
      const u = seg(p, 0.90, 1.0);
      pose = { angle: lerp(liftedTop.angle, CARRY.angle, u), ext: lerp(liftedTop.ext, CARRY.ext, u) };
    }
    pose.lock = seg(p, 0.58, 0.64);
    pose.attached = p >= 0.64;
    pose.contPos = contGround;
    return pose;
  };
}

// ------------------------------------------------------------------ container yard
export function buildYard() {
  const yard = new THREE.Group();
  // asphalt with painted bay lines
  const tex = canvasTex(1024, 1024, (g, W, H) => {
    g.fillStyle = '#3b3e43'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      const v = 50 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * 0.5})`;
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    g.fillStyle = 'rgba(242,183,5,.85)';
    g.fillRect(0, H * 0.48, W, 10);
    for (let x = 0; x < W; x += 128) g.fillRect(x, H * 0.08, 6, H * 0.3);
    g.fillStyle = 'rgba(255,255,255,.7)';
    for (let x = 20; x < W; x += 160) g.fillRect(x, H * 0.72, 80, 8);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  yard.add(ground);
  // background stacks of 40 ft boxes (instanced, one ribbed texture, per-box colour)
  const rib = canvasTex(512, 128, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 9) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, 0, 3, H); }
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6);
  });
  const boxMat = new THREE.MeshStandardMaterial({ map: rib, roughness: 0.6, metalness: 0.25 });
  const COLORS = ['#b4372c', '#1f4f9e', '#2f7d4f', '#d77a1f', '#5a6470', '#8a2f5a', '#e1e4e8', '#1b6f8a'];
  const stacks = [];
  let rnd = 7;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  // well behind the machine so they read as the yard, not as clutter around it
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 11; i++) {
      const h = 1 + Math.floor(r() * 3);
      for (let k = 0; k < h; k++) stacks.push([-50 + i * 12.8, 1.3 + k * 2.6, -34 - row * 3.2, COLORS[Math.floor(r() * COLORS.length)]]);
    }
  }
  for (let i = 0; i < 6; i++) {
    const h = 1 + Math.floor(r() * 2);
    for (let k = 0; k < h; k++) stacks.push([-26 - (i % 2) * 3.2, 1.3 + k * 2.6, -14 + Math.floor(i / 2) * 13, COLORS[Math.floor(r() * COLORS.length)], true]);
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(12.19, 2.59, 2.44), boxMat, stacks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  stacks.forEach(([x, y, z, c, turned], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turned ? Math.PI / 2 : 0);
    m4.compose(new THREE.Vector3(x, y, z), q, s1);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.set(c));
  });
  inst.castShadow = inst.receiveShadow = true;
  yard.add(inst);
  // light masts
  const mast = new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.7, roughness: 0.4 });
  [[-22, -9], [16, -12], [34, 14]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 26, 12), mast);
    p.position.set(x, 13, z);
    p.castShadow = true;
    yard.add(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.2), mast);
    head.position.set(x, 26, z);
    yard.add(head);
  });
  return yard;
}

export { DEG, clamp01 };
