// Footer: brand name built from a dot-matrix of particles. As the reference runs its own: round
// 2px dots on a 4px grid in mid grey; they fly in from random places the first time the footer
// shows, and the cursor (anywhere on the page) knocks the ones within ~55px away, each with its
// own ease and friction, before they settle back. The canvas is larger than the wordmark's box
// (1.5× wide, 3× tall) so scattered dots are not cut off at its edges.
export function particleText(canvas, text = 'BALAROVERSEAS', opts = {}) {
  const { color = '#a0a0a0', gap = 4, size = 2 } = opts;
  const host = canvas.parentElement;
  const g = canvas.getContext('2d');
  let parts = [], W = 0, H = 0, CW = 0, CH = 0, dpr = 1;
  const R2 = 3000, R = Math.sqrt(R2);
  const mouse = { x: -1e4, y: -1e4, on: false, timer: 0 };

  Object.assign(canvas.style, { position: 'absolute', left: '-25%', top: '-100%', width: '150%', height: '300%', inset: 'auto', pointerEvents: 'none' });
  canvas.style.left = '-25%';
  canvas.style.top = '-100%';

  function build() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return;
    CW = W * 1.5; CH = H * 3;
    canvas.width = CW * dpr; canvas.height = CH * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Render the word once in the box, then sample it on the grid.
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d', { willReadFrequently: true });
    let fs = H * 0.95;
    o.font = `800 ${fs}px Oxanium, Arial, sans-serif`;
    const fit = W * 0.98 / o.measureText(text).width;
    fs = Math.min(fs, fs * fit);
    o.font = `800 ${fs}px Oxanium, Arial, sans-serif`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#000';
    o.fillText(text, W / 2, H * 0.56);
    const data = o.getImageData(0, 0, W, H).data;

    const settled = parts.length > 0;          // on a resize the dots stay put instead of flying in again
    parts = [];
    const ox = W * 0.25, oy = H;
    for (let y = 0; y < H; y += gap) {
      for (let x = 0; x < W; x += gap) {
        if (data[(y * W + x) * 4 + 3] > 128) {
          const hx = ox + x, hy = oy + y;
          parts.push({
            hx, hy,
            x: settled ? hx : Math.random() * CW, y: settled ? hy : Math.random() * CH,
            vx: 0, vy: 0,
            ease: 0.04 + 0.04 * Math.random(), kick: 0.2 + 0.2 * Math.random(), fr: 0.8 + 0.15 * Math.random(),
          });
        }
      }
    }
  }

  addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.on = true;
    clearTimeout(mouse.timer);
    mouse.timer = setTimeout(() => { mouse.on = false; }, 100);
  });

  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || !parts.length) return;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = color;
    g.beginPath();
    const r = size / 2, TAU = Math.PI * 2;
    for (const p of parts) {
      if (mouse.on) {
        const dx = mouse.x - p.x, dy = mouse.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          p.ease = p.kick;
          const d = Math.sqrt(d2) || 1, f = -(R - d) / R * 150 * (0.5 + Math.random());
          p.vx += dx / d * f + (Math.random() - 0.5);
          p.vy += dy / d * f + (Math.random() - 0.5);
        }
      }
      p.x += (p.vx *= p.fr) + (p.hx - p.x) * p.ease;
      p.y += (p.vy *= p.fr) + (p.hy - p.y) * p.ease;
      g.moveTo(p.x + r, p.y);
      g.arc(p.x, p.y, r, 0, TAU);
    }
    g.fill();
  }

  build();
  new ResizeObserver(build).observe(host);
  requestAnimationFrame(frame);
}
