// Scroll-scrubbed image sequence (pre-rendered Blender frames) drawn on a canvas.
// Frames load progressively: first frame, then a coarse pass, then everything else,
// so scrubbing works immediately and sharpens as frames arrive. With `lazy`, nothing
// loads until load() or the first setProgress().
export function sequencePlayer(canvas, { dir, count, ext = 'webp', fit = 'contain', align = 'center', bleed = 0, anchor = null, onLayout = null, lazy = false }) {
  const g = canvas.getContext('2d');
  const frames = new Array(count).fill(null);
  let current = 0, W = 0, H = 0, dpr = 1;
  const url = (i) => `${dir}/f${String(i + 1).padStart(3, '0')}.${ext}`;

  function load(i) {
    if (frames[i] !== null) return Promise.resolve();
    frames[i] = false; // loading
    return new Promise((res) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { frames[i] = img; if (Math.abs(i - current) < 3) draw(); res(); };
      img.onerror = () => { frames[i] = null; res(); };
      img.src = url(i);
    });
  }

  function nearest(i) {
    for (let d = 0; d < count; d++) {
      if (frames[i - d]) return frames[i - d];
      if (frames[i + d]) return frames[i + d];
    }
    return null;
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    draw();
  }

  function draw() {
    const img = nearest(current);
    if (!img || !W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // 'contain' may crop up to `bleed` of the width on narrow screens so the subject stays large
    const s = fit === 'cover' ? Math.max(W / img.width, H / img.height) : Math.min((W / img.width) * (1 + bleed), H / img.height);
    const w = img.width * s, h = img.height * s;
    const x = (W - w) / 2;
    // anchor [a, b]: put the point a (fraction of image height) at b (fraction of canvas height)
    const y = anchor ? H * anchor[1] - h * anchor[0] : align === 'bottom' ? H - h : (H - h) / 2;
    g.drawImage(img, x, y, w, h);
    onLayout && onLayout({ x, y, w, h, W, H, frame: current });
  }

  new ResizeObserver(resize).observe(canvas);
  let ready = null;
  function start() {
    ready = ready || load(0).then(async () => {
      resize();
      const coarse = [];
      for (let i = 0; i < count; i += 6) coarse.push(load(i));
      await Promise.all(coarse);
      for (let i = 0; i < count; i++) await load(i);
    });
    return ready;
  }
  if (!lazy) start();

  return {
    get ready() { return start(); },
    load: start,
    setProgress(p) {
      start();
      const i = Math.max(0, Math.min(count - 1, Math.round(p * (count - 1))));
      if (i === current) return;
      current = i;
      if (!frames[i]) load(i);
      draw();
    },
  };
}
