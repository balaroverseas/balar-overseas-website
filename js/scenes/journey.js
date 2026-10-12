// One continuous scroll-driven scene:
//  A) the live reach stacker (reachstacker3d.js) drives to a stack, picks the top box, backs off
//     turning to face the camera, the truck reverses in under it and the box is set down
//     (reference timings: pick 0.15, lifted 0.19, turned 0.26, truck 0.30–0.34, down 0.35)
//  B) truck drives (side view) while the services panel slides over
//  C) camera orbits to a top-down view and the truck turns onto a crossing road
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStage, buildTruck, upgradeTruck, seg, lerp, clamp01 } from './util.js';
import { buildReachStacker3D, buildRibbedContainer, upgradeContainer, upgradeStacker, useMeshyStacker, CONT } from './reachstacker3d.js';

// phase boundaries measured off the reference: port/stacker → services panel → road
const A_END = 0.42, B_END = 0.71;
// ?mob: the phone staging being built, as the reference stages this part on phones (followed there
// every 30 px of scroll at 375x812): everything on the dark page, no road. The stacker is seen in
// profile on the right with the boxes end-on at the left; it lifts the box and does NOT turn; the
// two lower boxes slide away; the view tips straight up to overhead (box upright on screen, stacker
// to its right); the truck drives in under the hanging box from the top of the screen; the box is
// set down; the truck then stays put on screen while the stacker is left behind.
// (on for every phone-width screen; ?mob forces it on a wider one for checks)
const MOB = new URLSearchParams(location.search).has('mob') || matchMedia('(max-width:759px)').matches;
// metres the lifted box swings along the boom, by reference frames since lift-off (smooth between keys)
const SWAY = [[0, 0], [8, -0.017], [18, 0], [27, 0.05], [40, 0], [52, -0.021], [66, 0], [78, 0.006], [90, 0]];
function sway(f) {
  if (f <= 0 || f >= SWAY[SWAY.length - 1][0]) return 0;
  let i = 1;
  while (SWAY[i][0] < f) i++;
  const [f0, a] = SWAY[i - 1], [f1, b] = SWAY[i];
  // keys alternate between zero crossings and extremes: a quarter sine joins them without a kink
  const u = (f - f0) / (f1 - f0);
  return a === 0 ? b * Math.sin(u * Math.PI / 2) : a * Math.cos(u * Math.PI / 2);
}
const CONTAINER_LOGO = 'assets/img/logo-on-light.webp';   // the company logo on the box's sides (dark lettering for the pale box)
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
  // Junction re-measured off the reference's own drawing (2026-10-12; its units / 3.694 = sketch px,
  // road A's top kerb at y 37, the bend starting at x 150): the bend is wider than first sketched -
  // inner kerb radius ~83 px, road C 36 px further right and starting 20 px lower.
  const CL = 232.8, CR = 298.7;                      // road C kerbs (sketch x): three lanes like A and B
  const CX = J((CL + CR) / 2, 0).x, CZ0 = J(0, 185.5).y;      // truck's line down road C, road C start z
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
  const bez = (a, c1, c2, e) => new THREE.CubicBezierCurve(JP(...a), JP(...c1), JP(...c2), JP(...e));
  // outer kerb: road A's top edge sweeps down in an S into road B's top edge
  const OUTER = [bez([150, 37], [187.9, 37], [222.9, 50.8], [248.8, 74.6]), bez([248.8, 74.6], [255.5, 80.8], [265.6, 90.0], [275.9, 94.7]), bez([275.9, 94.7], [286.5, 99.5], [298.1, 101.7], [310.4, 101.7])];
  const B_TOP = 101.7, B_BOT = 167.75;
  // inner kerb: road C's left edge bends up and round into road A's bottom edge
  const INNER = bez([CL, 185.5], [232.9, 139.9], [195.6, 103], [150, 103]);
  // the corner between road B's bottom edge and road C's right edge
  const CORNER = bez([309.3, 167.7], [302.9, 169.0], [298.9, 174.1], [298.9, 180.3]);
  let p = JP(140, 37); sh.moveTo(p.x, p.y);
  p = JP(150, 37); sh.lineTo(p.x, p.y);
  OUTER.forEach((c) => sh.bezierCurveTo(c.v1.x, c.v1.y, c.v2.x, c.v2.y, c.v3.x, c.v3.y));
  sh.lineTo(XJ + 300, JP(0, B_TOP).y);
  sh.lineTo(XJ + 300, JP(0, B_BOT).y);
  p = JP(309.3, 167.7); sh.lineTo(p.x, p.y);
  sh.bezierCurveTo(CORNER.v1.x, CORNER.v1.y, CORNER.v2.x, CORNER.v2.y, CORNER.v3.x, CORNER.v3.y);
  sh.lineTo(JP(CR, 0).x, FAR);
  sh.lineTo(JP(CL, 0).x, FAR);
  p = JP(CL, 185.5); sh.lineTo(p.x, p.y);
  sh.bezierCurveTo(INNER.v1.x, INNER.v1.y, INNER.v2.x, INNER.v2.y, INNER.v3.x, INNER.v3.y);
  p = JP(140, 103); sh.lineTo(p.x, p.y);
  const junction = new THREE.Mesh(new THREE.ShapeGeometry(sh, 32).rotateX(Math.PI / 2), roadMat);
  junction.position.y = 0.004;
  junction.receiveShadow = true;
  scene.add(junction);

  // lane markings: dashes laid along curves (2.4 m dash, 4.2 m gap), faint edge lines, gore hatch
  const V = (x, z) => new THREE.Vector2(x, z);
  const marks = [], edges = [];   // [x, z, angle, length, width]
  const dashed = (curve, dash = 2.4, gap = 4.2) => {
    const len = curve.getLength();
    for (let d = gap / 2; d + dash < len; d += dash + gap) {
      const u = (d + dash / 2) / len, q2 = curve.getPointAt(u), tg = curve.getTangentAt(u);
      marks.push([q2.x, q2.y, Math.atan2(tg.y, tg.x), dash, 0.22]);
    }
  };
  const solid = (a2, b2, w = 0.16, list = marks) => {
    const mx = (a2.x + b2.x) / 2, mz = (a2.y + b2.y) / 2;
    list.push([mx, mz, Math.atan2(b2.y - a2.y, b2.x - a2.x), a2.distanceTo(b2), w]);
  };
  const line = (a2, b2) => new THREE.LineCurve(a2, b2);
  // a kerb curve moved `off` metres into the road (its left-hand normal points in), as a new curve
  const inset = (curves, off, n = 20) => {
    const pts = [];
    curves.forEach((c, k) => {
      for (let i = k ? 1 : 0; i <= n; i++) {
        const pt = c.getPointAt(i / n), tg = c.getTangentAt(i / n);
        pts.push(pt.add(V(-tg.y, tg.x).multiplyScalar(off)));
      }
    });
    return new THREE.SplineCurve(pts);
  };
  // road A
  dashed(line(V(-80, -LW / 2), V(XJ, -LW / 2)));
  dashed(line(V(-80, LW / 2), V(XJ, LW / 2)));
  // road B
  const zB1 = JP(0, B_TOP).y + LW, zB2 = JP(0, B_TOP).y + 2 * LW, xB0 = JP(310.4, 0).x;
  dashed(line(V(xB0, zB1), V(XJ + 300, zB1)));
  dashed(line(V(JP(312.5, 0).x, zB2), V(XJ + 300, zB2)));   // from the gore's nose
  // road C
  const xC1 = JP(CL, 0).x + LW, xC2 = JP(CL, 0).x + 2 * LW;
  dashed(line(V(xC1, CZ0), V(xC1, FAR)));
  dashed(line(V(xC2, CZ0 - 2.4), V(xC2, FAR)));              // from the gore's foot
  // through the junction (as the reference) no lane line crosses another: road A's first line runs
  // parallel to the outer kerb's S-bend into B's first line, its second line parallel to the inner
  // kerb's bend into C's first line; B's second line and C's second line both start at the gore
  dashed(inset(OUTER, LW));
  dashed(inset([INNER], LW));
  // gore (the reference's, point for point): a curved triangle — foot on C's second line, nose on
  // B's second line, the third corner up towards the bend — hatched with four strokes one way and
  // five the other
  const G = 0.3;                                             // stroke, metres (5 of the reference's units)
  const gFoot = [278.07, 174.1], gNose = [310.9, 147.9], gTop = [270.9, 144.7];
  [bez(gFoot, [279.8, 158.9], [293.3, 148.9], gNose), bez(gNose, [290.3, 148.5], [275.8, 145.8], gTop), bez(gTop, [272.9, 149.7], [276.5, 160.1], gFoot)]
    .forEach((c) => { for (let i = 0; i < 16; i++) solid(c.getPointAt(i / 16), c.getPointAt((i + 1) / 16), G); });
  [[274.0, 152.0, 279.1, 146.5], [275.1, 156.3, 283.5, 146.7], [276.1, 160.7, 283.0, 152.8], [276.4, 165.9, 283.0, 158.4],
    [289.9, 154.1, 282.3, 147.4], [294.1, 152.8, 287.4, 146.9], [297.6, 151.0, 293.6, 147.5], [287.4, 157.6, 282.2, 153.0], [284.6, 160.7, 282.2, 158.5]]
    .forEach(([x0, y0, x1, y1]) => solid(JP(x0, y0), JP(x1, y1), G));
  // edge lines just inside the kerbs, round the corners too — barely lighter than the road itself
  const e = RW / 2 - 0.47;
  const edgeCurve = (c) => { for (let i = 0; i < 40; i++) solid(c.getPointAt(i / 40), c.getPointAt((i + 1) / 40), 0.22, edges); };
  edgeCurve(inset(OUTER, 0.47)); edgeCurve(inset([INNER], 0.47)); edgeCurve(inset([CORNER], 0.47));
  solid(V(-80, -e), V(XJ, -e), 0.22, edges); solid(V(-80, e), V(XJ, e), 0.22, edges);
  solid(V(xB0, JP(0, B_TOP).y + 0.47), V(XJ + 300, JP(0, B_TOP).y + 0.47), 0.22, edges);
  solid(V(JP(309.3, 0).x, JP(0, B_BOT).y - 0.47), V(XJ + 300, JP(0, B_BOT).y - 0.47), 0.22, edges);
  solid(V(JP(CL, 0).x + 0.47, CZ0), V(JP(CL, 0).x + 0.47, FAR), 0.22, edges);
  solid(V(JP(CR, 0).x - 0.47, JP(0, 180.3).y), V(JP(CR, 0).x - 0.47, FAR), 0.22, edges);
  const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // the reference's own greys: markings #1f1f1f and edge lines #141414 (its road is #0c0c0c; ours
  // stays the page's #111, so both are lifted by the same step)
  [[marks, '#252525', 0.03], [edges, '#191919', 0.028]].forEach(([list, color, y]) => {
    const inst = new THREE.InstancedMesh(markGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }), list.length);
    list.forEach(([x, z, ang, len, w], i) => {
      q.setFromAxisAngle(up, -ang);
      m4.compose(new THREE.Vector3(x, y, z), q, sc3.set(len, 1, w));
      inst.setMatrixAt(i, m4);
    });
    inst.visible = !MOB;
    scene.add(inst);
  });
  // ---------- Port: two boxes end-on with the hero box on top, behind the truck lane (z = ZP);
  // the live reach stacker picks it, backs off turning to face the camera and sets it on the truck
  // everything in the port stands on the white ground behind the black road (|z| < RW/2 = 7.2):
  // the 40 ft stack (12.2 m deep) sits right behind the kerb, the stacker never drives onto the road
  const ZP = -(RW / 2 + CONT.L / 2 + 0.3);
  // far enough right that the widening hand-over framing (0.36–0.42) never shows it again
  const STACK_X = [28.6, 31.04], HERO_X = (STACK_X[0] + STACK_X[1]) / 2;
  let mobRoad = [];
  if (MOB) {
    // phones: the truck's own road, along the box's axis - a single lane (so the stacker stands beside
    // it, not on it) a shade darker than the page, a dashed line down each side (seen only from above)
    const z0 = ZP + 80, z1 = ZP - 420, zm = (z0 + z1) / 2, len = z0 - z1;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(LW + 0.7, len).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#080808', toneMapped: false }));
    strip.position.set(HERO_X, 0.004, zm);
    const mk = [];
    for (const dx of [-1.9, 1.9]) for (let z = z0; z - 2.4 > z1; z -= 6.6) mk.push([HERO_X + dx, z - 1.2, 0.22, 2.4]);
    const lanes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3a3a3a', toneMapped: false }), mk.length);
    const mm = new THREE.Matrix4(), q0 = new THREE.Quaternion();
    mk.forEach(([x, z, w, l], i) => lanes.setMatrixAt(i, mm.compose(new THREE.Vector3(x, 0.03, z), q0, new THREE.Vector3(w, 1, l))));
    // one group, switched as a whole (the exporter swaps the instanced lanes for a plain mesh)
    const g = new THREE.Group();
    g.add(lanes);          // no darker strip: on the reference the road is the page itself, with a dashed line each side
    scene.add(g);
    mobRoad = [g];
  }
  const stack = STACK_X.map((x, i) => {
    const s = buildRibbedContainer(i ? '#d4632a' : '#1f3c8f', '');
    s.position.set(x, 0, ZP);
    scene.add(s);
    upgradeContainer(s, { tint: i ? '#d34618' : '#2169b3', number: i ? 'BLRU 554210 2' : 'BLRU 381926 4', ink: '#1f2329' });     // real box, tinted
    return s;
  });
  const rig = buildReachStacker3D({ container: false });
  upgradeStacker(rig);
  // ?hq: the detailed scanned stacker (offline Cycles render of the port phase only)
  rig.ready = new URLSearchParams(location.search).has('hq') ? useMeshyStacker(rig, `assets/models/stacker_meshy.glb?t=${Date.now()}`) : Promise.resolve(rig);   // never a cached copy
  scene.add(rig.root);
  const box = buildRibbedContainer('#c4c9cf', 'BALAR OVERSEAS', '#1e2328', CONTAINER_LOGO);
  scene.add(box);
  upgradeContainer(box, { scanTint: 'a9aaab', sideNumber: false, label: 'BALAR OVERSEAS', labelColor: '#1e2328', logo: CONTAINER_LOGO });
  const SP_H = rig.SP_H, H = CONT.H;
  // Phones: the reference draws its stacker there at about 0.6 of life size beside a full-size box
  // (its phone art is a composite: small body, spreader as long as the box). Ours is scaled the same
  // (RS) with the spreader stretched back to the box's length; the tip targets below are in the rig's
  // own frame, so heights and offsets that belong to the world are divided by RS.
  const RS = MOB ? 0.6 : 1;
  rig.root.scale.setScalar(RS);
  rig.parts.spreader.scale.z = 1 / RS;
  // where the stacker stands (rig x) for the pick, and its pose then
  const PICK_REACH = MOB ? 8.2 : 9.4;                       // tip ahead of the rig origin (rig frame); 8.2 keeps the small stacker's front tyres 0.4 m clear of the lower boxes
  const RIG_PICK_X = HERO_X - PICK_REACH * RS;
  const pickTip = new THREE.Vector2(PICK_REACH, (2 * H) / RS + SP_H);
  const liftTip = new THREE.Vector2(PICK_REACH - 0.4 / RS, (2 * H + 1.6) / RS + SP_H);
  // after the turn the boom points at the camera (+Z) over the truck lane: box low over the deck
  const DECK_Y = 1.56;                                      // truck deck (container bottom) height
  // box ahead of the rig = the rig's distance behind the lane: front tyres (3.4 m ahead) stay off the road
  const CARRY_D = RW / 2 + 3.4 + 0.4;
  const carryTip = new THREE.Vector2(CARRY_D, DECK_Y + 0.4 + H + SP_H);
  const downTip = new THREE.Vector2(CARRY_D, DECK_Y + H + SP_H);
  const clearTip = new THREE.Vector2(CARRY_D, DECK_Y + H + SP_H + 1.0);   // locks open, lifts ~1 m clear and holds (reference 0.36–0.47)
  const mDownTip = new THREE.Vector2(PICK_REACH, (DECK_Y + H) / RS + SP_H), mClearTip = new THREE.Vector2(PICK_REACH, (DECK_Y + H + 1.0) / RS + SP_H);
  const hoverTip = new THREE.Vector2(PICK_REACH, (2 * H + 0.8) / RS + SP_H);       // parked over the box at the start (reference 0–0.12)
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
  // a quarter circle (cubic, 0.5523 handles) down the middle lane of the bend
  const turnCurve = new THREE.CubicBezierCurve(new THREE.Vector2(XJ, 0), new THREE.Vector2(XJ + 0.5523 * (CX - XJ), 0), new THREE.Vector2(CX, CZ0 - 0.5523 * CZ0), new THREE.Vector2(CX, CZ0));
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
  const mLook = new THREE.Vector3(), mDir = new THREE.Vector3(), qS = new THREE.Quaternion();
  qS.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // from the far side of the port, looking +z
  const qT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), new THREE.Vector3(0, 0, 1)));
  const tmp = new THREE.Vector3(), boxOnTruck = new THREE.Vector3(-1.1, 1.56, 0);   // box origin = bottom centre, on the deck
  let target = 0, P = 0, snap = false, prevTruckX = null, prevTruckZ = null, lastSpeed = -1;
  // light-space axes of the (fixed-direction) sun, for texel-snapping its shadow camera
  const SUN_OFFSET = new THREE.Vector3(14, 40, MOB ? -24 : 24), TEXEL = 60 / 2048;
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
    // phones: the reference's timing there (px of scroll at 812 high -> P = px / 4200): spreader down
    // 520-600, locks to 680, lift 680-780, view tips up 810-930, truck in 1050-1350. The stacker's
    // keys below stay as they are and are read through this warp (Pr).
    const W = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
    const Pr = !MOB ? P : P < 0.124 ? W(P, 0, 0.124, 0, 0.12) : P < 0.143 ? W(P, 0.124, 0.143, 0.12, 0.165) : P < 0.162 ? W(P, 0.143, 0.162, 0.165, 0.18) : P < 0.186 ? W(P, 0.162, 0.186, 0.18, 0.21) : Math.max(0.21, P);
    const turnU = MOB ? 0 : seg(P, 0.20, 0.26);
    const rigX = lerp(RIG_PICK_X, XC, turnU);
    const rigZ = lerp(ZP, -CARRY_D, turnU);
    rig.root.position.set(rigX, 0, rigZ);
    rig.root.rotation.y = -Math.PI / 2 * turnU;
    let pose;
    if (Pr < 0.18) pose = tipPose(hoverTip, pickTip, seg(Pr, 0.12, 0.17));
    else if (Pr < 0.21) pose = tipPose(pickTip, liftTip, seg(Pr, 0.18, 0.21));
    else if (MOB) {
      // held where it was lifted, then straight down onto the trailer that has come in under it
      // (box down 1365-1432 px, locks open, spreader clear by 1478 when the stage starts to leave)
      if (P < 0.325) pose = tipPose(liftTip, liftTip, 0);
      else if (P < 0.343) pose = tipPose(liftTip, mDownTip, seg(P, 0.325, 0.341));
      else pose = tipPose(mDownTip, mClearTip, seg(P, 0.343, 0.352));
    } else if (P < 0.34) pose = tipPose(liftTip, carryTip, seg(P, 0.21, 0.27));
    else if (P < 0.355) pose = tipPose(carryTip, downTip, seg(P, 0.34, 0.35));
    else pose = tipPose(downTip, clearTip, seg(P, 0.355, 0.385));
    pose.lock = P < 0.3 ? seg(Pr, 0.165, 0.18) : MOB ? 1 - seg(P, 0.341, 0.343) : 1 - seg(P, 0.35, 0.355);
    const tipL = rig.apply(pose);
    // wheels roll with the machine
    const rigMove = Math.hypot(rigX - (rig.root.userData.px ?? rigX), rigZ - (rig.root.userData.pz ?? rigZ));
    rig.root.userData.px = rigX; rig.root.userData.pz = rigZ;
    rig.parts.wheels.forEach((w) => { w.rotation.z -= rigMove / (rig.G.wheelR || 0.83); });   // tyre radius: one turn per circumference, no slip

    // truck x (A reverses in, B drives) and path (C)
    let tx, tz = 0, heading = 0;
    if (P < A_END) tx = lerp(XC + 1.1 + 60, XC + 1.1, 1 - Math.pow(1 - seg(P, 0.30, 0.34), 2));
    else if (P < B_END) tx = XC + 1.1 + B_DIST * driveB(b);
    else {
      const pp = pathAt(pathS(c));
      tx = pp.x; tz = pp.z; heading = pp.a;
    }
    if (MOB) {
      // along the box's own axis: in from +z under the hanging box (0.26-0.33), off towards -z after loading
      const zL = ZP - 1.1;
      tx = HERO_X; heading = -Math.PI / 2;
      // from P 0.352 (1478 px) the truck is carried along at page speed: 4200 px per unit of P, 16.67 m
      // across a 375 px screen -> 186.67 m per unit; the camera follows it, so the stage slides away
      tz = P < 0.352 ? lerp(zL + 60, zL, 1 - Math.pow(1 - seg(P, 0.25, 0.321), 2)) : zL - 186.67 * (P - 0.352);
    }
    truck.position.set(tx, 0, tz);
    if (MOB) truck.visible = P >= 0.235;      // waiting up the lane it stood end-on right behind the stack in the side view
    truck.rotation.y = -heading;
    // the reference's road truck is ~9% bigger against the road than in the side view:
    // grow it while the camera swings up (nothing to compare it with mid-orbit)
    const topK = MOB ? api.mobZoom : ease(range(c, 0, 0.07));
    const grow = 1 + 0.09 * topK;
    truck.scale.setScalar(grow);
    if (prevTruckX !== null) truck.userData.spin(Math.hypot(tx - prevTruckX, tz - prevTruckZ));
    prevTruckX = tx; prevTruckZ = tz;

    // box: on the stack → on the spreader → on the truck (long axis along the trailer)
    if (P >= (MOB ? 0.342 : 0.35)) {
      // seen from above the reference's box is a little larger on its truck than a true 40 ft one
      // (measured at 1280×720: 39 × 192 px against our 36 × 172, the extra length all towards the
      // cab): it swells with the swing up to the top view, where nothing gives the change away
      const top = topK;
      tmp.copy(boxOnTruck);
      tmp.x += 0.71 * top;
      truck.localToWorld(tmp);
      box.position.copy(tmp);
      // same way round as on the spreader (doors to the rear) — +π/2 here flipped the box at set-down
      box.rotation.set(0, -Math.PI / 2 - heading, 0);
      box.scale.set(grow * (1 + 0.07 * top), grow, grow * (1 + 0.117 * top));
      // and its roof reads near white there, like the ship's own grey boxes it ends up among (ours came
      // out a mid grey under the high sun): the paint is lifted as the view swings overhead
      {
        box.traverse((o) => {
          if (!o.isMesh || o.material.transparent) return;
          const base = o.userData.baseColor || (o.userData.baseColor = o.material.color.clone());
          // from the side the paint is set to the render's own (read off its last frame beside the
          // live one: 193,185,192 against our 165,167,169), so the box does not change colour as
          // the frames hand over to this scene
          o.material.color.copy(base);
          // (phones: the ship comes in under the truck further off, where its light boxes read a cool
          // blue-grey - 133,159,181 on the frame it arrives with - so the truck's box ends there instead)
          const [eR, eG, eB] = MOB ? [0.77, 0.9, 1.02] : [1.55, 1.55, 1.55];
          // (phones start from the phone render's own grey roof, 198,197,199)
          const [sR, sG, sB] = MOB ? [1.2, 1.16, 1.15] : [1.6, 1.38, 1.5];
          // (and drifts there over the whole text column - mobPaint - not over the last half screen,
          // where the change showed as the truck drove on)
          const pk = MOB ? api.mobPaint : top;
          o.material.color.r *= sR + (eR - sR) * pk;
          o.material.color.g *= sG + (eG - sG) * pk;
          o.material.color.b *= sB + (eB - sB) * pk;
        });
      }
    } else if (Pr >= 0.18) {
      tipWorld.set(tipL.x, tipL.y - SP_H - H / RS, 0);
      rig.root.localToWorld(tipWorld);
      box.position.copy(tipWorld);
      box.rotation.set(0, rig.root.rotation.y, 0);
      box.scale.setScalar(1);
      // the load swings on the spreader as it is snatched up, as the reference's does (tracked off
      // its frames): back 2 cm, forward 5 cm, back 2 cm, still — along the boom, with a slight roll
      const sw = sway((Pr - 0.18) / 0.0006);
      if (sw) {
        tmp.set(1, 0, 0).applyQuaternion(rig.root.quaternion);
        box.position.addScaledVector(tmp, sw);
        box.rotateZ(-sw * 0.22);
      }
    } else {
      // the spreader lands on it: the box is pressed down a centimetre, then comes back as it locks
      const land = range(Pr, 0.166, 0.172) - range(Pr, 0.174, 0.18);
      box.position.set(HERO_X, H - 0.011 * land, ZP);
      box.rotation.set(0, 0, 0);
      box.scale.setScalar(1);
    }

    // the port is left behind with the truck: at 0.42 the stack is just off the right edge and the
    // stacker off the left, so they go then (the camera then follows the truck past where they stood)
    const inPort = P < A_END;
    // the stacker is left standing where it set the box down; it goes once the camera has left it
    rig.root.visible = P < (MOB ? 0.5 : A_END + 0.08);

    stack.forEach((s) => { s.visible = MOB ? P < 0.225 : inPort; });
    if (MOB) {
      const sl = 14 * ease(seg(P, 0.186, 0.221));
      stack.forEach((s) => { s.userData.x0 ??= s.position.x; s.position.x = s.userData.x0 + sl; });
      slab.visible = junction.visible = false;
      // not while the camera stands below ground level in the side view (a path tracer draws their undersides)
      mobRoad.forEach((o) => { o.visible = P >= 0.203; });
    }
    white.visible = !MOB && P > B_END;
    shadowCatcher.visible = P < A_END + 0.05 || P > B_END;
    // once the camera is straight overhead (0.74) road A's deep slab goes flat: when the camera
    // later moves down road C its side face would show as a black band under road A
    const flat = P >= 0.74 || (MOB && P >= 0.23);
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
    // (re-checked 2026-10-12 at 1280x720: the reference is already fully pulled out as the truck's
    // nose enters the bend, with road C on the screen's centre line)
    const topH = lerp(12, 28.25, seg(c, 0.30, 0.44)), topD = topH / tanH;
    const center = new THREE.Vector3(tx + 3.8 * (topH / 12), 1.5, tz);
    const jView = J((CL + CR) / 2, 140);
    center.lerp(new THREE.Vector3(jView.x, 1.5, jView.y), seg(c, 0.30, 0.44));
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
    if (MOB) {
      // measured off the reference at 375x812: 22.5 px per metre in both views (a 16.67 m wide field);
      // side - the hero box's end 33% across, ground 40.6% down; top - the box upright, its centre 27%
      // down and 32% across until the truck comes (1000 px), 19% across by 1200 px, 13.7% (where the
      // truck then stays) by 1478 px. mobZoom (set by the page for the ship hand-over) pulls out to the
      // desktop's last framing with the truck mid-screen.
      const hS = 8.333 / camera.aspect, k = ease(seg(P, 0.193, 0.221)), z = api.mobZoom;
      const fx = lerp(lerp(0.32, 0.19, ease(seg(P, 0.238, 0.286))), 0.137, ease(seg(P, 0.30, 0.352)));
      const bz = P < 0.352 ? ZP : tz + 1.1;
      mLook.set(lerp(HERO_X - (0.5 - fx) * 16.667, tx, z), 1.5, lerp(bz - 0.23 * 2 * hS, tz, z));
      mLook.set(lerp(HERO_X - 0.17 * 16.667, mLook.x, k), lerp(-0.188 * hS, mLook.y, k), lerp(ZP, mLook.z, k));
      camera.quaternion.slerpQuaternions(qS, qT, k);
      mDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
      camera.position.copy(mLook).addScaledVector(mDir, -lerp(hS, lerp(hS, 37.5, z), k) / tanH);      // 37.5: the truck's box ends 31 px wide and 155 long at 375x812 - the size of the ship's boxes on the frame it arrives with (measured on screen)
    }
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
    // phones: while the rendered frames cover the scene nothing of it shows, so it is not drawn at all;
    // on resuming it jumps straight to where the page is
    pause(v) { if (stage.paused && !v) snap = true; stage.paused = v; },
    step() { stage.onFrame(performance.now() / 1000, 0); },      // one update by hand (dev export in a hidden tab)
    debugCam: null, mobZoom: 0, mobPaint: 0,
    camera, scene, truck, box, rig, renderer: stage.renderer,
  };
  return api;
}
