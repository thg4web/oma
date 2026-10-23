/* Observer's Moon Atlas prototype.
   Globe: VMA WAC tiles (DEV ONLY, license pending), lit by the real Sun position for the chosen
   date from ephem.js. Features: IAU/USGS gazetteer export in data/dev (DEV ONLY).
   Elevation: LOLA, 8 pixels per degree (data/dem). By default the Sun lights the sphere; "Phase with relief" tilts the surface
   by the LOLA slope. Crater walls cast no shadows. */
(function () {
  "use strict";
  var E = window.OMA && window.OMA.ephem, U = window.OMA && window.OMA.util;
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
  // Time zone for every time on the page: "local" (the browser's), "UTC" or an IANA name. Set from the observer panel.
  var zone = "local";
  function fmtLocal(d) {
    if (!d) return "none in range";
    var o = { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    if (zone !== "local") o.timeZone = zone;
    return d.toLocaleString([], o);
  }
  function fmtUTC(d) { return d.toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
  function toLocalInput(d) { return U.toInputValue(d, zone); }
  function zoneLabel() { return zone === "local" ? "your local time" : zone === "UTC" ? "UTC" : zone.replace(/_/g, " "); }
  function fmtKm(k) { return k >= 100 ? Math.round(k) + " km" : k.toFixed(1) + " km"; }
  function rows(el, pairs) {
    el.textContent = "";
    pairs.forEach(function (p) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = p[0]; dd.textContent = p[1];
      el.appendChild(dt); el.appendChild(dd);
    });
  }

  if (!E || !U) { $("fName").textContent = "EPHEMERIS FAILED TO LOAD"; return; }

  /* ---- state ---------------------------------------------------------------- */
  var view = { lon0: 0, lat0: 0, px: 0, py: 0, globe: false, zoom: 1, sx: 1, sy: 1, term: true, grid: false, labels: true, density: 0.5,
               bright: 1.6, libr: true, free: false, manualSun: false, sunLon: 35, hidden: {},
               scale: true, shortNames: false, marks: true, centerLabels: false, gridStep: 30,
               termLine: false, earth: false, markSize: 2.5, marksOnly: false, detail: 1200, baseMode: 0, reliefK: 3, lblStyle: 0 };
  var markHidden = false, exporting = false, exportPx = 0;
  var L100 = { on: false, rows: null };
  var ov = { on: false, opacity: 0.5, data: null, w: 0, h: 0, loading: false, id: "geo" };
  var db = { gaz: true, notes: false, noteIds: [] };
  var S = { date: new Date(), live: false, st: null, sunVec: [0, 0, 1] };
  var FE = [], FEID = {}, sel = null, matches = [], matchIdx = -1, ATLAS = {};
  var measure = { on: false, pts: [], text: "" };
  var prof = { data: null, scale: 0, hover: -1, ext: null, box: null };
  // Default observer is Greenwich, a neutral place. Visitors set their own, saved in their browser only.
  var obs = { lat: parseFloat(lsGet("oma-obs-lat", "51.48")), lon: parseFloat(lsGet("oma-obs-lon", "0")),
              alt: parseFloat(lsGet("oma-obs-alt", "0")) || 0, geo: lsGet("oma-obs-mode", "topo") === "geo" };
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
  var ready = { feat: false, tiles: false };
  function markReady(k) { ready[k] = true; if (ready.feat && ready.tiles && window.OMA.splashReady) window.OMA.splashReady(); }

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
        markReady("tiles");
        setLevel("layer not available");
        if (prev !== lay) { layer = prev; $("layerBase").value = prev.id; }
        return;
      }
      G = g; setLevel(lay.short + " z3"); markReady("tiles"); requestDraw();
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

  /* ---- elevation: LOLA grid (data/dem/ldem-8ppd.png), loaded the first time something needs it ------------------------- */
  var DEM = { dem: null, slope: null, loading: false, failed: false, cbs: [], lut: null };
  function loadDem(done) {
    if (DEM.dem) { if (done) done(); return; }
    if (done) DEM.cbs.push(done);
    if (DEM.loading || DEM.failed) return;
    DEM.loading = true;
    var im = new Image();
    im.onload = function () {
      var c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
      var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
      DEM.dem = U.demFromRGBA(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height); DEM.loading = false;
      DEM.cbs.splice(0).forEach(function (f) { f(); });
      requestDraw();
    };
    im.onerror = function () { DEM.loading = false; DEM.failed = true; DEM.cbs.splice(0); $("layerNote").textContent = "The elevation data could not be loaded."; };
    im.src = "data/dem/ldem-8ppd.png";
  }
  function elevLut() {
    if (DEM.lut) return DEM.lut;
    var n = 512, l = new Uint8Array(n * 3);
    for (var i = 0; i < n; i++) { var c = U.elevColour(-9500 + i / (n - 1) * 20500); l[i * 3] = c[0]; l[i * 3 + 1] = c[1]; l[i * 3 + 2] = c[2]; }
    return (DEM.lut = l);
  }
  var OVERLAYS = [
    { id: "geo", name: "Geologic units", cat: "Geology", origin: "USGS", note: "Colours show geologic units. Fortezzo, Spudis and Harrel (2020), USGS Unified Geologic Map of the Moon, CC0." },
    { id: "elev", name: "Elevation colours", cat: "Topography", origin: "NASA LOLA", note: "Colour by height above the 1737.4 km reference sphere, blue low to white high, about 3.8 km per pixel. Elevation: LOLA, NASA / GSFC / LRO." }
  ];
  function ovNeeds() { if (ov.id === "geo") loadOverlay(); else loadDem(); }

  /* ---- view geometry ---------------------------------------------------------- */
  function geom() { return { cx: W / 2 + view.px, cy: H / 2 + view.py, R: Math.min(W, H) * 0.46 * view.zoom }; }
  // Earth view (VMA's visible side lock): the sphere stays put and dragging moves the picture; the disc edge may reach the centre
  function clampPan() {
    var R = Math.min(W, H) * 0.46 * view.zoom;
    view.px = Math.max(-R, Math.min(R, view.px)); view.py = Math.max(-R, Math.min(R, view.py));
  }
  function centerOn(lat, lon) {
    if (view.globe) { view.lon0 = lon; view.lat0 = lat; view.free = true; return true; }
    view.free = false; applyCentering();
    var v = toView(lat, lon), R = Math.min(W, H) * 0.46 * view.zoom;
    if (v[2] < 0) return false;                            // far side, not visible from Earth
    view.px = -view.sx * R * v[0]; view.py = view.sy * R * v[1]; clampPan();
    return true;
  }
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
    // an export draws at its own pixel size (exportPx) with the page layout size kept as the unit, so labels scale with it
    var cap = interacting ? 640 : view.detail, scale = exporting ? exportPx / Math.max(W, H) : Math.min(1, cap / Math.max(W, H));
    var ow = Math.max(1, Math.round(W * scale)), oh = Math.max(1, Math.round(H * scale));
    if (off.width !== ow || off.height !== oh) { off.width = ow; off.height = oh; }
    var img = octx.createImageData(ow, oh), data = img.data;
    var g = geom(), R = g.R * scale, cx = g.cx * scale, cy = g.cy * scale;
    var ca = Math.cos(view.lat0 * D2R), sa = Math.sin(view.lat0 * D2R), cl = Math.cos(view.lon0 * D2R), sl = Math.sin(view.lon0 * D2R);
    var sv = S.sunVec, term = view.term, gain = view.bright, oa = ov.opacity, elevOv = ov.id === "elev";
    var ovOn = ov.on && (elevOv ? !!DEM.dem : !!ov.data), lut = ovOn && elevOv ? elevLut() : null, dem = DEM.dem;
    var relOn = view.baseMode === 2 && term && !!dem, flat = view.baseMode === 1, rk = view.reliefK, sg = null;
    if (view.baseMode === 2 && !dem) loadDem();
    if (relOn) { if (!DEM.slope) DEM.slope = U.demSlopeGrids(dem); sg = DEM.slope; }
    var yMin = Math.max(0, Math.floor(cy - R) - 1), yMax = Math.min(oh - 1, Math.ceil(cy + R) + 1);
    var xMin = Math.max(0, Math.floor(cx - R) - 1), xMax = Math.min(ow - 1, Math.ceil(cx + R) + 1);
    for (var py = yMin; py <= yMax; py++) {
      var vy = view.sy * (cy - py) / R;
      for (var px = xMin; px <= xMax; px++) {
        var vx = view.sx * (px - cx) / R, r2 = vx * vx + vy * vy;
        if (r2 >= 1) continue;
        var vz = Math.sqrt(1 - r2);
        var y = vy * ca + vz * sa, z1 = -vy * sa + vz * ca, x = vx * cl + z1 * sl, z = -vx * sl + z1 * cl;
        var la = Math.asin(y) * R2D, lo = Math.atan2(x, z) * R2D, alb = flat ? 0.5 : sampleGray(la, lo), lam;
        if (!term) lam = Math.pow(vz, 0.45);
        else if (relOn) lam = U.reliefLambertV(sv, x, y, z, U.gridSample(sg.e, sg.w, sg.h, la, lo) / sg.unit, U.gridSample(sg.n, sg.w, sg.h, la, lo) / sg.unit, rk);
        else lam = Math.max(0, x * sv[0] + y * sv[1] + z * sv[2]);
        var shade = alb * (0.012 + 0.988 * lam) * gain;
        var edge = Math.min(1, (1 - Math.sqrt(r2)) * R / 1.5);
        var v = Math.min(1, Math.max(0, shade)) * 255, k = (py * ow + px) * 4;
        var rr = v, gg = v * 0.985, bb = v * 0.955;
        if (ovOn) {
          var lit = Math.min(1, v / 255 * 1.6) * oa, c0, c1, c2;
          if (lut) {
            var li = Math.max(0, Math.min(511, Math.round((U.demHeight(dem, la, lo) + 9500) / 20500 * 511))) * 3;
            c0 = lut[li]; c1 = lut[li + 1]; c2 = lut[li + 2];
          } else {
            var oi = ((Math.min(ov.h - 1, Math.max(0, Math.floor((90 - la) / 180 * ov.h)))) * ov.w + Math.min(ov.w - 1, Math.floor((lo + 180) / 360 * ov.w))) * 4;
            c0 = ov.data[oi]; c1 = ov.data[oi + 1]; c2 = ov.data[oi + 2];
          }
          rr = rr * (1 - oa) + c0 * lit; gg = gg * (1 - oa) + c1 * lit; bb = bb * (1 - oa) + c2 * lit;
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

  // draws a run of selenographic points, breaking the line wherever the point is on the far side
  function strokePoints(pts) {
    var first = true;
    ctx.beginPath();
    pts.forEach(function (p) {
      var q = toScreen(p.lat, p.lon);
      if (q.z <= 0) { first = true; return; }
      if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
  }
  function drawTerminatorLine() {
    ctx.save(); ctx.strokeStyle = "rgba(255,176,64,0.95)"; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]);
    strokePoints(U.terminatorPoints(S.sunVec, 240));
    ctx.restore();
  }
  // the sub-Earth point is where the Earth stands overhead; it moves around the disc as the Moon librates
  function drawEarthMark() {
    if (!S.st) return;
    var q = toScreen(S.st.libLat, S.st.libLon);
    if (q.z <= 0) return;
    ctx.save(); ctx.strokeStyle = "#7cf0c0"; ctx.fillStyle = "#7cf0c0"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.moveTo(q.x - 14, q.y); ctx.lineTo(q.x + 14, q.y); ctx.moveTo(q.x, q.y - 14); ctx.lineTo(q.x, q.y + 14); ctx.stroke();
    ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textBaseline = "top"; ctx.fillText("Earth overhead", q.x + 12, q.y + 10);
    // an arrow along the libration: east and north libration point right and up (mirrored with the flips), longer for a larger libration
    var la = U.librationArrow(S.st.libLon, S.st.libLat), g = geom(), len = Math.max(14, la.mag * D2R * g.R);
    var ax = q.x + view.sx * Math.cos(la.angle) * len, ay = q.y - view.sy * Math.sin(la.angle) * len, ang = Math.atan2(ay - q.y, ax - q.x);
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(ax, ay);
    ctx.moveTo(ax, ay); ctx.lineTo(ax - 8 * Math.cos(ang - 0.45), ay - 8 * Math.sin(ang - 0.45)); ctx.moveTo(ax, ay); ctx.lineTo(ax - 8 * Math.cos(ang + 0.45), ay - 8 * Math.sin(ang + 0.45)); ctx.stroke();
    ctx.fillText("Libration " + fmtLon(S.st.libLon) + " " + fmtLat(S.st.libLat), q.x + 12, q.y + 24);
    ctx.restore();
  }
  function drawL100() {
    if (!L100.on || !L100.rows) return;
    ctx.save(); ctx.strokeStyle = "#4dd2ff"; ctx.fillStyle = "#4dd2ff"; ctx.lineWidth = 1.5; ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textBaseline = "bottom";
    L100.rows.forEach(function (r) {
      var q = toScreen(r[3], r[4]);
      if (q.z < 0.08 || q.x < -20 || q.x > W + 20 || q.y < -20 || q.y > H + 20) return;
      ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText("L" + r[0], q.x + 6, q.y - 8);
    });
    ctx.restore();
  }

  function drawNotesDb() {
    if (!db.notes || !db.noteIds.length) return;
    ctx.save(); ctx.strokeStyle = "#7cf0c0"; ctx.lineWidth = 2;
    db.noteIds.forEach(function (id) {
      var f = FEID[id]; if (!f) return;
      var q = toScreen(f.lat, f.lon);
      if (q.z < 0.08 || q.x < -20 || q.x > W + 20 || q.y < -20 || q.y > H + 20) return;
      ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.restore();
  }
  // ids of the features that have notes saved in this browser
  function refreshNoteIds() {
    var ids = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf("oma-notes-") === 0) { var v = JSON.parse(localStorage.getItem(k) || "[]"); if (v && v.length) ids.push(k.slice(10)); } } } catch (e) {}
    db.noteIds = ids;
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
    // angle as seen from Earth: the Moon's apparent size over its width in kilometres
    var arc = S.st ? km / MOON_D_KM * S.st.diamDeg * 3600 : 0, arcTxt = !arc ? "" : arc < 120 ? ", " + arc.toFixed(0) + "\"" : ", " + (arc / 60).toFixed(arc < 600 ? 1 : 0) + "'";
    ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textBaseline = "bottom"; ctx.fillText(km + " km" + arcTxt, x0, y0 - 7);
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
      var sizePx = f.diam * pxPerKm, minimal = view.marksOnly && !isSel;
      if (isSel) {
        ctx.strokeStyle = "#ffd24d"; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(8, Math.min(sizePx / 2, 400)), 0, Math.PI * 2); ctx.stroke();
      }
      if (view.density <= 0) return;                 // slider fully left: no label text at all, selection ring stays
      if (!view.labels && !isSel) return;
      var nm = view.shortNames ? shortName(f.name) : f.name, star = false;
      if (!isSel && view.lblStyle) { var lt = U.labelText(f.name, f.type, view.lblStyle); nm = lt.text; star = lt.star; }
      var w = minimal ? 0 : star ? 9 : ctx.measureText(nm).width, tx = view.centerLabels ? p.x - w / 2 : p.x + 8, r = [minimal ? p.x - 4 : star ? p.x - 5 : tx, p.y - 7, minimal ? 8 : w, 14];
      if (!isSel && overlaps(r)) return;
      placed.push(r);
      if (star && !minimal) {                        // abbreviated and minimal styles: main features are a star in place of the name
        ctx.font = '700 18px "Exo 2", system-ui, sans-serif'; ctx.fillStyle = "#f3e9a0"; ctx.fillText("*", p.x - 4, p.y + 5);
        ctx.font = '600 12px "Exo 2", system-ui, sans-serif'; return;
      }
      if ((view.marks && !view.centerLabels) || minimal) { ctx.fillStyle = "#ff5a4d"; ctx.beginPath(); ctx.arc(p.x, p.y, view.markSize, 0, Math.PI * 2); ctx.fill(); }
      if (minimal) return;                           // marks only: names appear for the selected feature alone
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.strokeText(nm, tx, p.y);
      ctx.fillStyle = isSel ? "#ffd24d" : "#f3e9a0"; ctx.fillText(nm, tx, p.y);
    }
    if (view.labels && view.density > 0 && db.gaz) {
      for (var i = 0; i < FE.length && count < 220; i++) {
        var f = FE[i];
        if (f.diam * pxPerKm < minPx) break;
        if (view.hidden[f.type] || (f === sel && !markHidden)) continue;
        var before = placed.length; label(f, false); if (placed.length > before) count++;
      }
    }
    if (sel && !markHidden) label(sel, true);
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
    for (var li = 0; li + 1 < measure.pts.length; li++) {
      var pts = gcPoints(measure.pts[li], measure.pts[li + 1], 48).map(function (p) { return toScreen(p.lat, p.lon); });
      ctx.beginPath(); var first = true;
      pts.forEach(function (q) { if (q.z <= 0) { first = true; return; } if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); });
      ctx.stroke();
    }
    if (prof.data && prof.hover >= 0 && prof.data.samples[prof.hover]) {      // the point under the pointer on the profile
      var hp = prof.data.samples[prof.hover], hs = toScreen(hp.lat, hp.lon);
      if (hs.z > 0) { ctx.strokeStyle = "#ffffff"; ctx.beginPath(); ctx.arc(hs.x, hs.y, 7, 0, Math.PI * 2); ctx.stroke(); }
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
  var fov = { on: false, preset: lsGet("oma-fov-preset", "s50"), vals: {}, rot: 0, user: [], mask: false };
  try { fov.vals = JSON.parse(lsGet("oma-fov-vals", "{}")) || {}; } catch (e) { fov.vals = {}; }
  // the visitor's own cameras and eyepieces, kept in this browser (same fields as the built-in presets, ids start with u)
  try { fov.user = JSON.parse(lsGet("oma-fov-user", "[]")) || []; } catch (e) { fov.user = []; }
  function fovAll() { return PRESETS.concat(fov.user); }
  function fovPreset() { return fovAll().filter(function (p) { return p.id === fov.preset; })[0] || PRESETS[0]; }
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
  function fovCentre(g) {
    var c = { x: g.cx, y: g.cy };
    if (sel) { var s = toScreen(sel.lat, sel.lon); if (s.z > 0) c = s; }
    return c;
  }
  // an eyepiece field with the mask on: clicks outside the circle do nothing (as in Virtual Moon Atlas)
  function outsideMask(p) {
    if (!fov.on || !fov.mask || !S.st) return false;
    var f = fovSize(); if (!f.circle) return false;
    var g = geom(), c = fovCentre(g), r = g.R * f.w / S.st.diamDeg;
    return Math.hypot(p.x - c.x, p.y - c.y) > r;
  }
  function drawFov(g) {
    if (!fov.on || !S.st) return;
    var f = fovSize(), diam = S.st.diamDeg, c = fovCentre(g);
    var pw = 2 * g.R * f.w / diam, ph = 2 * g.R * f.h / diam;
    if (fov.mask && f.circle) {
      ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(c.x, c.y, pw / 2, 0, Math.PI * 2, true); ctx.fill("evenodd"); ctx.restore();
    }
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
    if (view.termLine) drawTerminatorLine();
    drawL100(); drawNotesDb();
    drawLabels(g); drawMeasure(); if (view.earth) drawEarthMark(); drawFov(g); drawScale(g);
    if (exporting) return;
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
    var cs = !view.globe && (view.px || view.py) ? fromScreen(W / 2, H / 2) : null;
    $("sCentre").textContent = cs ? fmtLon(cs.lon) + " " + fmtLat(cs.lat) : fmtLon(view.lon0) + " " + fmtLat(view.lat0);
    var km2 = U.visibleAreaKm2(W, H, kmpx, function (px, py) {
      var vx = view.sx * (px - g.cx) / g.R, vy = view.sy * (g.cy - py) / g.R, r2 = vx * vx + vy * vy;
      return r2 >= 1 ? 0 : Math.sqrt(1 - r2);
    }, 48, 32);
    $("sArea").textContent = km2 >= 1e6 ? (km2 / 1e6).toFixed(2) + " million km²" : Math.round(km2).toLocaleString() + " km²";
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
    var zp = U.zoneParts(S.date, zone);
    $("sDate").textContent = zp.y + "-" + pad(zp.mo) + "-" + pad(zp.d);
    $("sTime").textContent = pad(zp.h) + ":" + pad(zp.mi) + ":" + pad(zp.s);
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

  // Hand-off to CalcLun (calclun.html): the date, observer, time zone and the selected feature go with the link
  (function () {
    var ln = $("mCalclun"); if (!ln) return;
    function build() {
      var q = ["date=" + encodeURIComponent(S.date.toISOString()), "lat=" + obs.lat, "lon=" + obs.lon, "alt=" + obs.alt];
      if (zone !== "local") q.push("tz=" + encodeURIComponent(zone));
      if (sel && String(sel.id).indexOf("L100-") !== 0) q.push("f=" + encodeURIComponent(sel.name), "flat=" + sel.lat, "flon=" + sel.lon);
      ln.href = "calclun.html?" + q.join("&");
    }
    ["pointerdown", "focus", "mouseover", "click"].forEach(function (t) { ln.addEventListener(t, build); });
  })();

  // Lunlets menu (applets internally): close on an outside click or Esc
  (function () {
    var d = $("mApplets"); if (!d) return;
    document.addEventListener("click", function (e) { if (d.open && !d.contains(e.target)) d.open = false; });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") d.open = false; });
  })();

  /* ---- feature panel ----------------------------------------------------------------------- */
  function showFeature() {
    var f = sel;
    if (!f) return;
    $("fName").textContent = f.name.toUpperCase();
    $("fSub").textContent = f.type;
    rows($("fIdentity"), [["Type", f.type], ["IAU type code", f.code], ["Status", f.status], ["Quadrangle", f.quad], ["Gazetteer ID", f.id]]);
    rows($("fPosition"), [["Latitude", fmtLat(f.lat)], ["Longitude", fmtLon(f.lon)]]);
    rows($("fSize"), [["Diameter", f.diam ? fmtKm(f.diam) : "not given"]]);
    rows($("fRecord"), [["name", f.name], ["code", f.code], ["type", f.type], ["latitude", String(f.lat)], ["longitude", String(f.lon)], ["diameter (km)", f.diam ? String(f.diam) : ""],
      ["quadrangle", f.quad], ["origin", f.origin], ["status", f.status], ["info", f.info], ["id", f.id]]);
    showDesc(f);
    $("fOrigin").textContent = f.origin || "Not given in the gazetteer.";
    $("fInfo").textContent = f.info || "";
    var at = ATLAS[f.id] || {}, ar = [];
    function ref(label, e, pre) { if (e) ar.push([label, (pre || "") + e.v.join(", ") + (e.q === "f" || e.c ? " (check)" : "")]); }
    ref("Rükl chart", at.r); ref("21st Century Atlas", at.a); ref("North, Observing the Moon", at.n, "pp. ");
    if (!ar.length) ar.push(["References", "none found yet"]);
    rows($("fAtlas"), ar);
    $("notesName").textContent = "Notes: " + f.name;
    $("notes").value = ""; renderNotes();
    renderNeighbors(f);
    refreshSun();
    requestDraw();
  }

  // Curated descriptions (VMA database, Legrand). Dev file, git-ignored until permission; absent on the public site.
  var DESC = null;
  function loadDesc() {
    fetch("data/dev/descriptions.json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { DESC = j.d || {}; if (sel) showDesc(sel); }).catch(function () {});
  }
  function showDesc(f) {
    var d = DESC && DESC[f.lname], r = [];
    if (d) {
      [["general_1", "General"], ["general_2", "Age note"], ["slopes", "Slopes"], ["walls", "Walls"], ["floor", "Floor"], ["facts", "Facts"]].forEach(function (k) { if (d[k[0]]) r.push([k[1], d[k[0]]]); });
      if (d.interest_n && d.interest_n !== "0") r.push(["Interest (1-5)", d.interest_n]);
    }
    $("fDescWrap").hidden = !r.length;
    rows($("fDesc"), r);
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
      del.addEventListener("click", function () { var b = getNotes(); b.splice(idx, 1); putNotes(b); renderNotes(); refreshNoteIds(); requestDraw(); });
      h.appendChild(t); h.appendChild(w); h.appendChild(del);
      var p = document.createElement("p"); p.textContent = n.text;
      li.appendChild(h); li.appendChild(p); ul.appendChild(li);
    });
  }
  $("noteSave").addEventListener("click", function () {
    var text = $("notes").value.trim(); if (!text || !sel) return;
    var a = getNotes(); a.push({ type: $("noteType").value, text: text, saved: Date.now(), when: S.date.getTime() });
    putNotes(a); $("notes").value = ""; renderNotes(); refreshNoteIds(); requestDraw();
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
    var st = S.st, oi = E.observerInfo(S.date, obs.lat, obs.lon, obs.alt, obs.geo);
    var age = (S.date - E.lastNewMoon(S.date)) / 86400000;
    function hms(h) { var hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return hh + "h " + pad(mm) + "m"; }
    rows($("ephTable"), [
      [zone === "local" ? "Local time" : "Time (" + zoneLabel() + ")", fmtLocal(S.date)], ["UTC", fmtUTC(S.date)],
      ["Illuminated", (st.illum * 100).toFixed(1) + "%"], ["Age", age.toFixed(1) + " days"],
      ["Phase angle", st.phaseAngle.toFixed(1) + "°"], ["Elongation", st.elongation.toFixed(1) + "°"],
      ["Distance", Math.round(st.distKm).toLocaleString() + " km"], ["Apparent diameter", (st.diamDeg * 60).toFixed(2) + "'"],
      ["Libration longitude", fmtLon(st.libLon)], ["Libration latitude", fmtLat(st.libLat)],
      ["Sub-solar longitude", fmtLon(st.sunLon)], ["Sub-solar latitude", fmtLat(st.sunLat)],
      ["Colongitude", st.colong.toFixed(2) + "°"],
      ["Moon altitude here", oi.alt.toFixed(1) + "°" + (obs.geo ? " (geocentric)" : "")], ["Moon azimuth here", oi.az.toFixed(1) + "°"],
      ["Right ascension", hms(oi.ra)], ["Declination", oi.dec.toFixed(2) + "°"],
      ["Moonrise", fmtLocal(oi.rise)], ["Moonset", fmtLocal(oi.set)]
    ]);
    refreshTerminator();
    $("ephTzHint").textContent = "Times are in " + zoneLabel() + ". Positions from astronomy-engine, libration and Sun from Meeus ch. 53 (optical libration only)." + (obs.geo ? " Moonrise and moonset are always topocentric." : "");
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

  /* ---- features on the terminator now (morning side: Sun just rising, evening side: Sun about to set) ---------- */
  function refreshTerminator() {
    var ul = $("termList"); ul.textContent = "";
    if (!FE.length || !S.st) { $("termHint").textContent = ""; return; }
    var st = S.st, out = [], band = 4, maxA = parseInt($("termAper").value, 10) || 50, dmin = Math.max(2, U.minDiamKm(maxA, st.distKm)), srt = $("termSort").value;
    for (var i = 0; i < FE.length; i++) {
      var f = FE[i];
      if (f.diam < dmin) break;                              // list is sorted by size, large first
      var e = E.sunElevation(st, f.lat, f.lon);
      if (Math.abs(e) > band) continue;
      if (E.angDist(st.libLat, st.libLon, f.lat, f.lon) > 88) continue;   // on the far side from Earth
      var ap = U.apertureMm(f.diam, st.distKm);
      if (ap > maxA) continue;
      out.push({ f: f, e: e, ap: ap, morning: E.norm180(f.lon - st.sunLon) < 0 });
    }
    var cmp = { size: function (a, b) { return b.f.diam - a.f.diam; }, name: function (a, b) { return a.f.name.localeCompare(b.f.name); },
                aper: function (a, b) { return a.ap - b.ap || b.f.diam - a.f.diam; }, lat: function (a, b) { return b.f.lat - a.f.lat; } };
    out.sort(cmp[srt] || cmp.size);
    var shown = out.slice(0, 200);
    $("termHint").textContent = out.length ? out.length + " features within " + band + "° of Sun elevation of the terminator, facing Earth" + (out.length > shown.length ? ", the first " + shown.length + " shown" : "") +
      ". Sunrise side is the morning terminator. Instrument is the smallest aperture that shows the feature, estimated from its size alone (Dawes limit, three resolution elements across), not a rating of how easy it is."
      : "No features needing " + (maxA === 999 ? "any size of telescope" : maxA + " mm or less") + " are on the terminator facing Earth right now.";
    shown.forEach(function (o) {
      var li = document.createElement("li"), b = document.createElement("button");
      b.type = "button"; b.textContent = o.f.name;
      var sp = document.createElement("span"); sp.textContent = o.ap + " mm, " + (o.morning ? "sunrise" : "sunset") + " " + o.e.toFixed(1) + "°";
      b.appendChild(sp); b.addEventListener("click", function () { select(o.f, true); });
      li.appendChild(b); ul.appendChild(li);
    });
  }
  $("termAper").addEventListener("change", refreshTerminator);
  $("termSort").addEventListener("change", refreshTerminator);
  $("ephCopy").addEventListener("click", function () {
    var k = $("ephTable").children, out = ["Observer " + fmtLat(obs.lat) + " " + fmtLon(obs.lon) + ", " + obs.alt + " m"];
    for (var i = 0; i + 1 < k.length; i += 2) out.push(k[i].textContent + ": " + k[i + 1].textContent);
    copyText(out.join("\n"));
  });

  /* ---- features: load, search, list -------------------------------------------------------------- */
  function loadAtlas() {
    loadDesc();
    fetch("data/atlas/atlas-index.json").then(function (r) { return r.json(); }).then(function (j) { ATLAS = j.features || {}; if (sel) showFeature(); }).catch(function () {});
  }
  function loadFeatures() {
    fetch("data/features/features.json").then(function (r) { return r.json(); }).then(function (j) {
      FE = j.rows.map(function (r) {
        return { name: r[0], code: r[1], type: r[2], lat: r[3], lon: r[4], diam: r[5], quad: r[6], origin: r[7], status: r[8], info: r[9], id: r[10], lname: r[0].toLowerCase() };
      });
      FE.forEach(function (f) { FEID[f.id] = f; });
      buildFilter(); $("dbCount").textContent = FE.length.toLocaleString();
      var c = FE.filter(function (f) { return f.name === "Copernicus"; })[0] || FE[0];
      sel = c;
      applyUrlParams();
      showFeature(); requestDraw(); markReady("feat");
    }).catch(function () {
      markReady("feat");
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
    if (isFinite(lat) && isFinite(lon)) centerOn(lat, lon);
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
    sel = f; markHidden = false;
    if (center && !centerOn(f.lat, f.lon)) note(f.name + " is on the far side. Turn on Full globe to see it.");
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
    if ($("paneList").hidden || !FE.length || !db.gaz) { if (!$("paneList").hidden && !db.gaz) { $("listHint").textContent = "The gazetteer is switched off in Map layers."; $("flist").textContent = ""; } return; }
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

  var POPS = [["popLayers", "tLayers"], ["popFilter", "tFilter"], ["popFov", "tFov"], ["popScope", "tScope"], ["popProfile", "tProfile"]];
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

  function fovBuildSelect() {
    var sl = $("fovPreset"); sl.textContent = "";
    function add(parent, p) { var o = document.createElement("option"); o.value = p.id; o.textContent = p.name; parent.appendChild(o); }
    PRESETS.forEach(function (p) { add(sl, p); });
    if (fov.user.length) {
      var g = document.createElement("optgroup"); g.label = "Your own";
      fov.user.forEach(function (p) { add(g, p); });
      sl.appendChild(g);
    }
  }
  function fovFill() {
    var p = fovGet(); fov.preset = p.id; fovBuildSelect(); $("fovPreset").value = fov.preset;
    $("fovDel").disabled = fov.preset.charAt(0) !== "u";
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
  $("fovSave").addEventListener("click", function () {
    var base = fovGet(), nm = $("fovName").value.trim() || (base.mode === "eye" ? "My eyepiece " : "My camera ") + (fov.user.length + 1);
    var np = { id: "u" + Date.now().toString(36), name: nm, mode: base.mode };
    ["fl", "pw", "ph", "ps", "scope", "eyeFl", "afov"].forEach(function (k) { if (base[k] !== undefined) np[k] = base[k]; });
    fov.user.push(np); fov.preset = np.id; fov.on = true;
    lsSet("oma-fov-user", JSON.stringify(fov.user)); lsSet("oma-fov-preset", fov.preset);
    $("fovName").value = ""; fovFill(); requestDraw();
  });
  $("fovDel").addEventListener("click", function () {
    if (fov.preset.charAt(0) !== "u") return;
    fov.user = fov.user.filter(function (p) { return p.id !== fov.preset; });
    delete fov.vals[fov.preset]; fov.preset = PRESETS[0].id;
    lsSet("oma-fov-user", JSON.stringify(fov.user)); lsSet("oma-fov-vals", JSON.stringify(fov.vals)); lsSet("oma-fov-preset", fov.preset);
    fovFill(); requestDraw();
  });
  $("fovMask").addEventListener("change", function () { fov.mask = $("fovMask").checked; if (fov.mask) fov.on = true; requestDraw(); });
  $("fovOff").addEventListener("click", function () { fov.on = false; $("popFov").hidden = true; $("tFov").setAttribute("aria-pressed", "false"); requestDraw(); });
  $("tFov").addEventListener("click", function () { if (!$("popFov").hidden) fov.on = true; fovFill(); requestDraw(); });

  /* ---- toolbar -------------------------------------------------------------------------------------- */
  function setZoom(v) { view.zoom = Math.max(1, Math.min(8, v)); $("zoom").value = view.zoom; if (view.globe || view.zoom <= 1.001) { view.px = 0; view.py = 0; } else clampPan(); bumpInteract(); requestDraw(); }
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
  // VMA's Full Globe button: down is a free-rotating globe (libration off, centred on 0, 0, orbit controls shown), up is the Earth view. Dragging rotates in both
  var libBeforeGlobe = true;
  function globeMode(on) {
    if (on === !!view.globe) return;
    view.globe = on; view.free = false; view.px = 0; view.py = 0; setPressed("tFull", on);
    $("orbitGroup").hidden = !on; $("tLib").disabled = on;
    if (on) { libBeforeGlobe = view.libr; view.libr = false; setPressed("tLib", false); }
    else { orbitSet(0); view.libr = libBeforeGlobe; setPressed("tLib", view.libr); }
    applyCentering(); bumpInteract(); requestDraw();
  }
  $("tFull").addEventListener("click", function () { globeMode(!view.globe); });
  $("dt0h").addEventListener("click", function () {
    var p = U.zoneParts(S.date, zone); setLive(false); setDate(U.fromZoneParts(p.y, p.mo, p.d, 0, 0, zone));
  });
  $("tPanel").addEventListener("click", function () {
    var on = !document.body.classList.contains("panel-off");
    document.body.classList.toggle("panel-off", on); $("tPanel").setAttribute("aria-pressed", on ? "true" : "false"); setTimeout(resize, 0);
  });
  function opt(id, key) { $(id).addEventListener("change", function () { view[key] = $(id).checked; requestDraw(); }); }
  opt("oScale", "scale"); opt("oShort", "shortNames"); opt("oMarksOnly", "marksOnly"); opt("oMarks", "marks"); opt("oCenter", "centerLabels"); opt("oTermLine", "termLine"); opt("oEarth", "earth");
  $("markSize").addEventListener("input", function () { view.markSize = parseFloat($("markSize").value); requestDraw(); });
  $("renderDetail").addEventListener("change", function () { view.detail = parseInt($("renderDetail").value, 10); requestDraw(); });
  $("gridStep").addEventListener("change", function () { view.gridStep = parseInt($("gridStep").value, 10); requestDraw(); });
  // overlays: category, then origin, then the overlay itself, as in Virtual Moon Atlas
  function ovFill() {
    function fill(id, vals, keep, any) {
      var sl = $(id), cur = keep; sl.textContent = "";
      var o0 = document.createElement("option"); o0.value = ""; o0.textContent = any; sl.appendChild(o0);
      vals.forEach(function (v) { var o = document.createElement("option"); o.value = v; o.textContent = v; sl.appendChild(o); });
      sl.value = vals.indexOf(cur) >= 0 ? cur : "";
    }
    function uniq(list, k) { var a = []; list.forEach(function (o) { if (a.indexOf(o[k]) < 0) a.push(o[k]); }); return a; }
    fill("ovCat", uniq(OVERLAYS, "cat"), $("ovCat").value, "All categories");
    var inCat = OVERLAYS.filter(function (o) { return !$("ovCat").value || o.cat === $("ovCat").value; });
    fill("ovOrigin", uniq(inCat, "origin"), $("ovOrigin").value, "All origins");
    var inBoth = inCat.filter(function (o) { return !$("ovOrigin").value || o.origin === $("ovOrigin").value; }), sl = $("ovPick");
    sl.textContent = "";
    inBoth.forEach(function (o) { var op = document.createElement("option"); op.value = o.id; op.textContent = o.name; sl.appendChild(op); });
    if (inBoth.some(function (o) { return o.id === ov.id; })) sl.value = ov.id; else if (inBoth.length) { sl.value = inBoth[0].id; ov.id = inBoth[0].id; }
    var cur = OVERLAYS.filter(function (o) { return o.id === ov.id; })[0];
    $("ovNote").textContent = cur ? cur.note : "";
    $("ovOn").disabled = !inBoth.length;
  }
  $("ovCat").addEventListener("change", function () { ovFill(); if (ov.on) ovNeeds(); requestDraw(); });
  $("ovOrigin").addEventListener("change", function () { ovFill(); if (ov.on) ovNeeds(); requestDraw(); });
  $("ovPick").addEventListener("change", function () { ov.id = $("ovPick").value; ovFill(); if (ov.on) ovNeeds(); requestDraw(); });
  $("ovOn").addEventListener("change", function () {
    ov.on = $("ovOn").checked; if (ov.on) ovNeeds(); requestDraw();
  });
  $("ovOpacity").addEventListener("input", function () { ov.opacity = parseFloat($("ovOpacity").value); requestDraw(); });
  ovFill();
  // map style: texture, no texture (an overlay shown alone), or the phase lit over the elevation
  function baseModeUi() {
    var m = view.baseMode;
    $("reliefKRow").hidden = m !== 2;
    $("baseModeNote").textContent = m === 1 ? "No texture is drawn, so an overlay shows alone. The overlay has been switched on."
      : m === 2 ? "Each point is lit by the real Sun on the LOLA slope (about 3.8 km per pixel), so only large relief shows and there are no cast shadows. Best with the high-Sun base map and the terminator on."
      : "";
  }
  $("baseMode").addEventListener("change", function () {
    view.baseMode = parseInt($("baseMode").value, 10) || 0;
    if (view.baseMode === 1 && !ov.on) { ov.on = true; $("ovOn").checked = true; ovNeeds(); }
    if (view.baseMode === 2) loadDem();
    baseModeUi(); requestDraw();
  });
  $("reliefK").addEventListener("change", function () { view.reliefK = parseFloat($("reliefK").value) || 3; requestDraw(); });
  $("lblStyle").addEventListener("change", function () { view.lblStyle = parseInt($("lblStyle").value, 10) || 0; requestDraw(); });
  $("phPrev").addEventListener("click", function () { var q = E.prevQuarter(S.date); if (q) { setLive(false); setDate(q.time); } });
  $("phNext").addEventListener("click", function () { var q = E.nextQuarters(new Date(S.date.getTime() + 60000))[0]; if (q) { setLive(false); setDate(q.time); } });
  function libJump(sign) { var t = E.nextLibrationExtreme(S.date, sign); if (t) { globeMode(false); setLive(false); view.libr = true; $("tLib").setAttribute("aria-pressed", "true"); view.free = false; setDate(t); } }
  $("libEast").addEventListener("click", function () { libJump(1); });
  $("libWest").addEventListener("click", function () { libJump(-1); });
  // as in Virtual Moon Atlas: at 1:1 the button restores the Earth view, zoomed in it centers the selected feature
  $("tCenter").addEventListener("click", function () {
    if (view.zoom <= 1.001) { view.free = false; view.px = 0; view.py = 0; applyCentering(); requestDraw(); }
    else if (sel) { centerOn(sel.lat, sel.lon); requestDraw(); }
  });
  $("tClearMark").addEventListener("click", function () { markHidden = true; requestDraw(); });

  function disclosure(btnId, cls) {
    var b = $(btnId), bar = $("toolbar");
    b.addEventListener("click", function () {
      var on = !bar.classList.contains(cls);
      bar.classList.toggle(cls, on); b.setAttribute("aria-expanded", on ? "true" : "false"); setTimeout(resize, 0);
    });
  }
  disclosure("toolsToggle", "open"); disclosure("menuToggle", "menu-open");

  $("dt").addEventListener("change", function () {
    var d = U.fromInputValue($("dt").value, zone);
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

  /* ---- pictures of the view: PNG, JPG or BMP, at the view size or 1500 or 3000 px square ---------------------- */
  function makeStars(w, h) {
    var a = [], n = Math.max(90, Math.min(260, Math.round(w * h / 5200)));
    for (var i = 0; i < n; i++) a.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.1 + 0.25, a: (Math.random() * 0.5 + 0.25).toFixed(2) });
    return a;
  }
  // draws the view into a new canvas n px square and returns it (n = 0 means the canvas on the page as it is)
  function renderPicture(n) {
    if (!n) return canvas;
    var keep = { canvas: canvas, ctx: ctx, W: W, H: H, dpr: dpr, off: off, octx: octx, stars: stars, interacting: interacting }, cv = document.createElement("canvas");
    var unit = Math.max(400, Math.min(1000, Math.min(W, H)));       // layout size the picture is composed at, then scaled up
    cv.width = cv.height = n;
    canvas = cv; ctx = cv.getContext("2d"); W = H = unit; dpr = n / unit;
    off = document.createElement("canvas"); octx = off.getContext("2d"); stars = makeStars(unit, unit);
    interacting = false; exporting = true; exportPx = n;
    try { draw(); }
    finally {
      exporting = false; canvas = keep.canvas; ctx = keep.ctx; W = keep.W; H = keep.H; dpr = keep.dpr;
      off = keep.off; octx = keep.octx; stars = keep.stars; interacting = keep.interacting;
    }
    return cv;
  }
  function pictureBlob(fmt, size, done) {
    var n = size === "view" ? 0 : parseInt(size, 10), cv = renderPicture(n);
    if (fmt === "bmp") {
      var px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
      done(new Blob([U.encodeBMP(px.data, cv.width, cv.height)], { type: "image/bmp" }));
    } else cv.toBlob(done, fmt === "jpg" ? "image/jpeg" : "image/png", 0.92);
  }
  function pictureName(fmt, size) {
    var z = U.zoneParts(S.date, zone);
    return "oma-moon-" + z.y + pad(z.mo) + pad(z.d) + "-" + pad(z.h) + pad(z.mi) + (size === "view" ? "" : "-" + size) + "." + fmt;
  }
  function note(t) { $("readoutText").textContent = t; $("readoutActions").hidden = true; $("readout").hidden = false; }
  $("tSnap").addEventListener("click", function () {
    var fmt = $("snapFmt").value, size = $("snapSize").value, big = size !== "view";
    if (big) note("Rendering a " + size + " px picture, one moment.");
    setTimeout(function () {
      pictureBlob(fmt, size, function (b) {
        if (!b) { note("The browser could not make that picture. Try a smaller size."); return; }
        var a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = pictureName(fmt, size);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        if (big) { if (measure.on) $("readoutText").textContent = "Click two points to measure. Esc to stop."; else $("readout").hidden = true; }
      });
    }, big ? 30 : 0);
  });

  /* ---- picture preview (lightbox) with zoom ---------------------------------------------------------------------- */
  var light = { zoom: 1, url: null };
  function lightApply() {
    var box = document.querySelector(".light-scroll");
    $("lightImg").style.width = Math.round(box.clientWidth * light.zoom) + "px";
  }
  function lightOpen(url, cap) {
    if (light.url) URL.revokeObjectURL(light.url);
    light.url = url; light.zoom = 1; $("lightImg").src = url; $("lightCap").textContent = cap;
    if (!$("lightDlg").open) $("lightDlg").showModal();
    lightApply();
  }
  $("tPreview").addEventListener("click", function () {
    pictureBlob("png", $("snapSize").value === "view" ? "view" : "1500", function (b) {
      if (b) lightOpen(URL.createObjectURL(b), "Moon at " + fmtLocal(S.date) + " (" + zoneLabel() + ")");
    });
  });
  $("lightPlus").addEventListener("click", function () { light.zoom = Math.min(8, light.zoom * 1.5); lightApply(); });
  $("lightMinus").addEventListener("click", function () { light.zoom = Math.max(0.25, light.zoom / 1.5); lightApply(); });
  $("lightClose").addEventListener("click", function () { $("lightDlg").close(); });
  $("lightDlg").addEventListener("close", function () { if (light.url) { URL.revokeObjectURL(light.url); light.url = null; $("lightImg").removeAttribute("src"); } });
  window.addEventListener("resize", function () { if ($("lightDlg").open) lightApply(); });

  /* ---- picture of the selected feature: the WAC map around it at a zoom that frames it, in the preview window ------------------- */
  function featurePicture() {
    var f = sel; if (!f || !W) return;
    var zoom = Math.max(1, Math.min(40, 3777 / (3 * Math.max(f.diam, 10)))), halfKm = 3777 / zoom / 2, halfLat = halfKm / (MOON_R_KM * D2R);
    var halfLon = Math.min(180, halfLat / Math.max(0.2, Math.cos(f.lat * D2R)));
    note("Fetching the map around " + f.name + ", one moment.");
    var keys = [];
    for (var ty = Math.floor((90 - Math.min(90, f.lat + halfLat)) / 180 * TROWS); ty <= Math.floor((90 - Math.max(-90, f.lat - halfLat)) / 180 * TROWS); ty++) {
      for (var u = Math.floor((f.lon - halfLon + 180) / 360 * TCOLS); u <= Math.floor((f.lon + halfLon + 180) / 360 * TCOLS); u++) {
        var tx = ((u % TCOLS) + TCOLS) % TCOLS; if (ty >= 0 && ty < TROWS) keys.push(ty * TCOLS + tx);
      }
    }
    var t0 = Date.now();
    (function poll() {
      keys.forEach(function (k) { reqTile(k % TCOLS, Math.floor(k / TCOLS)); });
      var left = keys.filter(function (k) { return !TIL[k] && !TILFAIL[k]; }).length;
      if (left && Date.now() - t0 < 5000) { setTimeout(poll, 120); return; }
      var keep = { lon0: view.lon0, lat0: view.lat0, px: view.px, py: view.py, zoom: view.zoom, free: view.free, grid: view.grid, termLine: view.termLine, earth: view.earth, labels: view.labels, sx: view.sx, sy: view.sy };
      var keepMark = markHidden, keepFov = fov.on, keepL100 = L100.on, keepNotes = db.notes, keepMeasure = measure.pts, cv;
      view.lon0 = f.lon; view.lat0 = f.lat; view.px = 0; view.py = 0; view.zoom = zoom; view.free = true; view.grid = false; view.termLine = false; view.earth = false; view.labels = false; view.sx = 1; view.sy = 1;
      markHidden = true; fov.on = false; L100.on = false; db.notes = false; measure.pts = [];
      try { cv = renderPicture(1500); }
      finally {
        for (var k in keep) view[k] = keep[k];
        markHidden = keepMark; fov.on = keepFov; L100.on = keepL100; db.notes = keepNotes; measure.pts = keepMeasure; requestDraw();
      }
      cv.toBlob(function (b) {
        if (!b) { note("The browser could not make that picture."); return; }
        if (measure.on) $("readoutText").textContent = "Click two points to measure. Esc to stop."; else $("readout").hidden = true;
        lightOpen(URL.createObjectURL(b), f.name + " (" + f.type + (f.diam ? ", " + fmtKm(f.diam) : "") + "), " + layer.short + ", Sun as at " + fmtLocal(S.date) + ". Picture about " + Math.round(halfKm * 2) + " km across.");
      }, "image/png");
    })();
  }
  $("fPicture").addEventListener("click", featurePicture);

  $("tMeasure").addEventListener("click", function () {
    measure.on = !measure.on; measure.pts = [];
    $("tMeasure").setAttribute("aria-pressed", measure.on ? "true" : "false");
    $("readout").hidden = !measure.on; $("readoutActions").hidden = true;
    $("readoutText").textContent = "Click two points to measure. Esc to stop.";
    canvas.style.cursor = measure.on ? "copy" : "crosshair"; requestDraw();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && measure.on) { $("tMeasure").click(); }
  });
  function copyText(t) {
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;left:-999px";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fallback); else fallback();
  }
  $("copyDist").addEventListener("click", function () { if (measure.text) copyText(measure.text); });
  $("copyCoord").addEventListener("click", function () {
    copyText(measure.pts.map(function (p, i) { return "P" + (i + 1) + " " + fmtLat(p.lat) + " " + fmtLon(p.lon); }).join("; "));
  });

  /* ---- height profile along the measured line (LOLA elevation, data/dem) ---------------------------------------------- */
  var PROF_M = { l: 58, r: 10, t: 8, b: 26 }, PROF_HELP = "Use the Measure tool: click two points, Shift-click adds legs. The height along the line is drawn here.";
  function css(name, d) { var v = getComputedStyle(document.documentElement).getPropertyValue(name); return (v && v.trim()) || d; }
  function niceStep(range, target) {
    var raw = Math.max(range, 1e-9) / target, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
  }
  function profileDraw() {
    var cv = $("profCanvas"), c = cv.getContext("2d"), w = cv.width, h = cv.height, d = prof.data;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
    c.fillStyle = css("--stage", "#03050a"); c.fillRect(0, 0, w, h);
    if (!d) return;
    var cw = w - PROF_M.l - PROF_M.r, chh = h - PROF_M.t - PROF_M.b, ext = U.profileExtent(d.km, d.hmin, d.hmax, prof.scale, cw, chh);
    prof.ext = ext; prof.box = { x: PROF_M.l, y: PROF_M.t, w: cw, h: chh };
    function X(km) { return PROF_M.l + (km - ext.x0) / (ext.x1 - ext.x0) * cw; }
    function Y(m) { return PROF_M.t + chh - (m - ext.y0) / (ext.y1 - ext.y0) * chh; }
    var ink = css("--ink-dim", "#9bb0c6"), grid = css("--line-soft", "#223044"), acc = css("--accent", "#5aa9ff"), v;
    var sx = niceStep(ext.x1 - ext.x0, 6), sy = niceStep(ext.y1 - ext.y0, 5);
    c.font = '11px "IBM Plex Mono", monospace'; c.lineWidth = 1; c.fillStyle = ink; c.strokeStyle = grid;
    c.textBaseline = "top"; c.textAlign = "center";
    for (v = 0; v <= ext.x1 + 1e-9; v += sx) { c.beginPath(); c.moveTo(X(v), PROF_M.t); c.lineTo(X(v), PROF_M.t + chh); c.stroke(); c.fillText(v === 0 ? "Start" : String(+v.toFixed(2)), X(v), PROF_M.t + chh + 6); }
    c.textAlign = "right"; c.textBaseline = "middle";
    for (v = Math.ceil(ext.y0 / sy) * sy; v <= ext.y1; v += sy) { c.beginPath(); c.moveTo(PROF_M.l, Y(v)); c.lineTo(PROF_M.l + cw, Y(v)); c.stroke(); c.fillText(String(Math.round(v)), PROF_M.l - 6, Y(v)); }
    c.save(); c.beginPath(); c.rect(PROF_M.l, PROF_M.t, cw, chh); c.clip();
    c.beginPath(); d.samples.forEach(function (p, i) { if (i) c.lineTo(X(p.km), Y(p.h)); else c.moveTo(X(p.km), Y(p.h)); });
    c.lineWidth = 1.6; c.strokeStyle = acc; c.stroke();
    c.lineTo(X(d.km), PROF_M.t + chh); c.lineTo(X(0), PROF_M.t + chh); c.closePath(); c.globalAlpha = 0.18; c.fillStyle = acc; c.fill(); c.globalAlpha = 1;
    c.lineWidth = 1; c.strokeStyle = "#ff5a4d"; d.joints.forEach(function (km) { c.beginPath(); c.moveTo(X(km), PROF_M.t); c.lineTo(X(km), PROF_M.t + chh); c.stroke(); });
    if (prof.hover >= 0 && d.samples[prof.hover]) { var hp = d.samples[prof.hover]; c.fillStyle = "#fff"; c.beginPath(); c.arc(X(hp.km), Y(hp.h), 3.5, 0, Math.PI * 2); c.fill(); }
    c.restore();
    c.fillStyle = ink; c.textAlign = "left"; c.textBaseline = "top"; c.fillText("m", 4, PROF_M.t); c.textAlign = "right"; c.fillText("km", w - 4, h - 14);
  }
  function profileCompute() {
    if (measure.pts.length < 2) { prof.data = null; prof.hover = -1; profileDraw(); $("profInfo").textContent = PROF_HELP; $("profPos").textContent = ""; return; }
    if (DEM.failed) { $("profInfo").textContent = "The elevation data could not be loaded."; return; }
    $("profInfo").textContent = "Reading the elevation data";
    loadDem(function () {
      if (measure.pts.length < 2) return;
      var a = measure.pts[0], z = measure.pts[measure.pts.length - 1], legs = measure.pts.length - 1;
      prof.data = U.demProfile(DEM.dem, measure.pts, 2); prof.hover = -1;
      $("profInfo").textContent = "From " + fmtLon(a.lon) + " " + fmtLat(a.lat) + " to " + fmtLon(z.lon) + " " + fmtLat(z.lat) + (legs > 1 ? " in " + legs + " legs" : "") +
        ". Length " + prof.data.km.toFixed(1) + " km, elevation from " + Math.round(prof.data.hmin) + " m to " + Math.round(prof.data.hmax) + " m, from LOLA at 8 pixels per degree.";
      profileDraw(); requestDraw();
    });
  }
  [["profK1", 1], ["profK2", 2], ["profK5", 5], ["profK10", 10], ["profK0", 0]].forEach(function (b) {
    $(b[0]).addEventListener("click", function () {
      prof.scale = b[1];
      [["profK1", 1], ["profK2", 2], ["profK5", 5], ["profK10", 10], ["profK0", 0]].forEach(function (o) { $(o[0]).setAttribute("aria-pressed", o[1] === prof.scale ? "true" : "false"); });
      profileDraw();
    });
  });
  $("profCanvas").addEventListener("pointermove", function (e) {
    var d = prof.data, b = prof.box, ext = prof.ext; if (!d || !b) return;
    var cv = $("profCanvas"), r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / (r.width || 1) * cv.width;
    var km = ext.x0 + (x - b.x) / b.w * (ext.x1 - ext.x0);
    if (km < 0 || km > d.km) { prof.hover = -1; $("profPos").textContent = ""; profileDraw(); requestDraw(); return; }
    var lo = 0, hi = d.samples.length - 1;                   // nearest sample by distance (they are in order)
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (d.samples[mid].km < km) lo = mid; else hi = mid; }
    var i = Math.abs(d.samples[lo].km - km) <= Math.abs(d.samples[hi].km - km) ? lo : hi, sm = d.samples[i];
    prof.hover = i; $("profPos").textContent = "Distance " + sm.km.toFixed(2) + " km, elevation " + Math.round(sm.h) + " m, " + fmtLon(sm.lon) + " " + fmtLat(sm.lat);
    profileDraw(); requestDraw();
  });
  $("profCanvas").addEventListener("pointerleave", function () { if (prof.hover >= 0) { prof.hover = -1; $("profPos").textContent = ""; profileDraw(); requestDraw(); } });
  function saveBlob(b, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  $("profSave").addEventListener("click", function () {
    if (!prof.data) return;
    var z = U.zoneParts(S.date, zone), nm = "oma-profile-" + z.y + pad(z.mo) + pad(z.d) + "-" + pad(z.h) + pad(z.mi);
    if ($("profFmt").value === "csv") saveBlob(new Blob([U.profileCsv(prof.data)], { type: "text/csv" }), nm + ".csv");
    else $("profCanvas").toBlob(function (b) { if (b) saveBlob(b, nm + ".png"); }, "image/png");
  });
  $("tProfile").addEventListener("click", function () {      // opened: start measuring if the Measure tool is not on, then draw what is measured
    if ($("popProfile").hidden) return;
    loadDem(); if (!measure.on) $("tMeasure").click();
    profileCompute();
  });
  $("profHide").addEventListener("click", function () { togglePop("popProfile"); });

  $("mAbout").addEventListener("click", function () { $("aboutDlg").showModal(); });
  // Location: open the observer settings (Ephemeris tab) from the menu bar
  $("mLocation").addEventListener("click", function () {
    document.body.classList.remove("panel-off"); $("tPanel").setAttribute("aria-pressed", "false"); setTimeout(resize, 0);
    $("tabEphem").click(); $("obsSet").open = true;
    $("obsSet").scrollIntoView && $("obsSet").scrollIntoView({ block: "nearest" });
    $("obsCountry").focus();
  });

  /* ---- observer location, altitude, time zone ------------------------------------------------------------------ */
  var PLACES = [];
  function fillObsBoxes() {
    $("obsLat").value = Math.abs(obs.lat); $("obsNS").value = obs.lat < 0 ? "-1" : "1";
    $("obsLon").value = Math.abs(obs.lon); $("obsEW").value = obs.lon < 0 ? "-1" : "1";
    $("obsAlt").value = obs.alt; $("obsMode").value = obs.geo ? "geo" : "topo";
  }
  function obsChanged() {
    var la = parseFloat($("obsLat").value) * parseInt($("obsNS").value, 10), lo = parseFloat($("obsLon").value) * parseInt($("obsEW").value, 10);
    var al = parseFloat($("obsAlt").value);
    if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      obs.lat = la; obs.lon = lo; obs.alt = isFinite(al) ? al : 0; obs.geo = $("obsMode").value === "geo";
      lsSet("oma-obs-lat", la); lsSet("oma-obs-lon", lo); lsSet("oma-obs-alt", obs.alt); lsSet("oma-obs-mode", obs.geo ? "geo" : "topo");
      refreshEphem();
    }
  }
  ["obsLat", "obsLon", "obsAlt", "obsNS", "obsEW", "obsMode"].forEach(function (id) { $(id).addEventListener("change", obsChanged); });
  $("obsGeo").addEventListener("click", function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (p) {
      obs.lat = p.coords.latitude; obs.lon = p.coords.longitude;
      if (isFinite(p.coords.altitude) && p.coords.altitude !== null) obs.alt = Math.round(p.coords.altitude);
      fillObsBoxes(); obsChanged();
    });
  });

  // time zone: "local", "UTC", then every IANA zone the browser knows
  function buildZones() {
    var sl = $("obsTz"), names = [];
    try { names = Intl.supportedValuesOf("timeZone"); } catch (e) { names = []; }
    PLACES.forEach(function (p) { if (names.indexOf(p[4]) < 0) names.push(p[4]); });
    names = names.filter(function (n) { return n !== "UTC"; }).sort();
    sl.textContent = "";
    [["local", "Your device's time zone"], ["UTC", "UTC"]].concat(names.map(function (n) { return [n, n.replace(/_/g, " ")]; })).forEach(function (z) {
      var o = document.createElement("option"); o.value = z[0]; o.textContent = z[1]; sl.appendChild(o);
    });
    sl.value = zone;
  }
  function setZone(z, save) {
    zone = U.zoneValid(z) ? z : "local";
    if (save) lsSet("oma-tz", zone);
    $("obsTz").value = zone;
    $("dt").setAttribute("aria-label", "Date and time (" + zoneLabel() + ")");
    $("dt").title = "Date and time in " + zoneLabel();
    setDate(S.date); renderNotes(); refreshEphem();
  }
  $("obsTz").addEventListener("change", function () { setZone($("obsTz").value, true); });

  // country and city lists (data/places/places.json, approximate city centres)
  function loadPlaces() {
    fetch("data/places/places.json").then(function (r) { return r.json(); }).then(function (j) {
      PLACES = j.places || [];
      var cs = {}; PLACES.forEach(function (p) { cs[p[1]] = 1; });
      var sl = $("obsCountry"); sl.textContent = "";
      var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Choose a country"; sl.appendChild(o0);
      Object.keys(cs).sort().forEach(function (c) { var o = document.createElement("option"); o.value = c; o.textContent = c; sl.appendChild(o); });
      fillCities(""); buildZones();
    }).catch(function () { buildZones(); });
  }
  function fillCities(country) {
    var sl = $("obsCity"); sl.textContent = "";
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = country ? "Choose a city" : "(choose a country first)"; sl.appendChild(o0);
    PLACES.forEach(function (p, i) { if (p[1] === country) { var o = document.createElement("option"); o.value = i; o.textContent = p[0]; sl.appendChild(o); } });
  }
  $("obsCountry").addEventListener("change", function () { fillCities($("obsCountry").value); });
  $("obsCity").addEventListener("change", function () {
    var p = PLACES[parseInt($("obsCity").value, 10)];
    if (!p) return;
    obs.lat = p[2]; obs.lon = p[3]; fillObsBoxes(); obsChanged(); setZone(p[4], true);
  });
  fillObsBoxes();

  /* ---- orbit the Moon: the view turns about the polar axis at a chosen rate -------------------------------------- */
  // "<" moves the surface to the left on screen (the view longitude increases), ">" to the right. Speed is degrees of
  // longitude per second; the 10, 5, 1, 0.5 and 0.2 steps follow Virtual Moon Atlas, whose unit is not documented.
  // Inclination 0 turns the view about the polar axis and keeps its latitude. Any other inclination moves the view centre along a
  // circular path tilted to the equator by that angle (negative runs the other way), through the current centre. Altitude is the
  // height of the viewing spacecraft in km: moving the slider sets the zoom to the area such a spacecraft sees (a rough equivalent,
  // the atlas draws an orthographic globe).
  var orbit = { dir: 0, last: 0, frames: 0, mark: 0, raf: 0, axis: null, p: null };
  function orbitUi() {
    $("orbL").setAttribute("aria-pressed", orbit.dir > 0 ? "true" : "false");
    $("orbR").setAttribute("aria-pressed", orbit.dir < 0 ? "true" : "false");
    if (!orbit.dir) $("orbFps").textContent = "";
  }
  function orbitAim() {                                  // path through the current centre for the chosen inclination
    var inc = parseFloat($("orbInc").value) || 0;
    if (!inc) { orbit.axis = null; return; }
    var o = U.orbitPole(view.lat0, view.lon0, inc);
    orbit.axis = o.pole; orbit.p = o.p;
  }
  function orbitTick(ts) {
    if (!orbit.dir) { orbit.raf = 0; return; }
    var dt = Math.min(0.25, (ts - orbit.last) / 1000), step = parseFloat($("orbSpeed").value) || 1;
    orbit.last = ts; orbit.frames++;
    if (ts - orbit.mark >= 1000) { $("orbFps").textContent = Math.round(orbit.frames * 1000 / (ts - orbit.mark)) + " fps"; orbit.frames = 0; orbit.mark = ts; }
    if (orbit.axis) {
      var inc = parseFloat($("orbInc").value) || 0;
      orbit.p = U.rotateAbout(orbit.p, orbit.axis, orbit.dir * (inc < 0 ? -1 : 1) * step * dt);
      var c = U.fromVec(orbit.p); view.lon0 = c.lon; view.lat0 = c.lat;
    } else view.lon0 = E.norm180(view.lon0 + orbit.dir * step * dt);
    view.free = true;
    bumpInteract(); requestDraw();
    orbit.raf = requestAnimationFrame(orbitTick);
  }
  function orbitSet(dir) {
    orbit.dir = dir; orbitUi();
    if (dir) orbitAim();
    if (dir && !orbit.raf) { orbit.last = performance.now(); orbit.mark = orbit.last; orbit.frames = 0; orbit.raf = requestAnimationFrame(orbitTick); }
  }
  $("orbL").addEventListener("click", function () { orbitSet(orbit.dir > 0 ? 0 : 1); });
  $("orbR").addEventListener("click", function () { orbitSet(orbit.dir < 0 ? 0 : -1); });
  $("orbStop").addEventListener("click", function () { orbitSet(0); });
  $("orbDir").addEventListener("click", function () { if (orbit.dir) orbitSet(-orbit.dir); });
  $("orbAlt").addEventListener("input", function () {
    var a = parseFloat($("orbAlt").value) || 800; $("orbAltOut").textContent = a + " km"; setZoom(U.orbitZoom(a));
  });
  $("orbInc").addEventListener("input", function () {
    var i = parseFloat($("orbInc").value) || 0; $("orbIncOut").textContent = i + "°";
    if (orbit.dir) orbitAim();
  });
  canvas.addEventListener("pointerdown", function () { if (orbit.dir) orbitSet(0); });

  /* ---- full screen, text size ------------------------------------------------------------------------------------ */
  if (!document.documentElement.requestFullscreen) $("tFullscreen").hidden = true;
  $("tFullscreen").addEventListener("click", function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  });
  document.addEventListener("fullscreenchange", function () {
    $("tFullscreen").setAttribute("aria-pressed", document.fullscreenElement ? "true" : "false"); setTimeout(resize, 120);
  });
  var FONTS = [85, 100, 115, 130, 150], fontIdx = 1;
  function setFont(i, save) {
    fontIdx = Math.max(0, Math.min(FONTS.length - 1, i));
    document.documentElement.style.fontSize = FONTS[fontIdx] + "%";
    $("fontDown").disabled = fontIdx === 0; $("fontUp").disabled = fontIdx === FONTS.length - 1;
    if (save) lsSet("oma-font", fontIdx);
    setTimeout(resize, 0);
  }
  $("fontDown").addEventListener("click", function () { setFont(fontIdx - 1, true); });
  $("fontUp").addEventListener("click", function () { setFont(fontIdx + 1, true); });
  setFont(parseInt(lsGet("oma-font", "1"), 10) || 1, false);

  /* ---- display defaults ---------------------------------------------------------------------------------------- */
  function setCtl(id, v) { var el = $(id); if (el.type === "checkbox") el.checked = !!v; else el.value = v; }
  function setPressed(id, on) { $(id).setAttribute("aria-pressed", on ? "true" : "false"); }
  $("dispDefault").addEventListener("click", function () {
    view.term = true; view.grid = false; view.labels = true; view.density = 0.5; view.bright = 1.6; view.libr = true; view.free = false;
    view.manualSun = false; view.scale = true; view.shortNames = false; view.marks = true; view.centerLabels = false; view.gridStep = 30;
    view.termLine = false; view.earth = false; view.markSize = 2.5; view.marksOnly = false; view.detail = 1200; view.sx = 1; view.sy = 1;
    ov.on = false; ov.opacity = 0.5; markHidden = false; view.baseMode = 0; view.reliefK = 3; view.lblStyle = 0; fov.mask = false;
    globeMode(false); view.libr = true;
    setPressed("tTerm", true); setPressed("tLib", true); setPressed("tGrid", false); setPressed("tLabels", true); setPressed("tFlipNS", false); setPressed("tFlipEW", false);
    setCtl("density", 0.5); setCtl("bright", 1.6); setCtl("sunManual", false); $("sun").disabled = true;
    setCtl("oScale", true); setCtl("oMarks", true); setCtl("oCenter", false); setCtl("oTermLine", false); setCtl("oEarth", false);
    setCtl("oShort", false); setCtl("oMarksOnly", false); setCtl("markSize", 2.5); setCtl("renderDetail", 1200); setCtl("gridStep", 30);
    setCtl("ovOn", false); setCtl("ovOpacity", 0.5); setCtl("baseMode", 0); setCtl("reliefK", 3); setCtl("lblStyle", 0); setCtl("fovMask", false); baseModeUi();
    for (var t in view.hidden) delete view.hidden[t];
    Array.prototype.forEach.call($("filterList").querySelectorAll("input"), function (c) { c.checked = true; });
    recompute();
  });

  /* ---- databases: the gazetteer, the Lunar 100 targets, and the features you have notes on -------------------------------- */
  $("dbGaz").addEventListener("change", function () { db.gaz = $("dbGaz").checked; requestDraw(); scheduleList(); });
  $("dbNotes").addEventListener("change", function () { db.notes = $("dbNotes").checked; refreshNoteIds(); requestDraw(); });
  $("dbL100").addEventListener("change", function () {
    L100.on = $("dbL100").checked;
    if (L100.on && !L100.rows) {
      fetch("data/lunar100/lunar100.json").then(function (r) { return r.json(); }).then(function (j) {
        L100.rows = j.rows.filter(function (r) { return r[3] !== null && r[4] !== null; }); requestDraw();
      }).catch(function () { L100.on = false; $("dbL100").checked = false; });
    }
    requestDraw();
  });

  /* ---- start-up credits ---------------------------------------------------------------------------------------- */
  var splashT0 = Date.now(), splashDone = false;
  function splashHide() { if (splashDone) return; splashDone = true; $("splash").hidden = true; try { sessionStorage.setItem("oma-splash", "1"); } catch (e) {} }
  window.OMA.splashReady = function () { splashReady(); };
  function splashReady() { // called when the features and the first map level are in
    if (splashDone) return;
    $("splashState").textContent = "Ready";
    setTimeout(splashHide, Math.max(0, 1800 - (Date.now() - splashT0)));
  }
  (function () {
    var seen = false; try { seen = sessionStorage.getItem("oma-splash") === "1"; } catch (e) {}
    if (seen) { splashDone = true; return; }
    $("splash").hidden = false;
    $("splashGo").addEventListener("click", splashHide);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") splashHide(); });
  })();

  /* ---- glossary: short original definitions (data/glossary/glossary.json), a tree of terms with previous and next ---- */
  var GL = { list: null, idx: 0 };
  function glShow(i) {
    if (!GL.list || !GL.list.length) return;
    GL.idx = (i + GL.list.length) % GL.list.length;
    var e = GL.list[GL.idx], box = $("glEntry");
    box.textContent = "";
    var h = document.createElement("h3"), c = document.createElement("p"), d = document.createElement("p");
    h.textContent = e.t; c.className = "gloss-cat"; c.textContent = e.c; d.textContent = e.d;
    box.appendChild(h); box.appendChild(c); box.appendChild(d);
    Array.prototype.forEach.call($("glTree").querySelectorAll("button"), function (b) { b.setAttribute("aria-current", b.dataset.i === String(GL.idx) ? "true" : "false"); });
  }
  function glBuild(j) {
    GL.list = j.entries;
    var tree = $("glTree"), cats = {}, order = [];
    tree.textContent = "";
    GL.list.forEach(function (e, i) { if (!cats[e.c]) { cats[e.c] = []; order.push(e.c); } cats[e.c].push(i); });
    order.forEach(function (c, ci) {
      var det = document.createElement("details"), sm = document.createElement("summary");
      det.open = ci === 0; sm.textContent = c; det.appendChild(sm);
      cats[c].forEach(function (i) {
        var b = document.createElement("button"); b.type = "button"; b.dataset.i = String(i); b.textContent = GL.list[i].t;
        b.addEventListener("click", function () { glShow(i); });
        det.appendChild(b);
      });
      tree.appendChild(det);
    });
    glShow(0);
  }
  $("mGlossary").addEventListener("click", function () {
    $("glossDlg").showModal();
    if (!GL.list) fetch("data/glossary/glossary.json").then(function (r) { return r.json(); }).then(glBuild)
      .catch(function () { $("glEntry").textContent = "The glossary could not be loaded."; });
  });
  // encyclopedia: every glossary term on one scrolling page, grouped, with a search box (our own short definitions)
  function encRender() {
    var box = $("encBody"), q = $("encFind").value.trim().toLowerCase(), last = "", n = 0;
    box.textContent = "";
    GL.list.forEach(function (e) {
      if (q && e.t.toLowerCase().indexOf(q) < 0 && e.d.toLowerCase().indexOf(q) < 0) return;
      if (e.c !== last) { var h = document.createElement("h3"); h.textContent = e.c; box.appendChild(h); last = e.c; }
      var t = document.createElement("h4"), d = document.createElement("p"); t.textContent = e.t; d.textContent = e.d; box.appendChild(t); box.appendChild(d); n++;
    });
    if (!n) { var p = document.createElement("p"); p.textContent = "No term matches."; box.appendChild(p); }
  }
  $("mEncyclopedia").addEventListener("click", function () {
    $("encDlg").showModal();
    if (GL.list) { encRender(); return; }
    fetch("data/glossary/glossary.json").then(function (r) { return r.json(); }).then(function (j) { glBuild(j); encRender(); })
      .catch(function () { $("encBody").textContent = "The encyclopedia could not be loaded."; });
  });
  $("encFind").addEventListener("input", function () { if (GL.list) encRender(); });
  $("encClose").addEventListener("click", function () { $("encDlg").close(); });
  $("glPrev").addEventListener("click", function () { glShow(GL.idx - 1); });
  $("glNext").addEventListener("click", function () { glShow(GL.idx + 1); });
  $("glClose").addEventListener("click", function () { $("glossDlg").close(); });

  /* ---- telescope: ASCOM Alpaca over REST (scope.js) ----------------------------------------------------------------- */
  var TS = window.OMA.scope, scope = { c: null, caps: {}, st: null, timer: 0, eqSys: 1, rates: [] };
  ["aHost", "aPort", "aDevice", "aUser"].forEach(function (id) { var v = lsGet("oma-" + id, ""); if (v) $(id).value = v; });    // never the password
  function sMsg(t) { $("aMsg").textContent = t; }
  function sFail(e) {
    var m = e && e.message ? e.message : String(e);
    sMsg(/Failed to fetch|NetworkError|Load failed/i.test(m) ? "Could not reach the telescope server. Check the host and port, that the Alpaca server is running, and that it allows this page (CORS). From an https page only localhost works." : m);
  }
  function sUi() {
    var on = !!scope.c, c = scope.caps;
    $("aConnect").disabled = on; $("aDisconnect").disabled = !on;
    $("aTrack").disabled = !on || !c.cansettracking; $("aPark").disabled = !on || !(c.canpark || c.canunpark); $("aAbort").disabled = !on;
    $("aGoto").disabled = !on || !(c.canslewasync || c.canslew); $("aSync").disabled = !on || !c.cansync;
    ["aN", "aS", "aE", "aW", "aStop", "aRate"].forEach(function (id) { $(id).disabled = !on || !c.canmoveaxis; });
  }
  function sShow() {
    var s = scope.st; if (!s) { $("aStatus").textContent = ""; return; }
    function hm(h) { if (h === null || h === undefined) return "n/a"; var hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.round(((h - hh) * 60 - mm) * 60); return hh + "h " + pad(mm) + "m " + pad(ss) + "s"; }
    function dg(v) { return v === null || v === undefined ? "n/a" : v.toFixed(2) + "°"; }
    var eq = { 0: "other", 1: "of date", 2: "J2000", 3: "J2050", 4: "B1950" }[scope.eqSys] || "?";
    rows($("aStatus"), [["Right ascension (" + eq + ")", hm(s.rightascension)], ["Declination", dg(s.declination)], ["Azimuth", dg(s.azimuth)], ["Altitude", dg(s.altitude)],
      ["Tracking", s.tracking === null ? "n/a" : s.tracking ? "on" : "off"], ["Parked", s.atpark === null ? "n/a" : s.atpark ? "yes" : "no"], ["Slewing", s.slewing ? "yes" : "no"],
      ["Axis rates", scope.rates.length ? scope.rates.map(function (r) { return r.Minimum + " to " + r.Maximum + "°/s"; }).join(", ") : "not given"]]);
    $("aTrack").setAttribute("aria-pressed", s.tracking ? "true" : "false");
    $("aPark").textContent = s.atpark ? "Unpark" : "Park";
  }
  function sPoll() {
    if (!scope.c) return;
    scope.c.status().then(function (s) { scope.st = s; if (s.equatorialsystem !== null && s.equatorialsystem !== undefined) scope.eqSys = s.equatorialsystem; sShow(); }).catch(sFail);
  }
  function sStart() { clearInterval(scope.timer); scope.timer = setInterval(sPoll, parseInt($("aRead").value, 10) || 2000); sPoll(); }
  function sClient() {
    ["aHost", "aPort", "aDevice", "aUser"].forEach(function (id) { lsSet("oma-" + id, $(id).value); });
    return TS.AlpacaScope({ host: $("aHost").value.trim() || "localhost", port: parseInt($("aPort").value, 10) || 11111,
                            device: parseInt($("aDevice").value, 10) || 0, user: $("aUser").value, pass: $("aPass").value });
  }
  $("aConnect").addEventListener("click", function () {
    var c = sClient(); sMsg("Connecting");
    c.connect().then(function () { return Promise.all([c.capabilities(), c.axisRates(0).catch(function () { return []; })]); }).then(function (r) {
      scope.c = c; scope.caps = r[0]; scope.rates = r[1] || [];
      var mx = scope.rates.reduce(function (m, x) { return Math.max(m, x.Maximum || 0); }, 0) || 1, rs = $("aRate"); rs.textContent = "";
      [["Slow", mx * 0.05], ["Medium", mx * 0.3], ["Fast", mx]].forEach(function (x) { var o = document.createElement("option"); o.value = x[1]; o.textContent = x[0] + " (" + x[1].toPrecision(2) + "°/s)"; rs.appendChild(o); });
      sUi(); sStart(); sMsg("Connected to " + c.base);
    }).catch(function (e) { scope.c = null; sUi(); sFail(e); });
  });
  $("aDisconnect").addEventListener("click", function () {
    var c = scope.c; clearInterval(scope.timer); scope.c = null; scope.st = null; sUi(); sShow();
    if (c) c.disconnect().then(function () { sMsg("Disconnected"); }).catch(sFail);
  });
  $("aSelect").addEventListener("click", function () {
    sClient().devices().then(function (list) {
      var sl = $("aDevList"); sl.textContent = "";
      list.filter(function (d) { return /telescope/i.test(d.DeviceType); }).forEach(function (d) {
        var o = document.createElement("option"); o.value = d.DeviceNumber; o.textContent = d.DeviceName + " (device " + d.DeviceNumber + ")"; sl.appendChild(o);
      });
      sl.hidden = !sl.children.length; sMsg(sl.children.length ? "Pick a telescope, then Connect." : "The server lists no telescope.");
      if (sl.children.length) { $("aDevice").value = sl.value; $("aDevName").value = sl.children[0].textContent; }
    }).catch(sFail);
  });
  $("aDevList").addEventListener("change", function () { $("aDevice").value = $("aDevList").value; $("aDevName").value = Array.prototype.filter.call($("aDevList").children, function (o) { return o.value === $("aDevList").value; }).map(function (o) { return o.textContent; })[0] || ""; });
  $("aConfig").addEventListener("click", function () { window.open(sClient().setupUrl(), "_blank", "noopener"); });
  $("aAbout").addEventListener("click", function () {
    sClient().description().then(function (d) { sMsg("Server: " + [d.ServerName, d.Manufacturer, d.ManufacturerVersion, d.Location].filter(Boolean).join(", ")); }).catch(sFail);
  });
  $("aTrack").addEventListener("click", function () { if (scope.c) scope.c.setTracking(!(scope.st && scope.st.tracking)).then(sPoll).catch(sFail); });
  $("aPark").addEventListener("click", function () { if (scope.c) (scope.st && scope.st.atpark ? scope.c.unpark() : scope.c.park()).then(sPoll).catch(sFail); });
  $("aAbort").addEventListener("click", function () { if (scope.c) scope.c.abort().then(sPoll).catch(sFail); });
  // the selected feature as RA and Dec for right now, in the mount's equatorial system
  function selectedRaDec() {
    if (!sel) { sMsg("Select a feature on the atlas first."); return null; }
    var now = new Date(), r = TS.featureRaDec(now, sel.lat, sel.lon, obs.lat, obs.lon, obs.alt);
    if (r.z <= 0) { sMsg(sel.name + " is on the far side from Earth right now."); return null; }
    var ra = r.ra, dec = r.dec;
    if (scope.eqSys === 2) { var j = TS.toJ2000(now, ra, dec); ra = j.ra; dec = j.dec; }
    else if (scope.eqSys !== 1) sMsg("The mount reports an equatorial system other than of-date or J2000; sending of-date coordinates.");
    return { ra: ra, dec: dec };
  }
  $("aGoto").addEventListener("click", function () {
    var p = scope.c && selectedRaDec(); if (!p) return;
    var go = scope.caps.canslewasync ? scope.c.slewTo(p.ra, p.dec) : Promise.reject(new Error("This mount cannot slew asynchronously."));
    go.then(function () { sMsg("Slewing to " + sel.name); sPoll(); }).catch(sFail);
  });
  $("aSync").addEventListener("click", function () {
    var p = scope.c && selectedRaDec(); if (!p) return;
    scope.c.syncTo(p.ra, p.dec).then(function () { sMsg("Mount synced on " + sel.name); sPoll(); }).catch(sFail);
  });
  [["aN", 1, 1], ["aS", 1, -1], ["aE", 0, 1], ["aW", 0, -1]].forEach(function (d) {
    var b = $(d[0]);
    function stop() { if (scope.c && b.dataset.moving) { delete b.dataset.moving; scope.c.moveAxis(d[1], 0).catch(sFail); } }
    b.addEventListener("pointerdown", function () {
      var rate = parseFloat($("aRate").value) || 0;
      if (!scope.c || !rate) return; b.dataset.moving = "1";
      scope.c.moveAxis(d[1], d[2] * rate).catch(sFail);
    });
    b.addEventListener("pointerup", stop); b.addEventListener("pointerleave", stop); b.addEventListener("pointercancel", stop);
  });
  $("aStop").addEventListener("click", function () { if (scope.c) { scope.c.moveAxis(0, 0).then(function () { return scope.c.moveAxis(1, 0); }).then(function () { return scope.c.abort(); }).catch(sFail); } });
  $("aRead").addEventListener("change", function () { if (scope.c) sStart(); });
  $("aHide").addEventListener("click", function () { togglePop("popScope"); });
  sUi();

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
    var p = pos(e); drag = { x: p.x, y: p.y, lon0: view.lon0, lat0: view.lat0, px0: view.px, py0: view.py, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    var p = pos(e), g = geom();
    if (drag) {
      var dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved && !view.globe) {                    // Earth view: move the picture, the sphere does not turn
        view.px = drag.px0 + dx; view.py = drag.py0 + dy; clampPan(); bumpInteract(); requestDraw();
      } else if (drag.moved) {
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
    if (!s) $("sElev").textContent = "—";
    else if (DEM.dem) $("sElev").textContent = (Math.round(U.demHeight(DEM.dem, s.lat, s.lon) / 10) * 10).toLocaleString() + " m";
    else { $("sElev").textContent = "…"; loadDem(); }
  });
  canvas.addEventListener("pointerup", function (e) {
    if (drag && !drag.moved) {
      var p = pos(e), s = fromScreen(p.x, p.y);
      if (measure.on) {
        if (s && !outsideMask(p)) {
          if (e.shiftKey && measure.pts.length >= 2) measure.pts.push(s);       // Shift-click adds another leg
          else { if (measure.pts.length >= 2) measure.pts = []; measure.pts.push(s); }
          if (measure.pts.length >= 2) {
            var legs = measure.pts.length - 1, tot = 0, r = null;
            for (var li = 0; li < legs; li++) { r = distBearing(measure.pts[li], measure.pts[li + 1]); tot += r.km; }
            measure.text = legs === 1 ? "Distance " + r.km.toFixed(1) + " km (great circle), bearing " + r.bearing.toFixed(0) + "°"
              : "Total " + tot.toFixed(1) + " km over " + legs + " legs, last leg " + r.km.toFixed(1) + " km, bearing " + r.bearing.toFixed(0) + "°";
            $("readoutText").textContent = measure.text + ". Click to measure again, Shift-click adds a leg, Esc to stop."; $("readoutActions").hidden = false;
          } else { $("readoutText").textContent = "Click a second point."; $("readoutActions").hidden = true; }
          if (!$("popProfile").hidden) profileCompute();
          requestDraw();
        }
      } else if (!outsideMask(pos(e)) && db.gaz) {
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
  zone = U.zoneValid(lsGet("oma-tz", "local")) ? lsGet("oma-tz", "local") : "local";
  $("dt").setAttribute("aria-label", "Date and time (" + zoneLabel() + ")");
  window.addEventListener("resize", function () { resize(); scheduleList(); });
  setDate(new Date());
  loadLayer(LAYERS[0]);
  loadFeatures();
  loadAtlas();
  loadPlaces();
  fovFill();
  resize();
  setInterval(function () { if (!S.live) return; }, 60000);
})();
