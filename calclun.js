/* CalcLun page for Observer's Moon Atlas: year, month, day and prediction views of the Moon for the observer.
   Calculations are in calclun-core.js (tested in project/tools/test_calclun.js). The observer and time zone are shared with the atlas
   through localStorage (oma-obs-lat, oma-obs-lon, oma-obs-alt, oma-tz). URL parameters from the atlas hand-off:
   date (ISO instant), lat, lon, alt, tz, f (formation name), flat, flon, tab (year|month|day|pred), pred (co|sun|lib). */
(function () {
  "use strict";
  var A = window.Astronomy, C = window.OMA.calclun, E = window.OMA.ephem, U = window.OMA.util;
  var D2R = Math.PI / 180, MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var QNAME = ["New Moon", "First quarter", "Full Moon", "Last quarter"];
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function clear(el) { el.textContent = ""; return el; }
  function add(el, tag, text, cls) { var n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; el.appendChild(n); return n; }
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  /* ---- theme, shared with the atlas ---- */
  (function () {
    var root = document.documentElement, btn = $("themeToggle");
    function apply(m, persist) { root.setAttribute("data-theme", m); if (persist) lsSet("oma-theme", m); }
    var s = lsGet("oma-theme", ""); if (s === "dark" || s === "light") apply(s, false);
    btn.addEventListener("click", function () { apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true); redraw(); });
  })();

  /* ---- observer and time zone ---- */
  var P = new URLSearchParams(location.search);
  function num(v, d) { var x = parseFloat(v); return isFinite(x) ? x : d; }
  var obs = { lat: num(P.get("lat"), num(lsGet("oma-obs-lat", "51.48"), 51.48)), lon: num(P.get("lon"), num(lsGet("oma-obs-lon", "0"), 0)), alt: num(P.get("alt"), num(lsGet("oma-obs-alt", "0"), 0)) };
  var zone = U.zoneValid(P.get("tz")) && P.get("tz") ? P.get("tz") : (U.zoneValid(lsGet("oma-tz", "local")) ? lsGet("oma-tz", "local") : "local");
  function O() { return { lat: obs.lat, lon: obs.lon, alt: obs.alt, tz: zone }; }
  function zoneLabel() { return zone === "local" ? "your device's time zone" : zone === "UTC" ? "UTC" : zone.replace(/_/g, " "); }
  function sig() { return [obs.lat, obs.lon, obs.alt, zone].join("|"); }
  function fmtLat(v) { return Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "N" : "S"); }
  function fmtLon(v) { return Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "E" : "W"); }

  /* ---- date state: year, month, day in the zone ---- */
  var S = { y: 2026, mo: 1, d: 1, tab: "year", pred: "co" };
  function today() { var p = U.zoneParts(new Date(), zone); S.y = p.y; S.mo = p.mo; S.d = p.d; }
  function dim(y, mo) { return C.monthDays(y, mo); }
  function localDate(y, mo, d, h, mi, s) { return U.fromZoneParts(y, mo, d, h || 0, mi || 0, zone).getTime() + (s || 0) * 1000; }
  function fmtDT(d) { if (!d) return ""; var p = U.zoneParts(d, zone); return p.y + "-" + pad(p.mo) + "-" + pad(p.d) + " " + pad(p.h) + ":" + pad(p.mi); }
  function fmtT(d) { if (!d) return "none"; var p = U.zoneParts(d, zone); return pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s); }
  function fmtMD(d) { var p = U.zoneParts(d, zone); return pad(p.mo) + "/" + pad(p.d); }
  function hourOf(d) { var p = U.zoneParts(d, zone); return p.h + p.mi / 60 + p.s / 3600; }
  function chartHour(d) { return hourOf(d); }
  function setChartOff() {}

  /* ---- events cache (rise, set, twilight) per local day ---- */
  var evSig = "", evCache = {};
  function ev(y, mo, d) {
    if (evSig !== sig()) { evSig = sig(); evCache = {}; }
    var k = y + "-" + mo + "-" + d;
    return evCache[k] || (evCache[k] = C.dayEvents(y, mo, d, O()));
  }
  var rowCache = {}, rowSig = "";
  function row(ms) {
    if (rowSig !== sig()) { rowSig = sig(); rowCache = {}; }
    return rowCache[ms] || (rowCache[ms] = C.moonRow(new Date(ms), O()));
  }

  /* ---- drawing helpers ---- */
  function fit(cv) {
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.max(10, Math.round(w * dpr)); cv.height = Math.max(10, Math.round(h * dpr));
    var x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    return { x: x, w: w, h: h };
  }
  function drawPhase(x, cx, cy, r, elong) {
    var e = elong * D2R, waxing = elong <= 180;
    x.save();
    x.fillStyle = "#14181f"; x.beginPath(); x.arc(cx, cy, r, 0, 2 * Math.PI); x.fill();
    x.fillStyle = "#f1ead0"; x.beginPath();
    x.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing);
    var kx = (waxing ? 1 : -1) * r * Math.cos(e);
    x.ellipse(cx, cy, Math.max(0.01, Math.abs(kx)), r, 0, Math.PI / 2, -Math.PI / 2, kx > 0);
    x.fill(); x.restore();
  }
  // the day levels: 0 night, 1 astronomical twilight, 2 nautical, 3 civil, 4 day
  var LEVEL_COL = function () { return ["#05070d", "#0d1a33", "#1c3a6b", "#4478b8", "#a9cdf0"]; };
  function dayBands(e, y, mo, d, hf) {
    hf = hf || chartHour;
    var evs = [["astro1", 1, 1], ["nautic1", 2, 1], ["civil1", 3, 1], ["sunrise", 4, 1], ["sunset", 3, -1], ["civil2", 2, -1], ["nautic2", 1, -1], ["astro2", 0, -1]], list = [];
    evs.forEach(function (k) { if (e[k[0]]) list.push({ h: hf(e[k[0]]), after: k[1], dir: k[2] }); });
    list.sort(function (a, b) { return a.h - b.h; });
    var start;
    if (list.length) start = list[0].dir > 0 ? list[0].after - 1 : list[0].after + 1;
    else {
      var a = C.sunAlt(localDate(y, mo, d, 12), O());
      start = a > -0.83 ? 4 : a > -6 ? 3 : a > -12 ? 2 : a > -18 ? 1 : 0;
    }
    var segs = [], h0 = 0, lv = start;
    list.forEach(function (x) { segs.push([h0, x.h, lv]); h0 = x.h; lv = x.after; });
    segs.push([h0, 24, lv]);
    return segs;
  }
  // rows of days against time of day: the Sun bands and the Moon rise and set. days: [{y,mo,d,label}]
  function bandChart(cv, days, opt) {
    var f = fit(cv), x = f.x, L = 46, R = 10, T = 8, B = 24, W = f.w - L - R, H = f.h - T - B, n = days.length;
    x.font = "11px 'IBM Plex Mono', monospace"; x.textBaseline = "middle";
    var cols = LEVEL_COL(), mr = [], ms = [];
    if (days.length) setChartOff(days[0].y);
    days.forEach(function (dy, i) {
      var e = ev(dy.y, dy.mo, dy.d), y0 = T + i * H / n, y1 = T + (i + 1) * H / n;
      dayBands(e, dy.y, dy.mo, dy.d).forEach(function (s) { x.fillStyle = cols[s[2]]; x.fillRect(L + s[0] / 24 * W, y0, Math.max(0.5, (s[1] - s[0]) / 24 * W + 0.5), y1 - y0 + 0.6); });
      mr.push(e.moonrise ? chartHour(e.moonrise) : null); ms.push(e.moonset ? chartHour(e.moonset) : null);
    });
    function line(arr, col) {
      x.strokeStyle = col; x.lineWidth = 1.6; x.beginPath(); var pen = false, prev = null;
      arr.forEach(function (h, i) {
        if (h === null) { pen = false; prev = null; return; }
        var px = L + h / 24 * W, py = T + (i + 0.5) * H / n;
        if (!pen || (prev !== null && Math.abs(h - prev) > 12)) x.moveTo(px, py); else x.lineTo(px, py);
        pen = true; prev = h;
      });
      x.stroke();
    }
    line(mr, "#f7e9a6"); line(ms, "#e0793a");
    x.strokeStyle = css("--line"); x.strokeRect(L, T, W, H); x.fillStyle = css("--ink-faint"); x.textAlign = "center";
    for (var h = 0; h <= 24; h += 3) { var px = L + h / 24 * W; x.fillText(pad(h) + ":00", px, f.h - 9); x.beginPath(); x.moveTo(px, T + H); x.lineTo(px, T + H + 4); x.stroke(); }
    x.textAlign = "right";
    days.forEach(function (dy, i) { if (dy.label) x.fillText(dy.label, L - 5, T + (i + 0.5) * H / n); });
    cv._geom = { L: L, T: T, W: W, H: H, n: n, days: days };
  }
  function bandHover(cv, evt, hoverEl, withMoon) {
    var g = cv._geom; if (!g) return null;
    var r = cv.getBoundingClientRect(), px = evt.clientX - r.left, py = evt.clientY - r.top;
    if (px < g.L || px > g.L + g.W || py < g.T || py > g.T + g.H) return null;
    var i = Math.min(g.n - 1, Math.floor((py - g.T) / g.H * g.n)), h = (px - g.L) / g.W * 24, dy = g.days[i];
    return { dy: dy, h: h, text: dy.y + "-" + pad(dy.mo) + "-" + pad(dy.d) + " " + pad(Math.floor(h)) + ":" + pad(Math.floor(h % 1 * 60)) };
  }
  // a line chart. opt: {xs, ys (null = gap), xmin, xmax, ymin, ymax, ytick, yfmt, wrap (a jump larger than this breaks the line), title, xlab}
  function lineChart(cv, opt) {
    var f = fit(cv), x = f.x, L = 58, R = 12, T = 26, B = 28, W = f.w - L - R, H = f.h - T - B;
    x.font = "11px 'IBM Plex Mono', monospace"; x.textBaseline = "middle";
    var ys = opt.ys.filter(function (v) { return v !== null && isFinite(v); });
    var ymin = opt.ymin, ymax = opt.ymax;
    if (ymin === undefined) { var a = Math.min.apply(null, ys), b = Math.max.apply(null, ys), pd = (b - a) * 0.08 || 1; ymin = a - pd; ymax = b + pd; }
    function X(v) { return L + (v - opt.xmin) / (opt.xmax - opt.xmin) * W; }
    function Y(v) { return T + H - (v - ymin) / (ymax - ymin) * H; }
    x.fillStyle = css("--ink"); x.textAlign = "left"; x.font = "12px 'Exo 2', sans-serif"; x.fillText(opt.title || "", L, 12); x.font = "11px 'IBM Plex Mono', monospace";
    var step = opt.ytick || niceStep((ymax - ymin) / 5);
    x.strokeStyle = css("--line-soft"); x.fillStyle = css("--ink-faint"); x.textAlign = "right"; x.lineWidth = 1;
    for (var v = Math.ceil(ymin / step) * step; v <= ymax + 1e-9; v += step) { x.beginPath(); x.moveTo(L, Y(v)); x.lineTo(L + W, Y(v)); x.stroke(); x.fillText(opt.yfmt ? opt.yfmt(v) : String(+v.toPrecision(6)), L - 5, Y(v)); }
    x.textAlign = "center";
    var xs = opt.xtick || Math.max(1, Math.ceil((opt.xmax - opt.xmin) / 12));
    for (var u = Math.ceil(opt.xmin / xs) * xs; u <= opt.xmax + 1e-9; u += xs) { x.fillText(String(u), X(u), f.h - 12); }
    x.strokeStyle = css("--line"); x.strokeRect(L, T, W, H);
    x.strokeStyle = css("--accent"); x.lineWidth = 2; x.beginPath();
    var pen = false, prev = null;
    opt.xs.forEach(function (xv, i) {
      var v = opt.ys[i];
      if (v === null || !isFinite(v)) { pen = false; prev = null; return; }
      if (!pen || (opt.wrap && prev !== null && Math.abs(v - prev) > opt.wrap)) x.moveTo(X(xv), Y(v)); else x.lineTo(X(xv), Y(v));
      pen = true; prev = v;
    });
    x.stroke();
    x.fillStyle = css("--accent");
    opt.xs.forEach(function (xv, i) { var v = opt.ys[i]; if (v !== null && isFinite(v)) { x.beginPath(); x.arc(X(xv), Y(v), 2.4, 0, 6.3); x.fill(); } });
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  /* ---- columns of the month and day tables ---- */
  var COLS = [
    { k: "ra2000", t: "RA 2000", f: function (r) { return C.ra2str(r.ra2000); }, v: function (r) { return r.ra2000; }, wrap: 12, ymin: 0, ymax: 24, ytick: 3 },
    { k: "de2000", t: "DE 2000", f: function (r) { return C.dec2str(r.de2000); }, v: function (r) { return r.de2000; }, ymin: -90, ymax: 90, ytick: 30 },
    { k: "ra", t: "RA apparent", f: function (r) { return C.ra2str(r.ra); }, v: function (r) { return r.ra; }, wrap: 12, ymin: 0, ymax: 24, ytick: 3 },
    { k: "de", t: "DE apparent", f: function (r) { return C.dec2str(r.de); }, v: function (r) { return r.de; }, ymin: -90, ymax: 90, ytick: 30 },
    { k: "dist", t: "Distance (km)", f: function (r) { return r.dist.toFixed(1); }, v: function (r) { return r.dist; } },
    { k: "diam", t: "Diameter (')", f: function (r) { return r.diam.toFixed(2); }, v: function (r) { return r.diam; } },
    { k: "phase", t: "Phase", f: function (r) { return r.phase.toFixed(3) + "°"; }, v: function (r) { return r.phase; }, ymin: 0, ymax: 360, ytick: 60, wrap: 180 },
    { k: "lunation", t: "Lunation (days)", f: function (r) { return r.lunation.toFixed(2); }, v: function (r) { return r.lunation; }, ymin: 0, ymax: 30, ytick: 5 },
    { k: "illum", t: "Illumination (%)", f: function (r) { return r.illum.toFixed(1); }, v: function (r) { return r.illum; }, ymin: 0, ymax: 100, ytick: 20 },
    { k: "colong", t: "Colongitude", f: function (r) { return r.colong.toFixed(4) + "°"; }, v: function (r) { return r.colong; }, ymin: 0, ymax: 360, ytick: 60, wrap: 180 },
    { k: "subSolLat", t: "Sub-solar latitude", f: function (r) { return r.subSolLat.toFixed(4) + "°"; }, v: function (r) { return r.subSolLat; } },
    { k: "libLon", t: "Libration longitude", f: function (r) { return C.deg2str(r.libLon); }, v: function (r) { return r.libLon; } },
    { k: "libLat", t: "Libration latitude", f: function (r) { return C.deg2str(r.libLat); }, v: function (r) { return r.libLat; } },
    { k: "pa", t: "PA", f: function (r) { return r.pa.toFixed(2) + "°"; }, v: function (r) { return r.pa; } }
  ];
  var RISE = { k: "rise", t: "Rise time" }, SET = { k: "set", t: "Set time" };
  var curGraph = "ra2000";

  /* ---- Year ---- */
  var yearKey = "", yearData = null;
  function monthPos(cvw, i) { return i; }
  function showYear() {
    $("yTitle").textContent = S.y + " at " + fmtLat(obs.lat) + " " + fmtLon(obs.lon);
    var key = S.y + "|" + sig();
    if (yearKey !== key) {
      yearKey = key; status("Computing the year");
      yearData = { cal: C.yearCalendar(S.y, zone), phases: C.yearPhases(S.y, zone), lib: C.yearLibration(S.y, zone) };
      fillPhases(); fillLib();
      setTimeout(function () { drawYearChart(); status(""); }, 20);
    }
    drawCal();
    if (yearKey === key && ALM) drawYearChart();
  }
  function fillPhases() {
    var tb = clear($("gPhase").tBodies[0]), inYear = function (d) { return d && U.zoneParts(d, zone).y === S.y; };
    yearData.phases.forEach(function (r) {
      var tr = add(tb, "tr");
      ["nm", "fq", "fm", "lq"].forEach(function (k) { add(tr, "td", inYear(r[k]) ? fmtDT(r[k]).slice(5) : ""); });
    });
  }
  function fillLib() {
    var L = yearData.lib, tb = clear($("gLib").tBodies[0]), cols = [L.eastLon, L.westLon, L.northLat, L.southLat], n = Math.max.apply(null, cols.map(function (c) { return c.length; }));
    for (var i = 0; i < n; i++) {
      var tr = add(tb, "tr");
      cols.forEach(function (c) { add(tr, "td", c[i] ? fmtMD(c[i].t) + " " + C.deg2str(c[i].v) : ""); });
    }
  }
  var CAL = { L: 56, T: 22, cw: 0, ch: 0 };
  function drawCal() {
    var cv = $("yCal"), f = fit(cv), x = f.x;
    if (!yearData) return;
    CAL.cw = (f.w - CAL.L - 6) / 31; CAL.ch = (f.h - CAL.T - 6) / 12;
    x.fillStyle = "#000"; x.fillRect(CAL.L, CAL.T, CAL.cw * 31, CAL.ch * 12);
    x.font = "11px 'IBM Plex Mono', monospace"; x.textBaseline = "middle";
    var t = U.zoneParts(new Date(), zone), r = Math.min(CAL.cw, CAL.ch) * 0.36;
    x.fillStyle = css("--ink-faint"); x.textAlign = "center";
    for (var d = 1; d <= 31; d++) x.fillText(String(d), CAL.L + (d - 0.5) * CAL.cw, CAL.T / 2);
    x.textAlign = "right";
    yearData.cal.forEach(function (mrow, i) {
      x.fillStyle = css("--accent"); x.fillText(MONTHS[i].slice(0, 3), CAL.L - 8, CAL.T + (i + 0.5) * CAL.ch);
      mrow.forEach(function (c) {
        var cx = CAL.L + (c.d - 0.5) * CAL.cw, cy = CAL.T + (i + 0.5) * CAL.ch;
        drawPhase(x, cx, cy, r, c.elong);
        if (c.q >= 0) { x.strokeStyle = "#f5b041"; x.lineWidth = 1.6; x.beginPath(); x.arc(cx, cy, r + 2, 0, 6.3); x.stroke(); }
        if (t.y === S.y && t.mo === i + 1 && t.d === c.d) { x.strokeStyle = "#58d68d"; x.lineWidth = 1.6; x.strokeRect(cx - CAL.cw / 2 + 1, cy - CAL.ch / 2 + 1, CAL.cw - 2, CAL.ch - 2); }
      });
    });
  }
  function calCell(evt) {
    var cv = $("yCal"), r = cv.getBoundingClientRect(), px = evt.clientX - r.left, py = evt.clientY - r.top;
    var mo = Math.floor((py - CAL.T) / CAL.ch) + 1, d = Math.floor((px - CAL.L) / CAL.cw) + 1;
    if (mo < 1 || mo > 12) return null;
    return { mo: mo, d: d < 1 ? 0 : d > dim(S.y, mo) ? -1 : d };
  }
  $("yCal").addEventListener("click", function (e) {
    var c = calCell(e); if (!c) return;
    S.mo = c.mo;
    if (c.d > 0) { S.d = c.d; setTab("day"); } else if (c.d === 0) setTab("month"); else { S.d = Math.min(S.d, dim(S.y, S.mo)); sync(); }
  });
  $("yCal").addEventListener("mousemove", function (e) {
    var c = calCell(e), cv = $("yCal");
    if (!c || c.d <= 0) { cv.title = c && c.d === 0 ? "Open " + MONTHS[c.mo - 1] : ""; return; }
    var cell = yearData && yearData.cal[c.mo - 1][c.d - 1];
    cv.title = cell ? S.y + "-" + pad(c.mo) + "-" + pad(c.d) + (cell.q >= 0 ? ": " + QNAME[cell.q] : "") + ", Moon " + ((1 - Math.cos(cell.elong * D2R)) / 2 * 100).toFixed(0) + "% lit at noon" : "";
  });
  function yearDays() {
    var out = [];
    for (var mo = 1; mo <= 12; mo++) for (var d = 1; d <= dim(S.y, mo); d++) out.push({ y: S.y, mo: mo, d: d, label: d === 1 ? MONTHS[mo - 1].slice(0, 3) : "" });
    return out;
  }
  /* The Moon through the year, laid out like the Skygazer's Almanac (Sky & Telescope): dates across, the night hours down, the Sun's twilight
     as the sky behind, and a small Moon of the right phase at the moonset of each waxing day and the moonrise of each waning day. */
  var ALM = null;
  // The year chart is in UT, so daylight saving cannot bend it. It is centred on 18:00 local standard time: that hour is halfway down.
  var CUT = 6;
  function utHour(d) { return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600; }
  function stdOffsetH(y) { return Math.min(U.zoneOffsetMs(localDate(y, 1, 1, 12), zone), U.zoneOffsetMs(localDate(y, 7, 1, 12), zone)) / 3600000; }
  function nightHour(h) { return h < CUT ? h + 24 : h; }
  function hourLabel(h) { return pad(Math.round(h) % 24) + ":00"; }
  function drawYearChart() {
    var cv = $("yChart"), days = yearDays(), n = days.length;
    var f = fit(cv), x = f.x, L = 62, R = 12, T = 22, B = 8, W = f.w - L - R, H = f.h - T - B, evs = days.map(function (d) { return ev(d.y, d.mo, d.d); });
    var cen = $("yCentre").value, centreUT = cen === "local" ? 18 - stdOffsetH(S.y) : parseFloat(cen);
    CUT = ((centreUT - 12) % 24 + 24) % 24;
    var t0 = CUT, t1 = CUT + 24;
    var cw = W / n;
    function Y(h) { return T + (h - t0) / (t1 - t0) * H; }
    var cols = LEVEL_COL();
    x.fillStyle = cols[0]; x.fillRect(L, T, W, H);
    days.forEach(function (dy, i) {
      var xs = L + i * cw;
      dayBands(evs[i], dy.y, dy.mo, dy.d, utHour).forEach(function (s) {
        [[s[0], Math.min(s[1], CUT), 24], [Math.max(s[0], CUT), s[1], 0]].forEach(function (p) {
          if (p[1] <= p[0]) return;
          var a = Math.max(t0, p[0] + p[2]), b = Math.min(t1, p[1] + p[2]);
          if (b > a) { x.fillStyle = cols[s[2]]; x.fillRect(xs, Y(a), cw + 0.6, Y(b) - Y(a) + 0.6); }
        });
      });
    });
    // grid: every hour across, every month down
    x.font = "11px 'IBM Plex Mono', monospace"; x.textBaseline = "middle"; x.textAlign = "right";
    for (var h = Math.ceil(t0); h <= t1; h++) {
      x.strokeStyle = h % 24 === 0 ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.16)"; x.lineWidth = 1; x.beginPath(); x.moveTo(L, Y(h) + 0.5); x.lineTo(L + W, Y(h) + 0.5); x.stroke();
      x.fillStyle = css("--ink-faint"); x.fillText(hourLabel(h), L - 6, Y(h));
    }
    x.textAlign = "left";
    days.forEach(function (dy, i) {
      if (dy.d !== 1) return;
      var xs = L + i * cw; x.strokeStyle = "rgba(255,255,255,0.2)"; x.beginPath(); x.moveTo(xs + 0.5, T); x.lineTo(xs + 0.5, T + H); x.stroke();
      x.fillStyle = css("--ink-faint"); x.fillText(MONTHS[dy.mo - 1].slice(0, 3), xs + 3, T - 10);
    });
    // apogee and perigee days
    var aps = {}, ap = A.SearchLunarApsis(new Date(localDate(S.y, 1, 1) - 15 * 86400000));
    for (var k = 0; k < 20; k++) { var p = U.zoneParts(ap.time.date, zone); if (p.y === S.y) aps[p.mo + "-" + p.d] = ap.kind === 0 ? "P" : "A"; ap = A.NextLunarApsis(ap); }
    // the Moons
    var r = Math.max(3.4, Math.min(7, cw * 1.5)), quarters = {}, ph = C.yearPhases(S.y, zone);
    ph.forEach(function (q) { ["nm", "fq", "fm", "lq"].forEach(function (kk, qi) { if (q[kk]) { var pz = U.zoneParts(q[kk], zone); if (pz.y === S.y) quarters[pz.mo + "-" + pz.d] = qi; } }); });
    var marks = [];
    days.forEach(function (dy, i) {
      var key0 = dy.mo + "-" + dy.d;
      if (i % 2 !== 0 && quarters[key0] === undefined) return;                 // every other day, and the major phases
      var e = evs[i], el = A.MoonPhase(new Date(localDate(dy.y, dy.mo, dy.d, 12))), waxing = el < 180, t = waxing ? e.moonset : e.moonrise;
      if (!t) return;
      var hh = nightHour(utHour(t)); if (hh < t0 || hh > t1) return;
      var elT = A.MoonPhase(t), cx = L + (i + 0.5) * cw, cy = Y(hh), key = dy.mo + "-" + dy.d, q = quarters[key];
      var rr = q !== undefined ? r + 1.5 : r;
      marks.push({ i: i, cx: cx, cy: cy, dy: dy, waxing: waxing, t: t, elong: elT, q: q, ap: aps[key], rr: rr });
    });
    // a dotted line through the Moons of one run (waxing or waning), broken where the run ends or the time wraps past the edge
    x.save(); x.setLineDash([2, 4]); x.lineCap = "round"; x.strokeStyle = "rgba(241,234,208,0.65)"; x.lineWidth = 1.3; x.beginPath();
    marks.forEach(function (m, k) {
      var p = marks[k - 1];
      if (k && p.waxing === m.waxing && m.i - p.i <= 4 && Math.abs(m.cy - p.cy) < H * 0.4) x.lineTo(m.cx, m.cy); else x.moveTo(m.cx, m.cy);
    });
    x.stroke(); x.restore();
    marks.forEach(function (m) {
      drawPhase(x, m.cx, m.cy, m.rr, m.elong);
      x.strokeStyle = "rgba(241,234,208,0.55)"; x.lineWidth = 0.8; x.beginPath(); x.arc(m.cx, m.cy, m.rr, 0, 6.3); x.stroke();
      if (m.q !== undefined) { x.strokeStyle = "#f5b041"; x.lineWidth = 1.4; x.beginPath(); x.arc(m.cx, m.cy, m.rr + 2.4, 0, 6.3); x.stroke(); }
      if (m.ap) { x.fillStyle = "#e9eef8"; x.font = "bold 10px 'IBM Plex Mono', monospace"; x.textAlign = "left"; x.fillText(m.ap, m.cx + m.rr + 4, m.cy); }
    });
    x.strokeStyle = css("--line"); x.lineWidth = 1; x.strokeRect(L, T, W, H);
    ALM = { L: L, T: T, W: W, H: H, cw: cw, n: n, t0: t0, t1: t1, days: days, marks: marks, evs: evs };
  }
  function ut5(d) { return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
  (function () {                                             // the centre hour: any hour in UT, or 18:00 local standard time
    var sl = $("yCentre");
    for (var h = 0; h < 24; h++) add(sl, "option", pad(h) + ":00 UT").value = String(h);
    add(sl, "option", "18:00 local standard time").value = "local";
    var v = lsGet("oma-cl-centre", "18"); sl.value = v === "local" || (+v >= 0 && +v < 24) ? v : "18";
    sl.addEventListener("change", function () { lsSet("oma-cl-centre", sl.value); drawYearChart(); });
  })();
  function almDay(evt) {
    var g = ALM; if (!g) return null;
    var r = $("yChart").getBoundingClientRect(), px = evt.clientX - r.left, py = evt.clientY - r.top;
    if (px < g.L || px > g.L + g.W || py < g.T || py > g.T + g.H) return null;
    var i = Math.min(g.n - 1, Math.floor((px - g.L) / g.cw)), h = g.t0 + (py - g.T) / g.H * (g.t1 - g.t0);
    return { i: i, dy: g.days[i], h: h, e: g.evs[i] };
  }
  $("yChart").addEventListener("mousemove", function (e) {
    var d = almDay(e); if (!d) { $("yHover").textContent = " "; return; }
    var m = ALM.marks.filter(function (k) { return k.i === d.i; })[0], dy = d.dy, ev = d.e;
    var txt = dy.y + "-" + pad(dy.mo) + "-" + pad(dy.d) + ": moonrise " + (ev.moonrise ? ut5(ev.moonrise) : "none") + ", moonset " + (ev.moonset ? ut5(ev.moonset) : "none");
    if (m) txt += ", Moon " + ((1 - Math.cos(m.elong * D2R)) / 2 * 100).toFixed(0) + "% lit, " + (m.waxing ? "waxing" : "waning") + (m.q !== undefined ? ", " + QNAME[m.q] : "") + (m.ap ? (m.ap === "A" ? ", apogee" : ", perigee") : "");
    $("yHover").textContent = txt + " (UT)";
  });
  $("yChart").addEventListener("click", function (e) {
    var d = almDay(e); if (!d) return;
    S.mo = d.dy.mo; S.d = d.dy.d; setTab("day");
  });

  /* ---- Month ---- */
  var monthKey = "", monthRows = [];
  function showMonth() {
    $("mTitle").textContent = S.y + " " + MONTHS[S.mo - 1];
    var key = S.y + "-" + S.mo + "|" + sig(), n = dim(S.y, S.mo);
    if (monthKey !== key) {
      monthKey = key; monthRows = [];
      for (var d = 1; d <= n; d++) monthRows.push({ d: d, r: row(Date.UTC(S.y, S.mo - 1, d)), e: ev(S.y, S.mo, d) });
    }
    var th = clear($("gMonth").tHead), tr = add(th, "tr");
    var h0 = add(tr, "th", "Day"); h0.title = "Click a day to open it";
    COLS.concat([RISE, SET]).forEach(function (c) {
      var h = add(tr, "th", c.t); h.title = "Click to graph"; if (c.k === curGraph) h.className = "cur";
      h.addEventListener("click", function () { curGraph = c.k; showMonth(); });
    });
    var tb = clear($("gMonth").tBodies[0]);
    monthRows.forEach(function (m) {
      var r = add(tb, "tr"), c0 = add(r, "td", String(m.d));
      c0.addEventListener("click", function () { S.d = m.d; setTab("day"); });
      COLS.forEach(function (c) { add(r, "td", c.f(m.r)); });
      add(r, "td", m.e.moonrise ? fmtT(m.e.moonrise) : (m.e.moonset ? "" : m.e.moonState));
      add(r, "td", m.e.moonset ? fmtT(m.e.moonset) : "");
    });
    var sel = $("gSel"); if (!sel.options.length) {
      COLS.concat([RISE, SET]).forEach(function (c) { var o = add(sel, "option", c.t); o.value = c.k; });
    }
    sel.value = curGraph;
    var dl = clear($("mPhases")), ph = monthPhases();
    QNAME.forEach(function (q, i) { add(dl, "dt", q); add(dl, "dd", ph[i] ? fmtDT(ph[i]) : "none this month"); });
    drawMonthCharts();
  }
  function monthPhases() {
    var from = localDate(S.y, S.mo, 1), to = localDate(S.y, S.mo + 1, 1), out = [null, null, null, null];
    var q = A.SearchMoonQuarter(new Date(from - 1000));
    for (var i = 0; i < 6; i++) { if (q.time.date.getTime() >= from && q.time.date.getTime() < to && !out[q.quarter]) out[q.quarter] = q.time.date; q = A.NextMoonQuarter(q); }
    return out;
  }
  function drawMonthCharts() {
    setChartOff(S.y);
    var n = dim(S.y, S.mo), xs = [], ys = [], col = COLS.filter(function (c) { return c.k === curGraph; })[0], title, opt;
    monthRows.forEach(function (m) {
      xs.push(m.d);
      if (col) ys.push(col.v(m.r));
      else { var t = curGraph === "rise" ? m.e.moonrise : m.e.moonset; ys.push(t ? chartHour(t) : null); }
    });
    if (col) {
      title = col.t + ", " + S.y + " " + MONTHS[S.mo - 1];
      opt = { xs: xs, ys: ys, xmin: 1, xmax: n, ymin: col.ymin, ymax: col.ymax, ytick: col.ytick, wrap: col.wrap, title: title };
      if (col.k === "ra2000" || col.k === "ra") opt.yfmt = function (v) { return v + "h"; };
    } else {
      opt = { xs: xs, ys: ys, xmin: 1, xmax: n, ymin: 0, ymax: 24, ytick: 3, wrap: 12, title: (curGraph === "rise" ? "Moonrise" : "Moonset") + " (local time), " + S.y + " " + MONTHS[S.mo - 1], yfmt: function (v) { return pad(v) + ":00"; } };
    }
    lineChart($("mChart"), opt);
    var isLib = curGraph === "libLon" || curGraph === "libLat", isRS = curGraph === "rise" || curGraph === "set";
    $("mLibWrap").hidden = !isLib; $("mTwWrap").hidden = !isRS;
    if (isLib) trackChart($("mLib"));
    if (isRS) { var days = []; for (var d = 1; d <= n; d++) days.push({ y: S.y, mo: S.mo, d: d, label: d % 2 ? String(d) : "" }); bandChart($("mTw"), days); }
  }
  // libration longitude against latitude, one labelled point per day (VMA's second graph)
  function trackChart(cv) {
    var f = fit(cv), x = f.x, L = 50, R = 14, T = 14, B = 28, W = f.w - L - R, H = f.h - T - B;
    var lo = monthRows.map(function (m) { return m.r.libLon; }), la = monthRows.map(function (m) { return m.r.libLat; });
    var a = Math.min.apply(null, lo), b = Math.max.apply(null, lo), c = Math.min.apply(null, la), d = Math.max.apply(null, la);
    var pa = (b - a) * 0.1 || 1, pc = (d - c) * 0.1 || 1; a -= pa; b += pa; c -= pc; d += pc;
    function X(v) { return L + (v - a) / (b - a) * W; } function Y(v) { return T + H - (v - c) / (d - c) * H; }
    x.font = "11px 'IBM Plex Mono', monospace"; x.textBaseline = "middle";
    x.strokeStyle = css("--line-soft"); x.fillStyle = css("--ink-faint"); x.lineWidth = 1;
    x.textAlign = "right"; for (var v = Math.ceil(c); v <= d; v += niceStep((d - c) / 6)) { x.beginPath(); x.moveTo(L, Y(v)); x.lineTo(L + W, Y(v)); x.stroke(); x.fillText(v + "°", L - 4, Y(v)); }
    x.textAlign = "center"; for (var u = Math.ceil(a); u <= b; u += niceStep((b - a) / 8)) { x.beginPath(); x.moveTo(X(u), T); x.lineTo(X(u), T + H); x.stroke(); x.fillText(u + "°", X(u), f.h - 12); }
    x.strokeStyle = css("--line"); x.strokeRect(L, T, W, H);
    x.strokeStyle = css("--accent"); x.lineWidth = 1.6; x.beginPath(); lo.forEach(function (v, i) { if (i) x.lineTo(X(v), Y(la[i])); else x.moveTo(X(v), Y(la[i])); }); x.stroke();
    x.fillStyle = css("--accent"); x.textAlign = "left";
    lo.forEach(function (v, i) { x.beginPath(); x.arc(X(v), Y(la[i]), 3, 0, 6.3); x.fill(); x.fillStyle = css("--ink"); x.fillText(String(i + 1), X(v) + 6, Y(la[i]) - 6); x.fillStyle = css("--accent"); });
    x.fillStyle = css("--ink-faint"); x.textAlign = "right"; x.fillText("longitude (east right), latitude (north up)", L + W - 4, T + 10);
  }
  $("gSel").addEventListener("change", function () { curGraph = $("gSel").value; showMonth(); });
  $("mTw").addEventListener("click", function (e) { var h = bandHover($("mTw"), e); if (h) { S.d = h.dy.d; setTab("day"); } });

  /* ---- Day ---- */
  function dayMs() { return localDate(S.y, S.mo, S.d, num($("dh").value, 0), num($("dmin").value, 0), num($("ds").value, 0)); }
  function showDay() {
    S.d = Math.min(S.d, dim(S.y, S.mo));
    $("dTitle").textContent = S.y + " " + MONTHS[S.mo - 1] + " " + S.d;
    var e = ev(S.y, S.mo, S.d), dl = clear($("dRise"));
    [["Moonrise", e.moonrise ? fmtT(e.moonrise) : e.moonState || "none this day"], ["Moonset", e.moonset ? fmtT(e.moonset) : e.moonState || "none this day"],
     ["Sunrise", e.sunrise ? fmtT(e.sunrise) : e.sunState], ["Sunset", e.sunset ? fmtT(e.sunset) : e.sunState],
     ["Civil twilight", (e.civil1 ? fmtT(e.civil1).slice(0, 5) : "-") + " to " + (e.civil2 ? fmtT(e.civil2).slice(0, 5) : "-")],
     ["Nautical twilight", (e.nautic1 ? fmtT(e.nautic1).slice(0, 5) : "-") + " to " + (e.nautic2 ? fmtT(e.nautic2).slice(0, 5) : "-")],
     ["Astronomical twilight", (e.astro1 ? fmtT(e.astro1).slice(0, 5) : "-") + " to " + (e.astro2 ? fmtT(e.astro2).slice(0, 5) : "-")]].forEach(function (p) { add(dl, "dt", p[0]); add(dl, "dd", p[1]); });
    var r0 = row(localDate(S.y, S.mo, S.d, 12));
    var pc = $("dPhase"), px = pc.getContext("2d"); px.clearRect(0, 0, 96, 96); drawPhase(px, 48, 48, 44, A.MoonPhase(new Date(localDate(S.y, S.mo, S.d, 12))));
    // hourly table
    var th = clear($("gDay").tHead), tr = add(th, "tr"); add(tr, "th", "Hour");
    COLS.forEach(function (c) { add(tr, "th", c.t); });
    var tb = clear($("gDay").tBodies[0]);
    for (var h = 0; h < 24; h++) {
      var r = row(localDate(S.y, S.mo, S.d, h)), trr = add(tb, "tr", undefined, "pick");
      add(trr, "td", h + ":00");
      COLS.forEach(function (c) { add(trr, "td", c.f(r)); });
      (function (hh) { trr.addEventListener("click", function () { $("dh").value = hh; $("dmin").value = 0; $("ds").value = 0; showDayAt(); }); })(h);
    }
    drawDayChart(); showDayAt();
  }
  function showDayAt() {
    var ms = dayMs(), r = C.moonRow(new Date(ms), O()), dl = clear($("dAt"));
    $("dAtTitle").textContent = "At " + fmtDT(new Date(ms)).slice(11) + " " + zoneLabel();
    [["Date", fmtDT(new Date(ms))], ["RA 2000", C.ra2str(r.ra2000)], ["DE 2000", C.dec2str(r.de2000)], ["RA apparent", C.ra2str(r.ra)], ["DE apparent", C.dec2str(r.de)],
     ["Distance", r.dist.toFixed(1) + " km"], ["Diameter", r.diam.toFixed(2) + "'"], ["Phase", r.phase.toFixed(3) + "°"], ["Illumination", r.illum.toFixed(1) + " %"],
     ["Lunation", r.lunation.toFixed(2) + " days"], ["Colongitude", r.colong.toFixed(4) + "°"], ["Sub-solar latitude", r.subSolLat.toFixed(4) + "°"],
     ["Libration longitude", C.deg2str(r.libLon)], ["Libration latitude", C.deg2str(r.libLat)], ["PA of the axis", r.pa.toFixed(2) + "°"],
     ["Azimuth", r.az.toFixed(2) + "°"], ["Altitude", r.alt.toFixed(2) + "°"]].forEach(function (p) { add(dl, "dt", p[0]); add(dl, "dd", p[1]); });
    drawDayChart();
  }
  var dayChartGeom = null;
  function drawDayChart() {
    var cv = $("dChart"), f = fit(cv), x = f.x, L = 40, R = 10, T = 10, B = 24, W = f.w - L - R, H = f.h - T - B;
    var t0 = localDate(S.y, S.mo, S.d, 0), t1 = localDate(S.y, S.mo, S.d + 1, 0), span = t1 - t0, cols = LEVEL_COL();
    function X(ms) { return L + (ms - t0) / span * W; }
    function Y(a) { return T + H - (a + 90) / 180 * H; }
    for (var i = 0; i < 144; i++) {                                       // sky shading every 10 minutes
      var ms = t0 + (i + 0.5) * span / 144, a = C.sunAlt(ms, O()), lv = a > -0.83 ? 4 : a > -6 ? 3 : a > -12 ? 2 : a > -18 ? 1 : 0;
      x.fillStyle = cols[lv]; x.fillRect(L + i * W / 144, T, W / 144 + 0.6, H);
    }
    x.strokeStyle = "rgba(255,255,255,0.25)"; x.fillStyle = css("--ink-faint"); x.font = "11px 'IBM Plex Mono', monospace"; x.textBaseline = "middle"; x.textAlign = "right";
    [-60, -30, 0, 30, 60].forEach(function (a) { x.beginPath(); x.moveTo(L, Y(a)); x.lineTo(L + W, Y(a)); x.stroke(); x.fillText(a + "°", L - 4, Y(a)); });
    x.textAlign = "center";
    for (var h = 0; h <= 24; h += 3) x.fillText(pad(h), L + h / 24 * W, f.h - 10);
    x.strokeStyle = "#f7e9a6"; x.lineWidth = 2; x.beginPath();
    for (var k = 0; k <= 144; k++) { var m = t0 + k * span / 144, al = C.moonAlt(m, O()); if (k) x.lineTo(X(m), Y(al)); else x.moveTo(X(m), Y(al)); }
    x.stroke();
    var at = dayMs(); x.strokeStyle = "#58d68d"; x.lineWidth = 1.2; x.beginPath(); x.moveTo(X(at), T); x.lineTo(X(at), T + H); x.stroke();
    x.strokeStyle = css("--line"); x.lineWidth = 1; x.strokeRect(L, T, W, H);
    dayChartGeom = { L: L, T: T, W: W, H: H, t0: t0, span: span };
  }
  $("dChart").addEventListener("mousemove", function (e) {
    var g = dayChartGeom, r = $("dChart").getBoundingClientRect(), px = e.clientX - r.left;
    if (!g || px < g.L || px > g.L + g.W) { $("dHover").textContent = " "; return; }
    var ms = g.t0 + (px - g.L) / g.W * g.span, m = C.moonRow(new Date(ms), O());
    $("dHover").textContent = fmtDT(new Date(ms)).slice(11) + "  altitude " + m.alt.toFixed(1) + "°  azimuth " + m.az.toFixed(1) + "°";
  });
  $("dChart").addEventListener("click", function (e) {
    var g = dayChartGeom, r = $("dChart").getBoundingClientRect(), px = e.clientX - r.left;
    if (!g || px < g.L || px > g.L + g.W) return;
    var mins = Math.round((px - g.L) / g.W * 24 * 60);
    $("dh").value = Math.min(23, Math.floor(mins / 60)); $("dmin").value = mins % 60; $("ds").value = 0; showDayAt();
  });
  ["dh", "dmin", "ds"].forEach(function (id) { $(id).addEventListener("input", showDayAt); });

  /* ---- Prediction ---- */
  var FE = null, form = { lat: 0, lon: 0, name: "" };
  function loadFeatures(cb) {
    if (FE) return cb();
    fetch("data/features/features.json").then(function (r) { return r.json(); }).then(function (j) {
      FE = j.rows.map(function (r) { return { name: r[0], type: r[2], lat: r[3], lon: r[4] }; });
      cb();
    }).catch(function () { FE = []; $("pHint").textContent = "The feature list could not be loaded (open this page through a web server). You can still type a longitude and latitude."; cb(); });
  }
  function formFill() {
    $("pLon").value = Math.abs(form.lon); $("pEW").value = form.lon < 0 ? "-1" : "1";
    $("pLat").value = Math.abs(form.lat); $("pNS").value = form.lat < 0 ? "-1" : "1";
    $("pFormName").textContent = form.name ? form.name + " (" + fmtLat(form.lat) + ", " + fmtLon(form.lon) + ")" : " ";
  }
  function formRead() {
    var lo = num($("pLon").value, 0) * parseInt($("pEW").value, 10), la = num($("pLat").value, 0) * parseInt($("pNS").value, 10);
    if (lo !== form.lon || la !== form.lat) form.name = "";
    form.lon = lo; form.lat = la;
  }
  function pickFormation(f) {
    form = { lat: f.lat, lon: f.lon, name: f.name }; formFill();
    var a = Math.abs(f.lon), b = Math.abs(f.lat);                                       // VMA's suggestion for the libration thresholds
    $("lbLon").value = a > 100 ? 0 : a > 40 ? Math.min(7, Math.max(2, a - 90 + 2)) : 0;
    $("lbLat").value = b > 40 ? Math.min(7, Math.max(2, b - 90 + 2)) : 0;
    $("lbEW").value = f.lon >= 0 ? "1" : "-1"; $("lbNS").value = f.lat >= 0 ? "1" : "-1";
    if (S.pred !== "co") runPred();
  }
  $("pName").addEventListener("input", function () {
    var q = $("pName").value.trim().toLowerCase(), sl = clear($("pPick"));
    if (q.length < 3) return;
    loadFeatures(function () {
      FE.filter(function (f) { return f.name.toLowerCase().indexOf(q) === 0; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }).slice(0, 100).forEach(function (f, i) {
        var o = add(sl, "option", f.name + " (" + f.type + ")"); o.value = String(FE.indexOf(f));
      });
      if (sl.options.length) { sl.selectedIndex = 0; pickFormation(FE[+sl.value]); }
    });
  });
  $("pPick").addEventListener("change", function () { var f = FE[+$("pPick").value]; if (f) pickFormation(f); });
  ["pLon", "pEW", "pLat", "pNS"].forEach(function (id) { $(id).addEventListener("change", function () { formRead(); formFill(); }); });

  function constraints() {
    return { night: $("cNight").checked, twilight: num($("cTw").value, 6), moonVisible: $("cMoon").checked, moonMin: num($("cMin").value, 15) };
  }
  function popupRows(tb, rows, atlas) {
    clear(tb);
    if (!rows.length) { var tr = add(tb, "tr"); var td = add(tr, "td", "None in this period"); td.colSpan = 4; return; }
    rows.forEach(function (r) {
      var tr = add(tb, "tr", undefined, "pick");
      r.cells.forEach(function (c) { add(tr, "td", c); });
      tr.title = "Double-click to open the atlas at the middle of this period";
      tr.addEventListener("dblclick", function () { toAtlas(new Date((r.start.getTime() + r.end.getTime()) / 2)); });
    });
  }
  function years() { return Math.max(1, Math.min(10, Math.round(num($("pYears").value, 1)))); }
  function startDate() { return new Date(localDate(S.y, S.mo, 1)); }
  function runPred() {
    formRead();
    status("Computing");
    var which = S.pred;
    setTimeout(function () {
      var o = O(), c = constraints(), st = startDate(), yrs = years();
      try {
        if (which === "co") {
          var w = E && C.predictColongitude(o, { colong: num($("coV").value, 10), delta: Math.max(0.05, num($("coD").value, 1)), start: st, years: yrs }, c);
          popupRows($("gCo").tBodies[0], w.map(function (x) { return { start: x.start, end: x.end, cells: [fmtDT(x.start), fmtDT(x.end), x.sunLat.toFixed(2) + "°"] }; }));
        } else if (which === "sun") {
          var s = C.predictSunElevation(o, { lat: form.lat, lon: form.lon, min: num($("seMin").value, 3), max: num($("seMax").value, 12), start: st, years: yrs }, c);
          var map = function (x) { return { start: x.start, end: x.end, cells: [fmtDT(x.start), fmtDT(x.end), C.deg2str(x.libLon), C.deg2str(x.libLat)] }; };
          popupRows($("gSe1").tBodies[0], s.morning.map(map)); popupRows($("gSe2").tBodies[0], s.evening.map(map));
        } else {
          var l = C.predictLibration(o, { lat: form.lat, lon: form.lon, libLon: num($("lbLon").value, 2), libLat: num($("lbLat").value, 0), west: $("lbEW").value === "-1", south: $("lbNS").value === "-1", start: st, years: yrs }, c);
          popupRows($("gLb").tBodies[0], l.map(function (x) { return { start: x.start, end: x.end, cells: [fmtDT(x.start), fmtDT(x.end), x.sunStart.toFixed(2) + "°", x.sunEnd.toFixed(2) + "°"] }; }));
        }
        status("");
      } catch (err) { status("Could not compute: " + err); }
    }, 30);
  }
  ["coGo", "seGo", "lbGo"].forEach(function (id) { $(id).addEventListener("click", runPred); });
  function setPred(p) {
    S.pred = p;
    [["co", "sCo", "qCo"], ["sun", "sSun", "qSun"], ["lib", "sLib", "qLib"]].forEach(function (k) {
      $(k[1]).setAttribute("aria-selected", String(k[0] === p)); $(k[2]).hidden = k[0] !== p;
    });
    var needs = p !== "co";
    $("pHint").textContent = needs && !form.name && !form.lat && !form.lon ? "Choose a formation above, or type its longitude and latitude." : "Double-click a row to open the atlas at the middle of that period" + (form.name ? ", centred on " + form.name : "") + ".";
    runPred();
  }
  [["sCo", "co"], ["sSun", "sun"], ["sLib", "lib"]].forEach(function (k) { $(k[0]).addEventListener("click", function () { setPred(k[1]); }); });

  /* ---- tabs, date controls ---- */
  function status(t) { $("status").textContent = t || ""; }
  var TABS = { year: ["tYear", "pYear", "by year"], month: ["tMonth", "pMonth", "by month"], day: ["tDay", "pDay", "by day"], pred: ["tPred", "pPred", "by month"] };
  function setTab(t) {
    S.tab = t;
    Object.keys(TABS).forEach(function (k) { $(TABS[k][0]).setAttribute("aria-selected", String(k === t)); $(TABS[k][1]).hidden = k !== t; });
    $("by").textContent = TABS[t][2];
    sync();
  }
  Object.keys(TABS).forEach(function (k) { $(TABS[k][0]).addEventListener("click", function () { setTab(k); }); });
  function sync() {
    S.d = Math.min(S.d, dim(S.y, S.mo));
    $("yy").value = S.y; $("mm").value = S.mo; $("dd").value = S.d;
    $("where").textContent = fmtLat(obs.lat) + " " + fmtLon(obs.lon) + ", " + Math.round(obs.alt) + " m, " + zoneLabel();
    updateAtlasLink();
    if (S.tab === "year") showYear(); else if (S.tab === "month") showMonth(); else if (S.tab === "day") showDay(); else setPredIfNew();
  }
  var predShown = false;
  function setPredIfNew() { if (!predShown) { predShown = true; setPred(S.pred); } else runPred(); }
  function redraw() { setTimeout(function () { if (S.tab === "year") { drawCal(); drawYearChart(); } else if (S.tab === "month") drawMonthCharts(); else if (S.tab === "day") drawDayChart(); }, 0); }
  window.addEventListener("resize", redraw);
  (function () {
    var sl = $("mm"); MONTHS.forEach(function (m, i) { var o = add(sl, "option", m); o.value = i + 1; });
  })();
  var timer = 0;
  function dateEdited() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var y = Math.round(num($("yy").value, S.y)); S.y = Math.max(1, Math.min(9999, y)); S.mo = +$("mm").value; S.d = Math.round(num($("dd").value, S.d)) || 1;
      S.d = Math.max(1, Math.min(S.d, dim(S.y, S.mo)));
      sync();
    }, 250);
  }
  ["yy", "mm", "dd"].forEach(function (id) { $(id).addEventListener("input", dateEdited); $(id).addEventListener("change", dateEdited); });
  function step(sgn) {
    if (S.tab === "year") S.y += sgn;
    else if (S.tab === "day") { var t = new Date(Date.UTC(S.y, S.mo - 1, S.d + sgn)); S.y = t.getUTCFullYear(); S.mo = t.getUTCMonth() + 1; S.d = t.getUTCDate(); }
    else { S.mo += sgn; if (S.mo < 1) { S.mo = 12; S.y--; } if (S.mo > 12) { S.mo = 1; S.y++; } }
    sync();
  }
  $("dec").addEventListener("click", function () { step(-1); });
  $("inc").addEventListener("click", function () { step(1); });
  $("today").addEventListener("click", function () { today(); $("dh").value = 0; $("dmin").value = 0; $("ds").value = 0; sync(); });

  /* ---- hand-off to and from the atlas ---- */
  function atlasUrl(date) {
    var q = ["date=" + encodeURIComponent(date.toISOString())];
    if (form.name) q.push("f=" + encodeURIComponent(form.name));
    else if (S.tab === "pred" && (form.lat || form.lon)) q.push("f=" + encodeURIComponent("Formation"), "lat=" + form.lat, "lon=" + form.lon);
    return "index.html?" + q.join("&");
  }
  function updateAtlasLink() { $("goAtlas").href = atlasUrl(new Date(dayMs())); }
  function toAtlas(date) { location.href = atlasUrl(date); }

  /* ---- Setup, Save ephemeris, Help, About ---- */
  var PLACES = [];
  function setupZones() {
    var sl = clear($("sTz")), names = [];
    try { names = Intl.supportedValuesOf("timeZone"); } catch (e) { names = []; }
    PLACES.forEach(function (p) { if (names.indexOf(p[4]) < 0) names.push(p[4]); });
    names = names.filter(function (n) { return n !== "UTC"; }).sort();
    [["local", "Your device's time zone"], ["UTC", "UTC"]].concat(names.map(function (n) { return [n, n.replace(/_/g, " ")]; })).forEach(function (z) { var o = add(sl, "option", z[1]); o.value = z[0]; });
  }
  function loadPlaces(cb) {
    if (PLACES.length) return cb();
    fetch("data/places/places.json").then(function (r) { return r.json(); }).then(function (j) {
      PLACES = j.places || []; var cs = {}; PLACES.forEach(function (p) { cs[p[1]] = 1; });
      var sl = clear($("sCountry")); add(sl, "option", "Choose a country").value = "";
      Object.keys(cs).sort().forEach(function (c) { add(sl, "option", c).value = c; });
      fillCities(""); setupZones(); cb();
    }).catch(function () { setupZones(); cb(); });
  }
  function fillCities(country) {
    var sl = clear($("sCity")); add(sl, "option", country ? "Choose a city" : "(choose a country first)").value = "";
    PLACES.forEach(function (p, i) { if (p[1] === country) add(sl, "option", p[0]).value = i; });
  }
  $("sCountry").addEventListener("change", function () { fillCities($("sCountry").value); });
  $("sCity").addEventListener("change", function () {
    var p = PLACES[parseInt($("sCity").value, 10)]; if (!p) return;
    $("sLat").value = Math.abs(p[2]); $("sNS").value = p[2] < 0 ? "-1" : "1"; $("sLon").value = Math.abs(p[3]); $("sEW").value = p[3] < 0 ? "-1" : "1"; $("sTz").value = p[4];
  });
  $("mSetup").addEventListener("click", function () {
    loadPlaces(function () {
      $("sLat").value = Math.abs(obs.lat); $("sNS").value = obs.lat < 0 ? "-1" : "1"; $("sLon").value = Math.abs(obs.lon); $("sEW").value = obs.lon < 0 ? "-1" : "1";
      $("sAlt").value = obs.alt; $("sTz").value = zone; $("dSetup").showModal();
    });
  });
  $("fSetup").addEventListener("submit", function (e) {
    if (e.submitter && e.submitter.value !== "ok") return;
    var la = num($("sLat").value, NaN) * parseInt($("sNS").value, 10), lo = num($("sLon").value, NaN) * parseInt($("sEW").value, 10), al = num($("sAlt").value, 0);
    if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) { e.preventDefault(); return; }
    obs.lat = la; obs.lon = lo; obs.alt = al; zone = U.zoneValid($("sTz").value) ? $("sTz").value : "local";
    lsSet("oma-obs-lat", la); lsSet("oma-obs-lon", lo); lsSet("oma-obs-alt", al); lsSet("oma-tz", zone);
    yearKey = ""; monthKey = ""; sync();
  });
  $("mEphem").addEventListener("click", function () {
    var a = localDate(S.y, S.mo, S.d), b = localDate(S.y, S.mo, S.d + 7);
    function iso(ms) { var p = U.zoneParts(new Date(ms), zone); return p.y + "-" + pad(p.mo) + "-" + pad(p.d); }
    $("eStart").value = iso(a); $("eEnd").value = iso(b); $("dEphem").showModal();
  });
  $("fEphem").addEventListener("submit", function (e) {
    if (e.submitter && e.submitter.value !== "ok") return;
    var s = /^(\d+)-(\d+)-(\d+)$/.exec($("eStart").value), en = /^(\d+)-(\d+)-(\d+)$/.exec($("eEnd").value), stp = num($("eStep").value, 1);
    if (!s || !en || !(stp > 0)) { e.preventDefault(); status("Give a start date, an end date and a step."); return; }
    var a = new Date(localDate(+s[1], +s[2], +s[3], 0)), b = new Date(localDate(+en[1], +en[2], +en[3], 23));
    if (!(b > a)) { e.preventDefault(); status("The end date must be after the start date."); return; }
    if ((b - a) / (stp * 3600000) > 100000) { e.preventDefault(); status("Too many rows (limit 100,000): use a larger step."); return; }
    var blob = new Blob([C.ephemCsv(O(), a, b, stp)], { type: "text/csv" }), link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "calclun-ephemeris-" + $("eStart").value + ".csv"; document.body.appendChild(link); link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000); status("");
  });
  $("mPrint").addEventListener("click", function () { window.print(); });
  function text(title, items) {
    $("dTextT").textContent = title; var b = clear($("dTextB")), ul = add(b, "ul");
    items.forEach(function (t) { add(ul, "li", t); }); $("dText").showModal();
  }
  $("mHelp").addEventListener("click", function () {
    text("CalcLun help", [
      "Year: a calendar of the Moon's phase for every day, the phase times, the greatest librations and a chart of twilight, moonrise and moonset. Click a day or a month name.",
      "Month: one row per day (values at 00:00 UT, rise and set in local time). Click a heading to graph that column, or a day to open it.",
      "Day: hour by hour values, the Moon's altitude through the day with the twilight shading, and the values at any time you set.",
      "Prediction: find when a colongitude, a Sun elevation on a formation or a libration comes up in the next years, optionally only at night and with the Moon above your horizon. Double-click a result to open the atlas at that moment.",
      "Setup sets the observatory (country and city, latitude, longitude, altitude) and the time zone; the atlas uses the same values.",
      "Save ephemeris writes a CSV file for a range of dates and a step in hours."
    ]);
  });
  $("mAbout").addEventListener("click", function () {
    text("About CalcLun", [
      "CalcLun in Observer's Moon Atlas is a workalike of the CalcLun applet of Virtual Moon Atlas (Christian Legrand and Patrick Chevalley). The code is new.",
      "Positions: astronomy-engine (MIT, Don Cross). Libration and the Sun's selenographic position: Meeus, Astronomical Algorithms ch. 53, optical libration only, with the diurnal shift for your observatory. Rise and set include refraction and the Sun and Moon's size.",
      "Colongitude is the selenographic longitude of the morning terminator (0 at first quarter, 90 at full Moon)."
    ]);
  });

  /* ---- start ---- */
  (function init() {
    var d = P.get("date") ? new Date(P.get("date")) : null;
    if (d && !isNaN(d)) { var p = U.zoneParts(d, zone); S.y = p.y; S.mo = p.mo; S.d = p.d; $("dh").value = p.h; $("dmin").value = p.mi; $("ds").value = p.s; } else today();
    var fl = parseFloat(P.get("flat")), fo = parseFloat(P.get("flon")), fn = P.get("f");
    if (isFinite(fl) && isFinite(fo)) { form = { lat: fl, lon: fo, name: fn || "" }; }
    formFill();
    var t = P.get("tab"); if (t && TABS[t]) S.tab = t;
    var pr = P.get("pred"); if (pr === "co" || pr === "sun" || pr === "lib") S.pred = pr;
    if (fn && !(isFinite(fl) && isFinite(fo))) {
      loadFeatures(function () {
        var hit = FE.filter(function (f) { return f.name.toLowerCase() === fn.toLowerCase(); })[0];
        if (hit) { form = { lat: hit.lat, lon: hit.lon, name: hit.name }; formFill(); }
        setTab(S.tab);
      });
    } else setTab(S.tab);
  })();
})();
