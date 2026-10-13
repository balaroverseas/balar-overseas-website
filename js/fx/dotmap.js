// Dotted world map drawn on a 2D canvas (used by the preloader and the footer).
const WATER_MAP = 'https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/earth-water.png';
let landPromise = null;

function loadLand() {
  if (landPromise) return landPromise;
  landPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = 360, H = 180;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      resolve((lon, lat) => {
        const x = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
        const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
        return d[(y * W + x) * 4] < 128;
      });
    };
    img.onerror = reject;
    img.src = WATER_MAP;
  });
  return landPromise;
}

/**
 * opts: { dot, gap, color, markers:[{lat,lon,color}], flicker }
 * Returns { setProgress(p) } – p reveals dots left→right (used by preloader).
 */
export async function drawDotMap(canvas, opts = {}) {
  const isLand = await loadLand();
  const { gap = 7, dot = 2.2, color = '#4a4a4a', markers = [], flicker = false } = opts;
  const g = canvas.getContext('2d');
  let pts = [], W = 0, H = 0, progress = 1;

  function build() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    pts = [];
    for (let y = gap / 2; y < H; y += gap) {
      for (let x = gap / 2; x < W; x += gap) {
        const lon = (x / W) * 360 - 180, lat = 90 - (y / H) * 180;
        if (lat < -58) continue;
        if (isLand(lon, lat)) pts.push({ x, y, r: Math.random() });
      }
    }
  }

  function draw(t = 0) {
    g.clearRect(0, 0, W, H);
    for (const p of pts) {
      if (p.x / W > progress) continue;
      let a = 1;
      if (flicker) a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.002 + p.r * 30));
      g.globalAlpha = a;
      g.fillStyle = color;
      g.fillRect(p.x - dot / 2, p.y - dot / 2, dot, dot);
    }
    g.globalAlpha = 1;
    markers.forEach((m) => {
      const x = ((m.lon + 180) / 360) * W, y = ((90 - m.lat) / 180) * H;
      if (x / W > progress) return;
      g.fillStyle = m.color || '#3b2cff';
      g.beginPath(); g.arc(x, y, gap * 0.55, 0, Math.PI * 2); g.fill();
      if (flicker) {
        const f = ((t * 0.0008) + m.lon * 0.01) % 1;
        g.globalAlpha = 1 - f;
        g.strokeStyle = m.color || '#3b2cff';
        g.beginPath(); g.arc(x, y, gap * (0.6 + f * 2.5), 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
    });
  }

  build();
  new ResizeObserver(() => { build(); draw(); }).observe(canvas);
  let raf = 0;
  // only while it can be seen: checked a few times a second (hidden with its loader, scrolled away, or
  // the tab in the background - the loader's map used to go on redrawing behind the page for good)
  let shown = true, tickN = 0, inView = true;
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; }).observe(canvas);
  const loop = (t) => {
    if (tickN++ % 20 === 0) shown = inView && !document.hidden && canvas.getClientRects().length > 0 && getComputedStyle(canvas).visibility !== 'hidden';
    if (shown) draw(t);
    raf = requestAnimationFrame(loop);
  };
  if (flicker) raf = requestAnimationFrame(loop); else draw();

  return {
    setProgress(p) { progress = p; if (!flicker) draw(); },
    stop() { cancelAnimationFrame(raf); },
  };
}
