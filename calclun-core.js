/* CalcLun calculations for Observer's Moon Atlas: the ephemeris tables, the Sun and Moon rise and set, the twilights,
   the lunar phases and the predictions (colongitude, Sun elevation on a formation, libration), the same tasks as VMA's CalcLun.
   Built on astronomy-engine, ephem.js and scope.js. Browser and node (project/tools/test_calclun.js).
   Angles in degrees, right ascension in hours, distance in km, time as JS Date. An observer is {lat, lon (east positive), alt (m), tz}. */
(function (root) {
  "use strict";
  var A = root.Astronomy, E = root.OMA.ephem, S = root.OMA.scope, U = root.OMA.util;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, AU_KM = 149597870.7, R_MOON = 1737.4, HOUR = 3600000, DAY = 86400000;
  var n180 = E.norm180, n360 = E.norm360;

  function obsOf(o) { return new A.Observer(o.lat, o.lon, o.alt || 0); }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  /* ---- topocentric libration: the geocentric value plus the shift of the sub-observer point (diurnal libration) ---- */
  function topoLibration(date, o, st) {
    var gv = A.GeoVector(A.Body.Moon, date, true), ov = A.ObserverVector(date, obsOf(o), false);
    var eq = A.EquatorFromVector(gv), ra = eq.ra * 15 * D2R, de = eq.dec * D2R, dist = gv.Length();
    var east = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 };
    var north = { x: -Math.sin(de) * Math.cos(ra), y: -Math.sin(de) * Math.sin(ra), z: Math.cos(de) };
    var dE = dot(ov, east) / dist, dN = dot(ov, north) / dist;                 // observer offset seen from the Moon, radians
    var P = S.axisPA(date, eq.ra * 15, st.libLat) * D2R, b = st.libLat * D2R;
    var dx = -dE * Math.cos(P) + dN * Math.sin(P), dy = dE * Math.sin(P) + dN * Math.cos(P);
    return { lon: st.libLon + dx * R2D / Math.cos(b), lat: st.libLat + dy * R2D };
  }

  /* ---- one row of the ephemeris: every column CalcLun shows, at an instant ---- */
  function moonRow(date, o) {
    var st = E.compute(date), obsr = obsOf(o);
    var gv = A.GeoVector(A.Body.Moon, date, true), ov = A.ObserverVector(date, obsr, false);
    var tv = new A.Vector(gv.x - ov.x, gv.y - ov.y, gv.z - ov.z, gv.t), r = tv.Length() * AU_KM;
    var j2 = A.EquatorFromVector(tv);
    var ap = A.Equator(A.Body.Moon, date, obsr, true, true);
    var hor = A.Horizon(date, obsr, ap.ra, ap.dec, "normal");
    var lib = topoLibration(date, o, st);
    var age = (date - E.lastNewMoon(new Date(date.getTime() + 1000))) / DAY;
    return {
      date: date, ra2000: j2.ra, de2000: j2.dec, ra: ap.ra, de: ap.dec, dist: r,
      diam: 60 * R2D * Math.atan(2 * R_MOON / r),                               // arc minutes
      phase: n360(180 - st.phaseDeg),                                           // VMA's phase: full 0, first quarter 90, new 180, last quarter 270
      lunation: age, illum: st.illum * 100, colong: st.colong, subSolLat: st.sunLat,
      libLon: lib.lon, libLat: lib.lat,
      pa: S.axisPA(date, ap.ra * 15, lib.lat),
      alt: hor.altitude, az: hor.azimuth, st: st
    };
  }

  /* ---- sexagesimal text ---- */
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function hms(h, fixed) {                                                     // hours to h:mm:ss
    var s = Math.round(((h % 24) + 24) % 24 * 3600), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    if (hh === 24) hh = 0;
    return pad2(hh) + ":" + pad2(mm) + (fixed === "hm" ? "" : ":" + pad2(ss));
  }
  function ra2str(h) { var s = Math.round(((h % 24) + 24) % 24 * 36000), hh = Math.floor(s / 36000) % 24, mm = Math.floor(s % 36000 / 600), ss = (s % 600) / 10; return hh + "h " + pad2(mm) + "m " + (ss < 10 ? "0" : "") + ss.toFixed(1) + "s"; }
  function dec2str(d) { var sg = d < 0 ? "-" : "+", a = Math.abs(d), s = Math.round(a * 3600), dd = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return sg + pad2(dd) + "° " + pad2(mm) + "' " + pad2(ss) + '"'; }
  function deg2str(d, ew) {                                                    // signed degrees and minutes
    var sg = d < 0 ? "-" : "", a = Math.abs(d), dd = Math.floor(a), mm = Math.round((a - dd) * 60);
    if (mm === 60) { dd++; mm = 0; }
    return sg + dd + "° " + pad2(mm) + "'";
  }

  /* ---- windows: instants where a margin (positive inside) holds; skips ahead by the bound on how fast the margin can change ---- */
  function scanWindows(f, t0, t1, minStepMs, ratePerHour) {
    var out = [], t = t0, m = f(t), inside = m >= 0, start = inside ? t0 : null;
    while (t < t1) {
      var adv = Math.max(minStepMs, Math.abs(m) / ratePerHour * HOUR * 0.9), tn = Math.min(t + adv, t1), mn = f(tn);
      if ((mn >= 0) !== inside) {
        var lo = t, hi = tn, up = !inside;
        for (var k = 0; k < 22; k++) {
          var mid = (lo + hi) / 2;
          if ((f(mid) >= 0) === up) hi = mid; else lo = mid;
        }
        var tc = (lo + hi) / 2;
        if (inside) out.push([start, tc]); else start = tc;
        inside = !inside;
      }
      t = tn; m = mn;
    }
    if (inside) out.push([start, t1]);
    return out;
  }
  // keep the parts of the windows where the margin holds
  function restrict(wins, f, minStepMs, ratePerHour) {
    var out = [];
    wins.forEach(function (w) { scanWindows(f, w[0], w[1], minStepMs, ratePerHour).forEach(function (x) { out.push(x); }); });
    return out;
  }
  // merge touching windows (a restriction can split one at a step edge)
  function tidy(wins) {
    var out = [];
    wins.filter(function (w) { return w[1] - w[0] > 1000; }).forEach(function (w) {
      var last = out[out.length - 1];
      if (last && w[0] - last[1] < 2000) last[1] = w[1]; else out.push([w[0], w[1]]);
    });
    return out;
  }

  /* ---- Sun and Moon altitude at the observer ---- */
  function sunAlt(ms, o) {
    var d = new Date(ms), obsr = obsOf(o), eq = A.Equator(A.Body.Sun, d, obsr, true, true);
    return A.Horizon(d, obsr, eq.ra, eq.dec, null).altitude;
  }
  function moonAlt(ms, o) {
    var d = new Date(ms), obsr = obsOf(o), eq = A.Equator(A.Body.Moon, d, obsr, true, true);
    return A.Horizon(d, obsr, eq.ra, eq.dec, null).altitude;
  }

  // observer constraints of the prediction pages: Moon above a height, Sun below a height
  function constrain(wins, o, c) {
    if (c.moonVisible) wins = restrict(wins, function (t) { return moonAlt(t, o) - c.moonMin; }, 3 * 60000, 16);
    if (c.night) wins = restrict(wins, function (t) { return -c.twilight - sunAlt(t, o); }, 3 * 60000, 16);
    return tidy(wins);
  }

  /* ---- predictions ---- */
  // times the colongitude is within delta of the target. opt: {colong, delta, start (Date), years}
  function predictColongitude(o, opt, c) {
    var t0 = opt.start.getTime(), t1 = t0 + 365.25 * DAY * opt.years;
    var wins = tidy(scanWindows(function (t) { return opt.delta - Math.abs(n180(E.compute(new Date(t)).colong - opt.colong)); }, t0, t1, 4 * 60000, 0.6));
    wins = constrain(wins, o, c);
    return wins.map(function (w) { return { start: new Date(w[0]), end: new Date(w[1]), sunLat: E.compute(new Date((w[0] + w[1]) / 2)).sunLat }; });
  }
  // times the Sun on the formation is between two elevations; each window is a morning (Sun rising there) or evening one
  function predictSunElevation(o, opt, c) {
    var t0 = opt.start.getTime(), t1 = t0 + 365.25 * DAY * opt.years;
    if (!(opt.max > opt.min)) return { morning: [], evening: [] };
    var wins = tidy(scanWindows(function (t) {
      var e = E.sunElevation(E.compute(new Date(t)), opt.lat, opt.lon); return Math.min(e - opt.min, opt.max - e);
    }, t0, t1, 10 * 60000, 0.6));
    wins = constrain(wins, o, c);
    var res = { morning: [], evening: [] };
    wins.forEach(function (w) {
      var mid = new Date((w[0] + w[1]) / 2), st = E.compute(mid), dl = n360(st.sunLon - opt.lon), lib = topoLibration(mid, o, st);
      var row = { start: new Date(w[0]), end: new Date(w[1]), libLon: lib.lon, libLat: lib.lat };
      (dl < 180 ? res.morning : res.evening).push(row);
    });
    return res;
  }
  // times the formation is lit (Sun above 5 degrees) while the libration shows it: lon beyond libLon to the east or west, lat beyond libLat to the north or south
  function predictLibration(o, opt, c) {
    var t0 = opt.start.getTime(), t1 = t0 + 365.25 * DAY * opt.years;
    var lit = tidy(scanWindows(function (t) { return E.sunElevation(E.compute(new Date(t)), opt.lat, opt.lon) - 5; }, t0, t1, 10 * 60000, 0.6));
    function lib(t) { var st = E.compute(new Date(t)); return topoLibration(new Date(t), o, st); }
    var lonSign = opt.west ? -1 : 1, latSign = opt.south ? -1 : 1;
    var wins = restrict(lit, function (t) { return lonSign * lib(t).lon - opt.libLon; }, 20 * 60000, 0.5);
    wins = restrict(wins, function (t) { return latSign * lib(t).lat - opt.libLat; }, 20 * 60000, 0.5);
    wins = constrain(tidy(wins), o, c);
    return wins.map(function (w) {
      return { start: new Date(w[0]), end: new Date(w[1]),
               sunStart: E.sunElevation(E.compute(new Date(w[0])), opt.lat, opt.lon), sunEnd: E.sunElevation(E.compute(new Date(w[1])), opt.lat, opt.lon) };
    });
  }

  /* ---- the local day: rise, set and twilights ---- */
  function dayStart(y, mo, d, tz) { return U.fromZoneParts(y, mo, d, 0, 0, tz); }
  function dayEvents(y, mo, d, o) {
    var t0 = dayStart(y, mo, d, o.tz), t1 = dayStart(y, mo, d + 1, o.tz), obsr = obsOf(o), lim = (t1 - t0) / DAY;
    function ev(body, dir) { var r = A.SearchRiseSet(body, obsr, dir, t0, lim); return r && r.date < t1 ? r.date : null; }
    function tw(dir, alt) { var r = A.SearchAltitude(A.Body.Sun, obsr, dir, t0, lim, alt); return r && r.date < t1 ? r.date : null; }
    var out = { sunrise: ev(A.Body.Sun, +1), sunset: ev(A.Body.Sun, -1), moonrise: ev(A.Body.Moon, +1), moonset: ev(A.Body.Moon, -1),
                civil1: tw(+1, -6), civil2: tw(-1, -6), nautic1: tw(+1, -12), nautic2: tw(-1, -12), astro1: tw(+1, -18), astro2: tw(-1, -18) };
    var noon = new Date((t0.getTime() + t1.getTime()) / 2);
    out.sunState = out.sunrise || out.sunset ? "" : (sunAlt(noon, o) > 0 ? "Always up" : "Never rises");
    out.moonState = out.moonrise || out.moonset ? "" : (moonAlt(noon, o) > 0 ? "Always up" : "Never rises");
    return out;
  }
  function monthDays(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }

  /* ---- phases of a year ---- */
  function yearPhases(y, tz) {
    var from = U.fromZoneParts(y, 1, 1, 0, 0, tz), to = U.fromZoneParts(y + 1, 1, 1, 0, 0, tz), rows = [];
    var q = A.SearchMoonQuarter(new Date(from.getTime() - 35 * DAY)), list = [];
    while (q.time.date < new Date(to.getTime() + 35 * DAY)) { list.push({ quarter: q.quarter, time: q.time.date }); q = A.NextMoonQuarter(q); }
    var cur = null;
    list.forEach(function (e) {
      if (e.quarter === 0) { cur = { nm: e.time }; rows.push(cur); }
      else if (cur) { cur[["", "fq", "fm", "lq"][e.quarter]] = e.time; }
    });
    return rows.filter(function (r) { return (r.nm >= from && r.nm < to) || (r.fq && r.fq >= from && r.fq < to) || (r.fm && r.fm >= from && r.fm < to) || (r.lq && r.lq >= from && r.lq < to); });
  }
  // for the calendar: for each local day of the year, the phase angle at local noon and the quarter that falls in the day (0 new, 1 first, 2 full, 3 last)
  function yearCalendar(y, tz) {
    var qs = yearPhases(y, tz), marks = {};
    qs.forEach(function (r) {
      [["nm", 0], ["fq", 1], ["fm", 2], ["lq", 3]].forEach(function (k) {
        if (!r[k[0]]) return;
        var p = U.zoneParts(r[k[0]], tz);
        if (p.y === y) marks[p.mo + "-" + p.d] = k[1];
      });
    });
    var rows = [];
    for (var mo = 1; mo <= 12; mo++) {
      var row = [];
      for (var d = 1; d <= monthDays(y, mo); d++) {
        var noon = U.fromZoneParts(y, mo, d, 12, 0, tz);
        row.push({ d: d, elong: A.MoonPhase(noon), q: marks[mo + "-" + d] === undefined ? -1 : marks[mo + "-" + d] });
      }
      rows.push(row);
    }
    return rows;
  }

  // local maxima and minima of f(ms) between two instants, refined; step in ms
  function extrema(f, t0, t1, step) {
    var ts = [], vs = [], out = [];
    for (var t = t0 - step; t <= t1 + step; t += step) { ts.push(t); vs.push(f(t)); }
    for (var i = 1; i < ts.length - 1; i++) {
      var isMax = vs[i] > vs[i - 1] && vs[i] >= vs[i + 1], isMin = vs[i] < vs[i - 1] && vs[i] <= vs[i + 1];
      if (!isMax && !isMin) continue;
      var lo = ts[i - 1], hi = ts[i + 1], s = isMax ? 1 : -1;
      for (var k = 0; k < 40; k++) {
        var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (s * f(m1) < s * f(m2)) lo = m1; else hi = m2;
      }
      var tm = (lo + hi) / 2;
      if (tm >= t0 && tm < t1) out.push({ t: new Date(tm), v: f(tm), max: isMax });
    }
    return out;
  }
  // the libration extrema of the (geocentric) libration over a year: longitude east and west, latitude north and south
  function yearLibration(y, tz) {
    var t0 = U.fromZoneParts(y, 1, 1, 0, 0, tz).getTime(), t1 = U.fromZoneParts(y + 1, 1, 1, 0, 0, tz).getTime();
    function lon(t) { return E.compute(new Date(t)).libLon; }
    function lat(t) { return E.compute(new Date(t)).libLat; }
    var lo = extrema(lon, t0, t1, 12 * HOUR), la = extrema(lat, t0, t1, 12 * HOUR);
    return { eastLon: lo.filter(function (x) { return x.max; }), westLon: lo.filter(function (x) { return !x.max; }),
             northLat: la.filter(function (x) { return x.max; }), southLat: la.filter(function (x) { return !x.max; }) };
  }

  /* ---- ephemeris file (the Save ephemeris dialog): a CSV like VMA's ---- */
  function ephemCsv(o, startDate, endDate, stepHours) {
    var rows = ['"Observatory","' + o.lat.toFixed(5) + '","' + o.lon.toFixed(5) + '","' + o.tz + '"',
      ['Date', 'Date TT', 'Date JD', 'RA 2000', 'DE 2000', 'RA apparent', 'DE apparent', 'Distance km', 'Diameter', 'Phase', 'Lunation', 'Illumination',
       'Colongitude', 'Sub-solar latitude', 'Libration latitude', 'Libration longitude', 'PA', 'Azimuth', 'Altitude', 'Ephemeris'].map(function (s) { return '"' + s + '"'; }).join(",")];
    var step = stepHours * HOUR, n = 0;
    for (var t = startDate.getTime(); t <= endDate.getTime() && n < 100000; t += step, n++) {
      var d = new Date(t), r = moonRow(d, o), p = U.zoneParts(d, o.tz), tt = A.MakeTime(d);
      var f = function (x, k) { return x.toFixed(k); };
      rows.push('"' + [p.y + "-" + pad2(p.mo) + "-" + pad2(p.d) + " " + pad2(p.h) + ":" + pad2(p.mi) + ":" + pad2(p.s), f(tt.tt + 2451545, 5), f(tt.ut + 2451545, 5), f(r.ra2000, 6), f(r.de2000, 5),
        f(r.ra, 6), f(r.de, 5), f(r.dist, 3), f(r.diam, 2), f(r.phase, 3), f(r.lunation, 2), f(r.illum, 2), f(r.colong, 4), f(r.subSolLat, 4),
        f(r.libLat, 4), f(r.libLon, 4), f(r.pa, 2), f(r.az, 3), f(r.alt, 3), "astronomy-engine"].join('","') + '"');
    }
    return rows.join("\n") + "\n";
  }

  root.OMA.calclun = { moonRow: moonRow, topoLibration: topoLibration, scanWindows: scanWindows, restrict: restrict, tidy: tidy,
    predictColongitude: predictColongitude, predictSunElevation: predictSunElevation, predictLibration: predictLibration,
    dayEvents: dayEvents, monthDays: monthDays, yearPhases: yearPhases, yearCalendar: yearCalendar, yearLibration: yearLibration, extrema: extrema,
    ephemCsv: ephemCsv, sunAlt: sunAlt, moonAlt: moonAlt, dayStart: dayStart, hms: hms, ra2str: ra2str, dec2str: dec2str, deg2str: deg2str };
  if (typeof module !== "undefined" && module.exports) module.exports = root.OMA.calclun;
})(typeof window !== "undefined" ? window : globalThis);
