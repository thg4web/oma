/* OMA small helpers kept apart from the page so they can be tested in node (project/tools/test_util.js):
   time zone arithmetic, BMP encoding, the terminator curve and the visible area of the globe. */
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

  var api = { zoneParts: zoneParts, zoneOffsetMs: zoneOffsetMs, fromZoneParts: fromZoneParts, toInputValue: toInputValue,
              fromInputValue: fromInputValue, zoneValid: zoneValid, encodeBMP: encodeBMP, terminatorPoints: terminatorPoints,
              visibleAreaKm2: visibleAreaKm2 };
  root.OMA = root.OMA || {};
  root.OMA.util = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
