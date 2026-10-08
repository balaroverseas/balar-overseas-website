// One continuous scroll-driven scene:
//  A) reach stacker lifts a container, camera zooms in, container is lowered onto a truck
//  B) truck drives (side view) while the services panel slides over
//  C) camera orbits to a top-down view and the truck turns onto a crossing road
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStage, makeContainer, buildTruck, buildWheel, canvasTex, seg, lerp, clamp01 } from './util.js';

const A_END = 0.28, B_END = 0.62;
const range = (p, a, b) => clamp01((p - a) / (b - a));
const ease = (t) => t * t * (3 - 2 * t);

const hazardTex = () => canvasTex(128, 32, (g) => {
  g.fillStyle = '#f2c230'; g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#151515';
  for (let x = -32; x < 160; x += 22) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 11, 32); g.lineTo(x + 27, 0); g.lineTo(x + 16, 0); g.fill(); }
});

function buildReachStacker() {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: '#1f72b8', metalness: 0.3, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 });
  const boomPaint = new THREE.MeshPhysicalMaterial({ color: '#262c34', metalness: 0.35, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#203040', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#e6e6e6', metalness: 1, roughness: 0.12 });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.5 });
  const add = (geo, m, x, y, z, parent = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const rbox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);

  // side-profile extrusion helper (profile drawn in X/Y, extruded across Z and centred)
  const profile = (pts, depth, bevel, mat, z = 0, arcs = []) => {
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach((p) => {
      if (p.arc) s.absarc(p.arc[0], p.arc[1], p.arc[2], Math.PI, 0, true);
      else s.lineTo(p[0], p[1]);
    });
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 24 });
    geo.translate(0, 0, -depth / 2 + z);
    return add(geo, mat, 0, 0, 0);
  };
  const frameDark = new THREE.MeshPhysicalMaterial({ color: '#24272c', metalness: 0.4, roughness: 0.45, clearcoat: 0.4 });
  const yellow = new THREE.MeshPhysicalMaterial({ color: '#f2c230', roughness: 0.35, clearcoat: 0.8 });

  // lower chassis frame (dark) with wheel arches
  profile([[-5.0, 0.75], { arc: [-2.6, 0.95, 1.2] }, [1.45, 0.95], { arc: [2.75, 1.1, 1.32] }, [4.6, 1.1], [4.6, 1.75], [-5.0, 1.75]], 2.7, 0.08, frameDark);
  // main body shell: sloped engine hood at the rear, low deck in front of the cab
  profile([[-5.0, 1.6], [4.35, 1.6], [4.55, 2.05], [4.1, 2.45], [0.2, 2.45], [-0.6, 2.55], [-1.05, 3.95], [-1.4, 4.2], [-3.9, 4.25], [-4.7, 3.85], [-5.0, 3.2]], 2.6, 0.14, paint);
  // counterweight with hazard band
  profile([[-5.75, 0.95], [-4.9, 0.95], [-4.9, 3.15], [-5.35, 3.25], [-5.75, 2.75]], 2.9, 0.1, frameDark);
  add(new THREE.BoxGeometry(0.95, 0.28, 3.12), hazard, -5.32, 1.35, 0);
  // engine grille + exhaust + logo on the hood
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(1.8, 0.07, 0.03), dark, -3.1, 2.15 + i * 0.2, 1.46);
  add(new THREE.CylinderGeometry(0.11, 0.13, 1.1, 12), chrome, -2.0, 4.75, -0.9);
  const hoodLogo = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.42), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex(512, 112, (c, W, H) => {
    c.clearRect(0, 0, W, H); c.fillStyle = '#ffffff'; c.font = '800 70px Saira, Arial, sans-serif'; c.textBaseline = 'middle'; c.fillText('BALAR', 8, H / 2 + 4);
  }) }));
  hoodLogo.position.set(-2.75, 3.55, 1.45);
  g.add(hoodLogo);
  // tail + head lights
  add(new THREE.BoxGeometry(0.06, 0.25, 0.45), new THREE.MeshStandardMaterial({ color: '#ff3020', emissive: '#ff2010', emissiveIntensity: 1.2 }), -5.78, 2.4, 1.05);
  add(new THREE.BoxGeometry(0.06, 0.22, 0.4), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6dc', emissiveIntensity: 1.5 }), 4.62, 1.85, 1.0);
  // yellow handrails along the deck
  [0.3, 1.15].forEach((x) => add(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), yellow, x, 2.85, 1.25));
  add(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8).rotateZ(Math.PI / 2), yellow, 0.72, 3.25, 1.25);

  // cab: slanted glass greenhouse on a dark frame
  const cabMat = paint;
  profile([[-0.15, 2.45], [2.45, 2.45], [2.65, 2.7], [2.65, 2.95], [-0.15, 2.95]], 1.85, 0.06, cabMat, 0.5);
  profile([[-0.05, 2.95], [2.55, 2.95], [2.85, 4.9], [2.6, 5.2], [0.05, 5.2], [-0.15, 4.95]], 1.75, 0.05, glass, 0.5);
  profile([[-0.25, 5.15], [2.75, 5.15], [2.95, 5.4], [-0.15, 5.45]], 2.0, 0.08, paint, 0.5);
  [[-0.05, 1.35], [2.6, 1.35], [-0.05, -0.35], [2.6, -0.35]].forEach(([x, z]) => {
    const pillar = add(new THREE.BoxGeometry(0.11, 2.3, 0.11), dark, x + (x > 1 ? 0.15 : 0), 4.07, z);
    if (x > 1) pillar.rotation.z = 0.15;
  });
  add(new THREE.BoxGeometry(0.75, 0.85, 0.75), new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.9 }), 0.8, 3.4, 0.5);   // seat
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20).rotateZ(1.2), dark, 1.9, 3.7, 0.5);                                          // steering wheel
  const beacon = add(new THREE.CylinderGeometry(0.14, 0.16, 0.32, 16), new THREE.MeshStandardMaterial({ color: '#ffb020', emissive: '#ff8a00', emissiveIntensity: 1.4 }), 1.0, 5.6, 0.5);
  [0.2, 2.4].forEach((x) => add(new THREE.BoxGeometry(0.3, 0.18, 0.22), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff6dc', emissiveIntensity: 1.2 }), x, 5.55, 1.3)); // work lights
  add(new THREE.BoxGeometry(0.05, 0.5, 0.32), dark, 2.95, 4.3, 1.55);                                                                // mirror
  [0.95, 1.4].forEach((y, i) => add(new THREE.BoxGeometry(0.6, 0.06, 0.35), chrome, -0.35 + i * 0.12, y, 1.55));                    // steps

  // twin front wheels, single rear wheels (yellow port-equipment rims)
  const wheels = [];
  [[2.75, 1.1, 0.85, [1.0, 1.95]], [-2.6, 0.95, 0.75, [1.15]]].forEach(([x, r, wdt, zs]) => zs.forEach((z) => [1, -1].forEach((s) => {
    const w = buildWheel(r, wdt, '#f2c230');
    w.position.set(x, r, z * s);
    g.add(w); wheels.push(w);
  })));

  // boom with decal, telescopic inner, twin lift cylinders
  const pivot = new THREE.Vector3(-2.6, 4.25, 0);
  const boom = new THREE.Group();
  boom.position.copy(pivot);
  g.add(boom);
  add(rbox(8.2, 1.05, 1.0, 0.08).translate(4.1, 0, 0), boomPaint, 0, 0, 0, boom);
  const label = canvasTex(1024, 96, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#ffffff';
    c.font = '800 64px Saira, Arial, sans-serif';
    c.textBaseline = 'middle';
    c.fillText('BALAR OVERSEAS', 40, H / 2 + 4);
    c.fillStyle = '#3a8fca'; c.fillRect(620, 34, 360, 28);
  });
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.52), new THREE.MeshBasicMaterial({ map: label, transparent: true }));
  decal.position.set(4.4, 0.02, 0.505);
  boom.add(decal);
  add(new THREE.CylinderGeometry(0.42, 0.42, 1.2, 20).rotateX(Math.PI / 2), chrome, 0, 0, 0, boom);    // pivot pin
  const inner = add(rbox(10.5, 0.78, 0.78, 0.06).translate(5.25, 0, 0), boomPaint, 0, 0, 0, boom);

  const rams = [-0.62, -1.15].map((z) => {
    const barrel = add(new THREE.CylinderGeometry(0.27, 0.27, 2.6, 16).translate(0, 1.3, 0), paint, 0, 0, z);
    const rod = add(new THREE.CylinderGeometry(0.14, 0.14, 1, 12).translate(0, 0.5, 0), chrome, 0, 0, z);
    return { barrel, rod };
  });
  const base = new THREE.Vector3(-0.55, 2.35, 0);
  const tmpA = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  const updateRams = () => {
    const a = boom.rotation.z;
    const top = new THREE.Vector3(3.9 * Math.cos(a), 3.9 * Math.sin(a), 0).add(pivot);
    tmpA.copy(top).sub(base);
    const len = tmpA.length();
    q.setFromUnitVectors(up, tmpA.clone().normalize());
    rams.forEach(({ barrel, rod }) => {
      barrel.position.set(base.x, base.y, barrel.position.z);
      barrel.quaternion.copy(q);
      rod.position.set(base.x, base.y, rod.position.z).addScaledVector(tmpA.clone().normalize(), 2.2);
      rod.quaternion.copy(q);
      rod.scale.y = Math.max(0.1, len - 2.2);
    });
  };
  return { group: g, boom, inner, pivot, updateRams, beacon };
}

