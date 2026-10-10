// Dev tool: exports the live journey scene for the Cycles render of the port phase
// (blender/journey_render.py). Run in the page console at 1280×720:
//   const m = await import('/js/dev/export-journey.js'); await m.exportJourney({ frames: 240, pEnd: 0.5 });
// Writes _export/journey.glb (geometry, every node named N<i>) and _export/journey_anim.json
// (camera + the local TRS / visibility of every node that changes, per frame).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function put(path, body) {
  const r = await fetch(path, { method: 'PUT', body });
  if (!r.ok) throw new Error(`PUT ${path}: ${r.status}`);
}

export async function exportJourney({ frames = 240, pEnd = 0.5 } = {}) {
  const J = window.__journey;
  const { scene, camera } = J;
  // instanced meshes (tyre lugs, road marks) → plain merged meshes, which every importer reads
  const inst = [];
  scene.traverse((o) => { if (o.isInstancedMesh) inst.push(o); });
  inst.forEach((o) => {
    const geos = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      geos.push(o.geometry.clone().applyMatrix4(m));
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), o.material);
    mesh.position.copy(o.position); mesh.quaternion.copy(o.quaternion); mesh.scale.copy(o.scale);
    mesh.castShadow = o.castShadow;
    o.parent.add(mesh);
    o.parent.remove(o);
  });
  // nothing the render does not want: lights (Blender lights it), the shadow-only plane
  const drop = [];
  scene.traverse((o) => { if (o.isLight || (o.isMesh && o.material && o.material.isShadowMaterial)) drop.push(o); });
  drop.forEach((o) => o.parent && o.parent.remove(o));
  // stable short names
  const nodes = [];
  scene.traverse((o) => { if (o !== scene) { o.name = `N${nodes.length}`; nodes.push(o); } });

  const sample = (p) => { J.inspect(p); };
  const pose = () => nodes.map((o) => [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.scale.x, o.scale.y, o.scale.z, o.visible ? 1 : 0]);

  // which nodes move or toggle at all over the range (coarse pass)
  sample(0); await tick(); await tick();
  const base = pose();
  const changed = new Set();
  for (let k = 1; k <= 60; k++) {
    sample((k / 60) * pEnd); await tick();
    const ps = pose();
    ps.forEach((v, i) => { if (v.some((x, j) => Math.abs(x - base[i][j]) > 1e-5)) changed.add(i); });
  }
  const ids = [...changed];

  // fine pass: camera + changed nodes for every frame
  const anim = { frames, pEnd, nodes: ids.map((i) => nodes[i].name), aspect: camera.aspect, cam: [], data: [] };
  for (let f = 0; f < frames; f++) {
    sample((f / (frames - 1)) * pEnd); await tick();
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    anim.cam.push({ m: Array.from(e), fov: camera.fov, near: camera.near, far: camera.far });
    const ps = pose();
    anim.data.push(ids.map((i) => ps[i].map((x) => Math.round(x * 1e5) / 1e5)));
  }

  // geometry at frame 0
  sample(0); await tick(); await tick();
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, maxTextureSize: 2048 });
  await put('/_export/journey.glb', glb);
  await put('/_export/journey_anim.json', JSON.stringify(anim));
  return { nodes: nodes.length, animated: ids.length, frames, glbBytes: glb.byteLength };
}
