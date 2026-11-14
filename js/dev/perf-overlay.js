// ?perf - a small readout for checking a real phone: frames per second, the worst stalls (with where in the page),
// and how the frame players are doing (bitmaps decoded, how long they took, pictures held back waiting for one).
const box = document.createElement('div');
Object.assign(box.style, { position: 'fixed', left: '4px', top: '4px', zIndex: 99999, font: '10px/1.25 monospace', color: '#0f0', background: 'rgba(0,0,0,.72)', padding: '4px 6px', borderRadius: '4px', pointerEvents: 'none', whiteSpace: 'pre', maxWidth: '96vw' });
document.body.appendChild(box);
let last = 0, frames = [], worst = [];      // worst: [dt, scrollY]
const t0 = performance.now();
const tick = (t) => {
  if (last) {
    const dt = t - last;
    frames.push(dt);
    if (dt > 34 && dt < 3000) { worst.push([Math.round(dt), Math.round(scrollY), Math.round(t - t0) / 1000]); if (worst.length > 40) worst.shift(); }
  }
  last = t; requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
setInterval(() => {
  const n = frames.length, avg = n ? frames.reduce((a, b) => a + b, 0) / n : 0;
  const slow = frames.filter((d) => d > 34 && d < 3000).length;
  frames = [];
  const top = worst.slice().sort((a, b) => b[0] - a[0]).slice(0, 4).map((w) => `${w[0]}ms@y${w[1]}`).join('  ');
  const st = window.__seqStats || {};
  const lines = Object.keys(st).map((k) => { const s = st[k]; return `${k.replace('seq/', '')}: bm ${s.bm} avg ${s.bm ? Math.round(s.bmMs / s.bm) : 0}ms max ${Math.round(s.bmMax)}ms held ${s.stale} | draw max ${Math.round(s.drMax)}ms@y${s.drY} resize ${s.rs}x max ${Math.round(s.rsMax)}ms`; });
  box.textContent = `fps ${avg ? Math.round(1000 / avg) : 0}  slow ${slow}/${n}  y ${Math.round(scrollY)}\nworst: ${top || '-'}\n${lines.join('\n')}`;
}, 500);
