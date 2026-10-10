// One continuous scroll-driven scene:
//  A) the live reach stacker (reachstacker3d.js) drives to a stack, picks the top box, backs off
//     turning to face the camera, the truck reverses in under it and the box is set down
//     (reference timings: pick 0.15, lifted 0.19, turned 0.26, truck 0.30–0.34, down 0.35)
//  B) truck drives (side view) while the services panel slides over
//  C) camera orbits to a top-down view and the truck turns onto a crossing road
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStage, buildTruck, upgradeTruck, seg, lerp, clamp01 } from './util.js';
import { buildReachStacker3D, buildRibbedContainer, upgradeContainer, upgradeStacker, CONT } from './reachstacker3d.js';

// phase boundaries measured off the reference: port/stacker → services panel → road
const A_END = 0.42, B_END = 0.71;
const range = (p, a, b) => clamp01((p - a) / (b - a));
const ease = (t) => t * t * (3 - 2 * t);

export function initJourney(canvas, onSpeed) {
  const stage = createStage(canvas, { fov: 14, shadows: true, env: true, far: 3000 });
  const { scene, camera } = stage;

  scene.add(new THREE.HemisphereLight('#ffffff', '#cfcfcf', 0.7));
  const sun = new THREE.DirectionalLight('#ffffff', 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight('#cfe2ff', 0.9);   // back light to outline silhouettes
  rim.position.set(-30, 25, -40);
  scene.add(rim);

  // ---------- Ground: white plane, black road slab (side view shows its face as a band)
  const white = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  // under the road slab (80 m deep), not at ground level: at ground level it switched on at the
  // start of the orbit right in front of the slab's black face — the ground band flashed white
  white.rotation.x = -Math.PI / 2; white.position.y = -80.5;
  scene.add(white);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.12 }));
  shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = -0.02; shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  // ---------- Road network, measured off the reference's top view (1280×720, section 0.77–1.0):
  // every road is three 4.8 m lanes (two grey dashed lane lines), ~0.87× the truck's length.
  // Road A runs along +X; at the junction it bends in a smooth S into road B (further +X) and
  // branches down into road C (+Z), with a hatched gore where they split. The truck keeps to
  // the middle lane and turns from A into C. Screen right = +X, screen down = +Z (top view).
  const RW = 14.4, LW = RW / 3;
  // phase B: the truck pulls away (speedometer 0→80 over the first 18%), then cruises at exactly
  // the speed it keeps on road A in phase C — no sudden slow-down as the camera swings up at 0.71
  const B_ACC = 0.18;
  const B_DIST = (100 / 0.43) * (1 - B_ACC / 2);       // = phase C's road-A speed (L1 / 0.43 per unit c)
  const driveB = (b) => (b < B_ACC ? (b * b) / (2 * B_ACC) : b - B_ACC / 2) / (1 - B_ACC / 2);
  const XB = 4.1 + B_DIST;         // truck x at end of phase B
  const L1 = 100;                  // straight run on road A before the bend
  const XJ = XB + L1;              // road A starts to bend here
  const K = RW / 66;               // reference sketch (px at the zoomed-out frame) → metres
  const J = (px, py) => new THREE.Vector2(XJ + (px - 150) * K, (py - 70) * K);
  const CX = J(229.5, 0).x, CZ0 = J(0, 165).y;      // truck's line down road C, road C start z
  const CL = 197, CR = 262;                          // road C kerbs (sketch x): three lanes like A and B
  const FAR = 420;
  // flat near-black like the reference (unlit, so it never turns grey under the lights)
  const roadMat = new THREE.MeshBasicMaterial({ color: '#111111', toneMapped: false, side: THREE.DoubleSide });
  // road A is a deep slab: from the side its face is the black ground band, from above it is the road
  const slab = new THREE.Mesh(new THREE.BoxGeometry(XJ + 82, 80, RW), roadMat);
  slab.position.set((XJ + 2 - 80) / 2, -40, 0);
  slab.receiveShadow = true;
  scene.add(slab);
  // junction + roads B and C as one flat shape
  const sh = new THREE.Shape();
  const JP = (px, py) => J(px, py);
  let p = JP(140, 37); sh.moveTo(p.x, p.y);
  p = JP(150, 37); sh.lineTo(p.x, p.y);
  { const c1 = JP(220, 37), c2 = JP(230, 100), e = JP(290, 100); sh.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y); }
  sh.lineTo(XJ + 300, JP(0, 100).y);
  sh.lineTo(XJ + 300, JP(0, 165).y);
  p = JP(CR + 10, 165); sh.lineTo(p.x, p.y);
  { const c = JP(CR, 165), e = JP(CR, 175); sh.quadraticCurveTo(c.x, c.y, e.x, e.y); }
  sh.lineTo(JP(CR, 0).x, FAR);
  sh.lineTo(JP(197, 0).x, FAR);
  p = JP(197, 165); sh.lineTo(p.x, p.y);
  { const c1 = JP(197, 130), c2 = JP(185, 103), e = JP(150, 103); sh.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y); }
  p = JP(140, 103); sh.lineTo(p.x, p.y);
  const junction = new THREE.Mesh(new THREE.ShapeGeometry(sh, 32).rotateX(Math.PI / 2), roadMat);
  junction.position.y = 0.004;
  junction.receiveShadow = true;
  scene.add(junction);

  // lane markings: dashes laid along curves (2.4 m dash, 4.2 m gap), solid edge lines, gore hatch
  const V = (x, z) => new THREE.Vector2(x, z);
  const marks = [];   // [x, z, angle, length, width]
  const dashed = (curve, dash = 2.4, gap = 4.2) => {
    const len = curve.getLength();
    for (let d = gap / 2; d + dash < len; d += dash + gap) {
      const u = (d + dash / 2) / len, q2 = curve.getPointAt(u), tg = curve.getTangentAt(u);
      marks.push([q2.x, q2.y, Math.atan2(tg.y, tg.x), dash, 0.22]);
    }
  };
  const solid = (a2, b2, w = 0.16) => {
    const mx = (a2.x + b2.x) / 2, mz = (a2.y + b2.y) / 2;
    marks.push([mx, mz, Math.atan2(b2.y - a2.y, b2.x - a2.x), a2.distanceTo(b2), w]);
  };
  const line = (a2, b2) => new THREE.LineCurve(a2, b2);
  // road A
  dashed(line(V(-80, -LW / 2), V(XJ, -LW / 2)));
  dashed(line(V(-80, LW / 2), V(XJ, LW / 2)));
  // road B
  const zB1 = JP(0, 121.7).y, zB2 = JP(0, 143.3).y, xB0 = JP(290, 0).x;
  dashed(line(V(xB0, zB1), V(XJ + 300, zB1)));
  dashed(line(V(JP(CL + 2 * (CR - CL) / 3 + 33, 0).x, zB2), V(XJ + 300, zB2)));   // from the gore
  // road C
  const xC1 = JP(CL + (CR - CL) / 3, 0).x, xC2 = JP(CL + 2 * (CR - CL) / 3, 0).x;
  dashed(line(V(xC1, CZ0), V(xC1, FAR)));
  dashed(line(V(xC2, CZ0), V(xC2, FAR)));
  // through the junction (as the reference) no lane line crosses another: road A's first line runs
  // parallel to the outer kerb's S-bend into B's first line, its second line parallel to the inner
  // kerb's bend into C's first line; B's second line and C's second line both start at the gore
  const solidCurve = (c, w = 0.22, n = 24) => {
    for (let i = 0; i < n; i++) solid(c.getPointAt(i / n), c.getPointAt((i + 1) / n), w);
  };
  const xC1px = CL + (CR - CL) / 3, xC2px = CL + 2 * (CR - CL) / 3;
  dashed(new THREE.CubicBezierCurve(JP(150, 59), JP(220, 59), JP(230, 121.7), JP(290, 121.7)));
  dashed(new THREE.CubicBezierCurve(JP(150, 81.3), JP(196, 81.3), JP(xC1px, 120), JP(xC1px, 165)));
  // gore (as the reference): a curved triangle, all three sides bowed in, chevron hatch inside;
  // its top side runs on into B's second line, its left side into C's second line
  const gT = JP(xC2px - 8, 140), gR = JP(xC2px + 33, 143.3), gB = JP(xC2px, 167);
  const top = new THREE.CubicBezierCurve(gT, JP(xC2px + 4, 141.5), JP(xC2px + 20, 143.3), gR);
  const left = new THREE.CubicBezierCurve(gT, JP(xC2px - 4, 148), JP(xC2px, 156), gB);
  const hyp = new THREE.QuadraticBezierCurve(gB, JP(xC2px, 143.3).lerp(JP(xC2px + 16.5, 155), 0.45), gR);
  solidCurve(top, 0.2, 16); solidCurve(left, 0.2, 16); solidCurve(hyp, 0.2, 16);
  const poly = [];
  for (let i = 0; i <= 24; i++) poly.push(top.getPointAt(i / 24));
  for (let i = 1; i <= 24; i++) poly.push(hyp.getPointAt(1 - i / 24));
  for (let i = 1; i < 24; i++) poly.push(left.getPointAt(1 - i / 24));
  const rayHit = (o, d) => {            // distance from o along d to the gore's outline
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b.x - a.x, ez = b.y - a.y, den = d.x * ez - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - o.x) * ez - (a.y - o.y) * ex) / den;
      const s = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
      if (t > 1e-4 && s >= 0 && s <= 1) best = Math.min(best, t);
    }
    return best;
  };
  // chevrons: apex towards the nose, arms swept back to the two outer sides
  const bis = top.getTangentAt(0).add(left.getTangentAt(0)).normalize();
  const armA = bis.clone().rotateAround(V(0, 0), 1.0), armB = bis.clone().rotateAround(V(0, 0), -1.0);
  for (let k = 1; k < 9; k++) {
    const apex = gT.clone().addScaledVector(bis, 1.15 * k);
    const hA = rayHit(apex, armA), hB = rayHit(apex, armB);
    if (!isFinite(hA) || !isFinite(hB) || hA < 0.3 || hB < 0.3) break;
    solid(apex, apex.clone().addScaledVector(armA, hA), 0.14);
    solid(apex, apex.clone().addScaledVector(armB, hB), 0.14);
  }
  // thin edge lines just inside the kerbs, round the corners too
  const e = RW / 2 - 0.45;
  const edgeCurve = (c) => {
    const n = 24, pts = [];
    for (let i = 0; i <= n; i++) {
      const pt = c.getPointAt(i / n), tg = c.getTangentAt(i / n);
      pts.push(pt.add(V(-tg.y, tg.x).multiplyScalar(0.45)));
    }
    for (let i = 0; i < n; i++) solid(pts[i], pts[i + 1]);
  };
  edgeCurve(new THREE.CubicBezierCurve(JP(150, 37), JP(220, 37), JP(230, 100), JP(290, 100)));
  edgeCurve(new THREE.CubicBezierCurve(JP(197, 165), JP(197, 130), JP(185, 103), JP(150, 103)));
  edgeCurve(new THREE.QuadraticBezierCurve(JP(CR + 10, 165), JP(CR, 165), JP(CR, 175)));
  solid(V(-80, -e), V(XJ, -e)); solid(V(-80, e), V(XJ, e));
  solid(V(xB0, JP(0, 100).y + 0.45), V(XJ + 300, JP(0, 100).y + 0.45)); solid(V(JP(CR + 10, 0).x, JP(0, 165).y - 0.45), V(XJ + 300, JP(0, 165).y - 0.45));
  solid(V(JP(197, 0).x + 0.45, CZ0), V(JP(197, 0).x + 0.45, FAR)); solid(V(JP(CR, 0).x - 0.45, JP(0, 175).y), V(JP(CR, 0).x - 0.45, FAR));
  const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const markMat = new THREE.MeshBasicMaterial({ color: '#4a4a4a' });
  const inst = new THREE.InstancedMesh(markGeo, markMat, marks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  marks.forEach(([x, z, ang, len, w], i) => {
    q.setFromAxisAngle(up, -ang);
    m4.compose(new THREE.Vector3(x, 0.03, z), q, sc3.set(len, 1, w));
    inst.setMatrixAt(i, m4);
  });
  scene.add(inst);
  // ---------- Port: two boxes end-on with the hero box on top, behind the truck lane (z = ZP);
  // the live reach stacker picks it, backs off turning to face the camera and sets it on the truck
  // everything in the port stands on the white ground behind the black road (|z| < RW/2 = 7.2):
  // the 40 ft stack (12.2 m deep) sits right behind the kerb, the stacker never drives onto the road
  const ZP = -(RW / 2 + CONT.L / 2 + 0.3);
  // far enough right that the widening hand-over framing (0.36–0.42) never shows it again
  const STACK_X = [28.6, 31.04], HERO_X = (STACK_X[0] + STACK_X[1]) / 2;
  const stack = STACK_X.map((x, i) => {
    const s = buildRibbedContainer(i ? '#d4632a' : '#1f3c8f', '');
    s.position.set(x, 0, ZP);
    scene.add(s);
    upgradeContainer(s, { tint: i ? '#e0773d' : '#4467c4', number: i ? 'BLRU 554210 2' : 'BLRU 381926 4', ink: '#f2f2f2' });     // real box, tinted
    return s;
  });
  const rig = buildReachStacker3D({ container: false });
  upgradeStacker(rig);
  scene.add(rig.root);
  const box = buildRibbedContainer('#c4c9cf', 'BALAR OVERSEAS', '#1e2328');
  scene.add(box);
  upgradeContainer(box, { label: 'BALAR OVERSEAS', labelColor: '#1e2328' });
  const SP_H = rig.SP_H, H = CONT.H;
  // where the stacker stands (rig x) for the pick, and its pose then
  const PICK_REACH = 9.4;                                   // tip ahead of the rig origin
  const RIG_PICK_X = HERO_X - PICK_REACH;
  const pickTip = new THREE.Vector2(PICK_REACH, 2 * H + SP_H);
  const liftTip = new THREE.Vector2(PICK_REACH - 0.4, 2 * H + SP_H + 1.6);
  // after the turn the boom points at the camera (+Z) over the truck lane: box low over the deck
  const DECK_Y = 1.56;                                      // truck deck (container bottom) height
  // box ahead of the rig = the rig's distance behind the lane: front tyres (3.4 m ahead) stay off the road
  const CARRY_D = RW / 2 + 3.4 + 0.4;
  const carryTip = new THREE.Vector2(CARRY_D, DECK_Y + 0.4 + H + SP_H);
  const downTip = new THREE.Vector2(CARRY_D, DECK_Y + H + SP_H);
  const clearTip = new THREE.Vector2(CARRY_D, DECK_Y + H + SP_H + 1.0);   // locks open, lifts ~1 m clear and holds (reference 0.36–0.47)
  const hoverTip = new THREE.Vector2(PICK_REACH, 2 * H + SP_H + 0.8);       // parked over the box at the start (reference 0–0.12)
  const restPose = { angle: 4 * Math.PI / 180, ext: 0 };
  const lerpPose = (p0, p1, u) => ({ angle: lerp(p0.angle, p1.angle, u), ext: lerp(p0.ext, p1.ext, u) });
  const tipPose = (a2, b2, u) => rig.solve(new THREE.Vector2(lerp(a2.x, b2.x, u), lerp(a2.y, b2.y, u)));
  const tipWorld = new THREE.Vector3();

  // same livery as the Blender truck the sequence hands over from
  const truck = buildTruck({ cab: '#1a1c21' });
  scene.add(truck);
  upgradeTruck(truck);          // real tractor + trailer model replaces the built one once loaded

  // ---------- helpers
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const frame = (x, y, halfW) => {
    const h = Math.max(halfW / camera.aspect, halfW * 0.42);
    return { x, y, h, D: h / tanH };
  };
  const mixF = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), h: lerp(a.h, b.h, t), D: lerp(a.D, b.D, t) });
  const sideTruckFrame = (tx) => {
    // like the reference: truck smaller and left of centre (≈10–47% of the width), ground at 40%
    const f = frame(tx + 8.8, 0, 21);
    f.y = -0.2 * f.h;
    return f;
  };
  // Same framing as the last Blender frame as main.js draws it (frames scaled to
  // min(1.15·W/1440, H/810), point 87% down the frame pinned at 90% of the screen), using the
  // width / truck offset / ground line Blender wrote to meta.json — so the hand-over from the
  // image sequence to this live scene is invisible.
  let seqEnd = { width: 29, dx: 1.05, ground: 0.6 };
  fetch('seq/stacker/meta.json').then((r) => r.json()).then((m) => {
    if (m.end) seqEnd = { width: m.end.width, dx: m.end.dx, ground: m.ground[m.ground.length - 1] };
  }).catch(() => {});
  const seqFrame = (tx) => {
    const W = innerWidth, H = innerHeight;
    const sc = Math.min((W * 1.15) / 1440, H / 810);
    const iw = 1440 * sc, ih = 810 * sc;
    const mpp = seqEnd.width / iw;             // metres per CSS pixel
    const groundY = H * 0.9 - ih * 0.87 + ih * seqEnd.ground;
    const h = 0.5 * H * mpp;
    return { x: tx - seqEnd.dx, y: (groundY - 0.5 * H) * mpp, h, D: h / tanH };
  };
  // The truck keeps to the middle lane: along A, a smooth right turn, then down road C.
  const turnCurve = new THREE.QuadraticBezierCurve(new THREE.Vector2(XJ, 0), new THREE.Vector2(CX, 0), new THREE.Vector2(CX, CZ0));
  const TURN = turnCurve.getLength();
  const pathAt = (s) => {
    if (s < L1) return { x: XB + s, z: 0, a: 0 };
    if (s < L1 + TURN) {
      const u = (s - L1) / TURN, pt = turnCurve.getPointAt(u), tg = turnCurve.getTangentAt(u);
      return { x: pt.x, z: pt.y, a: Math.atan2(tg.y, tg.x) };
    }
    return { x: CX, z: CZ0 + (s - L1 - TURN), a: Math.PI / 2 };
  };
  // reference pacing (fractions of phase C): straight until 0.43, turn 0.43–0.55, then road C
  const pathS = (c) => (c < 0.43 ? L1 * (c / 0.43) : c < 0.55 ? L1 + TURN * ((c - 0.43) / 0.12) : L1 + TURN + 110 * ((c - 0.55) / 0.45));
  const tmp = new THREE.Vector3(), boxOnTruck = new THREE.Vector3(-1.1, 1.56, 0);   // box origin = bottom centre, on the deck
  let target = 0, P = 0, snap = false, prevTruckX = null, prevTruckZ = null, lastSpeed = -1;
  // light-space axes of the (fixed-direction) sun, for texel-snapping its shadow camera
  const SUN_OFFSET = new THREE.Vector3(14, 40, 24), TEXEL = 60 / 2048;
  const sunDir = SUN_OFFSET.clone().normalize();
  const sunRight = new THREE.Vector3(0, 1, 0).cross(sunDir).normalize();
  const sunUp = sunDir.clone().cross(sunRight).normalize();
  const focus = new THREE.Vector3();

  stage.onFrame = (t, dt) => {
    P = snap ? target : THREE.MathUtils.damp(P, target, 7, dt);
    snap = false;
    const a = range(P, 0, A_END), b = range(P, A_END, B_END), c = range(P, B_END, 1);

    // ---------------- reach stacker + box (phase A), timings measured off the reference:
    // parked at the stack, spreader hovering over the box 0–0.12 · down onto it 0.12–0.17, locks
    // 0.165–0.18 · lift 0.18–0.21 · back off turning to face the camera 0.20–0.26 · truck reverses
    // in 0.30–0.34 · box down 0.34–0.35 · locks open, spreader lifts ~1 m clear 0.355–0.385 and
    // stays there: the stacker does not drive off, the truck leaves it behind (reference 0.40–0.47)
    const XC = 3.0;                                       // box (and trailer) x once on the truck
    const turnU = seg(P, 0.20, 0.26);
    const rigX = lerp(RIG_PICK_X, XC, turnU);
    const rigZ = lerp(ZP, -CARRY_D, turnU);
    rig.root.position.set(rigX, 0, rigZ);
    rig.root.rotation.y = -Math.PI / 2 * turnU;
    let pose;
    if (P < 0.18) pose = tipPose(hoverTip, pickTip, seg(P, 0.12, 0.17));
    else if (P < 0.21) pose = tipPose(pickTip, liftTip, seg(P, 0.18, 0.21));
    else if (P < 0.34) pose = tipPose(liftTip, carryTip, seg(P, 0.21, 0.27));
    else if (P < 0.355) pose = tipPose(carryTip, downTip, seg(P, 0.34, 0.35));
    else pose = tipPose(downTip, clearTip, seg(P, 0.355, 0.385));
    pose.lock = P < 0.3 ? seg(P, 0.165, 0.18) : 1 - seg(P, 0.35, 0.355);
    const tipL = rig.apply(pose);
    // wheels roll with the machine
    const rigMove = Math.hypot(rigX - (rig.root.userData.px ?? rigX), rigZ - (rig.root.userData.pz ?? rigZ));
    rig.root.userData.px = rigX; rig.root.userData.pz = rigZ;
    rig.parts.wheels.forEach((w) => { w.rotation.z -= rigMove / 0.76; });

    // truck x (A reverses in, B drives) and path (C)
    let tx, tz = 0, heading = 0;
    if (P < A_END) tx = lerp(XC + 1.1 + 60, XC + 1.1, 1 - Math.pow(1 - seg(P, 0.30, 0.34), 2));
    else if (P < B_END) tx = XC + 1.1 + B_DIST * driveB(b);
    else {
      const pp = pathAt(pathS(c));
      tx = pp.x; tz = pp.z; heading = pp.a;
    }
    truck.position.set(tx, 0, tz);
    truck.rotation.y = -heading;
    // the reference's road truck is ~9% bigger against the road than in the side view:
    // grow it while the camera swings up (nothing to compare it with mid-orbit)
    const grow = 1 + 0.09 * ease(range(c, 0, 0.07));
    truck.scale.setScalar(grow);
    if (prevTruckX !== null) truck.userData.spin(Math.hypot(tx - prevTruckX, tz - prevTruckZ));
    prevTruckX = tx; prevTruckZ = tz;

    // box: on the stack → on the spreader → on the truck (long axis along the trailer)
    if (P >= 0.35) {
      tmp.copy(boxOnTruck);
      truck.localToWorld(tmp);
      box.position.copy(tmp);
      // same way round as on the spreader (doors to the rear) — +π/2 here flipped the box at set-down
      box.rotation.set(0, -Math.PI / 2 - heading, 0);
      box.scale.setScalar(grow);
    } else if (P >= 0.18) {
      tipWorld.set(tipL.x, tipL.y - SP_H - H, 0);
      rig.root.localToWorld(tipWorld);
      box.position.copy(tipWorld);
      box.rotation.set(0, rig.root.rotation.y, 0);
      box.scale.setScalar(1);
    } else {
      box.position.set(HERO_X, H, ZP);
      box.rotation.set(0, 0, 0);
      box.scale.setScalar(1);
    }

    // the port is left behind with the truck: at 0.42 the stack is just off the right edge and the
    // stacker off the left, so they go then (the camera then follows the truck past where they stood)
    const inPort = P < A_END;
    // the stacker is left standing where it set the box down; it goes once the camera has left it
    rig.root.visible = P < A_END + 0.08;

    stack.forEach((s) => { s.visible = inPort; });
    white.visible = P > B_END;
    shadowCatcher.visible = P < A_END + 0.05 || P > B_END;
    // once the camera is straight overhead (0.74) road A's deep slab goes flat: when the camera
    // later moves down road C its side face would show as a black band under road A
    const flat = P >= 0.74;
    slab.scale.y = flat ? 0.001 : 1;
    slab.position.y = flat ? -0.04 : -40;

    // ---------------- speed readout
    let kmh = 0;
    if (P >= A_END && P < B_END) kmh = 80 * ease(range(b, 0, 0.18));
    else if (P >= B_END) kmh = 80 - 22 * ease(range(c, 0.05, 0.25)) + 12 * ease(range(c, 0.4, 0.6));
    kmh = Math.round(kmh);
    if (kmh !== lastSpeed) { lastSpeed = kmh; onSpeed && onSpeed(kmh); }

    // ---------------- camera
    let f;
    if (P < A_END) {
      // wide over the stacker and the stack (ground ~80% down) → follows the box as it turns
      // towards the camera → settles on the loaded truck exactly as phase B picks it up
      // reference 0–0.12: stacker and stack fill the frame, the stack ~68% across, ground at ~91%
      const wide = frame(HERO_X - 6, 0, 12);
      wide.y = 0.82 * wide.h;
      // measured off the reference at 1280×720: from the turn to the set-down the ground sits at
      // 90% of the height and the 40 ft box spans ~56% of the width, centred; 0.37 → 0.42 the view
      // drops to the services framing (ground 75% at 0.40, 60% by 0.42)
      const follow = frame(box.position.x - 0.15, 0, 10.6);
      follow.y = 0.8 * follow.h;
      f = mixF(wide, follow, seg(P, 0.17, 0.28));
      f = mixF(f, seqFrame(XC + 1.1), seg(P, 0.37, 0.42));
    } else {
      // starts exactly where the pre-rendered sequence ends, then settles into the services framing
      // pull back over the whole 0.42–0.47 stretch (like the reference) while the truck pulls
      // away — squeezed into 0.43–0.45 it lurched at ~16 km/h
      f = mixF(seqFrame(tx), sideTruckFrame(tx), seg(P, 0.42, 0.47));
    }

    const orbit = P >= B_END ? ease(range(c, 0, 0.07)) * (Math.PI / 2) : 0;   // top view by ~0.73
    // top view, measured off the reference: zoomed so the road fills 60% of the height while on
    // road A (truck at ~41% across), pulls out to ~2.35× (whole junction) for the turn, then
    // follows the truck down road C until it sits mid-screen
    const topH = lerp(12, 28.25, seg(c, 0.35, 0.48)), topD = topH / tanH;
    const center = new THREE.Vector3(tx + 3.8 * (topH / 12), 1.5, tz);
    const jView = J(230, 130);
    center.lerp(new THREE.Vector3(jView.x, 1.5, jView.y), seg(c, 0.35, 0.48));
    center.lerp(new THREE.Vector3(tx, 1.5, tz - 7.6 * (1 - ease(range(c, 0.55, 1)))), seg(c, 0.5, 0.6));    if (orbit > 0) {
      const k = orbit / (Math.PI / 2);
      const D = lerp(f.D, topD, k);
      const offY = lerp(f.y - 1.5, 0, k);
      const look = center.clone();
      // start from the side view's own aim point (f.x on the z = 0 plane) and swing over to the
      // top view's centre with the orbit — jumping straight to `center` moved the truck 150px
      look.x = lerp(f.x, center.x, k);
      look.z = lerp(0, center.z, k);
      look.y += offY * Math.cos(orbit);
      camera.position.set(look.x, look.y + D * Math.sin(orbit), look.z + D * Math.cos(orbit));
      camera.up.set(0, Math.cos(orbit), -Math.sin(orbit));
      camera.lookAt(look);
    } else {
      camera.up.set(0, 1, 0);
      camera.position.set(f.x, f.y, f.D);
      camera.lookAt(f.x, f.y, 0);
    }

    // shadows follow the action: the stacker/box in the port, then the truck
    // the focus is snapped to the shadow map's texel grid *in light space*, so shadow edges don't
    // crawl/shimmer frame to frame as the light follows the truck
    focus.set(P < A_END ? box.position.x : tx, 0, P < A_END ? box.position.z : tz);
    const u = Math.round(focus.dot(sunRight) / TEXEL) * TEXEL, v = Math.round(focus.dot(sunUp) / TEXEL) * TEXEL;
    focus.addScaledVector(sunRight, u - focus.dot(sunRight)).addScaledVector(sunUp, v - focus.dot(sunUp));
    sun.position.copy(focus).add(SUN_OFFSET);
    sun.target.position.copy(focus);
    // inspection only: a close-up camera relative to the truck (journey.debugCam = { pos, look })
    if (api.debugCam) {
      camera.up.set(0, 1, 0);
      camera.position.copy(truck.localToWorld(tmp.fromArray(api.debugCam.pos)));
      camera.lookAt(truck.localToWorld(tmp.fromArray(api.debugCam.look)));
    }
  };

  // `inspect` jumps straight to a progress (no damping) for frame-by-frame checks
  const api = {
    setProgress(v) { target = v; },
    inspect(v) { target = v; snap = true; },
    debugCam: null,
    camera, scene, truck, box, rig, renderer: stage.renderer,
  };
  return api;
}
