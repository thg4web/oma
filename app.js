/* Observer's Moon Atlas prototype.
   Globe: VMA WAC tiles (DEV ONLY, license pending), lit by the real Sun position for the chosen
   date from ephem.js. Features: IAU/USGS gazetteer export in data/dev (DEV ONLY).
   No DEM relighting yet: the Sun lights the sphere, crater walls cast no shadows. */
(function () {
  "use strict";
  var E = window.OMA && window.OMA.ephem;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var MOON_D_KM = 3474.8, MOON_R_KM = 1737.4;

  /* ---- helpers ---------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function vec(lat, lon) {
    var cl = Math.cos(lat * D2R);
    return [cl * Math.sin(lon * D2R), Math.sin(lat * D2R), cl * Math.cos(lon * D2R)];
  }
  function fmtLat(v) { return Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "N" : "S"); }
  function fmtLon(v) { return Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "E" : "W"); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fmtLocal(d) {
    return d ? d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "none in range";
  }
  function fmtUTC(d) { return d.toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
  function toLocalInput(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtKm(k) { return k >= 100 ? Math.round(k) + " km" : k.toFixed(1) + " km"; }
  function rows(el, pairs) {
    el.textContent = "";
    pairs.forEach(function (p) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = p[0]; dd.textContent = p[1];
      el.appendChild(dt); el.appendChild(dd);
    });
  }

  if (!E) { $("fName").textContent = "EPHEMERIS FAILED TO LOAD"; return; }

  /* ---- state ---------------------------------------------------------------- */
  var view = { lon0: 0, lat0: 0, zoom: 1, sx: 1, sy: 1, term: true, grid: false, labels: true, density: 0.5,
               bright: 1.6, libr: true, free: false, manualSun: false, sunLon: 35, hidden: {},
               scale: true, shortNames: false, marks: true, centerLabels: false, gridStep: 30 };
  var ov = { on: false, opacity: 0.5, data: null, w: 0, h: 0, loading: false };
  var S = { date: new Date(), live: false, st: null, sunVec: [0, 0, 1] };
  var FE = [], sel = null, matches = [], matchIdx = -1;
  var measure = { on: false, pts: [] };
  // Default observer is Greenwich, a neutral place. Visitors set their own, saved in their browser only.
  var obs = { lat: parseFloat(lsGet("oma-obs-lat", "51.48")), lon: parseFloat(lsGet("oma-obs-lon", "0")) };
  var canvas = $("globe"), ctx = canvas.getContext("2d");
  var off = document.createElement("canvas"), octx = off.getContext("2d");
  var W = 0, H = 0, dpr = 1, stars = [], pending = false, interacting = false, ixTimer = null;

  /* ---- layers and tiles --------------------------------------------------- */
  var LAYERS = [
    { id: "wac", name: "WAC, high Sun (flat, lit by the Sun setting)", short: "WAC", base: "data/tiles/wac/", relit: true },
    { id: "lowsun", name: "WAC, low Sun (relief, shadows baked in)", short: "WAC low Sun", base: "data/tiles/wac_lowsun/", relit: false }
  ];
  var TILE_PX = 512, DEEP_Z = 5, TCOLS = 64, TROWS = 32;
  var layer = LAYERS[0], G = null, TIL = new Array(TCOLS * TROWS), TILFAIL = {}, tilePending = {}, pendingN = 0;
  var tileOrder = [], loadToken = 0;
  var tcanvas = document.createElement("canvas"); tcanvas.width = tcanvas.height = TILE_PX;
  var tctx = tcanvas.getContext("2d", { willReadFrequently: true });

  function setLevel(t) { $("sLevel").textContent = t; }

  function loadLevel(lay, z, done) {
    var cols = Math.pow(2, z + 1), nrows = Math.pow(2, z), w = cols * TILE_PX, h = nrows * TILE_PX;
    var d = new Uint8Array(w * h), left = cols * nrows, failed = 0;
    function finish() { if (--left === 0) done(failed < cols * nrows / 2 ? { d: d, w: w, h: h, z: z } : null); }
    function one(x, y) {
      var im = new Image();
      im.onload = function () {
        tctx.drawImage(im, 0, 0);
        var px = tctx.getImageData(0, 0, TILE_PX, TILE_PX).data, ox = x * TILE_PX, oy = y * TILE_PX;
        for (var j = 0; j < TILE_PX; j++) {
          var row = (oy + j) * w + ox, src = j * TILE_PX * 4;
          for (var i = 0; i < TILE_PX; i++) d[row + i] = px[src + i * 4];
        }
        finish();
      };
      im.onerror = function () { failed++; finish(); };
      im.src = lay.base + z + "/" + x + "/" + y + ".jpg";
    }
    for (var y = 0; y < nrows; y++) for (var x = 0; x < cols; x++) one(x, y);
  }

  function loadLayer(lay, quiet) {
    var tok = ++loadToken, prev = layer;
    layer = lay; TIL = new Array(TCOLS * TROWS); TILFAIL = {}; tilePending = {}; pendingN = 0; tileOrder = [];
    setLevel(lay.name.split(",")[0] + " loading");
    loadLevel(lay, 3, function (g) {
      if (tok !== loadToken) return;
      if (!g) {
        setLevel("layer not available");
        if (prev !== lay) { layer = prev; $("layerBase").value = prev.id; }
        return;
      }
      G = g; setLevel(lay.short + " z3"); requestDraw();
      loadLevel(lay, 4, function (g2) {
        if (tok !== loadToken || !g2) return;
        G = g2; setLevel(lay.short + " z4"); requestDraw();
      });
    });
    $("layerNote").textContent = lay.relit ? "Lit by the Sun setting. The terminator and phase follow the date."
      : "Lighting is baked into this map, so the date does not relight it. Good for relief, not for phase.";
  }

  function reqTile(tx, ty) {
    var k = ty * TCOLS + tx;
    if (TIL[k] || tilePending[k] || TILFAIL[k] || pendingN >= 24) return;
    tilePending[k] = 1; pendingN++;
    var tok = loadToken, im = new Image();
    im.onload = function () {
      pendingN--; delete tilePending[k];
      if (tok !== loadToken) return;
      tctx.drawImage(im, 0, 0);
      var px = tctx.getImageData(0, 0, TILE_PX, TILE_PX).data, d = new Uint8Array(TILE_PX * TILE_PX);
      for (var i = 0; i < d.length; i++) d[i] = px[i * 4];
      TIL[k] = d; tileOrder.push(k);
      if (tileOrder.length > 450) TIL[tileOrder.shift()] = undefined;
      requestDraw();
    };
    im.onerror = function () { pendingN--; delete tilePending[k]; TILFAIL[k] = 1; };
    im.src = layer.base + DEEP_Z + "/" + tx + "/" + ty + ".jpg";
  }

  function wantTiles() {
    if (view.zoom < 1.8 || !W) return;
    var seen = {};
    for (var gx = 0; gx <= 12; gx++) for (var gy = 0; gy <= 8; gy++) {
      var p = fromScreen(W * gx / 12, H * gy / 8);
      if (!p) continue;
      var u = (p.lon + 180) / 360 * TCOLS, v = (90 - p.lat) / 180 * TROWS;
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var tx = ((Math.floor(u) + dx) % TCOLS + TCOLS) % TCOLS, ty = Math.floor(v) + dy;
        if (ty < 0 || ty >= TROWS) continue;
        var k = ty * TCOLS + tx;
        if (!seen[k]) { seen[k] = 1; reqTile(tx, ty); }
      }
    }
  }

  function sampleGray(lat, lon) {
    if (view.zoom >= 1.8) {
      var u = (lon + 180) / 360 * TCOLS, v = (90 - lat) / 180 * TROWS;
      var tx = Math.floor(u), ty = Math.floor(v);
      if (tx >= 0 && tx < TCOLS && ty >= 0 && ty < TROWS) {
        var t = TIL[ty * TCOLS + tx];
        if (t) {
          var fx = (u - tx) * TILE_PX - 0.5, fy = (v - ty) * TILE_PX - 0.5;
          var ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
          var x0 = ix < 0 ? 0 : ix, x1 = ix + 1 > 511 ? 511 : ix + 1, y0 = iy < 0 ? 0 : iy, y1 = iy + 1 > 511 ? 511 : iy + 1;
          var a = t[y0 * 512 + x0], b = t[y0 * 512 + x1], c = t[y1 * 512 + x0], d = t[y1 * 512 + x1];
          return ((a + (b - a) * ax) * (1 - ay) + (c + (d - c) * ax) * ay) / 255;
        }
      }
    }
    if (G) {
      var gw = G.w, gh = G.h, gd = G.d;
      var gx2 = (lon + 180) / 360 * gw - 0.5, gy2 = (90 - lat) / 180 * gh - 0.5;
      var i2 = Math.floor(gx2), j2 = Math.floor(gy2), fx2 = gx2 - i2, fy2 = gy2 - j2;
      var k2 = (i2 + 1 + gw) % gw; i2 = (i2 + gw) % gw;
      var l2 = Math.min(gh - 1, j2 + 1); j2 = Math.max(0, j2);
      var p0 = gd[j2 * gw + i2], p1 = gd[j2 * gw + k2], p2 = gd[l2 * gw + i2], p3 = gd[l2 * gw + k2];
      return ((p0 + (p1 - p0) * fx2) * (1 - fy2) + (p2 + (p3 - p2) * fx2) * fy2) / 255;
    }
    return 0.3;
  }

  /* ---- geology overlay (USGS Unified Geologic Map, CC0) ------------------------------------ */
  function loadOverlay(done) {
    if (ov.data || ov.loading) { if (done) done(); return; }
    ov.loading = true;
    var im = new Image();
    im.onload = function () {
      var c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
      var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
      ov.data = x.getImageData(0, 0, c.width, c.height).data; ov.w = c.width; ov.h = c.height; ov.loading = false;
      requestDraw(); if (done) done();
    };
    im.onerror = function () { ov.loading = false; $("layerNote").textContent = "Geology overlay could not be loaded."; $("ovOn").checked = false; ov.on = false; };
    im.src = "data/overlays/geology-usgs-4k.jpg";
  }

  /* ---- view geometry ---------------------------------------------------------- */
  function geom() { return { cx: W / 2, cy: H / 2, R: Math.min(W, H) * 0.46 * view.zoom }; }
  function toView(lat, lon) {
    var p = vec(lat, lon), cl = Math.cos(view.lon0 * D2R), sl = Math.sin(view.lon0 * D2R);
    var ca = Math.cos(view.lat0 * D2R), sa = Math.sin(view.lat0 * D2R);
    var x1 = p[0] * cl - p[2] * sl, z1 = p[0] * sl + p[2] * cl;
    return [x1, p[1] * ca - z1 * sa, p[1] * sa + z1 * ca];
  }
  function fromScreen(px, py) {
    var g = geom(), vx = view.sx * (px - g.cx) / g.R, vy = view.sy * (g.cy - py) / g.R, r2 = vx * vx + vy * vy;
    if (r2 >= 1) return null;
    var vz = Math.sqrt(1 - r2);
    var ca = Math.cos(view.lat0 * D2R), sa = Math.sin(view.lat0 * D2R), cl = Math.cos(view.lon0 * D2R), sl = Math.sin(view.lon0 * D2R);
    var y = vy * ca + vz * sa, z1 = -vy * sa + vz * ca, x = vx * cl + z1 * sl, z = -vx * sl + z1 * cl;
    return { lat: Math.asin(y) * R2D, lon: Math.atan2(x, z) * R2D };
  }
  function toScreen(lat, lon) {
    var g = geom(), v = toView(lat, lon);
    return { x: g.cx + view.sx * g.R * v[0], y: g.cy - view.sy * g.R * v[1], z: v[2] };
  }

  /* ---- drawing ------------------------------------------------------------------ */
  function renderSphere() {
    var cap = interacting ? 640 : 1200, scale = Math.min(1, cap / Math.max(W, H));
    var ow = Math.max(1, Math.round(W * scale)), oh = Math.max(1, Math.round(H * scale));
    if (off.width !== ow || off.height !== oh) { off.width = ow; off.height = oh; }
    var img = octx.createImageData(ow, oh), data = img.data;
    var g = geom(), R = g.R * scale, cx = g.cx * scale, cy = g.cy * scale;
    var ca = Math.cos(view.lat0 * D2R), sa = Math.sin(view.lat0 * D2R), cl = Math.cos(view.lon0 * D2R), sl = Math.sin(view.lon0 * D2R);
    var sv = S.sunVec, term = view.term, gain = view.bright, ovOn = ov.on && !!ov.data, oa = ov.opacity;
    var yMin = Math.max(0, Math.floor(cy - R) - 1), yMax = Math.min(oh - 1, Math.ceil(cy + R) + 1);
    var xMin = Math.max(0, Math.floor(cx - R) - 1), xMax = Math.min(ow - 1, Math.ceil(cx + R) + 1);
    for (var py = yMin; py <= yMax; py++) {
      var vy = view.sy * (cy - py) / R;
      for (var px = xMin; px <= xMax; px++) {
        var vx = view.sx * (px - cx) / R, r2 = vx * vx + vy * vy;
        if (r2 >= 1) continue;
        var vz = Math.sqrt(1 - r2);
        var y = vy * ca + vz * sa, z1 = -vy * sa + vz * ca, x = vx * cl + z1 * sl, z = -vx * sl + z1 * cl;
        var la = Math.asin(y) * R2D, lo = Math.atan2(x, z) * R2D, alb = sampleGray(la, lo);
        var lam = term ? Math.max(0, x * sv[0] + y * sv[1] + z * sv[2]) : Math.pow(vz, 0.45);
        var shade = alb * (0.012 + 0.988 * lam) * gain;
        var edge = Math.min(1, (1 - Math.sqrt(r2)) * R / 1.5);
        var v = Math.min(1, Math.max(0, shade)) * 255, k = (py * ow + px) * 4;
        var rr = v, gg = v * 0.985, bb = v * 0.955;
        if (ovOn) {
          var oi = ((Math.min(ov.h - 1, Math.max(0, Math.floor((90 - la) / 180 * ov.h)))) * ov.w + Math.min(ov.w - 1, Math.floor((lo + 180) / 360 * ov.w))) * 4;
          var lit = Math.min(1, v / 255 * 1.6) * oa;
          rr = rr * (1 - oa) + ov.data[oi] * lit; gg = gg * (1 - oa) + ov.data[oi + 1] * lit; bb = bb * (1 - oa) + ov.data[oi + 2] * lit;
        }
        data[k] = rr; data[k + 1] = gg; data[k + 2] = bb; data[k + 3] = 255 * edge;
      }
    }
    octx.putImageData(img, 0, 0);
  }

  function drawGrid() {
    ctx.save(); ctx.strokeStyle = "rgba(124,184,234,0.38)"; ctx.lineWidth = 1;
    var la, lo, first;
    function run(pts) {
      ctx.beginPath(); first = true;
      pts.forEach(function (q) {
        if (q.z <= 0) { first = true; return; }
        if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    }
    var gs = view.gridStep;
    for (la = -90 + gs; la < 90; la += gs) { var row = []; for (lo = -180; lo <= 180; lo += 3) row.push(toScreen(la, lo)); run(row); }
    for (lo = -180; lo < 180; lo += gs) { var col = []; for (la = -90; la <= 90; la += 3) col.push(toScreen(la, lo)); run(col); }
    ctx.restore();
  }

  var SHORT_RE = /^(Mare|Mons|Montes|Rima|Rimae|Vallis|Dorsum|Dorsa|Catena|Palus|Sinus|Lacus|Oceanus|Promontorium|Rupes|Lacuna|Planitia|Fossa)\s+/;
  function shortName(n) { var m = n.replace(SHORT_RE, ""); return m.length >= 3 ? m : n; }

  function drawScale(g) {
    if (!view.scale) return;
    var pxPerKm = 2 * g.R / MOON_D_KM, cand = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000], km = cand[0];
    for (var i = 0; i < cand.length; i++) { km = cand[i]; if (km * pxPerKm >= 90) break; }
    var len = km * pxPerKm, x0 = 14, y0 = H - 16;
    ctx.save(); ctx.strokeStyle = "#cfe4fa"; ctx.fillStyle = "#cfe4fa"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 5); ctx.stroke();
    ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textBaseline = "bottom"; ctx.fillText(km + " km", x0, y0 - 7);
    ctx.restore();
  }

  function drawLabels(g) {
    if (!FE.length) return;
    var minPx = 5 + Math.pow(1 - view.density, 1.5) * 70, pxPerKm = 2 * g.R / MOON_D_KM;
    var placed = [], count = 0;
    ctx.save();
    ctx.font = '600 12px "Exo 2", system-ui, sans-serif'; ctx.textBaseline = "middle";
    function overlaps(r) {
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];
        if (r[0] < p[0] + p[2] && r[0] + r[2] > p[0] && r[1] < p[1] + p[3] && r[1] + r[3] > p[1]) return true;
      }
      return false;
    }
    function label(f, isSel) {
      var p = toScreen(f.lat, f.lon);
      if (p.z < 0.08 || p.x < -40 || p.x > W + 40 || p.y < -20 || p.y > H + 20) return;
      var sizePx = f.diam * pxPerKm;
      if (isSel) {
        ctx.strokeStyle = "#ffd24d"; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(8, Math.min(sizePx / 2, 400)), 0, Math.PI * 2); ctx.stroke();
      }
      if (view.density <= 0) return;                 // slider fully left: no label text at all, selection ring stays
      if (!view.labels && !isSel) return;
      var nm = view.shortNames ? shortName(f.name) : f.name;
      var w = ctx.measureText(nm).width, tx = view.centerLabels ? p.x - w / 2 : p.x + 8, r = [tx, p.y - 7, w, 14];
      if (!isSel && overlaps(r)) return;
      placed.push(r);
      if (view.marks && !view.centerLabels) { ctx.fillStyle = "#ff5a4d"; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.strokeText(nm, tx, p.y);
      ctx.fillStyle = isSel ? "#ffd24d" : "#f3e9a0"; ctx.fillText(nm, tx, p.y);
    }
    if (view.labels && view.density > 0) {
      for (var i = 0; i < FE.length && count < 220; i++) {
        var f = FE[i];
        if (f.diam * pxPerKm < minPx) break;
        if (view.hidden[f.type] || f === sel) continue;
        var before = placed.length; label(f, false); if (placed.length > before) count++;
      }
    }
    if (sel) label(sel, true);
    ctx.restore();
  }

  function gcPoints(a, b, n) {
    var va = vec(a.lat, a.lon), vb = vec(b.lat, b.lon);
    var dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])), om = Math.acos(dot), out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, s1 = om ? Math.sin((1 - t) * om) / Math.sin(om) : 1 - t, s2 = om ? Math.sin(t * om) / Math.sin(om) : t;
      var v = [s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]];
      out.push({ lat: Math.asin(Math.max(-1, Math.min(1, v[1]))) * R2D, lon: Math.atan2(v[0], v[2]) * R2D });
    }
    return out;
  }
  function distBearing(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    var h = Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(dl / 2), 2);
    var c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
    var br = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D;
    return { km: c * MOON_R_KM, bearing: (br + 360) % 360 };
  }
  function drawMeasure() {
    if (!measure.pts.length) return;
    ctx.save(); ctx.strokeStyle = "#4dd2ff"; ctx.fillStyle = "#4dd2ff"; ctx.lineWidth = 2;
    measure.pts.forEach(function (p) {
      var s = toScreen(p.lat, p.lon);
      if (s.z > 0) { ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill(); }
    });
    if (measure.pts.length === 2) {
      var pts = gcPoints(measure.pts[0], measure.pts[1], 48).map(function (p) { return toScreen(p.lat, p.lon); });
      ctx.beginPath(); var first = true;
      pts.forEach(function (q) { if (q.z <= 0) { first = true; return; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); });
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---- field of view frames ---------------------------------------------------------- */
  var PRESETS = [
    { id: "s50", name: "Seestar S50 (camera)", mode: "camera", fl: 250, pw: 1920, ph: 1080, ps: 2.9 },
    { id: "s30", name: "Seestar S30 Pro (camera, approximate, check ZWO specs)", mode: "camera", fl: 160, pw: 3840, ph: 2160, ps: 2.9 },
    { id: "cam", name: "Custom camera", mode: "camera", fl: 1000, pw: 4000, ph: 3000, ps: 3.76 },
    { id: "eye", name: "Custom eyepiece (true field circle)", mode: "eye", scope: 1000, eyeFl: 25, afov: 52 }
  ];
  var fov = { on: false, preset: lsGet("oma-fov-preset", "s50"), vals: {}, rot: 0 };
  try { fov.vals = JSON.parse(lsGet("oma-fov-vals", "{}")) || {}; } catch (e) { fov.vals = {}; }
  function fovPreset() { return PRESETS.filter(function (p) { return p.id === fov.preset; })[0] || PRESETS[0]; }
  function fovGet() {
    var p = fovPreset(), o = {}, k;
    for (k in p) o[k] = p[k];
    var v = fov.vals[p.id] || {};
    for (k in v) o[k] = v[k];
    return o;
  }
  function fovSize() { // degrees {w, h}, plus info text
    var p = fovGet();
    if (p.mode === "eye") {
      var tf = p.afov / (p.scope / p.eyeFl);
      return { w: tf, h: tf, circle: true, text: "Magnification " + (p.scope / p.eyeFl).toFixed(0) + "x, true field " + tf.toFixed(2) + "°" };
    }
    var w = 2 * Math.atan(p.pw * p.ps / 1000 / (2 * p.fl)) * R2D, h = 2 * Math.atan(p.ph * p.ps / 1000 / (2 * p.fl)) * R2D;
    return { w: w, h: h, circle: false, text: w.toFixed(2) + "° × " + h.toFixed(2) + "°, " + (p.ps / p.fl * 206.265).toFixed(2) + " arcsec/px" };
  }
  function drawFov(g) {
    if (!fov.on || !S.st) return;
    var f = fovSize(), diam = S.st.diamDeg, c = { x: g.cx, y: g.cy };
    if (sel) { var s = toScreen(sel.lat, sel.lon); if (s.z > 0) c = s; }
    var pw = 2 * g.R * f.w / diam, ph = 2 * g.R * f.h / diam;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(fov.rot * D2R);
    ctx.strokeStyle = "#ffd24d"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    if (f.circle) { ctx.beginPath(); ctx.arc(0, 0, pw / 2, 0, Math.PI * 2); ctx.stroke(); }
    else ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    ctx.setLineDash([]); ctx.rotate(-fov.rot * D2R);
    ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.fillStyle = "#ffd24d"; ctx.textBaseline = "bottom";
    ctx.fillText(fovGet().name || "Frame", -pw / 2, -ph / 2 - 4);
    ctx.restore();
  }

  function draw() {
    pending = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--stage") || "#03050a";
    ctx.fillRect(0, 0, W, H);
    stars.forEach(function (s) { ctx.fillStyle = "rgba(255,255,255," + s.a + ")"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); });
    renderSphere();
    ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H);
    var g = geom();
    if (view.grid) drawGrid();
    drawLabels(g); drawMeasure(); drawFov(g); drawScale(g);
    updateField(g);
    if (!interacting) wantTiles();
  }
  function requestDraw() { if (!pending) { pending = true; requestAnimationFrame(draw); } }
  function bumpInteract() {
    interacting = true; clearTimeout(ixTimer);
    ixTimer = setTimeout(function () { interacting = false; requestDraw(); scheduleList(); }, 180);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    stars = [];
    var n = Math.max(90, Math.min(260, Math.round(W * H / 5200)));
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.25, a: (Math.random() * 0.5 + 0.25).toFixed(2) });
    requestDraw();
  }

  function updateField(g) {
    var diam = S.st ? S.st.diamDeg : 0.52, arc = W / (2 * g.R) * diam * 60, kmpx = MOON_D_KM / (2 * g.R);
    $("sField").textContent = arc.toFixed(arc < 10 ? 1 : 0) + "', " + kmpx.toFixed(2) + "km/px";
    $("zoomOut").textContent = view.zoom.toFixed(1) + ":1";
  }

  /* ---- date, ephemeris ------------------------------------------------------------------ */
  var infoTimer = null;
  function recompute() {
    S.st = E.compute(S.date);
    var sl = view.manualSun ? { lat: 0, lon: view.sunLon } : { lat: S.st.sunLat, lon: S.st.sunLon };
    S.sunVec = vec(sl.lat, sl.lon);
    applyCentering();
    $("sunOut").textContent = view.manualSun ? Math.abs(view.sunLon) + "°" + (view.sunLon >= 0 ? "E" : "W") : "auto " + S.st.sunLon.toFixed(1) + "°";
    $("sDate").textContent = S.date.getFullYear() + "-" + pad(S.date.getMonth() + 1) + "-" + pad(S.date.getDate());
    $("sTime").textContent = pad(S.date.getHours()) + ":" + pad(S.date.getMinutes()) + ":" + pad(S.date.getSeconds());
    drawPhaseIcon();
    clearTimeout(infoTimer); infoTimer = setTimeout(function () { refreshSun(); refreshEphem(); }, 120);
    requestDraw();
  }
  function applyCentering() {
    if (view.free) return;
    if (view.libr && S.st) { view.lon0 = S.st.libLon; view.lat0 = S.st.libLat; } else { view.lon0 = 0; view.lat0 = 0; }
  }
  function setDate(d) { S.date = d; $("dt").value = toLocalInput(d); recompute(); }

  function drawPhase(c, deg) {
    var x = c.getContext("2d"), r = 12, cx = 15, cy = 15, p = deg * D2R;
    x.clearRect(0, 0, 30, 30);
    x.fillStyle = "#1b2436"; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.save(); x.translate(cx, cy);
    if (deg > 180) x.scale(-1, 1);
    x.fillStyle = "#f1ead0"; x.beginPath();
    x.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    x.ellipse(0, 0, Math.max(0.01, r * Math.abs(Math.cos(p))), r, 0, Math.PI / 2, -Math.PI / 2, Math.cos(p) > 0);
    x.fill(); x.restore();
  }
  function drawPhaseIcon() {
    drawPhase($("phaseIcon"), S.st.phaseDeg);
    $("phaseIcon").title = "Moon " + (S.st.illum * 100).toFixed(0) + "% illuminated";
  }

  /* ---- feature panel ----------------------------------------------------------------------- */
  function showFeature() {
    var f = sel;
    if (!f) return;
    $("fName").textContent = f.name.toUpperCase();
    $("fSub").textContent = f.type;
    rows($("fIdentity"), [["Type", f.type], ["IAU type code", f.code], ["Status", f.status], ["Quadrangle", f.quad], ["Gazetteer ID", f.id]]);
    rows($("fPosition"), [["Latitude", fmtLat(f.lat)], ["Longitude", fmtLon(f.lon)]]);
    rows($("fSize"), [["Diameter", f.diam ? fmtKm(f.diam) : "not given"]]);
    $("fOrigin").textContent = f.origin || "Not given in the gazetteer.";
    $("fInfo").textContent = f.info || "";
    $("notesName").textContent = "Notes: " + f.name;
    $("notes").value = ""; renderNotes();
    renderNeighbors(f);
    refreshSun();
    requestDraw();
  }

  var COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function renderNeighbors(f) {
    var list = [];
    for (var i = 0; i < FE.length; i++) {
      var g = FE[i]; if (g === f || g.diam < 3) continue;
      var d = distBearing(f, g); if (d.km < 400) list.push({ f: g, km: d.km, br: d.bearing });
    }
    list.sort(function (a, b) { return a.km - b.km; });
    var ul = $("fNeighbors"); ul.textContent = "";
    list.slice(0, 8).forEach(function (n) {
      var li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.textContent = n.f.name;
      var s = document.createElement("span"); s.textContent = n.km.toFixed(0) + " km " + COMPASS[Math.round(n.br / 45) % 8];
      b.appendChild(s); b.addEventListener("click", function () { select(n.f, true); });
      li.appendChild(b); ul.appendChild(li);
    });
    if (!list.length) { var e = document.createElement("li"); e.textContent = "No larger named features within 400 km."; ul.appendChild(e); }
  }

  /* ---- notes: several per feature, information or observation ------------------------------------ */
  function getNotes() {
    if (!sel) return [];
    try { return JSON.parse(lsGet("oma-notes-" + sel.id, "[]")) || []; } catch (e) { return []; }
  }
  function putNotes(a) { if (sel) lsSet("oma-notes-" + sel.id, JSON.stringify(a)); }
  function renderNotes() {
    var ul = $("nlist"), a = getNotes(); ul.textContent = "";
    a.slice().reverse().forEach(function (n, ri) {
      var idx = a.length - 1 - ri, li = document.createElement("li");
      var h = document.createElement("div"); h.className = "nhead";
      var t = document.createElement("strong"); t.textContent = n.type === "obs" ? "Observation" : "Information";
      var w = document.createElement("span"); w.textContent = n.type === "obs" ? "for " + fmtLocal(new Date(n.when)) : "saved " + fmtLocal(new Date(n.saved));
      var del = document.createElement("button"); del.type = "button"; del.textContent = "Delete";
      del.addEventListener("click", function () { var b = getNotes(); b.splice(idx, 1); putNotes(b); renderNotes(); });
      h.appendChild(t); h.appendChild(w); h.appendChild(del);
      var p = document.createElement("p"); p.textContent = n.text;
      li.appendChild(h); li.appendChild(p); ul.appendChild(li);
    });
  }
  $("noteSave").addEventListener("click", function () {
    var text = $("notes").value.trim(); if (!text || !sel) return;
    var a = getNotes(); a.push({ type: $("noteType").value, text: text, saved: Date.now(), when: S.date.getTime() });
    putNotes(a); $("notes").value = ""; renderNotes();
  });
  $("noteNew").addEventListener("click", function () { $("notes").value = ""; $("notes").focus(); });

  function sunNote(e) {
    if (e < 0) return "The Sun is below the horizon here, so this spot is in night.";
    if (e < 3) return "At the terminator: the Sun is on the horizon, shadows are extremely long.";
    if (e < 12) return "Low Sun: long shadows, the best light for relief and small detail.";
    if (e < 30) return "Moderate Sun: good contrast with shorter shadows.";
    return "High Sun: flat lighting, best for albedo and ray systems, poor for relief.";
  }
  function refreshSun() {
    if (!sel || !S.st) return;
    var e = E.sunElevation(S.st, sel.lat, sel.lon);
    rows($("fSun"), [["Sun elevation", e.toFixed(1) + "°"], ["Sun incidence angle", (90 - e).toFixed(1) + "°"], ["Next sunrise here", "working"], ["Next sunset here", "working"]]);
    $("fSunNote").textContent = sunNote(e);
    var f = sel, d = S.date;
    setTimeout(function () {
      if (f !== sel || d !== S.date) return;
      var ev = E.sunEvents(d, f.lat, f.lon, 32);
      function when(t) { return t ? fmtLocal(t) + " (in " + ((t - d) / 86400000).toFixed(1) + " days)" : "none in the next 32 days"; }
      rows($("fSun"), [["Sun elevation", e.toFixed(1) + "°"], ["Sun incidence angle", (90 - e).toFixed(1) + "°"], ["Next sunrise here", when(ev.rise)], ["Next sunset here", when(ev.set)]]);
    }, 0);
  }

  function refreshEphem() {
    if ($("paneEphem").hidden || !S.st) return;
    var st = S.st, oi = E.observerInfo(S.date, obs.lat, obs.lon);
    var age = (S.date - E.lastNewMoon(S.date)) / 86400000;
    function hms(h) { var hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return hh + "h " + pad(mm) + "m"; }
    rows($("ephTable"), [
      ["Local time", fmtLocal(S.date)], ["UTC", fmtUTC(S.date)],
      ["Illuminated", (st.illum * 100).toFixed(1) + "%"], ["Age", age.toFixed(1) + " days"],
      ["Phase angle", st.phaseAngle.toFixed(1) + "°"], ["Elongation", st.elongation.toFixed(1) + "°"],
      ["Distance", Math.round(st.distKm).toLocaleString() + " km"], ["Apparent diameter", (st.diamDeg * 60).toFixed(2) + "'"],
      ["Libration longitude", fmtLon(st.libLon)], ["Libration latitude", fmtLat(st.libLat)],
      ["Sub-solar longitude", fmtLon(st.sunLon)], ["Sub-solar latitude", fmtLat(st.sunLat)],
      ["Colongitude", st.colong.toFixed(2) + "°"],
      ["Moon altitude here", oi.alt.toFixed(1) + "°"], ["Moon azimuth here", oi.az.toFixed(1) + "°"],
      ["Right ascension", hms(oi.ra)], ["Declination", oi.dec.toFixed(2) + "°"],
      ["Moonrise", fmtLocal(oi.rise)], ["Moonset", fmtLocal(oi.set)]
    ]);
    var names = { 0: "New Moon", 1: "First quarter", 2: "Full Moon", 3: "Last quarter" };
    var ul = $("phaseList"); ul.textContent = "";
    E.nextQuarters(S.date).forEach(function (q) {
      var li = document.createElement("li"), b = document.createElement("button"), c = document.createElement("canvas");
      c.width = c.height = 30; c.style.cssText = "width:22px;height:22px;flex:none";
      drawPhase(c, q.quarter * 90);
      b.type = "button"; b.title = "Go to this time";
      var n = document.createElement("strong"); n.textContent = names[q.quarter];
      var sp = document.createElement("span"); sp.textContent = fmtLocal(q.time);
      b.appendChild(c); b.appendChild(n); b.appendChild(sp);
      b.addEventListener("click", function () { setLive(false); setDate(q.time); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  /* ---- features: load, search, list -------------------------------------------------------------- */
  function loadFeatures() {
    fetch("data/features/features.json").then(function (r) { return r.json(); }).then(function (j) {
      FE = j.rows.map(function (r) {
        return { name: r[0], code: r[1], type: r[2], lat: r[3], lon: r[4], diam: r[5], quad: r[6], origin: r[7], status: r[8], info: r[9], id: r[10], lname: r[0].toLowerCase() };
      });
      buildFilter();
      var c = FE.filter(function (f) { return f.name === "Copernicus"; })[0] || FE[0];
      sel = c;
      applyUrlParams();
      showFeature(); requestDraw();
    }).catch(function () {
      $("fName").textContent = "FEATURES NOT LOADED";
      $("fSub").textContent = "Open this page through a web server so data/features/features.json can load.";
    });
  }
  // Deep links, used by the Lunar 100 page: ?f=name&lat=..&lon=..&zoom=..&date=ISO
  function applyUrlParams() {
    var p = new URLSearchParams(location.search), name = p.get("f"), lat = parseFloat(p.get("lat")), lon = parseFloat(p.get("lon"));
    var z = parseFloat(p.get("zoom")), dstr = p.get("date");
    if (dstr) { var d = new Date(dstr); if (!isNaN(d)) { setLive(false); setDate(d); } }
    if (name) {
      var ln = name.toLowerCase(), hit = FE.filter(function (f) { return f.lname === ln; })[0];
      if (!hit && isFinite(lat) && isFinite(lon)) hit = { name: name, code: "", type: "Lunar 100 target", lat: lat, lon: lon, diam: 0, quad: "", origin: "", status: "", info: "Position from the Lunar 100 list.", id: "L100-" + ln, lname: ln };
      if (hit) sel = hit;
    }
    if (isFinite(lat) && isFinite(lon)) { view.lon0 = lon; view.lat0 = lat; view.free = true; }
    if (isFinite(z)) setZoom(z);
  }
  function findMatches(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var a = [], b = [];
    for (var i = 0; i < FE.length; i++) {
      var k = FE[i].lname.indexOf(q);
      if (k === 0) a.push(FE[i]); else if (k > 0) b.push(FE[i]);
    }
    return a.concat(b);
  }
  function select(f, center) {
    sel = f;
    if (center) { view.lon0 = f.lon; view.lat0 = f.lat; view.free = true; }
    showFeature(); scheduleList();
  }
  $("find").addEventListener("input", function () {
    var m = findMatches($("find").value).slice(0, 25), dl = $("findList");
    dl.textContent = "";
    m.forEach(function (f) { var o = document.createElement("option"); o.value = f.name; dl.appendChild(o); });
  });
  function doFind(next) {
    if (!next) { matches = findMatches($("find").value); matchIdx = 0; }
    else if (matches.length) matchIdx = (matchIdx + 1) % matches.length;
    if (matches.length) select(matches[matchIdx], true);
    else { $("find").classList.add("nomatch"); setTimeout(function () { $("find").classList.remove("nomatch"); }, 800); }
  }
  $("findBtn").addEventListener("click", function () { doFind(false); });
  $("nextBtn").addEventListener("click", function () { doFind(true); });
  $("find").addEventListener("keydown", function (e) { if (e.key === "Enter") doFind(false); });

  var listTimer = null;
  function scheduleList() { clearTimeout(listTimer); listTimer = setTimeout(refreshList, 200); }
  function refreshList() {
    if ($("paneList").hidden || !FE.length) return;
    var g = geom(), pxPerKm = 2 * g.R / MOON_D_KM, out = [];
    for (var i = 0; i < FE.length && out.length < 60; i++) {
      var f = FE[i];
      if (f.diam * pxPerKm < 8) break;
      var p = toScreen(f.lat, f.lon);
      if (p.z > 0.08 && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) out.push(f);
    }
    $("listHint").textContent = out.length ? out.length + " largest features in view. Click one to select it." : "Zoom in or pan to see features here.";
    var ul = $("flist"); ul.textContent = "";
    out.forEach(function (f) {
      var li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.textContent = f.name; b.title = f.type;
      var s = document.createElement("span"); s.textContent = f.type + (f.diam ? ", " + fmtKm(f.diam) : "");
      b.appendChild(s); b.addEventListener("click", function () { select(f, false); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  /* ---- popovers: layers, filter, field of view ------------------------------------------------------ */
  function buildFilter() {
    var counts = {};
    FE.forEach(function (f) { counts[f.type] = (counts[f.type] || 0) + 1; });
    var types = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 14);
    var box = $("filterList"); box.textContent = "";
    types.forEach(function (t) {
      var l = document.createElement("label"), c = document.createElement("input");
      c.type = "checkbox"; c.checked = !view.hidden[t];
      c.addEventListener("change", function () { view.hidden[t] = !c.checked; requestDraw(); });
      l.appendChild(c); l.appendChild(document.createTextNode(" " + t + " (" + counts[t] + ")"));
      box.appendChild(l);
    });
  }
  function setAllTypes(on) {
    FE.forEach(function (f) { view.hidden[f.type] = !on; });
    Array.prototype.forEach.call($("filterList").querySelectorAll("input"), function (c) { c.checked = on; });
    requestDraw();
  }
  $("filtAll").addEventListener("click", function () { setAllTypes(true); });
  $("filtNone").addEventListener("click", function () { setAllTypes(false); });

  var POPS = [["popLayers", "tLayers"], ["popFilter", "tFilter"], ["popFov", "tFov"]];
  function togglePop(id) {
    POPS.forEach(function (p) {
      var el = $(p[0]), on = p[0] === id && el.hidden;
      el.hidden = !on; $(p[1]).setAttribute("aria-pressed", on ? "true" : "false");
    });
    requestDraw();
  }
  POPS.forEach(function (p) { $(p[1]).addEventListener("click", function () { togglePop(p[0]); }); });

  LAYERS.forEach(function (l) { var o = document.createElement("option"); o.value = l.id; o.textContent = l.name; $("layerBase").appendChild(o); });
  $("layerBase").addEventListener("change", function () {
    loadLayer(LAYERS.filter(function (l) { return l.id === $("layerBase").value; })[0]);
  });

  PRESETS.forEach(function (p) { var o = document.createElement("option"); o.value = p.id; o.textContent = p.name; $("fovPreset").appendChild(o); });
  function fovFill() {
    var p = fovGet(); $("fovPreset").value = fov.preset;
    var eye = p.mode === "eye";
    $("fovCustom").hidden = eye; $("fovEye").hidden = !eye;
    if (eye) { $("eyeScope").value = p.scope; $("eyeFl").value = p.eyeFl; $("eyeAfov").value = p.afov; }
    else { $("fovFl").value = p.fl; $("fovPw").value = p.pw; $("fovPh").value = p.ph; $("fovPs").value = p.ps; }
    $("fovRot").value = fov.rot;
    $("fovInfo").textContent = fovSize().text + (S.st ? ". The Moon is " + (S.st.diamDeg * 60).toFixed(1) + "' across now." : "");
  }
  function fovRead() {
    var p = fovPreset(), v = {};
    if (p.mode === "eye") { v.scope = +$("eyeScope").value || p.scope; v.eyeFl = +$("eyeFl").value || p.eyeFl; v.afov = +$("eyeAfov").value || p.afov; }
    else { v.fl = +$("fovFl").value || p.fl; v.pw = +$("fovPw").value || p.pw; v.ph = +$("fovPh").value || p.ph; v.ps = +$("fovPs").value || p.ps; }
    fov.vals[p.id] = v; fov.rot = +$("fovRot").value || 0;
    lsSet("oma-fov-vals", JSON.stringify(fov.vals)); lsSet("oma-fov-preset", fov.preset);
    fov.on = true; fovFill(); requestDraw();
  }
  $("fovPreset").addEventListener("change", function () { fov.preset = $("fovPreset").value; fov.on = true; fovFill(); lsSet("oma-fov-preset", fov.preset); requestDraw(); });
  ["fovFl", "fovPw", "fovPh", "fovPs", "eyeScope", "eyeFl", "eyeAfov", "fovRot"].forEach(function (id) { $(id).addEventListener("input", fovRead); });
  $("fovOff").addEventListener("click", function () { fov.on = false; $("popFov").hidden = true; $("tFov").setAttribute("aria-pressed", "false"); requestDraw(); });
  $("tFov").addEventListener("click", function () { if (!$("popFov").hidden) fov.on = true; fovFill(); requestDraw(); });

  /* ---- toolbar -------------------------------------------------------------------------------------- */
  function setZoom(v) { view.zoom = Math.max(1, Math.min(8, v)); $("zoom").value = view.zoom; bumpInteract(); requestDraw(); }
  $("zoom").addEventListener("input", function (e) { setZoom(parseFloat(e.target.value)); });
  $("density").addEventListener("input", function (e) { view.density = parseFloat(e.target.value); requestDraw(); });
  $("bright").addEventListener("input", function (e) { view.bright = parseFloat(e.target.value); requestDraw(); });
  $("sunManual").addEventListener("change", function () {
    view.manualSun = $("sunManual").checked; $("sun").disabled = !view.manualSun; recompute();
  });
  $("sun").addEventListener("input", function (e) { view.sunLon = parseFloat(e.target.value); recompute(); });
  function toggle(id, apply) {
    var b = $(id);
    b.addEventListener("click", function () {
      var on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", on ? "true" : "false"); apply(on); requestDraw();
    });
  }
  toggle("tTerm", function (on) { view.term = on; });
  toggle("tGrid", function (on) { view.grid = on; });
  toggle("tLabels", function (on) { view.labels = on; });
  toggle("tFlipNS", function (on) { view.sy = on ? -1 : 1; });
  toggle("tFlipEW", function (on) { view.sx = on ? -1 : 1; });
  toggle("tLib", function (on) { view.libr = on; view.free = false; applyCentering(); });
  $("zoomPre").addEventListener("change", function () { var v = parseFloat($("zoomPre").value); if (v) setZoom(v); $("zoomPre").value = ""; });
  $("tFull").addEventListener("click", function () { view.free = false; view.zoom = 1; $("zoom").value = 1; applyCentering(); bumpInteract(); requestDraw(); });
  $("dt0h").addEventListener("click", function () { var d = new Date(S.date); d.setHours(0, 0, 0, 0); setLive(false); setDate(d); });
  $("tPanel").addEventListener("click", function () {
    var on = !document.body.classList.contains("panel-off");
    document.body.classList.toggle("panel-off", on); $("tPanel").setAttribute("aria-pressed", on ? "true" : "false"); setTimeout(resize, 0);
  });
  function opt(id, key) { $(id).addEventListener("change", function () { view[key] = $(id).checked; requestDraw(); }); }
  opt("oScale", "scale"); opt("oShort", "shortNames"); opt("oMarks", "marks"); opt("oCenter", "centerLabels");
  $("gridStep").addEventListener("change", function () { view.gridStep = parseInt($("gridStep").value, 10); requestDraw(); });
  $("ovOn").addEventListener("change", function () {
    ov.on = $("ovOn").checked; if (ov.on) loadOverlay(); requestDraw();
  });
  $("ovOpacity").addEventListener("input", function () { ov.opacity = parseFloat($("ovOpacity").value); requestDraw(); });
  $("phPrev").addEventListener("click", function () { var q = E.prevQuarter(S.date); if (q) { setLive(false); setDate(q.time); } });
  $("phNext").addEventListener("click", function () { var q = E.nextQuarters(new Date(S.date.getTime() + 60000))[0]; if (q) { setLive(false); setDate(q.time); } });
  function libJump(sign) { var t = E.nextLibrationExtreme(S.date, sign); if (t) { setLive(false); view.libr = true; $("tLib").setAttribute("aria-pressed", "true"); view.free = false; setDate(t); } }
  $("libEast").addEventListener("click", function () { libJump(1); });
  $("libWest").addEventListener("click", function () { libJump(-1); });
  $("tCenter").addEventListener("click", function () {
    if (sel) { view.lon0 = sel.lon; view.lat0 = sel.lat; view.free = true; requestDraw(); }
  });

  function disclosure(btnId, cls) {
    var b = $(btnId), bar = $("toolbar");
    b.addEventListener("click", function () {
      var on = !bar.classList.contains(cls);
      bar.classList.toggle(cls, on); b.setAttribute("aria-expanded", on ? "true" : "false"); setTimeout(resize, 0);
    });
  }
  disclosure("toolsToggle", "open"); disclosure("menuToggle", "menu-open");

  $("dt").addEventListener("change", function () {
    var d = new Date($("dt").value);
    if (!isNaN(d)) { setLive(false); setDate(d); }
  });
  function step(dir) { setLive(false); setDate(new Date(S.date.getTime() + dir * parseFloat($("dtStep").value))); }
  $("dtPrev").addEventListener("click", function () { step(-1); });
  $("dtNext").addEventListener("click", function () { step(1); });
  $("dtNow").addEventListener("click", function () { setLive(false); setDate(new Date()); });
  var liveTimer = null;
  function setLive(on) {
    S.live = on; $("dtLive").setAttribute("aria-pressed", on ? "true" : "false");
    clearInterval(liveTimer);
    if (on) { setDate(new Date()); liveTimer = setInterval(function () { setDate(new Date()); }, 2000); }
  }
  $("dtLive").addEventListener("click", function () { setLive(!S.live); });

  $("tSnap").addEventListener("click", function () {
    canvas.toBlob(function (b) {
      if (!b) return;
      var a = document.createElement("a"), d = S.date;
      a.href = URL.createObjectURL(b);
      a.download = "oma-moon-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }, "image/png");
  });

  $("tMeasure").addEventListener("click", function () {
    measure.on = !measure.on; measure.pts = [];
    $("tMeasure").setAttribute("aria-pressed", measure.on ? "true" : "false");
    $("readout").hidden = !measure.on;
    $("readout").textContent = "Click two points to measure. Esc to stop.";
    canvas.style.cursor = measure.on ? "copy" : "crosshair"; requestDraw();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && measure.on) { $("tMeasure").click(); }
  });

  $("mAbout").addEventListener("click", function () { $("aboutDlg").showModal(); });

  /* ---- observer location ------------------------------------------------------------------------------ */
  $("obsLat").value = obs.lat; $("obsLon").value = obs.lon;
  function obsChanged() {
    var la = parseFloat($("obsLat").value), lo = parseFloat($("obsLon").value);
    if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      obs.lat = la; obs.lon = lo; lsSet("oma-obs-lat", la); lsSet("oma-obs-lon", lo); refreshEphem();
    }
  }
  $("obsLat").addEventListener("change", obsChanged); $("obsLon").addEventListener("change", obsChanged);
  $("obsGeo").addEventListener("click", function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (p) {
      $("obsLat").value = p.coords.latitude.toFixed(3); $("obsLon").value = p.coords.longitude.toFixed(3); obsChanged();
    });
  });

  /* ---- notes and tabs ---------------------------------------------------------------------------------- */
  var TABS = [["tabInfo", "paneInfo"], ["tabNotes", "paneNotes"], ["tabEphem", "paneEphem"], ["tabList", "paneList"]];
  TABS.forEach(function (t) {
    $(t[0]).addEventListener("click", function () {
      TABS.forEach(function (u) { var on = u[0] === t[0]; $(u[0]).setAttribute("aria-selected", on ? "true" : "false"); $(u[1]).hidden = !on; });
      refreshEphem(); refreshList();
    });
  });

  /* ---- pointer ------------------------------------------------------------------------------------------- */
  var drag = null;
  function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener("pointerdown", function (e) {
    var p = pos(e); drag = { x: p.x, y: p.y, lon0: view.lon0, lat0: view.lat0, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    var p = pos(e), g = geom();
    if (drag) {
      var dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        var k = 1 / (g.R * D2R);
        view.lon0 = drag.lon0 - view.sx * dx * k / Math.max(0.2, Math.cos(view.lat0 * D2R));
        view.lat0 = Math.max(-85, Math.min(85, drag.lat0 + view.sy * dy * k));
        if (view.lon0 > 180) view.lon0 -= 360;
        if (view.lon0 < -180) view.lon0 += 360;
        view.free = true; bumpInteract(); requestDraw();
      }
    }
    var s = fromScreen(p.x, p.y);
    $("sLon").textContent = s ? fmtLon(s.lon) : "—"; $("sLat").textContent = s ? fmtLat(s.lat) : "—";
  });
  canvas.addEventListener("pointerup", function (e) {
    if (drag && !drag.moved) {
      var p = pos(e), s = fromScreen(p.x, p.y);
      if (measure.on) {
        if (s) {
          if (measure.pts.length >= 2) measure.pts = [];
          measure.pts.push(s);
          if (measure.pts.length === 2) {
            var r = distBearing(measure.pts[0], measure.pts[1]);
            $("readout").textContent = "Distance " + r.km.toFixed(1) + " km (great circle), bearing " + r.bearing.toFixed(0) + "°. Click to measure again, Esc to stop.";
          } else $("readout").textContent = "Click a second point.";
          requestDraw();
        }
      } else {
        var g = geom(), pxPerKm = 2 * g.R / MOON_D_KM, best = null, bd = 1e9;
        for (var i = 0; i < FE.length; i++) {
          var f = FE[i], sizePx = f.diam * pxPerKm;
          if (sizePx < 3 && f !== sel) { if (f.diam === 0 || sizePx < 1.5) break; }
          var q = toScreen(f.lat, f.lon);
          if (q.z < 0.08) continue;
          var d = Math.hypot(q.x - p.x, q.y - p.y), lim = 14 + Math.min(sizePx / 2, 60);
          if (d < lim && d < bd) { bd = d; best = f; }
        }
        if (best) select(best, false);
      }
    }
    drag = null;
  });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault(); setZoom(view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  /* ---- theme ------------------------------------------------------------------------------------------------ */
  (function () {
    var root = document.documentElement, KEY = "oma-theme", btn = $("themeToggle");
    function apply(mode, persist) {
      root.setAttribute("data-theme", mode); btn.setAttribute("aria-pressed", mode === "dark" ? "true" : "false");
      if (persist) lsSet(KEY, mode);
      requestDraw();
    }
    apply("dark", false);
    var s = lsGet(KEY, ""); if (s === "dark" || s === "light") apply(s, false);
    btn.addEventListener("click", function () { apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true); });
  })();

  /* ---- go ----------------------------------------------------------------------------------------------------- */
  $("protoFlag").textContent = "Prototype";
  window.addEventListener("resize", function () { resize(); scheduleList(); });
  setDate(new Date());
  loadLayer(LAYERS[0]);
  loadFeatures();
  fovFill();
  resize();
  setInterval(function () { if (!S.live) return; }, 60000);
})();
