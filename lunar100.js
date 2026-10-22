/* Lunar 100 page for Observer's Moon Atlas.
   Data: Wood's Lunar 100 with Rükl, 21st Century Atlas and North references (data/lunar100/lunar100.json).
   Lighting and visibility use the same ephemeris layer as the atlas (ephem.js). Observation log: localStorage. */
(function () {
  "use strict";
  var E = window.OMA && window.OMA.ephem;
  var D2R = Math.PI / 180;
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toLocalInput(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function isoDay(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fmtLocal(d) { return d ? d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "none in range"; }
  function fmtLat(v) { return Math.abs(v).toFixed(1) + "°" + (v >= 0 ? "N" : "S"); }
  function fmtLon(v) { return Math.abs(v).toFixed(1) + "°" + (v >= 0 ? "E" : "W"); }
  function vec(lat, lon) { var c = Math.cos(lat * D2R); return [c * Math.sin(lon * D2R), Math.sin(lat * D2R), c * Math.cos(lon * D2R)]; }
  function rows(el, pairs) {
    el.textContent = "";
    pairs.forEach(function (p) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = p[0]; dd.textContent = p[1]; el.appendChild(dt); el.appendChild(dd);
    });
  }

  /* theme, shared with the atlas */
  (function () {
    var root = document.documentElement, btn = $("themeToggle");
    function apply(m, persist) { root.setAttribute("data-theme", m); if (persist) lsSet("oma-theme", m); }
    apply("dark", false);
    var s = lsGet("oma-theme", ""); if (s === "dark" || s === "light") apply(s, false);
    btn.addEventListener("click", function () { apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true); });
  })();

  if (!E) { $("dName").textContent = "Ephemeris failed to load"; return; }

  var DATA = [], log = {}, sel = null, sortKey = "L", sortDir = 1, st = null, weekStates = [], date = new Date();
  try { log = JSON.parse(lsGet("oma-l100", "{}")) || {}; } catch (e) { log = {}; }
  function saveLog() { lsSet("oma-l100", JSON.stringify(log)); }
  function entry(L) { return log[L] || (log[L] = { seen: false, date: "", note: "" }); }

  /* ---- computed lighting ---- */
  function visibleFromEarth(f, s) {
    if (f.lat === null) return false;
    var a = vec(f.lat, f.lon), b = vec(s.libLat, s.libLon);
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.03;
  }
  function recompute() {
    st = E.compute(date);
    weekStates = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + i, 20, 0, 0);
      weekStates.push(E.compute(d));
    }
    DATA.forEach(function (f) {
      if (f.lat === null) { f.sun = null; f.vis = false; f.lit = false; f.week = false; return; }
      f.sun = E.sunElevation(st, f.lat, f.lon);
      f.vis = visibleFromEarth(f, st);
      f.lit = f.vis && f.sun >= 2 && f.sun <= 25;
      f.week = weekStates.some(function (s) { var e = E.sunElevation(s, f.lat, f.lon); return visibleFromEarth(f, s) && e >= 2 && e <= 25; });
    });
  }

  /* ---- list ---- */
  function natural(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }
  function keyOf(f, k) {
    switch (k) {
      case "seen": return entry(f.L).seen ? 0 : 1;
      case "name": return f.name.toLowerCase();
      case "diam": return f.diam === null ? Infinity : f.diam;
      case "rukl": return f.rukl || "zzz";
      case "atlas21": return f.atlas21 || "zzz";
      case "north": return f.north || "zzz";
      case "sun": return f.sun === null ? Infinity : -f.sun;
      default: return f.L;
    }
  }
  function visibleRows() {
    var seenF = $("fSeen").value, q = $("q").value.trim().toLowerCase(), lit = $("fLit").checked, wk = $("fWeek").checked;
    var out = DATA.filter(function (f) {
      var s = entry(f.L).seen;
      if (seenF === "seen" && !s) return false;
      if (seenF === "unseen" && s) return false;
      if (lit && !f.lit) return false;
      if (wk && !f.week) return false;
      if (q && (f.name + " " + f.significance + " " + f.notes + " " + (log[f.L] ? log[f.L].note : "")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    out.sort(function (a, b) {
      var x = keyOf(a, sortKey), y = keyOf(b, sortKey), c = typeof x === "number" && typeof y === "number" ? x - y : natural(x, y);
      return (c || a.L - b.L) * sortDir;
    });
    return out;
  }
  function sunCell(f) {
    if (f.sun === null) return ["—", "sun-dim"];
    if (!f.vis) return ["far side", "sun-dim"];
    var e = f.sun.toFixed(0) + "°";
    return [e, f.sun < 0 ? "sun-dim" : (f.sun <= 25 ? (f.sun >= 2 ? "sun-good" : "sun-low") : "")];
  }
  function render() {
    var tb = $("rows"), list = visibleRows(); tb.textContent = "";
    list.forEach(function (f) {
      var tr = document.createElement("tr"); if (sel && sel.L === f.L) tr.className = "sel";
      var c1 = document.createElement("td"), cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = entry(f.L).seen; cb.setAttribute("aria-label", "Seen " + f.name);
      cb.addEventListener("click", function (e) { e.stopPropagation(); setSeen(f, cb.checked); });
      c1.appendChild(cb); tr.appendChild(c1);
      var c2 = document.createElement("td"); c2.className = "num"; c2.textContent = f.L; tr.appendChild(c2);
      var c3 = document.createElement("td"), nm = document.createElement("strong"), sg = document.createElement("span");
      nm.textContent = f.name; sg.className = "sig"; sg.textContent = f.significance; c3.appendChild(nm); c3.appendChild(sg); tr.appendChild(c3);
      [f.diam_text || "—", f.rukl || "—", f.atlas21 || "—", f.north || "—"].forEach(function (t) {
        var c = document.createElement("td"); c.className = "num"; c.textContent = t; tr.appendChild(c);
      });
      var sc = sunCell(f), c8 = document.createElement("td"); c8.className = "num " + sc[1]; c8.textContent = sc[0]; tr.appendChild(c8);
      tr.addEventListener("click", function () { select(f); });
      tb.appendChild(tr);
    });
    var seen = DATA.filter(function (f) { return entry(f.L).seen; }).length;
    $("progress").textContent = seen + " / " + DATA.length + " seen";
    $("count").textContent = list.length + " of " + DATA.length + " shown. Sun column: Sun elevation at the feature at the chosen time. Green is good relief (2° to 25°), amber is the terminator, grey is night.";
    Array.prototype.forEach.call(document.querySelectorAll("thead th"), function (th) {
      if (th.getAttribute("data-k") === sortKey) th.setAttribute("aria-sort", sortDir > 0 ? "ascending" : "descending"); else th.removeAttribute("aria-sort");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("thead th"), function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-k");
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      render();
    });
  });

  function setSeen(f, on) {
    var e = entry(f.L); e.seen = on;
    if (on && !e.date) e.date = isoDay(new Date());
    saveLog(); render(); if (sel && sel.L === f.L) fillObs();
  }

  /* ---- detail ---- */
  function sunNote(e) {
    if (e < 0) return "The Sun is below the horizon at this feature at the chosen time.";
    if (e < 3) return "At the terminator: very long shadows, the dramatic moment, but short-lived.";
    if (e < 12) return "Low Sun: long shadows, the best light for relief and fine detail.";
    if (e < 30) return "Moderate Sun: good contrast with shorter shadows.";
    return "High Sun: flat lighting. Good for albedo and rays, poor for relief.";
  }
  function select(f) {
    sel = f; $("dName").textContent = f.name; $("dSig").textContent = f.significance;
    var facts = [["Lunar 100 number", "L" + f.L]];
    if (f.lat !== null) facts.push(["Position", fmtLat(f.lat) + ", " + fmtLon(f.lon)]);
    facts.push(["Diameter", f.diam_text ? f.diam_text + (f.diam !== null ? " km" : "") : "n/a"]);
    facts.push(["Rükl chart", f.rukl || "n/a"], ["21st Century Atlas", f.atlas21 || "n/a"], ["North, Observing the Moon", f.north ? "pp. " + f.north : "not indexed"]);
    if (f.notes) facts.push(["Note", f.notes]);
    rows($("dFacts"), facts);
    var d = date;
    if (f.lat === null) { rows($("dSun"), [["Lighting", "This entry is a concept, not a place."]]); $("dNote").textContent = ""; }
    else {
      var e = f.sun;
      rows($("dSun"), [["Sun elevation", e.toFixed(1) + "°"], ["Visible from Earth", f.vis ? "yes" : "no, far side at this libration"],
                       ["Next sunrise there", "working"], ["Next sunset there", "working"]]);
      $("dNote").textContent = sunNote(e);
      setTimeout(function () {
        if (sel !== f || date !== d) return;
        var ev = E.sunEvents(d, f.lat, f.lon, 32);
        function when(t) { return t ? fmtLocal(t) + " (in " + ((t - d) / 86400000).toFixed(1) + " days)" : "none in the next 32 days"; }
        rows($("dSun"), [["Sun elevation", e.toFixed(1) + "°"], ["Visible from Earth", f.vis ? "yes" : "no, far side at this libration"],
                         ["Next sunrise there", when(ev.rise)], ["Next sunset there", when(ev.set)]]);
      }, 0);
    }
    fillObs();
    var url = "index.html?f=" + encodeURIComponent(f.name) + (f.lat !== null ? "&lat=" + f.lat + "&lon=" + f.lon + "&zoom=" + (f.diam && f.diam > 250 ? 2.5 : 5) : "") + "&date=" + encodeURIComponent(date.toISOString());
    $("goAtlas").href = url; $("goAtlas").style.display = f.lat === null ? "none" : "";
    render();
  }
  function fillObs() {
    var e = entry(sel.L); $("oSeen").checked = e.seen; $("oDate").value = e.date; $("oNote").value = e.note;
  }
  $("oSeen").addEventListener("change", function () { if (sel) setSeen(sel, $("oSeen").checked); });
  $("oDate").addEventListener("change", function () { if (sel) { entry(sel.L).date = $("oDate").value; saveLog(); } });
  $("oNote").addEventListener("input", function () { if (sel) { entry(sel.L).note = $("oNote").value; saveLog(); } });

  /* ---- controls ---- */
  function setDate(d) { date = d; $("dt").value = toLocalInput(d); recompute(); render(); if (sel) select(sel); }
  $("dt").addEventListener("change", function () { var d = new Date($("dt").value); if (!isNaN(d)) setDate(d); });
  $("today").addEventListener("click", function () { setDate(new Date()); });
  ["fSeen", "fLit", "fWeek"].forEach(function (id) { $(id).addEventListener("change", render); });
  $("q").addEventListener("input", render);

  /* ---- export ---- */
  function download(name, mime, text) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function q(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
  $("expCsv").addEventListener("click", function () {
    var out = ["L,Feature,Significance,Lat,Lon,Diameter,Rukl,21st Century Atlas,North,Seen,Date seen,Note"];
    visibleRows().forEach(function (f) {
      var e = entry(f.L);
      out.push([f.L, q(f.name), q(f.significance), f.lat === null ? "" : f.lat, f.lon === null ? "" : f.lon, q(f.diam_text), q(f.rukl), q(f.atlas21), q(f.north), e.seen ? "yes" : "no", e.date, q(e.note)].join(","));
    });
    download("lunar100-" + isoDay(new Date()) + ".csv", "text/csv", out.join("\n") + "\n");
  });
  $("printBtn").addEventListener("click", function () { window.print(); });
  $("expTxt").addEventListener("click", function () {
    var out = ["Lunar 100, " + $("progress").textContent, ""];
    visibleRows().forEach(function (f) {
      var e = entry(f.L);
      out.push((e.seen ? "[x] " : "[ ] ") + "L" + f.L + " " + f.name + (f.lat !== null ? " (" + fmtLat(f.lat) + ", " + fmtLon(f.lon) + ")" : "") +
               " Rukl " + (f.rukl || "-") + ", 21stC " + (f.atlas21 || "-") + (e.date ? ", seen " + e.date : "") + (e.note ? " | " + e.note : ""));
    });
    download("lunar100-" + isoDay(new Date()) + ".txt", "text/plain", out.join("\n") + "\n");
  });

  /* ---- go ---- */
  fetch("data/lunar100/lunar100.json").then(function (r) { return r.json(); }).then(function (j) {
    DATA = j.rows.map(function (r) {
      return { L: r[0], name: r[1], significance: r[2], lat: r[3], lon: r[4], diam: r[5], diam_text: r[6], rukl: r[7], atlas21: r[8], north: r[9], notes: r[10] };
    });
    var p = new URLSearchParams(location.search), want = parseInt(p.get("L"), 10);
    setDate(new Date());
    var f = DATA.filter(function (x) { return x.L === want; })[0];
    if (f) select(f);
  }).catch(function () { $("dName").textContent = "Data not loaded"; $("dSig").textContent = "Open this page through a web server so data/lunar100/lunar100.json can load."; });
})();
