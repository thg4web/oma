/* Web links page (WebLun) for Observer's Moon Atlas.
   Data: data/dev/weblun.json, built by project/tools/build_weblun.py (DEV DATA, permission pending).
   Filters work as VMA's WebLun: theme, then sub-theme, then a text search in one column or all. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* theme, shared with the atlas */
  (function () {
    var root = document.documentElement, btn = $("themeToggle");
    function apply(m, persist) { root.setAttribute("data-theme", m); if (persist) lsSet("oma-theme", m); }
    apply("dark", false);
    var s = lsGet("oma-theme", ""); if (s === "dark" || s === "light") apply(s, false);
    btn.addEventListener("click", function () { apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true); });
  })();

  var COLS = ["name", "language", "theme", "subtheme", "url", "description", "date"];
  var DATA = [], sortKey = "theme", sortDir = 1, ALL = "All";
  var locked = false;
  var BASE = [], sel = null, MY = { user: [], over: {}, del: [] };
  var STORE = "oma-wl";
  try { var saved = JSON.parse(lsGet(STORE, "{}")); if (saved && typeof saved === "object") { MY.user = saved.user || []; MY.over = saved.over || {}; MY.del = saved.del || []; } } catch (e) {}
  function saveMy() { lsSet(STORE, JSON.stringify(MY)); }
  // The shipped list is never changed: edits to it are kept as overrides keyed by address + name, deletions as a list of keys.
  function keyOf(r) { return r.url + "|" + r.name; }
  function build() {
    DATA = BASE.filter(function (r) { return MY.del.indexOf(r.id) < 0; }).map(function (r) {
      var o = MY.over[r.id]; if (!o) return r;
      var n = {}; COLS.forEach(function (k) { n[k] = o[k] !== undefined ? o[k] : r[k]; }); n.id = r.id; n.edited = true; return n;
    }).concat(MY.user.map(function (r) { var n = {}; COLS.forEach(function (k) { n[k] = r[k] || ""; }); n.id = r.id; n.mine = true; return n; }));
    if (sel && !DATA.some(function (r) { return r.id === sel; })) sel = null;
    $("mRestore").hidden = MY.del.length === 0;
  }

  function fill(sel, values) {
    sel.textContent = "";
    [ALL].concat(values).forEach(function (v) { var o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
    sel.value = ALL;
  }
  function uniq(list) { var s = {}; list.forEach(function (v) { s[v] = 1; }); return Object.keys(s).sort(); }
  // "English" matches "Chinese / English" and so on: split the language field on "/"
  function langs(r) { return r.language.split("/").map(function (s) { return s.trim(); }); }
  function fillThemes() {
    locked = true;
    fill($("fTheme"), uniq(DATA.map(function (r) { return r.theme; })));
    fill($("fSub"), uniq(DATA.map(function (r) { return r.subtheme; })));
    var all = []; DATA.forEach(function (r) { all = all.concat(langs(r)); });
    fill($("fLang"), uniq(all));
    locked = false;
  }
  function fillSub() {
    var th = $("fTheme").value;
    fill($("fSub"), uniq(DATA.filter(function (r) { return th === ALL || r.theme === th; }).map(function (r) { return r.subtheme; })));
  }
  function matches(r) {
    var th = $("fTheme").value, sb = $("fSub").value, lg = $("fLang").value, f = $("fField").value;
    var q = $("q").value.trim().toLowerCase();
    if (th !== ALL && r.theme !== th) return false;
    if (sb !== ALL && r.subtheme !== sb) return false;
    if (lg !== ALL && langs(r).indexOf(lg) < 0) return false;
    if (!q) return true;
    var keys = f === "all" ? COLS : [f];
    return keys.some(function (k) { return r[k].toLowerCase().indexOf(q) >= 0; });
  }
  function cmp(a, b) {
    var x = a[sortKey].toLowerCase(), y = b[sortKey].toLowerCase();
    return (x < y ? -1 : x > y ? 1 : 0) * sortDir || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  function td(cls, text) { var c = document.createElement("td"); if (cls) c.className = cls; c.textContent = text; return c; }

  function render() {
    var list = DATA.filter(matches).sort(cmp), body = $("rows");
    body.textContent = "";
    list.forEach(function (r) {
      var tr = document.createElement("tr");
      if (r.id === sel) tr.className = "sel";
      tr.addEventListener("click", function (e) { if (e.target && e.target.tagName === "A") return; sel = r.id; render(); });
      var nm = td("name", r.name || "(untitled)");
      if (r.mine || r.edited) { var b = document.createElement("span"); b.className = "mine"; b.textContent = r.mine ? "yours" : "edited"; nm.appendChild(b); }
      tr.appendChild(nm);
      tr.appendChild(td("lang", r.language));
      tr.appendChild(td("", r.theme));
      tr.appendChild(td("", r.subtheme));
      var u = document.createElement("td"); u.className = "url";
      var a = document.createElement("a"); a.href = r.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = r.url;
      u.appendChild(a); tr.appendChild(u);
      tr.appendChild(td("", r.description));
      tr.appendChild(td("date", r.date));
      body.appendChild(tr);
    });
    $("bDel").disabled = $("bEdit").disabled = !sel;
    $("count").textContent = list.length + " of " + DATA.length + " sites";
    $("msg").textContent = list.length ? "" : "No site matches. Reset the selection or change the search.";
    Array.prototype.forEach.call(document.querySelectorAll("#tbl thead th"), function (th) {
      if (th.getAttribute("data-k") === sortKey) th.setAttribute("aria-sort", sortDir > 0 ? "ascending" : "descending"); else th.removeAttribute("aria-sort");
    });
  }
  function reset() {
    locked = true;
    $("fTheme").value = ALL; fillSub(); $("fLang").value = ALL; $("fField").value = "all"; $("q").value = "";
    locked = false; render();
  }

  $("fTheme").addEventListener("change", function () { if (locked) return; $("q").value = ""; fillSub(); render(); });
  ["fSub", "fLang", "fField"].forEach(function (id) { $(id).addEventListener("change", function () { if (!locked) { if (id !== "fField") $("q").value = ""; render(); } }); });
  /* ---- new, delete, edit ---- */
  var editing = null;   // the id being edited, or null for a new site
  function datalist(id, vals) { var d = $(id); d.textContent = ""; uniq(vals).forEach(function (v) { var o = document.createElement("option"); o.value = v; d.appendChild(o); }); }
  function openSite(r) {
    editing = r ? r.id : null;
    $("sTitle").textContent = r ? "Edit site" : "New site";
    $("sName").value = r ? r.name : ""; $("sUrl").value = r ? r.url : ""; $("sLang").value = r ? r.language : "English";
    $("sTheme").value = r ? r.theme : ($("fTheme").value === ALL ? "" : $("fTheme").value);
    $("sSub").value = r ? r.subtheme : ($("fSub").value === ALL ? "" : $("fSub").value);
    $("sDesc").value = r ? r.description : ""; $("sErr").textContent = "";
    datalist("lLang", DATA.map(function (x) { return x.language; })); datalist("lTheme", DATA.map(function (x) { return x.theme; })); datalist("lSub", DATA.map(function (x) { return x.subtheme; }));
    var d = $("dSite"); if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }
  function today() { var d = new Date(), p = function (n) { return n < 10 ? "0" + n : "" + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  $("fSite").addEventListener("submit", function (e) {
    var v = e.submitter ? e.submitter.value : "ok";
    if (v === "cancel") return;
    var rec = { name: $("sName").value.trim(), url: $("sUrl").value.trim(), language: $("sLang").value.trim(), theme: $("sTheme").value.trim(), subtheme: $("sSub").value.trim(), description: $("sDesc").value.trim() };
    var err = !rec.name ? "A site name is needed." : !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(rec.url) ? "The address must start with http:// or https://." : !rec.theme ? "A theme is needed." : "";
    if (err) { e.preventDefault(); $("sErr").textContent = err; return; }
    rec.date = today();
    var base = editing && BASE.filter(function (r) { return r.id === editing; })[0];
    if (!editing) { rec.id = "u" + Date.now(); MY.user.push(rec); sel = rec.id; }
    else if (base) { var o = {}; COLS.forEach(function (k) { if (rec[k] !== base[k]) o[k] = rec[k]; }); if (Object.keys(o).length) MY.over[editing] = o; else delete MY.over[editing]; }
    else { MY.user = MY.user.map(function (r) { return r.id === editing ? Object.assign(rec, { id: editing }) : r; }); }
    saveMy(); build(); fillThemes(); render();
  });
  $("bAdd").addEventListener("click", function () { openSite(null); });
  $("bEdit").addEventListener("click", function () { var r = DATA.filter(function (x) { return x.id === sel; })[0]; if (r) openSite(r); });
  $("bDel").addEventListener("click", function () {
    var r = DATA.filter(function (x) { return x.id === sel; })[0]; if (!r) return;
    if (typeof confirm === "function" && !confirm("Delete " + (r.name || r.url) + (r.mine ? "?" : " from your list? The original list is not changed, and Restore deleted brings it back."))) return;
    if (r.mine) MY.user = MY.user.filter(function (x) { return x.id !== r.id; }); else { MY.del.push(r.id); delete MY.over[r.id]; }
    sel = null; saveMy(); build(); fillThemes(); render();
  });
  $("mRestore").addEventListener("click", function () { MY.del = []; saveMy(); build(); fillThemes(); render(); });
  $("go").addEventListener("click", render);
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") render(); });
  $("q").addEventListener("input", render);
  $("mReset").addEventListener("click", reset);
  Array.prototype.forEach.call(document.querySelectorAll("#tbl thead th"), function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-k");
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      render();
    });
  });

  function text(title, paras) {
    $("dTextT").textContent = title; var b = $("dTextB"); b.textContent = "";
    paras.forEach(function (t) { var p = document.createElement("p"); p.textContent = t; b.appendChild(p); });
    var d = $("dText"); if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }
  $("mHelp").addEventListener("click", function () {
    text("Web links help", [
      "Pick a theme, then a sub-theme, to narrow the list. Language filters by the language of the site.",
      "Type in the search box to look in every column or in one column chosen in Search in. The list updates as you type.",
      "Click a column title to sort, and again to reverse. Click an address to open the site in a new tab.",
      "Reset selection clears every filter.",
      "Click a row to select it. + adds a site, Edit changes the selected site and the minus button deletes it. Deleted sites from the original list can be brought back with Restore deleted. Your changes stay in this browser only, and the original list is never changed."]);
  });
  $("mAbout").addEventListener("click", function () {
    text("About Web links", [
      "WebLun is the Observer's Moon Atlas workalike of Virtual Moon Atlas's WebLun. The code is new.",
      "The list of sites is Christian Legrand's curated WebLun list, used with permission pending. Descriptions are his.",
      "Sites are external and outside our control. An address may change or stop working."]);
  });

  fetch("data/dev/weblun.json").then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
    BASE = j.rows.map(function (r) { var o = {}; COLS.forEach(function (k, i) { o[k] = r[i] || ""; }); o.id = keyOf(o); return o; });
    build(); fillThemes(); render();
  }).catch(function () { $("msg").textContent = "The list of sites could not be loaded."; });
})();
