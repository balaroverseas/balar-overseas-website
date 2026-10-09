// One continuous scroll-driven scene:
//  A) the live reach stacker (reachstacker3d.js) drives to a stack, picks the top box, backs off
//     turning to face the camera, the truck reverses in under it and the box is set down
//     (reference timings: pick 0.15, lifted 0.19, turned 0.26, truck 0.30–0.34, down 0.35)
//  B) truck drives (side view) while the services panel slides over
//  C) camera orbits to a top-down view and the truck turns onto a crossing road
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStage, buildTruck, seg, lerp, clamp01 } from './util.js';
import { buildReachStacker3D, buildRibbedContainer, CONT } from './reachstacker3d.js';

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
  const XB = 4.1 + 260;            // truck x at end of phase B
  const L1 = 100;                  // straight run on road A before the bend
  const XJ = XB + L1;              // road A starts to bend here
  const K = RW / 66;               // reference sketch (px at the zoomed-out frame) → metres
  const J = (px, py) => new THREE.Vector2(XJ + (px - 150) * K, (py - 70) * K);
  const CX = J(229.5, 0).x, CZ0 = J(0, 165).y;      // truck's line down road C, road C start z
  const CL = 197, CR = 278;                          // road C kerbs (sketch x)
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
  // road C is wider than A/B in the reference (≈1× the truck's length across, the truck running
  // left of its centre): its right kerb sits at 278, not 262 like a plain three-lane road
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
  dashed(line(V(xB0, zB2), V(XJ + 300, zB2)));
  // road C
  const xC1 = JP(CL + (CR - CL) / 3, 0).x, xC2 = JP(CL + 2 * (CR - CL) / 3, 0).x;
  dashed(line(V(xC1, CZ0), V(xC1, FAR)));
  dashed(line(V(xC2, CZ0), V(xC2, FAR)));
  // through the junction (like the reference) only the A → B lane lines carry on, following the
  // road's own S-bend (the outer kerb's curve moved down a lane); none cross the mouth of road C
  const sBend = (pyA, pyB) => new THREE.CubicBezierCurve(JP(150, pyA), JP(220, pyA), JP(230, pyB), JP(290, pyB));
  dashed(sBend(59, 121.7));
  dashed(sBend(81, 143.3));
  // thin edge lines just inside the kerbs of the straight runs
  const e = RW / 2 - 0.45;
  solid(V(-80, -e), V(XJ, -e)); solid(V(-80, e), V(XJ, e));
  solid(V(xB0, JP(0, 100).y + 0.45), V(XJ + 300, JP(0, 100).y + 0.45)); solid(V(xB0 + 6, JP(0, 165).y - 0.45), V(XJ + 300, JP(0, 165).y - 0.45));
  solid(V(JP(197, 0).x + 0.45, CZ0 + 4), V(JP(197, 0).x + 0.45, FAR)); solid(V(JP(CR, 0).x - 0.45, CZ0 + 4), V(JP(CR, 0).x - 0.45, FAR));
  // hatched gore where the lanes to B and to C split
  const g1 = JP(236 + (CR - 262) / 2, 140), g2 = JP(CR, 168), g3 = JP(CR + 19, 141);
  solid(g1, g2); solid(g2, g3); solid(g3, g1);
  for (let i = 1; i < 7; i++) solid(g1.clone().lerp(g2, i / 7), g1.clone().lerp(g3, i / 7), 0.12);
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
    return s;
  });
  const rig = buildReachStacker3D({ container: false });
  scene.add(rig.root);
  const box = buildRibbedContainer('#c4c9cf', 'BALAR OVERSEAS', '#1e2328');
  scene.add(box);
  const SP_H = rig.SP_H, H = CONT.H;
  // where the stacker stands (rig x) for the pick, and its pose then
  const PICK_REACH = 9.4;                                   // tip ahead of the rig origin
  const RIG_PICK_X = HERO_X - PICK_REACH;
  const pickTip = new THREE.Vector2(PICK_REACH, 2 * H + SP_H);
  const liftTip = new THREE.Vector2(PICK_REACH - 0.4, 2 * H + SP_H + 1.6);
  // after the turn the boom points at the camera (+Z) over the truck lane: box low over the deck
  const DECK_Y = 1.6;                                       // truck deck (container bottom) height
  // box ahead of the rig = the rig's distance behind the lane: front tyres (3.4 m ahead) stay off the road
  const CARRY_D = RW / 2 + 3.4 + 0.4;
  const carryTip = new THREE.Vector2(CARRY_D, DECK_Y + 0.4 + H + SP_H);
  const downTip = new THREE.Vector2(CARRY_D, DECK_Y + H + SP_H);
  const clearTip = new THREE.Vector2(CARRY_D - 0.4, DECK_Y + H + SP_H + 0.9);   // locks open, lift clear
  const restPose = { angle: 4 * Math.PI / 180, ext: 0 };
  const lerpPose = (p0, p1, u) => ({ angle: lerp(p0.angle, p1.angle, u), ext: lerp(p0.ext, p1.ext, u) });
  const tipPose = (a2, b2, u) => rig.solve(new THREE.Vector2(lerp(a2.x, b2.x, u), lerp(a2.y, b2.y, u)));
  const tipWorld = new THREE.Vector3();

  // same livery as the Blender truck the sequence hands over from
  const truck = buildTruck({ cab: '#1a1c21' });
  scene.add(truck);

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
  const tmp = new THREE.Vector3(), boxOnTruck = new THREE.Vector3(-1.1, 1.6, 0);   // box origin = bottom centre, on the deck
  let target = 0, P = 0, prevTruckX = null, prevTruckZ = null, lastSpeed = -1;

  stage.onFrame = (t, dt) => {
    P = THREE.MathUtils.damp(P, target, 7, dt);
    const a = range(P, 0, A_END), b = range(P, A_END, B_END), c = range(P, B_END, 1);

    // ---------------- reach stacker + box (phase A), reference timings in P:
    // drive in & spreader onto the box 0–0.15 · lift 0.15–0.19 · back off turning to face the
    // camera 0.19–0.26 · truck reverses in 0.30–0.34 · box down 0.34–0.35 · locks open,
    // spreader lifts clear 0.35–0.40 · stacker backs away 0.38–0.42 (it never vanishes)
    const XC = 3.0;                                       // box (and trailer) x once on the truck
    // after the drop it backs off, swings round to the left and drives out of the shot
    // (fully out of the frame by 0.415, before it is switched off at 0.42)
    const drive = seg(P, 0, 0.13), turnU = seg(P, 0.19, 0.26), back = seg(P, 0.365, 0.385), away = seg(P, 0.375, 0.415);
    const rigX = lerp(lerp(RIG_PICK_X - 14, RIG_PICK_X, drive), XC, turnU) - 40 * Math.pow(away, 1.3);
    const rigZ = lerp(ZP, -CARRY_D, turnU) - 3.5 * back - 2 * away;
    rig.root.position.set(rigX, 0, rigZ);
    rig.root.rotation.y = -Math.PI / 2 * turnU - Math.PI / 2 * seg(P, 0.375, 0.405);
    let pose;
    if (P < 0.15) pose = lerpPose(restPose, rig.solve(pickTip), seg(P, 0.04, 0.14));
    else if (P < 0.19) pose = tipPose(pickTip, liftTip, seg(P, 0.15, 0.19));
    else if (P < 0.34) pose = tipPose(liftTip, carryTip, seg(P, 0.19, 0.27));
    else if (P < 0.355) pose = tipPose(carryTip, downTip, seg(P, 0.34, 0.35));
    else if (P < 0.37) pose = tipPose(downTip, clearTip, seg(P, 0.355, 0.37));
    else pose = lerpPose(rig.solve(clearTip), restPose, seg(P, 0.37, 0.4));    // boom folds back to travel
    pose.lock = P < 0.3 ? seg(P, 0.135, 0.15) : 1 - seg(P, 0.35, 0.355);
    const tipL = rig.apply(pose);
    // wheels roll with the machine
    const rigMove = Math.hypot(rigX - (rig.root.userData.px ?? rigX), rigZ - (rig.root.userData.pz ?? rigZ));
    rig.root.userData.px = rigX; rig.root.userData.pz = rigZ;
    rig.parts.wheels.forEach((w) => { w.rotation.z -= rigMove / 0.76; });

    // truck x (A reverses in, B drives) and path (C)
    let tx, tz = 0, heading = 0;
    if (P < A_END) tx = lerp(XC + 1.1 + 60, XC + 1.1, 1 - Math.pow(1 - seg(P, 0.30, 0.34), 2));
    else if (P < B_END) tx = XC + 1.1 + 260 * Math.pow(b, 1.35);
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
      box.rotation.set(0, Math.PI / 2 - heading, 0);
      box.scale.setScalar(grow);
    } else if (P >= 0.15) {
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
    rig.root.visible = inPort;
    stack.forEach((s) => { s.visible = inPort; });
    white.visible = P > B_END;
    shadowCatcher.visible = P < A_END + 0.05 || P > B_END;

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
      const wide = frame(lerp(RIG_PICK_X - 6, HERO_X - 9, drive), 0, 16);
      wide.y = 0.6 * wide.h;
      const follow = frame(box.position.x - 1, 0, 11.5);
      follow.y = 0.5 * follow.h;
      f = mixF(wide, follow, seg(P, 0.17, 0.28));
      f = mixF(f, seqFrame(XC + 1.1), seg(P, 0.36, 0.42));
    } else {
      // starts exactly where the pre-rendered sequence ends, then settles into the services framing
      f = mixF(seqFrame(tx), sideTruckFrame(tx), seg(b, 0.03, 0.1));
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
    const fx = P < A_END ? box.position.x : tx, fz = P < A_END ? box.position.z : tz;
    sun.position.set(fx + 14, 40, fz + 24);
    sun.target.position.set(fx, 0, fz);
  };

  return { setProgress(v) { target = v; }, camera, scene };
}
