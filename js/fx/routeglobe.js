// Planes flying between the places we work with, across the whole background of "Our difference"
// (About page). No globe: the places are laid out flat by longitude and latitude over the section,
// each route a curved dotted line with a plane travelling along it. Plain 2-D canvas, ~30 frames a
// second and only while on screen.
const CITIES = {
  Surat: [21.17, 72.83], Delhi: [28.61, 77.21], Mumbai: [19.08, 72.88],
  Guangzhou: [23.13, 113.26], Yiwu: [29.31, 120.08], Shenzhen: [22.54, 114.06],
  Dubai: [25.2, 55.27], Singapore: [1.35, 103.82], Rotterdam: [51.92, 4.48],
  'New York': [40.71, -74.0], Sydney: [-33.87, 151.21],
};
const HOME = ['Surat', 'Guangzhou'];
const NO_LABEL = ['Shenzhen', 'Mumbai', 'Delhi'];      // (too close to Guangzhou and Surat to name)
const ROUTES = [['Guangzhou', 'Surat'], ['Yiwu', 'Surat'], ['Shenzhen', 'Delhi'], ['Surat', 'Dubai'], ['Surat', 'Rotterdam'],
  ['Guangzhou', 'Singapore'], ['Mumbai', 'New York'], ['Guangzhou', 'Sydney'], ['Dubai', 'Rotterdam'], ['Singapore', 'Sydney']];

export async function routeGlobe(canvas, { phone = false } = {}) {
  const g = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LON = [-80, 158], LAT = [-40, 58];
  let W = 0, H = 0, dpr = 1, pos = {};
  const size = () => {
    dpr = Math.min(devicePixelRatio || 1, phone ? 1.5 : 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // the places spread over the whole section, with a margin
    const mx = W * 0.06, my = H * 0.12;
    pos = Object.fromEntries(Object.entries(CITIES).map(([k, [la, lo]]) => [k, [
      mx + ((lo - LON[0]) / (LON[1] - LON[0])) * (W - 2 * mx),
      my + ((LAT[1] - la) / (LAT[1] - LAT[0])) * (H - 2 * my)]]));
  };
  size();
  new ResizeObserver(size).observe(canvas);

  // a route: a quadratic curve bowing upward (more for longer hops)
  const curve = (a, b) => {
    const [x1, y1] = pos[a], [x2, y2] = pos[b], d = Math.hypot(x2 - x1, y2 - y1);
    return [x1, y1, (x1 + x2) / 2, Math.min(y1, y2) - d * 0.28, x2, y2];
  };
  const at = (c, t) => {
    const u = 1 - t;
    return [u * u * c[0] + 2 * u * t * c[2] + t * t * c[4], u * u * c[1] + 2 * u * t * c[3] + t * t * c[5]];
  };
  const routes = ROUTES.map(([a, b], i) => ({ a, b, off: i / ROUTES.length, speed: 0.05 + (i % 3) * 0.012 }));
  const plane = (x, y, ang, s) => {
    g.save(); g.translate(x, y); g.rotate(ang); g.scale(s, s);
    g.beginPath();
    g.moveTo(9, 0); g.lineTo(1.5, -1.6); g.lineTo(-1, -8); g.lineTo(-3.5, -8); g.lineTo(-2, -1.6); g.lineTo(-6.5, -1.4); g.lineTo(-8.5, -4);
    g.lineTo(-10, -4); g.lineTo(-9, 0); g.lineTo(-10, 4); g.lineTo(-8.5, 4); g.lineTo(-6.5, 1.4); g.lineTo(-2, 1.6); g.lineTo(-3.5, 8); g.lineTo(-1, 8); g.lineTo(1.5, 1.6);
    g.closePath(); g.fill(); g.restore();
  };

  let last = 0, raf = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 32) return;                        // ~30 fps
    last = t;
    const time = reduce ? 0 : t / 1000;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    for (const r of routes) {
      const c = curve(r.a, r.b);
      g.strokeStyle = 'rgba(59,44,255,0.22)'; g.lineWidth = 1.2; g.setLineDash([3, 5]);
      g.beginPath(); g.moveTo(c[0], c[1]); g.quadraticCurveTo(c[2], c[3], c[4], c[5]); g.stroke(); g.setLineDash([]);
      if (reduce) continue;
      const f = (time * r.speed + r.off) % 1, p = at(c, f), q = at(c, Math.min(1, f + 0.01));
      // a short fading trail behind the plane
      for (let k = 1; k <= 6; k++) {
        const s = at(c, Math.max(0, f - k * 0.012));
        g.fillStyle = `rgba(59,44,255,${(0.28 - k * 0.04).toFixed(2)})`;
        g.beginPath(); g.arc(s[0], s[1], 1.6, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(32,22,170,0.7)';
      plane(p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]), phone ? 0.8 : 1);
    }
    g.font = '11px "Share Tech Mono", monospace';
    for (const [name, [x, y]] of Object.entries(pos)) {
      const home = HOME.includes(name), rr = home ? 3.4 : 2.6, pulse = 3 + 2 * Math.sin(time * 2 + x);
      g.fillStyle = home ? 'rgba(226,35,26,0.85)' : 'rgba(59,44,255,0.7)';
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = home ? 'rgba(226,35,26,0.3)' : 'rgba(59,44,255,0.25)';
      g.beginPath(); g.arc(x, y, rr + pulse, 0, Math.PI * 2); g.stroke();
      if ((!phone || home) && !NO_LABEL.includes(name)) { g.fillStyle = 'rgba(20,20,60,0.45)'; g.fillText(name.toUpperCase(), x + 7, y - 6); }
    }
  }
  // only while the section is on screen
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!e.isIntersecting && raf) { cancelAnimationFrame(raf); raf = 0; }
  }).observe(canvas);
}
