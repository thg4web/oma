/* OMA ephemeris layer on astronomy-engine (MIT, Don Cross).
   Selenographic Sun position follows Meeus, Astronomical Algorithms ch. 53, optical
   libration only (physical libration is under 0.04 deg and is ignored).
   Validated in project/tools/test_ephem.js. */
(function (root) {
  "use strict";
  var A = root.Astronomy;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, AU_KM = 149597870.7;
  var I = 1.54242 * D2R;

  function norm180(x) { x = x % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x; }
  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }

  // selenographic (l, b) in degrees of the point at ecliptic (lam, beta) as seen from the Moon's centre
  function seleno(lamDeg, betaDeg, T) {
    var om = (125.0445479 - 1934.1362891 * T + 0.0020754 * T * T) * D2R;
    var F = (93.2720950 + 483202.0175233 * T - 0.0036539 * T * T) * D2R;
    var lam = lamDeg * D2R, beta = betaDeg * D2R, W = lam - om;
    var Aa = Math.atan2(Math.sin(W) * Math.cos(beta) * Math.cos(I) - Math.sin(beta) * Math.sin(I),
                        Math.cos(W) * Math.cos(beta));
    var l = norm180((Aa - F) * R2D);
    var b = Math.asin(-Math.sin(W) * Math.cos(beta) * Math.sin(I) - Math.sin(beta) * Math.cos(I)) * R2D;
    return { l: l, b: b };
  }

  function compute(date) {
    var T = (A.MakeTime(date).tt - 0) / 36525;               // days since J2000 TT / 36525
    var moon = A.EclipticGeoMoon(date);                       // lat, lon (deg), dist (AU)
    var sun = A.SunPosition(date);                            // apparent ecliptic of date
    var sunDist = A.GeoVector(A.Body.Sun, date, true).Length() * AU_KM;
    var moonDist = moon.dist * AU_KM;
    var lam0 = sun.elon;
    // heliocentric position of the Moon's centre as seen from the Sun, per Meeus 53
    var lamH = lam0 + 180 + (moonDist / sunDist) * R2D * Math.cos(moon.lat * D2R) * Math.sin((lam0 - moon.lon) * D2R);
    var betaH = (moonDist / sunDist) * moon.lat;
    var lib = seleno(moon.lon, moon.lat, T);
    var sl = seleno(lamH, betaH, T);
    var ill = A.Illumination(A.Body.Moon, date);
    var lib2 = A.Libration(date);
    var elong = A.AngleFromSun(A.Body.Moon, date);
    var c0 = sl.l >= 0 ? 90 - sl.l : 450 - sl.l;
    return {
      date: date,
      libLon: lib2.elon, libLat: lib2.elat,             // engine libration, used for the view
      libLonMeeus: lib.l, libLatMeeus: lib.b,           // our own, for the cross-check
      sunLon: sl.l, sunLat: sl.b, colong: norm360(c0),
      diamDeg: lib2.diam_deg, distKm: lib2.dist_km,
      phaseAngle: ill.phase_angle, illum: ill.phase_fraction,
      elongation: elong, eclLon: moon.lon, eclLat: moon.lat,
      phaseDeg: A.MoonPhase(date)
    };
  }

  // Sun elevation in degrees at selenographic (lat, lon) for a computed state
  function sunElevation(st, lat, lon) {
    var p = lat * D2R, p0 = st.sunLat * D2R, dl = (lon - st.sunLon) * D2R;
    return Math.asin(Math.sin(p) * Math.sin(p0) + Math.cos(p) * Math.cos(p0) * Math.cos(dl)) * R2D;
  }

  // next sunrise and sunset at a feature (Moon-local Sun crossing 0 deg), scanning forward
  function sunEvents(date, lat, lon, days) {
    var step = 3 * 3600 * 1000, t0 = date.getTime(), out = { rise: null, set: null };
    var prev = sunElevation(compute(date), lat, lon), pt = t0;
    for (var t = t0 + step; t <= t0 + days * 86400000 && (!out.rise || !out.set); t += step) {
      var e = sunElevation(compute(new Date(t)), lat, lon);
      if ((prev < 0) !== (e < 0)) {
        var lo = pt, hi = t, rising = prev < 0;
        for (var k = 0; k < 18; k++) {
          var mid = (lo + hi) / 2, em = sunElevation(compute(new Date(mid)), lat, lon);
          if ((em < 0) === rising) lo = mid; else hi = mid;
        }
        var when = new Date((lo + hi) / 2);
        if (rising && !out.rise) out.rise = when;
        if (!rising && !out.set) out.set = when;
      }
      prev = e; pt = t;
    }
    return out;
  }

  function nextQuarters(date) {
    var q = A.SearchMoonQuarter(date), out = [];
    for (var i = 0; i < 4; i++) {
      out.push({ quarter: q.quarter, time: q.time.date });
      q = A.NextMoonQuarter(q);
    }
    out.sort(function (a, b) { return a.time - b.time; });
    return out;
  }
  function lastNewMoon(date) { return A.SearchMoonPhase(0, date, -35).date; }
  // most recent quarter strictly before the date
  function prevQuarter(date) {
    var best = null;
    for (var q = 0; q < 4; q++) {
      var t = A.SearchMoonPhase(q * 90, new Date(date.getTime() - 1000), -35);
      if (t && (!best || t.date > best.time)) best = { quarter: q, time: t.date };
    }
    return best;
  }
  // next time the libration in longitude peaks (sign +1 east, -1 west), scanning forward
  function nextLibrationExtreme(date, sign) {
    var step = 6 * 3600 * 1000, t = date.getTime() + step, a = compute(new Date(date.getTime())).libLon * sign,
        b = compute(new Date(t)).libLon * sign;
    for (var i = 0; i < 80; i++) {
      var c = compute(new Date(t + step)).libLon * sign;
      if (b > a && b >= c) {
        var lo = t - step, hi = t + step, f = function (x) { return compute(new Date(x)).libLon * sign; };
        for (var k = 0; k < 30; k++) {                        // ternary search for the peak
          var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
          if (f(m1) < f(m2)) lo = m1; else hi = m2;
        }
        return new Date((lo + hi) / 2);
      }
      t += step; a = b; b = c;
    }
    return null;
  }

  // observer-based values: altitude, azimuth, rise, set, transit
  function observerInfo(date, latDeg, lonDeg) {
    var obs = new A.Observer(latDeg, lonDeg, 0);
    var eq = A.Equator(A.Body.Moon, date, obs, true, true);
    var hor = A.Horizon(date, obs, eq.ra, eq.dec, "normal");
    var rise = A.SearchRiseSet(A.Body.Moon, obs, +1, date, 2);
    var set = A.SearchRiseSet(A.Body.Moon, obs, -1, date, 2);
    return { ra: eq.ra, dec: eq.dec, alt: hor.altitude, az: hor.azimuth,
             rise: rise ? rise.date : null, set: set ? set.date : null };
  }

  root.OMA = root.OMA || {};
  root.OMA.ephem = { compute: compute, sunElevation: sunElevation, sunEvents: sunEvents,
                     nextQuarters: nextQuarters, prevQuarter: prevQuarter, nextLibrationExtreme: nextLibrationExtreme, lastNewMoon: lastNewMoon, observerInfo: observerInfo,
                     norm180: norm180, norm360: norm360 };
  if (typeof module !== "undefined" && module.exports) module.exports = root.OMA.ephem;
})(typeof window !== "undefined" ? window : globalThis);
