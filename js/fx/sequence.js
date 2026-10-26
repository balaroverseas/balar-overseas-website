// Scroll-scrubbed image sequence (pre-rendered Blender frames) drawn on a canvas.
// Frames load progressively: first frame, then a coarse pass, then everything else,
// so scrubbing works immediately and sharpens as frames arrive. With `lazy`, nothing
// loads until load() or the first setProgress().
import { avifOK } from './avif.js';

export function sequencePlayer(canvas, { dir, count, ext = 'webp', avif = false, fit = 'contain', align = 'center', bleed = 0, anchor = null, onLayout = null, lazy = false, shadow = null, scaleAt = null, blend = false, warp = null, from = 0, cache = 0, view = null }) {
  const g = canvas.getContext('2d');
  const frames = new Array(count).fill(null);
  let current = from, frac = 0, W = 0, H = 0, dpr = 1;
  // avif: the folder also holds AVIF copies of the frames (smaller); used where the browser shows AVIF
  let fmt = ext;
  const fmtReady = avif ? avifOK.then((ok) => { if (ok) fmt = 'avif'; }) : Promise.resolve();
  const url = (i) => `${dir}/f${String(i + 1).padStart(3, '0')}.${fmt}`;

  function load(i) {
    if (i < from || frames[i] !== null) return Promise.resolve();   // (frames before `from` are never shown: not fetched)
    frames[i] = false; // loading
    return new Promise((res) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { frames[i] = img; if (Math.abs(i - current) < 3) draw(); if (cache && Math.abs(i - current) <= cache * 2) tend(); res(); };
      img.onerror = () => {
        // (a frame without an AVIF copy falls back to its WebP)
        if (fmt !== ext && !img.src.endsWith(ext)) { img.src = img.src.replace(/\.avif$/, '.' + ext); return; }
        frames[i] = undefined; res();                               // (not null: it is not asked for again)
      };
      fmtReady.then(() => { img.src = url(i); });
    });
  }

  function nearest(i) {
    for (let d = 0; d < count; d++) {
      if (frames[i - d]) return i - d;
      if (frames[i + d]) return i + d;
    }
    return -1;
  }

  // cache (phones): a compressed frame is only decoded when it is first drawn, which costs a phone a
  // visible hitch on every new frame - and it forgets them again when memory runs short. So the
  // frames around the current one are decoded ahead of time and held as bitmaps (a few each side,
  // more in the direction of travel); the ones left behind are released.
  const bitmaps = new Map(), pending = new Set();
  let dirSign = 1, noBitmaps = false, speed = 0, lastT = 0, settle = 0;
  // the frames held: a window around the current one, longer ahead. Scrolled fast, a phone cannot decode
  // every frame before the page is past it, so the window then takes every st-th frame and reaches
  // as far ahead: there is always a decoded frame close to where the page is going (see near). Slower,
  // st falls back to 1 and the frames in between are filled in.
  const win = () => {
    const st = warp ? 1 : Math.max(1, Math.round(speed * 3));
    const ahead = cache * 2 * st, back = Math.ceil(cache / 2) * st;
    return dirSign > 0 ? [current - back, current + ahead, st] : [current - ahead, current + back, st];
  };
  const hold = (i) => {
    if (noBitmaps || i < from || i >= count || bitmaps.has(i) || pending.has(i) || !frames[i] || !window.createImageBitmap) return;
    if (pending.size >= 2) return;     // two at a time (each one finished asks for the next, see below)
    pending.add(i);
    // (made from the file's bytes - already in the browser's cache - not from the <img>: from an <img>
    // the bitmap is made on the page's own thread, 16-40 ms a frame even on a fast PC, and six at once
    // froze the page as the ship came in; from the bytes it is decoded in the background. Kept at the
    // frame's own size: shrinking the 2560 px desktop frames to the screen as they were decoded cost
    // more than it saved, and made the stacker and the ship's start stutter)
    fetch(frames[i].src).then((r) => r.blob()).then((blob) => createImageBitmap(blob)).then((b) => {
      pending.delete(i);
      const [a, z] = win();
      if (i < a - 2 || i > z + 2) { b.close(); tend(); return; }
      bitmaps.set(i, b);
      if (i === current || i === current + 1) draw();
      tend();
    }).catch(() => { pending.delete(i); noBitmaps = true; });     // (a browser that cannot: frames are drawn from the <img>s)
  };
  const tend = () => {
    if (!cache) return;
    const [a, b, st] = win();
    for (let i = current; i >= a && i <= b; i += dirSign * st) hold(i);
    for (let i = current - dirSign * st; i >= a && i <= b; i -= dirSign * st) hold(i);
    bitmaps.forEach((bm, i) => { if (i < a - 2 || i > b + 2) { bm.close(); bitmaps.delete(i); } });
  };
  // A frame not decoded yet would be decoded the moment it is drawn, on the spot - on a phone that is
  // the stutter (scrolled fast, a phone's stacker asks for 100+ new frames a second, far more than it
  // can decode). So until it is ready the nearest frame that is decoded stands in for it (a few frames
  // off at most); when the scroll slows the right one arrives. Not where each frame is drawn from its
  // own camera (warp): there a stand-in would sit in the wrong place.
  const near = (i) => {
    const [a, b] = win();
    for (let d = 1; d <= b - a; d++) {
      const a = bitmaps.get(i - d * dirSign) || bitmaps.get(i + d * dirSign);
      if (a) return a;
    }
    return null;
  };
  const pic = (i) => bitmaps.get(i) || (cache && !warp && near(i)) || frames[i];

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    draw();
  }

  function draw() {
    const at = nearest(current), img = at < 0 ? null : frames[at];
    if (!img || !W) return;
    const src = pic(at);
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
      g.drawImage(src, x + shadow.dx * w, y + shadow.dy * h, w, h);
      g.restore();
    }
    if (clipW) { g.save(); g.beginPath(); g.rect(x, 0, clipW, H); g.clip(); }
    // blend: where few frames cover a long scroll (the ship on phones) the picture must not step from
    // frame to frame. With `warp` (the camera of each frame is known) the next frame is drawn as the
    // camera would see it from the in-between position - enlarged and shifted - and this one, shrunk
    // the same way, fades out over it: the motion is continuous and the two never stand apart.
    // Without it the next frame is simply laid over this one by the fraction of the way to it.
    const next = blend && at === current && frames[current + 1] ? pic(current + 1) : null;
    if (next && warp) {
      const k = w / img.width, cx = x + w / 2, cy = y + h / 2, pos = current + frac;
      const vN = warp(pos, current + 1), vC = warp(pos, current);
      const put = (im, v) => g.drawImage(im, cx - (w * v.m) / 2 + (v.dx || 0) * k, cy - (h * v.m) / 2 + v.dy * k, w * v.m, h * v.m);
      // where the camera is closing in or gliding, the next frame as re-drawn does not reach every edge:
      // this one is then laid down first so no strip is left bare
      const full = vN.m >= 1 && Math.abs(vN.dy) * k <= ((vN.m - 1) * h) / 2 + 0.5 && Math.abs(vN.dx || 0) * k <= ((vN.m - 1) * w) / 2 + 0.5;
      if (!full) put(src, vC);
      put(next, vN);
      g.globalAlpha = 1 - frac;
      put(src, vC);
      g.globalAlpha = 1;
    } else {
      g.drawImage(src, x, y, w, h);
      if (next && frac > 0.004) {
        g.globalAlpha = frac;
        g.drawImage(next, x, y, w, h);
        g.globalAlpha = 1;
      }
    }
    if (clipW) g.restore();
    if (fit === 'width' && y + h < H - 1) {
      // below a frame that stops short of the bottom: carry its last row on down (ground or road)
      g.drawImage(src, 0, src.height - 2, src.width, 1, x, y + h - 1, w, H - (y + h) + 2);
    }
    onLayout && onLayout({ x, y, w, h, W, H, frame: current });
  }

  new ResizeObserver(resize).observe(canvas);
  // Loading: the first frame, then every sixth (so any position has something close to show), then the
  // rest - six at a time, always the missing frame nearest to where the page is now (ahead first), so
  // a visitor who scrolls on, or jumps, gets the frames around them before the ones far away. (They
  // used to come strictly one after another from the start.)
  const nextNeeded = () => {
    for (let d = 0; d < count; d++) {
      const a = current + d, b = current - d;
      if (a >= from && a < count && frames[a] === null) return a;
      if (b >= from && b < count && frames[b] === null) return b;
    }
    return -1;
  };
  const fill = () => Promise.all(Array.from({ length: 6 }, async () => {
    for (let i = nextNeeded(); i >= 0; i = nextNeeded()) await load(i);
  }));
  let ready = null;
  function start() {
    ready = ready || load(from).then(async () => {
      resize();
      const coarse = [];
      for (let i = from; i < count; i += 6) coarse.push(load(i));
      await Promise.all(coarse);
      await fill();
    });
    return ready;
  }
  if (!lazy) start();
  let firstF = null;      // where it was first asked to stand

  return {
    get ready() { return start(); },
    load: start,
    redraw: () => draw(),
    setProgress(p) {
      const f = Math.max(from, Math.min(count - 1, p * (count - 1)));
      // a lazy sequence fetches only the frame it is asked to show until load() is called, or until
      // it is actually being moved through
      if (firstF === null) firstF = f;
      if (!lazy || Math.abs(f - firstF) > 1.5) start();
      const i = blend ? Math.min(count - 1, Math.floor(f)) : Math.round(f);
      const fr = blend ? f - i : 0;
      if (i === current && Math.abs(fr - frac) < 0.004) return;
      if (i !== current) dirSign = i > current ? 1 : -1;
      // how fast the frames are going by (frames per call, smoothed; a pause in the scroll resets it)
      const now = performance.now();
      speed = now - lastT > 150 ? 0 : speed * 0.8 + Math.abs(i - current) * 0.2;
      lastT = now;
      // once the scroll stops, every frame around the page is decoded again (the right one replaces its
      // stand-in as soon as it is ready)
      clearTimeout(settle);
      settle = setTimeout(() => { speed = 0; tend(); }, 160);
      current = i; frac = fr;
      tend();
      if (!frames[i]) load(i);
      if (blend && i + 1 < count && !frames[i + 1]) load(i + 1);
      draw();
    },
  };
}
