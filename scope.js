/* OMA telescope helpers: where a lunar feature is on the sky, and a small ASCOM Alpaca (REST) client.
   Tested in node against a mock Alpaca server and against the Sun-side bright limb (project/tools/test_scope.js).
   Not yet tried on a real mount: see the notes in the tracker. */
(function (root) {
  "use strict";
  var A = root.Astronomy, E = root.OMA && root.OMA.ephem;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var I = 1.54242 * D2R;                       // mean inclination of the lunar equator to the ecliptic

  /* ---- sky position of a point on the Moon -------------------------------------------------------------------- */
  // Position angle of the Moon's north pole from celestial north through east, degrees (Meeus ch. 53, optical libration only).
  function axisPA(date, raDeg, libLatDeg) {
    var T = A.MakeTime(date).tt / 36525;
    var om = (125.0445479 - 1934.1362891 * T + 0.0020754 * T * T) * D2R;
    var eps = (23.4392911 - 0.0130042 * T) * D2R;
    var X = Math.sin(I) * Math.sin(om);
    var Y = Math.sin(I) * Math.cos(om) * Math.cos(eps) - Math.cos(I) * Math.sin(eps);
    var w = Math.atan2(X, Y), b = libLatDeg * D2R;
    return Math.asin(Math.sqrt(X * X + Y * Y) * Math.cos(raDeg * D2R - w) / Math.cos(b)) * R2D;
  }
  // Unit-disc coordinates of a selenographic point: x toward selenographic east, y toward north, z toward the viewer.
  function discXY(lat, lon, libLat, libLon) {
    var be = lat * D2R, la = (lon - libLon) * D2R, b = libLat * D2R;
    return { x: Math.cos(be) * Math.sin(la),
             y: Math.sin(be) * Math.cos(b) - Math.cos(be) * Math.sin(b) * Math.cos(la),
             z: Math.sin(be) * Math.sin(b) + Math.cos(be) * Math.cos(b) * Math.cos(la) };
  }
  // RA (hours) and Dec (degrees), of date, of a selenographic point as seen from the observer (topocentric centre, geocentric libration).
  function featureRaDec(date, lat, lon, obsLat, obsLon, obsAlt) {
    var st = E.compute(date), obs = new A.Observer(obsLat, obsLon, obsAlt || 0);
    var eq = A.Equator(A.Body.Moon, date, obs, true, true);
    var P = axisPA(date, eq.ra * 15, st.libLat) * D2R, q = st.diamDeg / 2;      // semi-diameter in degrees
    var d = discXY(lat, lon, st.libLat, st.libLon);
    var dE = q * (-d.x * Math.cos(P) + d.y * Math.sin(P)), dN = q * (d.x * Math.sin(P) + d.y * Math.cos(P));
    var dec = eq.dec + dN, ra = eq.ra + dE / Math.cos(eq.dec * D2R) / 15;
    return { ra: (ra + 24) % 24, dec: dec, visible: d.z > 0, moonRa: eq.ra, moonDec: eq.dec, pa: P * R2D, z: d.z };
  }

  // RA (hours) and Dec (degrees) of date to J2000, for mounts whose EquatorialSystem is J2000 (ASCOM value 2)
  function toJ2000(date, raHours, decDeg) {
    var v = A.VectorFromSphere(new A.Spherical(decDeg, raHours * 15, 1), A.MakeTime(date));
    var q = A.EquatorFromVector(A.RotateVector(A.Rotation_EQD_EQJ(A.MakeTime(date)), v));
    return { ra: q.ra, dec: q.dec };
  }

  /* ---- ASCOM Alpaca client ------------------------------------------------------------------------------------ */
  // opt: { host, port, device (number), user, pass, fetch (optional, for tests) }. All calls return promises of the Alpaca "Value".
  function AlpacaScope(opt) {
    var tid = 0, f = opt.fetch || (root.fetch && root.fetch.bind(root));
    var base = (/^https?:\/\//.test(opt.host) ? opt.host : "http://" + opt.host) + ":" + (opt.port || 11111);
    function headers(extra) {
      var h = extra || {};
      if (opt.user) h.Authorization = "Basic " + (typeof btoa === "function" ? btoa(opt.user + ":" + (opt.pass || "")) : Buffer.from(opt.user + ":" + (opt.pass || "")).toString("base64"));
      return h;
    }
    function check(j) {
      if (j && j.ErrorNumber) { var e = new Error(j.ErrorMessage || ("Alpaca error " + j.ErrorNumber)); e.number = j.ErrorNumber; throw e; }
      return j ? j.Value : undefined;
    }
    function url(path) { return base + path; }
    function dev(prop) { return url("/api/v1/telescope/" + (opt.device || 0) + "/" + prop); }
    function get(prop, q) {
      var qs = "?ClientID=1&ClientTransactionID=" + (++tid);
      for (var k in (q || {})) qs += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(q[k]);
      return f(dev(prop) + qs, { method: "GET", headers: headers() }).then(function (r) { return r.json(); }).then(check);
    }
    function put(prop, q) {
      var body = "ClientID=1&ClientTransactionID=" + (++tid);
      for (var k in (q || {})) body += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(q[k]);
      return f(dev(prop), { method: "PUT", headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }), body: body })
        .then(function (r) { return r.json(); }).then(check);
    }
    function mgmt(path) { return f(url(path), { method: "GET", headers: headers() }).then(function (r) { return r.json(); }).then(check); }
    return {
      base: base,
      devices: function () { return mgmt("/management/v1/configureddevices"); },
      description: function () { return mgmt("/management/v1/description"); },
      setupUrl: function () { return url("/setup/v1/telescope/" + (opt.device || 0) + "/setup"); },
      connect: function () { return put("connected", { Connected: "true" }); },
      disconnect: function () { return put("connected", { Connected: "false" }); },
      connected: function () { return get("connected"); },
      status: function () {
        // one round of reads; a property the mount does not support comes back as null instead of failing the lot
        var props = ["rightascension", "declination", "azimuth", "altitude", "tracking", "atpark", "slewing", "equatorialsystem"];
        return Promise.all(props.map(function (p) { return get(p).catch(function () { return null; }); })).then(function (v) {
          var o = {}; props.forEach(function (p, i) { o[p] = v[i]; }); return o;
        });
      },
      capabilities: function () {
        var props = ["canslew", "canslewasync", "cansync", "canpark", "canunpark", "cansettracking", "canmoveaxis"];
        return Promise.all(props.map(function (p) {
          return (p === "canmoveaxis" ? get(p, { Axis: 0 }) : get(p)).catch(function () { return false; });
        })).then(function (v) { var o = {}; props.forEach(function (p, i) { o[p] = !!v[i]; }); return o; });
      },
      axisRates: function (axis) { return get("axisrates", { Axis: axis }); },
      setTracking: function (on) { return put("tracking", { Tracking: on ? "true" : "false" }); },
      park: function () { return put("park"); },
      unpark: function () { return put("unpark"); },
      abort: function () { return put("abortslew"); },
      slewTo: function (raHours, decDeg) { return put("slewtocoordinatesasync", { RightAscension: raHours, Declination: decDeg }); },
      syncTo: function (raHours, decDeg) { return put("synctocoordinates", { RightAscension: raHours, Declination: decDeg }); },
      moveAxis: function (axis, rate) { return put("moveaxis", { Axis: axis, Rate: rate }); }
    };
  }

  root.OMA = root.OMA || {};
  root.OMA.scope = { axisPA: axisPA, discXY: discXY, featureRaDec: featureRaDec, toJ2000: toJ2000, AlpacaScope: AlpacaScope };
  if (typeof module !== "undefined" && module.exports) module.exports = root.OMA.scope;
})(typeof window !== "undefined" ? window : globalThis);
