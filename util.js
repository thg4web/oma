/* OMA small helpers kept apart from the page so they can be tested in node (project/tools/test_util.js):
   time zone arithmetic, BMP encoding, the terminator curve, the visible area of the globe, elevation and profiles, label styles and the orbit path. */
(function (root) {
  "use strict";
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ---- time zones: "local" is the browser zone, "UTC", or an IANA name such as Europe/London ---- */
  var fmtCache = {};
  function zoneFormatter(tz) {
    if (!fmtCache[tz]) {
      fmtCache[tz] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    return fmtCache[tz];
  }
  // calendar fields of an instant as seen in the zone
  function zoneParts(d, tz) {
    if (!tz || tz === "local") {
      return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
    }
    var o = {};
    zoneFormatter(tz).formatToParts(d).forEach(function (p) { o[p.type] = parseInt(p.value, 10); });
    return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
  }
  // offset of the zone from UTC in milliseconds at an instant
  function zoneOffsetMs(ms, tz) {
    var p = zoneParts(new Date(ms), tz), t = Math.floor(ms / 1000) * 1000;
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - t;
  }
  // the instant whose wall-clock fields in the zone are y-mo-d h:mi (two passes settle the daylight saving edge)
  function fromZoneParts(y, mo, d, h, mi, tz) {
    if (!tz || tz === "local") return new Date(y, mo - 1, d, h, mi, 0, 0);
    var guess = Date.UTC(y, mo - 1, d, h, mi, 0), o1 = zoneOffsetMs(guess, tz), t = guess - o1, o2 = zoneOffsetMs(t, tz);
    if (o2 !== o1) t = guess - o2;
    return new Date(t);
  }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  // "YYYY-MM-DDTHH:mm" for a datetime-local box
  function toInputValue(d, tz) {
    var p = zoneParts(d, tz);
    return p.y + "-" + pad2(p.mo) + "-" + pad2(p.d) + "T" + pad2(p.h) + ":" + pad2(p.mi);
  }
  function fromInputValue(str, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str || "");
    return m ? fromZoneParts(+m[1], +m[2], +m[3], +m[4], +m[5], tz) : new Date(NaN);
  }
  function zoneValid(tz) {
    if (!tz || tz === "local") return true;
    try { zoneFormatter(tz); return true; } catch (e) { return false; }
  }

  /* ---- BMP: 24 bit, uncompressed, from canvas RGBA pixels ---- */
  function encodeBMP(rgba, w, h) {
    var rowBytes = Math.ceil(w * 3 / 4) * 4, size = 54 + rowBytes * h, buf = new Uint8Array(size), dv = new DataView(buf.buffer);
    buf[0] = 0x42; buf[1] = 0x4d;
    dv.setUint32(2, size, true); dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, rowBytes * h, true);
    dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
    for (var y = 0; y < h; y++) {
      var src = (h - 1 - y) * w * 4, dst = 54 + y * rowBytes;       // bottom row first
      for (var x = 0; x < w; x++) {
        buf[dst + x * 3] = rgba[src + x * 4 + 2]; buf[dst + x * 3 + 1] = rgba[src + x * 4 + 1]; buf[dst + x * 3 + 2] = rgba[src + x * 4];
      }
    }
    return buf;
  }

  /* ---- the terminator: the great circle 90 degrees from the sub-solar point ---- */
  // sv is the Sun unit vector in OMA's convention (x = cos lat sin lon, y = sin lat, z = cos lat cos lon)
  function terminatorPoints(sv, n) {
    var a = Math.abs(sv[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    var u = [sv[1] * a[2] - sv[2] * a[1], sv[2] * a[0] - sv[0] * a[2], sv[0] * a[1] - sv[1] * a[0]];
    var ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
    var v = [sv[1] * u[2] - sv[2] * u[1], sv[2] * u[0] - sv[0] * u[2], sv[0] * u[1] - sv[1] * u[0]], out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      var p = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
      out.push({ lat: Math.asin(Math.max(-1, Math.min(1, p[1]))) * R2D, lon: Math.atan2(p[0], p[2]) * R2D });
    }
    return out;
  }

  /* ---- area of the lunar surface inside a screen rectangle, by sampling (orthographic, so tilt-corrected) ----
     inside(px, py) returns the cosine of the angle from the view axis (the z of the sphere point) or 0 when off the disc */
  function visibleAreaKm2(w, h, kmPerPx, inside, nx, ny) {
    var sum = 0, cnt = 0;
    for (var i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
      var z = inside((i + 0.5) / nx * w, (j + 0.5) / ny * h);
      // near the limb 1/z blows up; the rim band z < 0.05 holds 5% of the hemisphere in about 0.1% of the pixels, so weight it by 2/0.05
      if (z > 0.05) sum += 1 / z; else if (z > 0) sum += 40;
      cnt++;
    }
    return cnt ? sum / cnt * w * h * kmPerPx * kmPerPx : 0;
  }

  /* ---- elevation (data/dem/ldem-8ppd.png, LOLA): 2880 x 1440, lon -180..180 east, lat +90..-90, pixel registered ----
     The PNG stores (round(h / 10) + 1000) as R * 256 + G, so a grid cell holds the height in units of 10 m. */
  var MOON_R_KM = 1737.4;
  function demFromRGBA(rgba, w, h) {
    var d = new Int16Array(w * h);
    for (var i = 0; i < d.length; i++) d[i] = (rgba[i * 4] * 256 + rgba[i * 4 + 1]) - 1000;
    return { w: w, h: h, d: d };
  }
  // bilinear height in metres, longitude wraps, latitude is clamped at the poles
  function demHeight(dem, lat, lon) {
    var w = dem.w, h = dem.h, x = (lon + 180) / 360 * w - 0.5, y = (90 - lat) / 180 * h - 0.5;
    var i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    var i0 = ((i % w) + w) % w, i1 = (i0 + 1) % w, j0 = Math.max(0, Math.min(h - 1, j)), j1 = Math.max(0, Math.min(h - 1, j + 1)), d = dem.d;
    var a = d[j0 * w + i0], b = d[j0 * w + i1], c = d[j1 * w + i0], e = d[j1 * w + i1];
    return ((a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy) * 10;
  }
  // slope of the ground as rise over run, towards the east and towards the north (central difference over one cell)
  function demSlope(dem, lat, lon) {
    var st = 180 / dem.h, cl = Math.max(0.05, Math.cos(lat * D2R)), mPerDegN = MOON_R_KM * 1000 * D2R, mPerDegE = mPerDegN * cl;
    var dE = (demHeight(dem, lat, lon + st) - demHeight(dem, lat, lon - st)) / (2 * st * mPerDegE);
    var dN = (demHeight(dem, Math.min(90, lat + st), lon) - demHeight(dem, Math.max(-90, lat - st), lon)) / (2 * st * mPerDegN);
    return { e: dE, n: dN };
  }
  // slope grids for fast shading: east and north slope per cell as Int16 in units of 1 / SLOPE_UNIT
  var SLOPE_UNIT = 20000;
  function demSlopeGrids(dem) {
    var w = dem.w, h = dem.h, d = dem.d, se = new Int16Array(w * h), sn = new Int16Array(w * h), cell = MOON_R_KM * 1000 * D2R * 180 / h;
    for (var j = 0; j < h; j++) {
      var lat = 90 - (j + 0.5) * 180 / h, ce = cell * Math.max(0.05, Math.cos(lat * D2R)), ja = j > 0 ? j - 1 : 0, jb = j < h - 1 ? j + 1 : h - 1;
      for (var i = 0; i < w; i++) {
        var ia = i > 0 ? i - 1 : w - 1, ib = i < w - 1 ? i + 1 : 0;
        var e = (d[j * w + ib] - d[j * w + ia]) * 10 / (2 * ce), n = (d[ja * w + i] - d[jb * w + i]) * 10 / ((jb - ja) * cell);
        se[j * w + i] = Math.max(-32767, Math.min(32767, Math.round(e * SLOPE_UNIT)));
        sn[j * w + i] = Math.max(-32767, Math.min(32767, Math.round(n * SLOPE_UNIT)));
      }
    }
    return { e: se, n: sn, w: w, h: h, unit: SLOPE_UNIT };
  }
  // bilinear value of a grid of the same layout as the elevation grid
  function gridSample(a, w, h, lat, lon) {
    var x = (lon + 180) / 360 * w - 0.5, y = (90 - lat) / 180 * h - 0.5, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    var i0 = ((i % w) + w) % w, i1 = (i0 + 1) % w, j0 = Math.max(0, Math.min(h - 1, j)), j1 = Math.max(0, Math.min(h - 1, j + 1));
    var p = a[j0 * w + i0], q = a[j0 * w + i1], r = a[j1 * w + i0], t = a[j1 * w + i1];
    return (p + (q - p) * fx) * (1 - fy) + (r + (t - r) * fx) * fy;
  }
  // cosine of the Sun's incidence on a surface tilted by the slope, k times exaggerated; the Sun vector is in OMA's convention
  // (x = cos lat sin lon, y = sin lat, z = cos lat cos lon). The normal of the sphere is the point itself.
  function reliefLambert(sv, lat, lon, slope, k) {
    var v = toVec(lat, lon);
    return reliefLambertV(sv, v[0], v[1], v[2], slope.e, slope.n, k);
  }
  // the same from the point's unit vector (x, y, z) and the east and north slopes, without trigonometry (used per pixel)
  function reliefLambertV(sv, x, y, z, se, sn, k) {
    var cl = Math.hypot(x, z), co, so;
    if (cl < 1e-9) { co = 1; so = 0; } else { co = z / cl; so = x / cl; }
    var sl = y, ex = co, ez = -so, nx0 = -sl * so, ny0 = cl, nz0 = -sl * co;
    var nx = x - k * (se * ex + sn * nx0), ny = y - k * sn * ny0, nz = z - k * (se * ez + sn * nz0);
    var l = Math.hypot(nx, ny, nz);
    return Math.max(0, (nx * sv[0] + ny * sv[1] + nz * sv[2]) / l);
  }
  // colour ramp for the elevation overlay, metres to [r, g, b]: dark blue lows through green and yellow to white highs
  var RAMP = [[-9000, 20, 30, 120], [-5000, 40, 90, 190], [-2500, 60, 170, 190], [-500, 90, 190, 120], [1000, 210, 210, 90], [4000, 215, 130, 60], [7000, 190, 70, 60], [10500, 250, 240, 240]];
  function elevColour(hm) {
    if (hm <= RAMP[0][0]) return [RAMP[0][1], RAMP[0][2], RAMP[0][3]];
    for (var i = 1; i < RAMP.length; i++) {
      if (hm <= RAMP[i][0]) {
        var a = RAMP[i - 1], b = RAMP[i], t = (hm - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
      }
    }
    var z = RAMP[RAMP.length - 1]; return [z[1], z[2], z[3]];
  }

  /* ---- great-circle legs and the height profile along them ---- */
  function legPoints(a, b, n) {
    var cl = Math.cos(a.lat * D2R), va = [cl * Math.sin(a.lon * D2R), Math.sin(a.lat * D2R), cl * Math.cos(a.lon * D2R)];
    cl = Math.cos(b.lat * D2R); var vb = [cl * Math.sin(b.lon * D2R), Math.sin(b.lat * D2R), cl * Math.cos(b.lon * D2R)];
    var dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])), om = Math.acos(dot), out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, s1 = om ? Math.sin((1 - t) * om) / Math.sin(om) : 1 - t, s2 = om ? Math.sin(t * om) / Math.sin(om) : t;
      var v = [s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]];
      out.push({ lat: Math.asin(Math.max(-1, Math.min(1, v[1]))) * R2D, lon: Math.atan2(v[0], v[2]) * R2D });
    }
    return { pts: out, km: om * MOON_R_KM };
  }
  // pts: two or more {lat, lon}; each consecutive pair is a leg. Returns samples {km, h, lat, lon}, the joints (km along the
  // profile where a leg ends) and the height range. About perCell samples per grid cell, at least 2 per leg.
  function demProfile(dem, pts, perCell) {
    var cellKm = MOON_R_KM * D2R * 180 / dem.h, out = [], joints = [], run = 0, hmin = Infinity, hmax = -Infinity;
    for (var i = 0; i + 1 < pts.length; i++) {
      var probe = legPoints(pts[i], pts[i + 1], 2), n = Math.max(2, Math.min(4000, Math.ceil(probe.km / cellKm * (perCell || 2))));
      var leg = legPoints(pts[i], pts[i + 1], n);
      for (var k = (i ? 1 : 0); k <= n; k++) {
        var p = leg.pts[k], h = demHeight(dem, p.lat, p.lon), km = run + leg.km * k / n;
        out.push({ km: km, h: h, lat: p.lat, lon: p.lon }); if (h < hmin) hmin = h; if (h > hmax) hmax = h;
      }
      run += leg.km; if (i + 2 < pts.length) joints.push(run);
    }
    return { samples: out, joints: joints, km: run, hmin: hmin, hmax: hmax };
  }
  // chart limits like Virtual Moon Atlas: scale 0 fits the heights ("Max"); scale k draws k times vertical exaggeration
  // (1 is true proportions): the chart is chartW x chartH pixels, the profile km long, heights hmin..hmax metres.
  function profileExtent(km, hmin, hmax, scale, chartW, chartH) {
    var dist = km * 1000, rng = Math.max(1, hmax - hmin), pad = 0.03 * rng;
    if (!scale) return { x0: 0, x1: km, y0: hmin - pad, y1: hmax + pad };
    var rc = chartH / chartW, rs = scale * rng / dist;
    if (rc >= rs) { var yy = dist * rc, dy = (yy - scale * rng) / 2 / scale; return { x0: 0, x1: km, y0: hmin - dy, y1: hmax + dy }; }
    return { x0: 0, x1: scale * rng / rc / 1000, y0: hmin - pad, y1: hmax + pad };
  }
  function profileCsv(prof) {
    var s = "index;distance_km;elevation_m;latitude;longitude\n";
    prof.samples.forEach(function (p, i) { s += i + ";" + p.km.toFixed(3) + ";" + p.h.toFixed(1) + ";" + p.lat.toFixed(4) + ";" + p.lon.toFixed(4) + "\n"; });
    return s;
  }

  /* ---- smallest telescope aperture (mm) that shows a feature, estimated from its size ----
     Dawes limit 116 / D arcsec, and a feature needs about 3 resolution elements across to be recognised. This is an estimate from
     size alone, not a rating of how easy the feature is. */
  function apertureMm(diamKm, distKm) {
    if (!(diamKm > 0)) return 999;
    var arcsec = diamKm / (distKm || 384400) * 206265;
    return Math.max(1, Math.ceil(116 * 3 / arcsec));
  }
  // the smallest diameter (km) that an aperture shows, the inverse of apertureMm
  function minDiamKm(aperMm, distKm) { return 116 * 3 / aperMm * (distKm || 384400) / 206265; }

  /* ---- label styles as in Virtual Moon Atlas: 0 full; 1 main features as a star, satellite craters as "Cop A"; 2 star and the letter ----
     A satellite crater is a Satellite Feature named for its parent with one capital letter: "Von Karman M". Returns the text and whether
     it is a star mark in place of a name. */
  function labelText(name, type, mode) {
    if (!mode) return { text: name, star: false };
    var m = /^(.*\S) ([A-Z])$/.exec(name);
    if (type === "Satellite Feature" && m) return { text: mode === 1 ? name.slice(0, 3) + " " + m[2] : m[2], star: false };
    return { text: "*", star: true };
  }

  /* ---- orbit view: the view centre moves along a circular path about a pole tilted by the inclination ----
     Unit vectors in OMA's convention (x east, y north, z towards the Earth at 0, 0). The path is chosen to pass through the
     current centre; if that latitude is further from the equator than the inclination allows, the centre is moved to the
     latitude limit. Inclination 0 keeps the old behaviour (turn about the polar axis, latitude unchanged), handled by the caller. */
  function toVec(lat, lon) { var c = Math.cos(lat * D2R); return [c * Math.sin(lon * D2R), Math.sin(lat * D2R), c * Math.cos(lon * D2R)]; }
  function fromVec(v) { return { lat: Math.asin(Math.max(-1, Math.min(1, v[1]))) * R2D, lon: Math.atan2(v[0], v[2]) * R2D }; }
  function orbitPole(lat, lon, incDeg) {
    var inc = Math.min(89.9, Math.max(0.1, Math.abs(incDeg))) * D2R, lim = inc * R2D;
    if (Math.abs(lat) > lim) lat = lat < 0 ? -lim : lim;
    var p = toVec(lat, lon), c = Math.hypot(p[0], p[2]), q = c < 1e-9 ? [1, 0] : [p[0] / c, p[2] / c], qp = [-q[1], q[0]];
    var a = -Math.cos(inc) * p[1] / (c < 1e-9 ? 1 : c), b = Math.sqrt(Math.max(0, Math.sin(inc) * Math.sin(inc) - a * a));
    var pole = [a * q[0] + b * qp[0], Math.cos(inc), a * q[1] + b * qp[1]];
    return { pole: pole, lat: lat, p: p };
  }
  // rotate v about the unit axis by angle (degrees), Rodrigues
  function rotateAbout(v, axis, deg) {
    var t = deg * D2R, c = Math.cos(t), s = Math.sin(t), k = axis, d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    var cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    return [v[0] * c + cr[0] * s + k[0] * d * (1 - c), v[1] * c + cr[1] * s + k[1] * d * (1 - c), v[2] * c + cr[2] * s + k[2] * d * (1 - c)];
  }
  // zoom at which the globe fills the view the way a spacecraft at this altitude (km) sees it: the visible cap has a half-angle
  // acos(R / (R + h)), and the disc is drawn at 1 / sin(that). A rough equivalent: the atlas draws an orthographic globe, not a perspective one.
  function orbitZoom(altKm) {
    var a = Math.acos(MOON_R_KM / (MOON_R_KM + Math.max(1, altKm)));
    return Math.max(1, Math.min(8, 1 / Math.sin(a)));
  }

  /* ---- libration arrow: direction and length from the libration in longitude and latitude (degrees) ---- */
  function librationArrow(libLon, libLat) { return { angle: Math.atan2(libLat, libLon), mag: Math.hypot(libLon, libLat) }; }

  var api = { zoneParts: zoneParts, zoneOffsetMs: zoneOffsetMs, fromZoneParts: fromZoneParts, toInputValue: toInputValue,
              fromInputValue: fromInputValue, zoneValid: zoneValid, encodeBMP: encodeBMP, terminatorPoints: terminatorPoints,
              visibleAreaKm2: visibleAreaKm2,
              demFromRGBA: demFromRGBA, demHeight: demHeight, demSlope: demSlope, demSlopeGrids: demSlopeGrids, gridSample: gridSample, reliefLambert: reliefLambert, reliefLambertV: reliefLambertV, elevColour: elevColour,
              legPoints: legPoints, demProfile: demProfile, profileExtent: profileExtent, profileCsv: profileCsv, apertureMm: apertureMm,
              minDiamKm: minDiamKm, labelText: labelText, orbitPole: orbitPole, rotateAbout: rotateAbout, orbitZoom: orbitZoom,
              librationArrow: librationArrow, toVec: toVec, fromVec: fromVec };
  root.OMA = root.OMA || {};
  root.OMA.util = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