function buildSpreader() {
  const s = new THREE.Group();
  const hazard = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.5 });
  const dark = new THREE.MeshPhysicalMaterial({ color: '#23262b', metalness: 0.4, roughness: 0.45, clearcoat: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.9, roughness: 0.3 });
  const add = (geo, m, x, y, z) => { const b = new THREE.Mesh(geo, m); b.position.set(x, y, z); b.castShadow = true; s.add(b); return b; };
  add(new RoundedBoxGeometry(12.0, 0.5, 0.9, 2, 0.08), dark, 0, 0.3, 0);   // main beam (local X)
  [6.0, -6.0].forEach((x) => {
    add(new THREE.BoxGeometry(0.6, 0.6, 2.6), hazard, x, 0.3, 0);          // end beams
    [1.15, -1.15].forEach((z) => add(new THREE.BoxGeometry(0.4, 0.3, 0.3), steel, x, 0.0, z)); // twistlock castings
  });
  [2.2, -2.2].forEach((x) => add(new THREE.BoxGeometry(0.25, 0.25, 2.3), dark, x, 0.3, 0)); // cross members
  add(new THREE.CylinderGeometry(0.75, 0.85, 0.5, 24), steel, 0, 0.8, 0);   // rotator
  add(new RoundedBoxGeometry(1.7, 0.9, 1.4, 2, 0.12), dark, 0, 1.4, 0);     // headblock
  return s;
}

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
  white.rotation.x = -Math.PI / 2; white.position.y = -0.03;
  scene.add(white);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.12 }));
  shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = -0.02; shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  const XB = 4.1 + 260;            // truck x at end of phase B
  const L1 = 72, R = 9;          // straight run then a right turn
  const XJ = XB + L1;              // x of the crossing road
  const roadMat = new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.9 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(XJ + 260, 80, 9), roadMat);
  slab.position.set((XJ + 260) / 2 - 80, -40, 0);
  slab.receiveShadow = true;
  scene.add(slab);
  const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(9, 900).rotateX(-Math.PI / 2), roadMat);
  vRoad.position.set(XJ + R, 0.005, 250);
  vRoad.receiveShadow = true;
  scene.add(vRoad);

  // dashed lane markings (instanced)
  const dashGeo = new THREE.PlaneGeometry(2.2, 0.22).rotateX(-Math.PI / 2);
  const dashMat = new THREE.MeshBasicMaterial({ color: '#8a8a8a' });
  const dashes = [];
  for (let x = XB - 120; x < XJ + 250; x += 5) if (Math.abs(x - (XJ + R)) > 7) dashes.push([x, 0, 0]);
  for (let z = -200; z < 700; z += 5) if (Math.abs(z) > 7) dashes.push([XJ + R, z, Math.PI / 2]);
  const inst = new THREE.InstancedMesh(dashGeo, dashMat, dashes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  dashes.forEach(([x, z, r], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
    m4.compose(new THREE.Vector3(x, 0.02, z), q, one);
    inst.setMatrixAt(i, m4);
  });
  scene.add(inst);
  // zebra crossings around the junction
  const zebraGeo = new THREE.PlaneGeometry(0.7, 3.2).rotateX(-Math.PI / 2);
  const zebraMat = new THREE.MeshBasicMaterial({ color: '#5a5a5a' });
  for (let i = -3; i <= 3; i++) {
    const a = new THREE.Mesh(zebraGeo, zebraMat); a.position.set(XJ + R + i * 1.2, 0.02, -7.5); a.rotation.y = 0; scene.add(a);
    const b = new THREE.Mesh(zebraGeo, zebraMat); b.position.set(XJ + R + i * 1.2, 0.02, 7.5); scene.add(b);
    const c = new THREE.Mesh(zebraGeo, zebraMat); c.position.set(XJ + R - 7.5, 0.02, i * 1.2); c.rotation.y = Math.PI / 2; scene.add(c);
  }

  // ---------- Port: stack + reach stacker (behind the truck lane at z = -6)
  const ZS = -6;
  const stackA = makeContainer('#1f3a8a', {}); stackA.rotation.y = Math.PI / 2; stackA.position.set(9.6, 1.3, ZS); scene.add(stackA);
  const stackB = makeContainer('#d4632a', {}); stackB.rotation.y = Math.PI / 2; stackB.position.set(12.05, 1.3, ZS); scene.add(stackB);
  const rs = buildReachStacker();
  rs.group.position.set(-4.5, 0, ZS);
  scene.add(rs.group);
  const spreader = buildSpreader();
  scene.add(spreader);
  const box = makeContainer('#c4c9cf', { label: 'BALAR OVERSEAS', labelColor: '#1e2328' });
  scene.add(box);

  // same livery as the Blender truck the sequence hands over from
  const truck = buildTruck({ cab: '#eef0f3', trim: '#3b2cff', skirt: '#3b2cff' });
  scene.add(truck);

  // ---------- helpers
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const frame = (x, y, halfW) => {
    const h = Math.max(halfW / camera.aspect, halfW * 0.42);
    return { x, y, h, D: h / tanH };
  };
  const mixF = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), h: lerp(a.h, b.h, t), D: lerp(a.D, b.D, t) });
  const sideTruckFrame = (tx) => {
    const f = frame(tx + 0.3, 0, 14.5);
    f.y = 2.5 - 0.5 * f.h;   // truck sits in the upper part of the screen
    return f;
  };
  // Same framing as the last Blender frame on the page (see main.js: 1440px frames, 30 m wide,
  // ground line pinned at 90% of the screen, camera trailing the truck by 5.2 m), so the
  // hand-over from the image sequence to this live scene is invisible.
  const seqFrame = (tx) => {
    const W = innerWidth, H = innerHeight;
    const sc = Math.min((W * 1.15) / 1440, H / 810);
    const mpp = 30 / (1440 * sc);              // metres per CSS pixel
    const h = 0.5 * H * mpp;
    return { x: tx - 5.2, y: 0.4 * H * mpp, h, D: h / tanH };
  };
  // The truck keeps to its own (right-hand) lane: +Z while heading +X, -X while heading +Z.
  const LANE = 2.25;
  const pathAt = (s) => {
    const r = R - LANE;
    if (s < L1) return { x: XB + s, z: LANE, a: 0 };
    const arc = (Math.PI / 2) * r;
    if (s < L1 + arc) {
      const phi = (s - L1) / r;
      return { x: XB + L1 + r * Math.sin(phi), z: R - r * Math.cos(phi), a: phi };
    }
    return { x: XJ + R - LANE, z: R + (s - L1 - arc), a: Math.PI / 2 };
  };

  const tmp = new THREE.Vector3(), boxOnTruck = new THREE.Vector3(-1.1, 2.9, 0);
  let target = 0, P = 0, prevTruckX = null, prevTruckZ = null, lastSpeed = -1;

  stage.onFrame = (t, dt) => {
    P = THREE.MathUtils.damp(P, target, 7, dt);
    const a = range(P, 0, A_END), b = range(P, A_END, B_END), c = range(P, B_END, 1);

    // ---------------- container + reach stacker (phase A)
    const XC = 3.0;
    const lift = seg(a, 0.08, 0.35), zoomIn = seg(a, 0.3, 0.5), turn = seg(a, 0.4, 0.55);
    const lower = seg(a, 0.62, 0.82), release = seg(a, 0.82, 0.95), toTruck = seg(a, 0.85, 1);
    const truckArrive = seg(a, 0.45, 0.66);

    let cx = lerp(10.83, XC, lift), cy = lerp(3.9, 9.2, lift), cz = lerp(ZS, 0, zoomIn);
    if (a >= 0.62) cy = lerp(9.2, 2.9, lower);
    const boxRot = lerp(Math.PI / 2, 0, turn);

    // truck x (A arrives, B drives) and path (C)
    let tx, tz = 0, heading = 0;
    if (P < A_END) tx = lerp(-60, XC + 1.1, truckArrive);
    else if (P < B_END) { tx = XC + 1.1 + 260 * Math.pow(b, 1.35); tz = LANE * seg(b, 0.15, 0.6); }
    else {
      const p = pathAt(c * 340);
      tx = p.x; tz = p.z; heading = p.a;
    }
    truck.position.set(tx, 0, tz);
    truck.rotation.y = -heading;
    if (prevTruckX !== null) truck.userData.spin(Math.hypot(tx - prevTruckX, tz - prevTruckZ));
    prevTruckX = tx; prevTruckZ = tz;

    if (a >= 0.82) {
      tmp.copy(boxOnTruck);
      truck.localToWorld(tmp);
      box.position.copy(tmp);
      box.rotation.set(0, -heading, 0);
    } else {
      box.position.set(cx, cy, cz);
      box.rotation.set(0, boxRot, 0);
    }

    // spreader rides on the box; after release the stacker lifts it back up and parks
    // after the drop the stacker reverses out of the shot, taking its spreader along
    const reverse = Math.pow(seg(a, 0.86, 1), 1.6) * 45 + (P > A_END ? 45 : 0);
    rs.group.position.x = -4.5 - reverse;
    if (a >= 0.82) {
      const sx = lerp(XC, XC - 2.5, release) - reverse, sy = lerp(2.9 + 1.3, 10.2, release), sz = lerp(0, ZS, release);
      spreader.position.set(sx, sy, sz);
      spreader.rotation.y = 0;
    } else {
      spreader.position.set(box.position.x, box.position.y + 1.3, box.position.z);
      spreader.rotation.y = boxRot;
    }

    // reach stacker stays in the port; it is simply left behind once the truck drives off
    const inPort = P < A_END + 0.1;
    rs.group.visible = spreader.visible = inPort;
    stackA.visible = stackB.visible = P < A_END;   // the Blender sequence hides the stack after the orbit too
    white.visible = shadowCatcher.visible = P > B_END;
    if (inPort) {
      const tip = new THREE.Vector3(spreader.position.x, spreader.position.y + 1.9, ZS);
      const piv = rs.pivot.clone().add(rs.group.position);
      const dx = tip.x - piv.x, dy = tip.y - piv.y;
      rs.boom.rotation.z = Math.atan2(dy, dx);
      const ext = THREE.MathUtils.clamp(Math.hypot(dx, dy) - 8, 0, 10.5);
      rs.inner.position.x = ext - 2.5;
      rs.updateRams();
      rs.beacon.material.emissiveIntensity = 0.6 + 1.4 * (0.5 + 0.5 * Math.sin(t * 9));
    }

    // ---------------- speed readout
    let kmh = 0;
    if (P >= A_END && P < B_END) kmh = 80 * ease(range(b, 0, 0.18));
    else if (P >= B_END) kmh = 80 - 22 * ease(range(c, 0.05, 0.25)) + 12 * ease(range(c, 0.4, 0.6));
    kmh = Math.round(kmh);
    if (kmh !== lastSpeed) { lastSpeed = kmh; onSpeed && onSpeed(kmh); }

    // ---------------- camera
    const wide = frame(2.6, 0, 13.4);
    wide.y = 0.6 * wide.h - 0.2;
    // moderate zoom: container stays the hero but the stacker never leaves the frame
    const close = frame(cx - 2, cy - 1.8, 11.5);
    const low = frame(cx - 1.5, 5.2, 12.5);
    let f;
    if (P < A_END) {
      f = mixF(wide, close, zoomIn);
      if (a > 0.6) f = mixF(f, low, seg(a, 0.6, 0.82));
      if (a > 0.85) f = mixF(f, sideTruckFrame(tx), toTruck);
    } else {
      // starts exactly where the pre-rendered sequence ends, then settles into the services framing
      f = mixF(seqFrame(tx), sideTruckFrame(tx), seg(b, 0.03, 0.1));
    }

    const orbit = P >= B_END ? ease(range(c, 0, 0.22)) * (Math.PI / 2) : 0;
    const topH = 19, topD = topH / tanH;
    const fwd = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    // frame the road centre (not the truck) so the road stays in the middle of the screen
    const center = new THREE.Vector3(tx + LANE * Math.sin(heading), 1.5, tz - LANE * Math.cos(heading) * seg(b, 0.15, 0.6)).addScaledVector(fwd, 0.3);
    if (orbit > 0) {
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

    sun.position.set(tx + 14, 40, tz + 24);
    sun.target.position.set(tx, 0, tz);
  };

  return { setProgress(v) { target = v; } };
}
