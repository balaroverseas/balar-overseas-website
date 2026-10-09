// Industries hero: top-down view of a Balar truck driving through a forest road.
import * as THREE from 'three';
import { createStage, makeContainer, buildTruck, upgradeTruck, seeded, lerp } from './util.js';

export function initRoadHero(canvas) {
  const stage = createStage(canvas, { fov: 30, shadows: true, far: 2000, maxDpr: 1.5 });
  const { scene, camera } = stage;
  camera.up.set(0, 0, -1);
  scene.background = new THREE.Color('#142a15');

  scene.add(new THREE.HemisphereLight('#e8f4ff', '#20361f', 1.0));
  const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 90, bottom: -90, near: 1, far: 300 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const LEN = 1200;
  // forest floor
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, LEN).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#16301a', roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
  // road with shoulders, edge lines and centre dashes
  const plane = (w, color, x = 0, y = 0.02) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, LEN).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
    m.position.set(x, y, 0); m.receiveShadow = true; scene.add(m); return m;
  };
  plane(13, '#5b5a4f');
  plane(10, '#2b2c2e', 0, 0.03);
  plane(0.18, '#e9e9e9', -4.6, 0.04);
  plane(0.18, '#e9e9e9', 4.6, 0.04);
  const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e6e6e6' }), Math.floor(LEN / 8));
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < dash.count; i++) { m4.makeTranslation(0, 0.05, -LEN / 2 + i * 8); dash.setMatrixAt(i, m4); }
  scene.add(dash);

  // trees: instanced low-poly crowns with colour variation
  const rand = seeded(11);
  // lumpy, smooth-shaded crowns (noise-displaced sphere) read as real canopy from above
  const crownGeo = new THREE.IcosahedronGeometry(1, 3);
  const pos = crownGeo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.16 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.7 - v.y * 2.1) + 0.08 * Math.sin(v.x * 11 + v.z * 9);
    v.multiplyScalar(n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  crownGeo.computeVertexNormals();
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const COUNT = 11000;
  const trees = new THREE.InstancedMesh(crownGeo, crownMat, COUNT);
  trees.castShadow = true;
  trees.receiveShadow = true;
  const greens = ['#1d3a1b', '#264823', '#2f5629', '#1a331a', '#3a6330', '#22421f', '#4a7238'].map((c) => new THREE.Color(c));
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (8.6 + Math.pow(rand(), 0.9) * 85);
    const z = -LEN / 2 + rand() * LEN;
    const r = 2.0 + rand() * 2.8;
    p.set(x, r * 0.9 + rand() * 2, z);
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    s.set(r, r * (0.75 + rand() * 0.3), r);
    m4.compose(p, q, s);
    trees.setMatrixAt(i, m4);
    trees.setColorAt(i, greens[Math.floor(rand() * greens.length)].clone().multiplyScalar(0.85 + rand() * 0.3));
  }
  scene.add(trees);

  // the truck, heading up the screen (-Z) in its lane
  const truck = buildTruck({ cab: '#141414', container: makeContainer('#e2e2e2', { label: 'BALAR OVERSEAS', labelColor: '#2a2a2a', ribTop: true }) });
  upgradeTruck(truck);   // real tractor + trailer model once loaded
  truck.rotation.y = Math.PI / 2; // +X → -Z
  scene.add(truck);

  let target = 0, prog = 0, prevZ = null;
  stage.onFrame = (t, dt) => {
    prog = THREE.MathUtils.damp(prog, target, 5, dt);
    // like the reference: the truck stays around the middle of the screen while the forest rolls by
    const z = lerp(100, -170, prog) + 6 - 14 * prog;
    truck.position.set(2.3, 0, z);
    if (prevZ !== null) truck.userData.spin(prevZ - z);
    prevZ = z;
    // camera drifts slower than the truck, so the truck travels up the screen
    const camZ = lerp(100, -170, prog);
    const h = 95 * Math.max(1, 0.75 / camera.aspect);
    camera.position.set(0, h, camZ);
    camera.lookAt(0, 0, camZ);
    sun.position.set(-40, 90, camZ - 30);
    sun.target.position.set(0, 0, camZ);
  };

  return { setProgress(v) { target = v; } };
}
