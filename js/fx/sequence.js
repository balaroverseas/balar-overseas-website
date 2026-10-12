// Scroll-scrubbed image sequence (pre-rendered Blender frames) drawn on a canvas.
// Frames load progressively: first frame, then a coarse pass, then everything else,
// so scrubbing works immediately and sharpens as frames arrive. With `lazy`, nothing
// loads until load() or the first setProgress().
export function sequencePlayer(canvas, { dir, count, ext = 'webp', fit = 'contain', align = 'center', bleed = 0, anchor = null, onLayout = null, lazy = false, shadow = null, scaleAt = null, blend = false, warp = null, from = 0, view = null }) {
  const g = canvas.getContext('2d');
  const frames = new Array(count).fill(null);
  let current = from, frac = 0, W = 0, H = 0, dpr = 1;
  const url = (i) => `${dir}/f${String(i + 1).padStart(3, '0')}.${ext}`;

  function load(i) {
    if (i < from || frames[i] !== null) return Promise.resolve();   // (frames before `from` are never shown: not fetched)
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
    // 'width': the frame always spans the canvas width, centred — what a 3-D camera with a fixed
    // horizontal field does on any screen shape, so frames rendered from such a camera line up with
    // the live scene they hand over to (a tall screen shows them smaller, a wide one crops top and bottom)
    let s = fit === 'width' ? W / img.width : fit === 'cover' ? Math.max(W / img.width, H / img.height) : Math.min((W / img.width) * (1 + bleed), H / img.height);
    if (scaleAt) s *= scaleAt(current);
    let w = img.width * s, h = img.height * s, clipW = 0;
    let x = (W - w) / 2;
    // anchor [a, b]: put the point a (fraction of image height) at b (fraction of canvas height)
    let y = anchor ? H * anchor[1] - h * anchor[0] : align === 'bottom' ? H - h : (H - h) / 2;
    if (view) {                       // extra 2-D 'camera': zoom about the anchor point, then shift
      const v = view({ x, y, w, h, W, H, frame: current });
      const ax = W / 2, ay = anchor ? H * anchor[1] : H / 2;
      x = ax + (x - ax) * v.s + v.dx; y = ay + (y - ay) * v.s + v.dy; w *= v.s; h *= v.s;
      clipW = v.clip ? w * v.clip : 0;
    }
    if (shadow) {
      // soft drop shadow from the frame's own alpha (e.g. the jet over the page)
      g.save();
      g.filter = `brightness(0) blur(${shadow.blur * (w / img.width)}px)`;
      g.globalAlpha = shadow.alpha;
      g.drawImage(img, x + shadow.dx * w, y + shadow.dy * h, w, h);
      g.restore();
    }
    if (clipW) { g.save(); g.beginPath(); g.rect(x, 0, clipW, H); g.clip(); }
    // blend: where few frames cover a long scroll (the ship on phones) the picture must not step from
    // frame to frame. With `warp` (the camera of each frame is known) the next frame is drawn as the
    // camera would see it from the in-between position - enlarged and shifted - and this one, shrunk
    // the same way, fades out over it: the motion is continuous and the two never stand apart.
    // Without it the next frame is simply laid over this one by the fraction of the way to it.
    const next = blend && frames[current] === img ? frames[current + 1] : null;
    if (next && warp) {
      const k = w / img.width, cx = x + w / 2, cy = y + h / 2, pos = current + frac;
      const put = (im, j) => {
        const v = warp(pos, j);
        g.drawImage(im, cx - (w * v.m) / 2, cy - (h * v.m) / 2 + v.dy * k, w * v.m, h * v.m);
      };
      put(next, current + 1);
      g.globalAlpha = 1 - frac;
      put(img, current);
      g.globalAlpha = 1;
    } else {
      g.drawImage(img, x, y, w, h);
      if (next && frac > 0.004) {
        g.globalAlpha = frac;
        g.drawImage(next, x, y, w, h);
        g.globalAlpha = 1;
      }
    }
    if (clipW) g.restore();
    if (fit === 'width' && y + h < H - 1) {
      // below a frame that stops short of the bottom: carry its last row on down (ground or road)
      g.drawImage(img, 0, img.height - 2, img.width, 1, x, y + h - 1, w, H - (y + h) + 2);
    }
    onLayout && onLayout({ x, y, w, h, W, H, frame: current });
  }

  new ResizeObserver(resize).observe(canvas);
  let ready = null;
  function start() {
    ready = ready || load(from).then(async () => {
      resize();
      const coarse = [];
      for (let i = from; i < count; i += 6) coarse.push(load(i));
      await Promise.all(coarse);
      for (let i = from; i < count; i++) await load(i);
    });
    return ready;
  }
  if (!lazy) start();

  return {
    get ready() { return start(); },
    load: start,
    redraw: () => draw(),
    setProgress(p) {
      start();
      const f = Math.max(from, Math.min(count - 1, p * (count - 1)));
      const i = blend ? Math.min(count - 1, Math.floor(f)) : Math.round(f);
      const fr = blend ? f - i : 0;
      if (i === current && Math.abs(fr - frac) < 0.004) return;
      current = i; frac = fr;
      if (!frames[i]) load(i);
      if (blend && i + 1 < count && !frames[i + 1]) load(i + 1);
      draw();
    },
  };
}
