(function(){
"use strict";
/* Datum card — one shared script. Reads the inline JSON, renders the page, mounts the chart on uPlot 1.6.32.
   Everything visual resolves from the custom properties in _card.css; theme and print are one attribute and one class. */
var D = JSON.parse(document.getElementById("card-data").textContent);
var M = D.models.measured, I = D.models.industry, P = D.profile || {}, B = D.base || {};
var PRIMARY = M || I;
var MINUS = "−";
var root = document.documentElement;
var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── tokens: read once, re-read on theme switch ─────────── */
var TOKENS = ["ground","raised","rule","ink","graphite","ink-soft","measured","industry","refusal","caution","datumline",
              "band-fill","band-edge","crosshair","selection-fill","selection-edge","focus","glow-measured","glow-industry"];
var T = {};
function readTokens(){
  var cs = getComputedStyle(document.body);
  TOKENS.forEach(function(n){ T[n] = cs.getPropertyValue("--" + n).trim(); });
}

/* ── helpers ────────────────────────────────────────────── */
function el(tag, cls, txt){ var e = document.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }
function txt(s){ return document.createTextNode(s); }
function neg(s){ return String(s).replace(/-/g, MINUS); }
function pct(x, digits){
  if(x == null || !isFinite(x)) return "—";
  var d = digits == null ? 0 : digits, v = +(x * 100).toFixed(d);
  if(Object.is(v, -0) || v === 0) return "0%";                    // a rounded zero is zero: "−0%" reads as a direction the number does not have
  return (v > 0 ? "+" : MINUS) + Math.abs(v).toFixed(d) + "%";
}
function num(x, d){
  if(x == null || !isFinite(x)) return "—";
  d = d == null ? 2 : d;
  return neg(Math.abs(x).toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d})).replace(/^/, x < 0 ? MINUS : "");
}
function signed(x, d){ if(x == null || !isFinite(x)) return "—"; var s = num(Math.abs(x), d); return (x > 0 ? "+" : x < 0 ? MINUS : "") + s; }
function big(x){
  if(x == null || !isFinite(x)) return "—";
  var a = Math.abs(x), s = x < 0 ? MINUS : "";
  if(a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
  if(a >= 1e6) return s + (a / 1e6).toFixed(0) + "M";
  return s + a.toFixed(0);
}
function words(s){ return String(s == null ? "" : s).replace(/_/g, " "); }
function ts(d){ var p = d.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 1000; }
function iso(t){ return new Date(t * 1000).toISOString().slice(0, 10); }
function daysSince(d){ return d ? (Date.now() - Date.UTC(+d.slice(0,4), +d.slice(5,7) - 1, +d.slice(8,10))) / 864e5 : null; }
function cik(){ var m = /CIK=(\d+)/.exec(P.edgar_url || ""); return m ? m[1] : null; }

/* ── the states this card is in ─────────────────────────── */
var valued = !!((M && M.current_fair != null) || (I && I.current_fair != null));
var H = (M && M.current_fair != null) ? M : (I && I.current_fair != null) ? I : PRIMARY;   // the headline model
var gM = M ? M.current_gap : null, gI = I ? I.current_gap : null;
var apart = (gM != null && gI != null) ? Math.abs(gM - gI) : null;
var disagree = apart != null && apart > 0.30;                      // no headline figure when the models are more than 30% apart
var lowConf = !!(H && H.lc);
var heldDays = H ? daysSince(H.valuation_date) : null;
var held = heldDays != null && heldDays > 420;                      // held past its evidence: no new vintage for well over a year
var heldQuarters = held ? Math.floor(heldDays / 91.3) : 0;
var RR = D.refusal_reasons || [];
var UD = D.unread_debt || null;
var refusedTotal = RR.reduce(function(s, r){ return s + r.n; }, 0);
var LF = D.latest_fundamental || {};
var debtCarried = !!(LF.debt_source && (/carried/.test(LF.debt_source) || LF.debt_status === "carried" || LF.debt_status === "stale"));
var staleFlag = !!((M && M.stale) || (I && I.stale));

function refusedFor(model){ return RR.filter(function(r){ return r.model === model; }); }
function topReason(list){
  var by = {}; list.forEach(function(r){ by[r.reason] = (by[r.reason] || 0) + r.n; });
  var best = null; Object.keys(by).forEach(function(k){ if(!best || by[k] > by[best]) best = k; });
  return best;
}

/* ── page root ──────────────────────────────────────────── */
var sheet = document.getElementById("sheet");
sheet.className = "page sheet" + (valued ? "" : " refused");
var chart = null;            // the live uPlot instance
var chartFrame = null;

/* ── 1. masthead ────────────────────────────────────────── */
var nav = el("nav", "masthead");
nav.appendChild(el("div", "wordmark", "Datum"));
nav.appendChild(el("div", "who", D.t + " · " + ((PRIMARY && PRIMARY.name) || P.name || "")));
var tools = el("div", "tools controls");
var bDark = el("button", "btn", "dark"), bLight = el("button", "btn", "light"), bA4 = el("button", "btn", "A4"), bPrint = el("button", "btn", "print ⎙");
[bDark, bLight, bA4, bPrint].forEach(function(b){ b.type = "button"; tools.appendChild(b); });
bDark.onclick = function(){ applyTheme("dark", true); };
bLight.onclick = function(){ applyTheme("light", true); };
bA4.title = "See exactly what the printer will receive: one A4 page, legible in black and white";
bA4.setAttribute("aria-pressed", "false");
bA4.onclick = function(){
  var on = document.body.classList.toggle("a4");
  document.body.classList.toggle("previewing", on);
  bA4.setAttribute("aria-pressed", on ? "true" : "false");
  if(on) window.scrollTo({top: 0, behavior: "smooth"});
  readTokens();
  fitA4();
};
bPrint.title = "Print or save as PDF — one A4 page, black-and-white safe";
bPrint.onclick = function(){ window.print(); };
nav.appendChild(tools);
sheet.appendChild(nav);

function applyTheme(t, persist){
  root.setAttribute("data-theme", t);
  if(persist){ try{ localStorage.setItem("datum-theme", t); }catch(e){} }
  bDark.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
  bLight.setAttribute("aria-pressed", t === "light" ? "true" : "false");
  readTokens();
  if(chart){ chart.redraw(false); recolourLegend(); }          // a repaint, never a re-layout, and never the draw-on again
}
(function initTheme(){
  var stored = null;
  try{ stored = localStorage.getItem("datum-theme") || localStorage.getItem("dcf-theme"); }catch(e){}
  var t = stored === "light" || stored === "dark" ? stored
        : root.getAttribute("data-theme") === "light" ? "light"
        : (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
  applyTheme(t, false);
})();

/* ── 2. head ────────────────────────────────────────────── */
var head = el("header", "head");
var left = el("div");
var meta = el("div", "meta");
var metaBits = [];
if((P.exchanges || []).length) metaBits.push(P.exchanges.join(", ").toUpperCase());
metaBits.push(D.t);
if(cik()) metaBits.push("CIK " + cik());
if(P.sic_description || (PRIMARY && PRIMARY.sector)) metaBits.push(P.sic_description || PRIMARY.sector);
if(P.hq) metaBits.push(P.hq);
metaBits.forEach(function(s, ix){ if(ix) meta.appendChild(txt(" · ")); meta.appendChild(txt(s)); });
if(P.website){
  meta.appendChild(txt(" · "));
  var a = el("a", null, P.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")); a.href = P.website; a.target = "_blank"; a.rel = "noopener"; meta.appendChild(a);
}
if(P.edgar_url){
  meta.appendChild(txt(" · "));
  var e2 = el("a", null, "EDGAR"); e2.href = P.edgar_url; e2.target = "_blank"; e2.rel = "noopener"; meta.appendChild(e2);
}
left.appendChild(meta);
var nameRow = el("div", "name");
var h1 = el("h1", "display", (PRIMARY && PRIMARY.name) || P.name || D.t); h1.style.margin = "0";
nameRow.appendChild(h1);
var nVint = H && H.fair ? H.fair.length : 0;
var firstV = H && H.fair && H.fair.length ? H.fair[0][0] : null;
if(nVint) nameRow.appendChild(el("div", "caps", nVint + " vintage" + (nVint === 1 ? "" : "s") + " since " + firstV));
else if(RR.length) nameRow.appendChild(el("div", "caps", refusedTotal + " vintages refused"));
left.appendChild(nameRow);
head.appendChild(left);

var verdict = el("div", "verdict");
if(!valued){
  /* B · refusal: an outline and no body */
  var rh = el("div", "refusal-head");
  rh.appendChild(el("span", "hollow"));
  rh.appendChild(el("div", "display", "No valuation"));
  verdict.appendChild(rh);
} else if(disagree){
  /* F · models disagree: both shown, neither blended away */
  var split = el("div", "split");
  [[M, "m", "measured ▮", gM], [I, "i", "industry ▯", gI]].forEach(function(t){
    var d = el("div", t[1]);
    d.appendChild(el("div", "caps", t[2]));
    d.appendChild(el("div", "v" + (t[0] && t[0].lc ? " low" : ""), pct(t[3])));
    split.appendChild(d);
  });
  verdict.appendChild(split);
  verdict.appendChild(el("div", "note", Math.round(apart * 100) + " points apart at the " + H.valuation_date + " vintage. Both shown. Neither blended away."));
} else {
  /* A · valuation (C · low confidence changes the form of the figure, not its hue) */
  var box = el("div");
  box.appendChild(el("div", "caps", "gap · " + (H === M ? "measured ▮" : "industry ▯")));
  var g = H.current_gap;
  box.appendChild(el("div", "headline" + (lowConf ? " low" : ""), pct(g)));
  verdict.appendChild(box);
  if(lowConf) verdict.appendChild(el("span", "tag-caution", "low confidence"));
  var z = H.delta ? H.delta.z : null;
  var where = z == null ? "" : z < -0.5 ? "the price sits cheaper than usual for this name" : z > 0.5 ? "the price sits pricier than usual for this name" : "the price sits inside its usual range for this name";
  verdict.appendChild(el("div", "note",
    (g > 0 ? "Value above price" : g < 0 ? "Price above value" : "Value at price") + " by " + Math.abs(Math.round(g * 100)) + "% at the " + H.valuation_date + " vintage." +
    (z == null ? "" : " Against its own history " + where + " (z " + signed(z, 2) + ").")));
}
head.appendChild(verdict);
if(!valued){
  var why = el("div", "refusal-why");
  var parts = ["measured", "industry"].map(function(m){
    var list = refusedFor(m); if(!list.length) return null;
    var n = list.reduce(function(s, r){ return s + r.n; }, 0);
    var first = list.map(function(r){ return r.first; }).sort()[0], last = list.map(function(r){ return r.last; }).sort().slice(-1)[0];
    return m + ": " + words(topReason(list)) + " (" + n + " vintage" + (n === 1 ? "" : "s") + ", " + first + " to " + last + ")";
  }).filter(Boolean);
  why.textContent = "Refused at every vintage. " + (parts.length ? parts.join("; ") + ". " : "") +
    "This is a refusal, not a zero and not a low value: the filings do not give the model what it needs, and it does not substitute a number.";
  head.appendChild(why);
}
sheet.appendChild(head);

/* ── 3. stat strip ──────────────────────────────────────── */
function cell(label, value, cls, whisperLines){
  var c = el("div");
  c.appendChild(el("div", "caps", label));
  if(typeof value === "string"){ c.appendChild(el("div", "v num" + (cls ? " " + cls : ""), value)); }
  else c.appendChild(value);
  if(whisperLines && whisperLines.length){
    var w = el("div", "whisper");
    whisperLines.forEach(function(l, ix){
      if(ix) w.appendChild(document.createElement("br"));
      if(l && typeof l === "object"){ w.appendChild(el("span", l.cls, l.text)); } else w.appendChild(txt(l));
    });
    c.appendChild(w);
  }
  return c;
}
function refusedCell(label, model){
  var list = refusedFor(model), n = list.reduce(function(s, r){ return s + r.n; }, 0);
  var v = el("div", "v refusal"); v.appendChild(el("span", "hollow")); v.appendChild(txt("refused"));
  return cell(label, v, null, [n ? n + " vintage" + (n === 1 ? "" : "s") + " refused" : "no valuation", n ? words(topReason(list)) : "at every vintage"]);
}
function fitMark(f){
  var cls = f && f.cls;
  if(!cls || /n\/a/.test(cls)) return {form: "none", word: "n/a"};
  if(/gold/.test(cls)) return {form: "gold", word: "gold"};
  if(/level/.test(cls) && !/shape/.test(cls)) return {form: "silver", word: "level"};
  if(/shape/.test(cls)) return {form: "silver", word: "shape"};
  if(/weak/.test(cls)) return {form: "bronze", word: "weak"};
  return {form: "none", word: cls};
}
var strip = el("div", "strip");
if(valued){
  var bm = B.measured || {}, bi = B.industry || {};
  /* price */
  var px = (H.price || []), lastPx = px.length ? px[px.length - 1] : null;
  var cutoff = lastPx ? ts(lastPx[0]) - 365 * 86400 : 0;
  var yr = px.filter(function(p){ return ts(p[0]) >= cutoff; }).map(function(p){ return p[1]; });
  var lo = yr.length ? Math.min.apply(null, yr) : null, hi = yr.length ? Math.max.apply(null, yr) : null;
  strip.appendChild(cell("Price", num(H.current_price), null,
    ["USD · " + (H.current_price_date || "—") + " close", lo != null ? "52w " + num(lo) + "–" + num(hi) : "—"]));
  /* the two values */
  function valueCell(m, label, cls, note, model){
    if(!m || m.current_fair == null) return refusedCell(label, model);
    var n = (m.fair || []).length, r = (m.refusals || []).length;
    return cell(label, num(m.current_fair), cls, [note, n + " of " + (n + r) + " vintages"]);
  }
  strip.appendChild(valueCell(M, "Measured ▮", "measured", "own history only", "measured"));
  strip.appendChild(valueCell(I, "Industry ▯", "industry", "universe priors", "industry"));
  /* the two gaps, each with its base rate */
  function gapCell(m, label, br, extra, model){
    if(!m || m.current_gap == null) return refusedCell(label, model);
    var lines = [br.n_gaps ? "corpus median " + pct(br.median_gap) : "no corpus base rate"];
    lines.push(extra != null ? extra : (br.n_gaps ? "above price " + br.above_price + " of " + br.n_gaps : ""));
    return cell(label, pct(m.current_gap), m.lc ? "low" : null, lines);
  }
  strip.appendChild(gapCell(M, "Gap ▮", bm, null, "measured"));
  strip.appendChild(gapCell(I, "Gap ▯", bi, apart != null ? "models " + Math.round(apart * 100) + " points apart" : (bi.n_gaps ? "above price " + bi.above_price + " of " + bi.n_gaps : ""), "industry"));
  /* z against own norm */
  var dl = H.delta, bz = (B[H === M ? "measured" : "industry"] || {}).z;
  if(dl && dl.z != null){
    var pos = bz ? (dl.z <= bz.p05 ? "below the corpus 5th percentile" : dl.z <= bz.p10 ? "below the 10th percentile" : dl.z >= bz.p90 ? "above the 90th percentile" : "inside the usual middle") : "";
    strip.appendChild(cell("z · own norm", signed(dl.z, 2), null, [pos || dl.n + " vintages", bz ? "corpus p05 " + signed(bz.p05, 2) + " · p90 " + signed(bz.p90, 2) : dl.n + " vintages"]));
  } else strip.appendChild(cell("z · own norm", "—", "low", ["fewer than 12 vintages", "no norm of its own yet"]));
  /* fit */
  var fm = fitMark(H.fit);
  var fv = el("div", "v num"); fv.style.display = "flex"; fv.style.alignItems = "center"; fv.style.gap = "10px";
  fv.appendChild(el("span", "fit " + fm.form)); fv.appendChild(txt(fm.word));
  var fc = (B[H === M ? "measured" : "industry"] || {}).fit_classes || {};
  var fcTotal = Object.keys(fc).reduce(function(s, k){ return s + fc[k]; }, 0);
  strip.appendChild(cell("Fit", fv, null, [H.fit ? "corr " + num(H.fit.corr) + " · " + H.fit.n + " vintages" : "no fit measured",
    H.fit && fc[H.fit.cls] != null ? fc[H.fit.cls].toLocaleString("en-US") + " of " + fcTotal.toLocaleString("en-US") + " names in class" : ""]));
  /* vintage */
  var vd = H.valuation_date || "";
  strip.appendChild(cell("Vintage", vd ? vd.slice(5, 7) + "·" + vd.slice(8, 10) : "—", null,
    [vd.slice(0, 4) + " · " + nVint + (nVint === 1 ? "st" : nVint === 2 ? "nd" : nVint === 3 ? "rd" : "th") + " vintage",
     held ? {cls: "caution", text: "held · " + heldQuarters + " quarters, no new vintage"} : "first " + (firstV || "—")]));
} else {
  /* the refusal plate: the same strip, holding what is known */
  var firstR = RR.map(function(r){ return r.first; }).sort()[0], lastR = RR.map(function(r){ return r.last; }).sort().slice(-1)[0];
  var modelsR = ["measured", "industry"].filter(function(m){ return refusedFor(m).length; });
  strip.appendChild(cell("Refused vintages", String(refusedTotal), null, [modelsR.length === 2 ? "both models" : modelsR.join(", ") || "—", firstR ? firstR + " to " + lastR : ""]));
  var reason = topReason(RR);
  var rv = el("div", "v num"); rv.style.fontSize = "16px"; rv.style.lineHeight = "1.3"; rv.style.whiteSpace = "normal"; rv.style.color = T.refusal; rv.textContent = words(reason || "—");
  rv.style.color = "";
  rv.className = "v num";
  strip.appendChild(cell("Reason", rv, null, ["most frequent of " + Object.keys(RR.reduce(function(o, r){ o[r.reason] = 1; return o; }, {})).length + " reason code" + (RR.length === 1 ? "" : "s")]));
  var rows = (D.fundamentals && D.fundamentals.rows) || [];
  strip.appendChild(cell("Filings held", String(rows.length), null, [rows.length ? rows[0][0] + " to " + rows[rows.length - 1][0] : "no fundamental series"]));
  strip.appendChild(cell("Latest filing", LF.filing_date || "—", null, [LF.period_end ? "period " + LF.period_end : "no parsed filing"]));
}
sheet.appendChild(strip);

/* ── 4. the hero chart ──────────────────────────────────── */
/* series order: 0 x · 1 bandHi · 2 bandLo · 3 price · 4 measured · 5 industry */
function buildSeries(){
  var px = (PRIMARY && PRIMARY.price) || [];
  /* Both models refused this name, so no model entry carries its price - but
     the corpus does, and the overview row already draws it. Drawn alone: a
     price thread with no value line and no band, because there is no value. */
  var priceOnly = false;
  if(!px.length && D.price_only && D.price_only.length){ px = D.price_only; priceOnly = true; }
  if(!px.length) return null;
  var stamps = {};
  px.forEach(function(r){ stamps[r[0]] = 1; });
  var t0 = px[0][0];
  [M, I].forEach(function(m){
    if(!m) return;
    (m.fair || []).forEach(function(r){ stamps[r[0]] = 1; if(r[0] < t0) t0 = r[0]; });
  });
  [M, I].forEach(function(m){
    if(!m) return;
    (m.refusals || []).forEach(function(r){ if(r[0] >= t0) stamps[r[0]] = 1; });
  });
  var days = Object.keys(stamps).sort();
  var xs = days.map(ts);
  var pmap = {}; px.forEach(function(r){ pmap[r[0]] = r[1]; });
  var priceRow = days.map(function(d){ return pmap[d] != null ? pmap[d] : null; });
  function heldRow(m){
    /* value holds until the next filing; a refusal holds nothing until the next filing */
    if(!m) return {row: null, refused: null, reason: null, termini: []};
    var ev = (m.fair || []).map(function(r){ return [r[0], r[1], null]; })
      .concat((m.refusals || []).filter(function(r){ return r[0] >= t0; }).map(function(r){ return [r[0], null, r[1]]; }));
    ev.sort(function(a, b){ return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    if(!ev.length) return {row: null, refused: null, reason: null, termini: []};
    var row = [], refused = [], reason = [], j = 0, cur = null, isRef = false, why = null;
    for(var i = 0; i < days.length; i++){
      while(j < ev.length && ev[j][0] <= days[i]){ cur = ev[j][1]; isRef = ev[j][1] == null; why = ev[j][2]; j++; }
      row.push(cur); refused.push(isRef); reason.push(isRef ? why : null);
    }
    var termini = [];
    for(var k = 0; k < row.length; k++){
      if(row[k] != null && ((k > 0 && refused[k - 1]) || (k < row.length - 1 && refused[k + 1]))) termini.push(k);
    }
    return {row: row, refused: refused, reason: reason, termini: termini};
  }
  var mr = heldRow(M), ir = heldRow(I);
  var d0 = M && M.delta, up = null, dn = null;
  if(d0 && mr.row){
    up = mr.row.map(function(v){ return v == null ? null : v * Math.exp(d0.med + d0.std); });
    dn = mr.row.map(function(v){ return v == null ? null : v * Math.exp(d0.med - d0.std); });
  }
  var heldSpan = null;
  if(held && H === M && mr.row && H.valuation_date){
    heldSpan = {from: ts(H.valuation_date), to: xs[xs.length - 1], value: H.current_fair};
  } else if(held && H === I && ir.row && H.valuation_date){
    heldSpan = {from: ts(H.valuation_date), to: xs[xs.length - 1], value: H.current_fair, industry: true};
  }
  return {t: xs, days: days, price: priceRow, measured: mr.row, industry: ir.row, bandHi: up, bandLo: dn,
          priceOnly: priceOnly,
          refused: {4: mr.refused, 5: ir.refused}, reason: {4: mr.reason, 5: ir.reason}, termini: {4: mr.termini, 5: ir.termini}, held: heldSpan};
}

/* the chart factory — uPlot 1.6.32 options (handoff datum-chart.js, adapted to the card's arrays) */
var progress = {price: 1, measured: 1, industry: 1, band: 1};
var animDone = true;
function revealClip(u, p, key){
  /* the stroke is clipped to a growing rect; refusal gaps stay gaps while it grows (union of non-gap rects) */
  var pr = progress[key];
  if(pr == null || pr >= 1) return;
  var b = u.bbox, right = b.left + b.width * pr;
  var c = new Path2D(), x0 = b.left;
  (p.gaps || []).forEach(function(g){ var g0 = Math.min(g[0], right); if(g0 > x0) c.rect(x0, b.top, g0 - x0, b.height); x0 = Math.max(x0, g[1]); });
  if(right > x0) c.rect(x0, b.top, right - x0, b.height);
  p.clip = c;
}
function revealed(builder, key){
  return function(u, sidx, i0, i1){
    var p = builder(u, sidx, i0, i1);
    if(p) revealClip(u, p, key);
    return p;
  };
}
function ease(t){ return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function runSequence(u, frame){
  var seq = [["price", 380, 700], ["measured", 640, 650], ["industry", 800, 600], ["band", 1250, 400]];
  var invalidate = function(){ for(var i = 1; i < u.series.length; i++) u.series[i]._paths = null; };
  if(reduced){ seq.forEach(function(s){ progress[s[0]] = 1; }); animDone = true; invalidate(); u.redraw(false); setTimeout(function(){ frame.classList.remove("animating"); }, 140); return; }
  seq.forEach(function(s){ progress[s[0]] = 0; }); animDone = false;
  invalidate(); u.redraw(false);
  var t0 = performance.now();
  function tick(now){
    var t = now - t0, done = true;
    seq.forEach(function(s){ var p = Math.min(1, Math.max(0, (t - s[1]) / s[2])); progress[s[0]] = ease(p); if(p < 1) done = false; });
    invalidate(); u.redraw(false);
    if(!done) requestAnimationFrame(tick);
    else { animDone = true; invalidate(); u.redraw(false); frame.classList.remove("animating"); }
  }
  requestAnimationFrame(tick);
}
function wheelZoom(factor){
  factor = factor || 0.75;
  return {hooks: {ready: function(u){
    var over = u.over;
    over.addEventListener("wheel", function(e){
      e.preventDefault();
      var rect = over.getBoundingClientRect(), left = e.clientX - rect.left;
      var xVal = u.posToVal(left, "x"), xMin = u.scales.x.min, xMax = u.scales.x.max;
      var range = xMax - xMin, nr = e.deltaY < 0 ? range * factor : range / factor;
      var pctL = (xVal - xMin) / range, nMin = xVal - pctL * nr;
      var lo = u.data[0][0], hi = u.data[0][u.data[0].length - 1];
      nMin = Math.max(lo, nMin); var nMax = Math.min(hi, nMin + nr);
      if(nMax - nMin < 86400 * 120) return;
      u.setScale("x", {min: nMin, max: nMax});
    }, {passive: false});
    over.addEventListener("dblclick", function(){ u.setScale("x", {min: u.data[0][0], max: u.data[0][u.data[0].length - 1]}); });
  }}};
}
function nearestPrice(u, idx){
  var d = u.data[3]; if(idx == null) return null;
  if(d[idx] != null) return d[idx];
  for(var k = 1; k < d.length; k++){
    if(idx - k >= 0 && d[idx - k] != null) return d[idx - k];
    if(idx + k < d.length && d[idx + k] != null) return d[idx + k];
  }
  return null;
}
function gapWord(v, p){ return v == null || p == null || p <= 0 ? "" : pct(v / p - 1); }
function datumChart(elm, data, opt){
  opt = opt || {};
  var frame = elm.closest(".chart-frame") || elm;
  var animate = opt.animate !== false;
  if(animate) frame.classList.add("animating");
  var stepped = uPlot.paths.stepped({align: 1});            // value holds until the next filing
  var linear = uPlot.paths.linear();
  var pointsBuilder = uPlot.paths.points();
  var dashI = [7, 4];
  var glowOn = function(){ return T["glow-measured"] && T["glow-measured"] !== "none"; };
  function shadowFor(sidx){
    var ctx = elm._u ? elm._u.ctx : null; if(!ctx) return;
    if(glowOn() && (sidx === 4 || sidx === 5)){ ctx.shadowBlur = 6 * devicePixelRatio; ctx.shadowColor = sidx === 4 ? T.measured : T.industry; }
    else { ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; }
  }
  function termini(sidx){ return animDone ? (data.termini[sidx] || []) : []; }
  var y = 31536000;
  var opts = {
    width: opt.width || elm.clientWidth || 800, height: opt.height || 400,
    padding: [16, 0, 0, 0],
    tzDate: function(t){ return uPlot.tzDate(new Date(t * 1e3), "Etc/UTC"); },
    cursor: {
      x: true, y: false,
      points: {size: 7, width: 1.5, show: function(u, s){ return s >= 3; },
               fill: function(u, s){ return u.series[s].stroke(u, s); }, stroke: function(){ return T.raised; }},
      drag: {x: true, y: false, setScale: true, uni: 20},
      focus: {prox: 1e6},
    },
    select: {show: true},
    legend: {live: true, markers: {width: 2, dash: function(u, s){ return s === 5 ? dashI.join(" ") : ""; }}},
    scales: {x: {time: true}, y: {distr: opt.log ? 3 : 1, range: function(u, mn, mx){ return [Math.max(0.01, mn * 0.9), mx * 1.05]; }}},
    axes: [
      {stroke: function(){ return T.graphite; }, grid: {show: false}, ticks: {show: true, stroke: function(){ return T.graphite; }, width: 1, size: 6},
       font: '12px "JetBrains Mono"', incrs: [y, 2 * y, 5 * y, 10 * y, 20 * y],
       values: [[y, "{YYYY}", null, null, null, null, null, null, 1]]},
      {side: 1, stroke: function(){ return T.graphite; }, grid: {stroke: function(){ return T.rule; }, width: 1}, ticks: {show: false},
       font: '12px "JetBrains Mono"', size: 64, gap: 12,
       values: function(u, vals, ax, space, incr){
         return vals.map(function(v){
           var d = u.scales.y.distr === 3 ? (v >= 100 ? 0 : v >= 10 ? 1 : 2) : (incr >= 1 ? 0 : incr >= 0.1 ? 1 : 2);
           return v.toFixed(d);
         });
       }},
    ],
    bands: [{series: [1, 2], fill: function(){ return T["band-fill"]; }}],
    series: [
      {label: "", value: function(u, v){ return v == null ? "" : iso(v); }},
      {label: "usual range", stroke: function(){ return T["band-edge"]; }, width: 1, paths: revealed(stepped, "band"), points: {show: false}, spanGaps: false, value: function(u, v){ return v == null ? "" : v.toFixed(2); }},
      {label: "", stroke: function(){ return T["band-edge"]; }, width: 1, paths: revealed(stepped, "band"), points: {show: false}, spanGaps: false, value: function(u, v){ return v == null ? "" : v.toFixed(2); }},
      {label: "price", stroke: function(){ return T.ink; }, width: 1, paths: revealed(linear, "price"), points: {show: false}, spanGaps: true,
       value: function(u, v, s, i){ var p = nearestPrice(u, i); return p == null ? "—" : num(p); }},
      {label: "measured ▮", stroke: function(){ return T.measured; }, width: 2.2, paths: revealed(stepped, "measured"), spanGaps: false,
       points: {show: true, size: 9, width: 1.5, stroke: function(){ return T.refusal; }, fill: function(){ return T.ground; },
                filter: function(u, s){ return termini(s); }, paths: function(u, s, i0, i1, f){ u.ctx.shadowBlur = 0; return pointsBuilder(u, s, i0, i1, f); }},
       value: function(u, v, s, i){ return v == null ? (data.refused[4] && data.refused[4][i] ? "refused" : "—") : num(v) + "  " + gapWord(v, nearestPrice(u, i)); }},
      {label: "industry ▯", stroke: function(){ return T.industry; }, width: 1.8, dash: dashI, paths: revealed(stepped, "industry"), spanGaps: false,
       points: {show: true, size: 9, width: 1.5, stroke: function(){ return T.refusal; }, fill: function(){ return T.ground; },
                filter: function(u, s){ return termini(s); }, paths: function(u, s, i0, i1, f){ u.ctx.shadowBlur = 0; return pointsBuilder(u, s, i0, i1, f); }},
       value: function(u, v, s, i){ return v == null ? (data.refused[5] && data.refused[5][i] ? "refused" : "—") : num(v) + "  " + gapWord(v, nearestPrice(u, i)); }},
    ],
    plugins: [wheelZoom()],
    hooks: {
      ready: [function(u){ elm._u = u; if(animate) runSequence(u, frame); else { for(var i = 1; i < u.series.length; i++) u.series[i]._paths = null; u.redraw(false); } }],
      drawClear: [function(u){ u.ctx.shadowBlur = 0; u.ctx.shadowColor = "transparent"; }],
      drawSeries: [function(u, sidx){ elm._u = u; shadowFor(sidx + 1); if(sidx === u.series.length - 1){ u.ctx.shadowBlur = 0; drawMarks(u); } }],
      setCursor: [function(u){
        var chip = frame.querySelector(".u-date-chip");
        if(!chip){ chip = document.createElement("div"); chip.className = "u-date-chip"; u.over.appendChild(chip); }
        var i = u.cursor.idx;
        if(i == null){ chip.style.display = "none"; if(typeof u.setLegend === "function") u.setLegend({idx: u.data[0].length - 1}, false); return; }
        chip.style.display = "";
        chip.style.left = u.valToPos(u.data[0][i], "x") + "px";
        chip.style.top = (u.bbox.height / devicePixelRatio + 6) + "px";
        chip.textContent = iso(u.data[0][i]);
      }],
      setScale: [function(u, key){ if(key === "x") syncRange(u); }],
    },
  };
  function drawMarks(u){
    /* after the last series: dotted bridges across refusals, the held hatch, and the live end labels */
    var ctx = u.ctx, dpr = devicePixelRatio, b = u.bbox;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.left, b.top, b.width, b.height); ctx.clip();
    [4, 5].forEach(function(s){
      var row = u.data[s], ref = data.refused[s]; if(!row || !ref) return;
      var pr = progress[s === 4 ? "measured" : "industry"];
      if(pr < 1) return;
      var i = 0, n = row.length;
      while(i < n){
        if(!ref[i]){ i++; continue; }
        var a = i; while(i < n && ref[i]) i++;
        var bEnd = i - 1;
        var yv = a > 0 && row[a - 1] != null ? row[a - 1] : (bEnd + 1 < n && row[bEnd + 1] != null ? row[bEnd + 1] : null);
        if(yv == null) continue;
        var x0 = a > 0 ? u.valToPos(u.data[0][a - 1], "x", true) : b.left;
        var x1 = bEnd + 1 < n ? u.valToPos(u.data[0][bEnd + 1], "x", true) : b.left + b.width;
        var yy = u.valToPos(yv, "y", true);
        ctx.save(); ctx.setLineDash([2 * dpr, 5 * dpr]); ctx.lineWidth = 1 * dpr; ctx.strokeStyle = T.refusal;
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke(); ctx.restore();
        if(animDone && x1 - x0 > 90 * dpr){
          ctx.save(); ctx.fillStyle = T.refusal; ctx.font = (11 * dpr) + 'px "Archivo", system-ui, sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          var label = (s === 4 ? "measured" : "industry") + " refused · " + words(data.reason[s][a] || "");
          ctx.fillText(label, (x0 + x1) / 2, yy - 6 * dpr, x1 - x0 - 8 * dpr); ctx.restore();
        }
      }
    });
    if(data.held && animDone){
      var hs = data.held, hx0 = u.valToPos(hs.from, "x", true), hx1 = u.valToPos(hs.to, "x", true), hy = u.valToPos(hs.value, "y", true);
      if(hx1 > hx0){
        var pc = document.createElement("canvas"); pc.width = pc.height = 6 * dpr;
        var pctx = pc.getContext("2d"); pctx.strokeStyle = T.caution; pctx.lineWidth = 1.2 * dpr;
        pctx.beginPath(); pctx.moveTo(0, 6 * dpr); pctx.lineTo(6 * dpr, 0); pctx.moveTo(-1.5 * dpr, 1.5 * dpr); pctx.lineTo(1.5 * dpr, -1.5 * dpr); pctx.moveTo(4.5 * dpr, 7.5 * dpr); pctx.lineTo(7.5 * dpr, 4.5 * dpr); pctx.stroke();
        ctx.save(); ctx.fillStyle = ctx.createPattern(pc, "repeat"); ctx.fillRect(hx0, hy - 4 * dpr, hx1 - hx0, 8 * dpr); ctx.restore();
        ctx.save(); ctx.fillStyle = T.caution; ctx.font = (11 * dpr) + 'px "Archivo", system-ui, sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText("held · " + heldQuarters + " quarters, no qualifying filing", (hx0 + hx1) / 2, hy - 8 * dpr, Math.max(60 * dpr, hx1 - hx0 + 120 * dpr)); ctx.restore();
      }
    }
    ctx.restore();
    if(animDone){
      /* the last price, measured and industry values sit on the axis in their own hue */
      var lastI = u.data[0].length - 1, labels = [];
      [[3, T.ink, 700], [4, T.measured, 400], [5, T.industry, 400]].forEach(function(t){
        var v = t[0] === 3 ? nearestPrice(u, lastI) : (u.data[t[0]] ? u.data[t[0]][lastI] : null);
        if(v == null) return;
        var yp = u.valToPos(v, "y", true); if(yp < b.top - 2 || yp > b.top + b.height + 2) return;
        labels.push({y: yp, text: num(v), color: t[1], weight: t[2]});
      });
      labels.sort(function(p, q){ return p.y - q.y; });
      for(var k = 1; k < labels.length; k++) if(labels[k].y - labels[k - 1].y < 14 * dpr) labels[k].y = labels[k - 1].y + 14 * dpr;
      ctx.save(); ctx.font = (12 * dpr) + 'px "JetBrains Mono", ui-monospace, monospace'; ctx.textBaseline = "middle"; ctx.textAlign = "left";
      labels.forEach(function(l){
        var w = ctx.measureText(l.text).width, x = b.left + b.width + 8 * dpr;
        ctx.fillStyle = T.raised; ctx.fillRect(x - 3 * dpr, l.y - 8 * dpr, w + 6 * dpr, 16 * dpr);
        ctx.fillStyle = l.color; ctx.font = l.weight + " " + (12 * dpr) + 'px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(l.text, x, l.y);
      });
      ctx.restore();
    }
  }
  var u = new uPlot(opts, [data.t, data.bandHi || data.t.map(function(){ return null; }), data.bandLo || data.t.map(function(){ return null; }), data.price, data.measured || data.t.map(function(){ return null; }), data.industry || data.t.map(function(){ return null; })], elm);
  elm._u = u;
  return u;
}
window.datumChart = datumChart;

var SERIES = buildSeries();
var rangeButtons = {};
function syncRange(u){
  var lo = u.data[0][0], hi = u.data[0][u.data[0].length - 1], s = u.scales.x;
  var isAll = Math.abs(s.min - lo) < 86400 && Math.abs(s.max - hi) < 86400;
  var is5 = !isAll && Math.abs(s.max - hi) < 86400 && Math.abs((hi - s.min) - 5 * 365.25 * 86400) < 86400 * 3;
  if(rangeButtons.all) rangeButtons.all.setAttribute("aria-pressed", isAll ? "true" : "false");
  if(rangeButtons.y5) rangeButtons.y5.setAttribute("aria-pressed", is5 ? "true" : "false");
}
function recolourLegend(){
  if(!chartFrame) return;
  var marks = chartFrame.querySelectorAll(".u-legend .u-marker");
  var cols = [null, T["band-edge"], T["band-edge"], T.ink, T.measured, T.industry];
  marks.forEach(function(m, ix){ var c = cols[ix + 1]; if(c) m.style.borderColor = c; });
}
function mountChart(){
  var frame = el("div", "chart-frame");
  var toolsRow = el("div", "chart-tools controls");
  var body = el("div", "chart-body");
  frame.appendChild(toolsRow); frame.appendChild(body);
  /* the paper renderer is built once and shown only under body.a4 */
  var paper = buildPaper(); if(paper) frame.appendChild(paper);
  if(!SERIES){ toolsRow.appendChild(el("span", "band-key", "no price series carried for this name")); frame.classList.add("no-data"); return frame; }
  if(typeof uPlot === "undefined"){ if(paper){ paper.style.display = "block"; } return frame; }
  var host = el("div"); body.appendChild(host);
  var scaleEl = null;
  /* Retroactive split adjustment pushes serial reverse-splitters over a
     million-fold range, and a wall beside a flat line is not a shape anyone
     can read. Above 50x the value axis opens on log - the sparkline in the
     overview has always been log for this reason - and the button shows
     pressed, so the reader is never on an axis they were not told about. */
  var seen = [];
  /* price, measured, industry - the series the chart draws as data. NOT
     bandHi/bandLo: those are fair x exp(median +/- 1sd) and for a wide name
     (IRDM, sd 2.96) the envelope spans 373x more than anything on the card,
     which would both flip the axis and print a range the reader cannot see. */
  ["price", "measured", "industry"].forEach(function(k){
    (SERIES[k] || []).forEach(function(v){ if(v != null && v > 0) seen.push(v); });
  });
  var spread = seen.length > 1 ? Math.max.apply(null, seen) / Math.min.apply(null, seen) : 1;
  var logOn = spread > 50;
  function create(animate){
    if(chart){ chart.destroy(); chart = null; }
    host.textContent = "";
    var w = body.clientWidth || 800, hgt = w < 600 ? 260 : 400;
    chart = datumChart(host, SERIES, {width: w, height: hgt, log: logOn, animate: animate});
    var legend = host.querySelector(".u-legend");
    if(legend){
      var rows = legend.querySelectorAll("tr.u-series");
      if(rows.length > 2){ rows[1].classList.add("hidden"); rows[2].classList.add("hidden"); }   // the band edges are structure, not series a reader chose to see
      if(!SERIES.industry && rows[5]) rows[5].classList.add("hidden");
      if(!SERIES.measured && rows[4]) rows[4].classList.add("hidden");
      toolsRow.insertBefore(legend, toolsRow.firstChild);
      recolourLegend();
    }
    if(typeof chart.setLegend === "function") chart.setLegend({idx: SERIES.t.length - 1}, false);
    syncRange(chart);
    if(scaleEl) scaleEl.textContent = scaleSentence();
  }
  if(SERIES.bandHi){
    var bk = el("span", "band-key"); bk.appendChild(el("i", "swatch-band")); bk.appendChild(txt("usual range"));
    toolsRow.appendChild(bk);
  }
  var range = el("div", "range");
  var b5 = el("button", "btn", "5y"), bAll = el("button", "btn", "all"), bLog = el("button", "btn", "log");
  [b5, bAll, bLog].forEach(function(b){ b.type = "button"; b.setAttribute("aria-pressed", "false"); range.appendChild(b); });
  if(logOn) bLog.setAttribute("aria-pressed", "true");
  rangeButtons.y5 = b5; rangeButtons.all = bAll;
  b5.onclick = function(){ if(!chart) return; var hi = SERIES.t[SERIES.t.length - 1]; chart.setScale("x", {min: Math.max(SERIES.t[0], hi - 5 * 365.25 * 86400), max: hi}); };
  bAll.onclick = function(){ if(!chart) return; chart.setScale("x", {min: SERIES.t[0], max: SERIES.t[SERIES.t.length - 1]}); };
  bLog.onclick = function(){ logOn = !logOn; bLog.setAttribute("aria-pressed", logOn ? "true" : "false"); create(false); };
  toolsRow.appendChild(range);
  /* The sentence about the axis has to follow the axis: the log button
     re-created the chart but left this text behind, so one click made the page
     assert an axis it was not using. It is its own node, rewritten by create(). */
  function scaleSentence(){
    if(!logOn) return "";
    return " The value axis is log10: this name's own price and value span " +
      Math.round(spread).toLocaleString("en-US") +
      "-fold after split adjustment, so on a linear axis its low end would sit on the axis line.";
  }
  var scaleNote = "";
  var note = el("div", "chart-note", SERIES.priceOnly ?
    "Price only. Both models refused this name at every vintage, so there is no fair value to draw - not a zero and not a low value: " +
    "the filings do not give either model what it needs, and neither substitutes a number. The reasons are listed above. " +
    "The price is the corpus's own series for this name, sampled month-end exactly as the valued names' series are sampled." + scaleNote :
    "Fair value moves in steps: it is recomputed only when a new filing lands and is held flat until the next one. " +
    "A hollow circle and a dotted bridge mark vintages the model refused to value; nothing is interpolated across the hole. " +
    "The band is where the price usually sits around measured value for this name." + scaleNote +
    " Drag to zoom, wheel to zoom at the cursor, double-click to reset.");
  scaleEl = el("span", "chart-scale-note", scaleSentence());
  note.appendChild(scaleEl);
  frame.appendChild(note);
  chartFrame = frame;
  requestAnimationFrame(function(){ create(true); });
  if(window.ResizeObserver){
    var lastW = 0;
    new ResizeObserver(function(){
      if(!chart || document.body.classList.contains("a4")) return;
      var w = body.clientWidth; if(!w || w === lastW) return; lastW = w;
      chart.setSize({width: w, height: w < 600 ? 260 : 400});
    }).observe(body);
  }
  return frame;
}

/* the paper renderer: SVG, drawn not rasterised, every distinction by stroke, mark and word */
function buildPaper(){
  if(!SERIES) return null;
  var W = 1000, Hh = 216, L = 0, R = 64, Tp = 12, Bt = 26;
  var NS = "http://www.w3.org/2000/svg";
  function mk(n, at){ var e = document.createElementNS(NS, n); for(var k in at) e.setAttribute(k, at[k]); return e; }
  var box = el("div", "paper");
  var svg = mk("svg", {viewBox: "0 0 " + W + " " + Hh, role: "img"});
  var defs = mk("defs", {});
  var pat = mk("pattern", {id: "stip", width: "3", height: "3", patternUnits: "userSpaceOnUse"});
  pat.appendChild(mk("circle", {cx: "1", cy: "1", r: "0.55", fill: "var(--ink)"})); defs.appendChild(pat);
  var hatch = mk("pattern", {id: "hatchP", width: "5", height: "5", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"});
  hatch.appendChild(mk("line", {x1: "0", y1: "0", x2: "0", y2: "5", stroke: "var(--caution)", "stroke-width": "1"})); defs.appendChild(hatch);
  svg.appendChild(defs);
  var xs = SERIES.t, t0 = xs[0], t1 = xs[xs.length - 1];
  var vals = [];
  [SERIES.price, SERIES.measured, SERIES.industry, SERIES.bandHi, SERIES.bandLo].forEach(function(r){ if(r) r.forEach(function(v){ if(v != null && v > 0) vals.push(v); }); });
  if(!vals.length) return null;
  var vmin = Math.min.apply(null, vals) * 0.92, vmax = Math.max.apply(null, vals) * 1.05;
  function X(t){ return L + (t - t0) / ((t1 - t0) || 1) * (W - L - R); }
  function Y(v){ return Tp + (1 - (v - vmin) / (vmax - vmin)) * (Hh - Tp - Bt); }
  for(var gi = 1; gi <= 4; gi++){
    var v = vmin + (vmax - vmin) * gi / 4, yy = Y(v);
    svg.appendChild(mk("line", {x1: L, x2: W - R, y1: yy, y2: yy, stroke: "var(--rule)", "stroke-width": "0.8"}));
    var tx = mk("text", {x: W - R + 10, y: yy + 3, fill: "var(--graphite)", "font-family": "JetBrains Mono, monospace", "font-size": "11"});
    tx.textContent = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); svg.appendChild(tx);
  }
  var y0 = +iso(t0).slice(0, 4), y1 = +iso(t1).slice(0, 4), stepY = (y1 - y0) > 14 ? 2 : 1;
  for(var yy2 = y0 + 1; yy2 <= y1; yy2 += stepY){
    var xx = X(Date.UTC(yy2, 0, 1) / 1000); if(xx < L || xx > W - R) continue;
    var t = mk("text", {x: xx, y: Hh - 8, "text-anchor": "middle", fill: "var(--graphite)", "font-family": "JetBrains Mono, monospace", "font-size": "11"});
    t.textContent = yy2; svg.appendChild(t);
  }
  /* band: a stepped region with hard edges, stippled on paper */
  if(SERIES.bandHi){
    var up = "", dn = "", open = false, segs = [];
    for(var i = 0; i < xs.length; i++){
      var hiV = SERIES.bandHi[i], loV = SERIES.bandLo[i];
      if(hiV == null){ if(open){ segs.push([up, dn]); up = dn = ""; open = false; } continue; }
      var x = X(xs[i]), xn = i + 1 < xs.length ? X(xs[i + 1]) : W - R;
      up += (open ? "L" : "M") + x.toFixed(1) + "," + Y(hiV).toFixed(1) + "L" + xn.toFixed(1) + "," + Y(hiV).toFixed(1);
      dn = "L" + xn.toFixed(1) + "," + Y(loV).toFixed(1) + "L" + x.toFixed(1) + "," + Y(loV).toFixed(1) + dn;
      open = true;
    }
    if(open) segs.push([up, dn]);
    segs.forEach(function(s){ svg.appendChild(mk("path", {d: s[0] + s[1] + "Z", fill: "url(#stip)", stroke: "var(--band-edge)", "stroke-width": "0.8"})); });
  }
  /* datum line */
  svg.appendChild(mk("line", {x1: 0, x2: W, y1: Hh - Bt, y2: Hh - Bt, stroke: "var(--datumline)", "stroke-width": "1.5"}));
  /* price thread */
  var pd = "", first = true;
  for(var j = 0; j < xs.length; j++){ var pv = SERIES.price[j]; if(pv == null) continue; pd += (first ? "M" : "L") + X(xs[j]).toFixed(1) + "," + Y(pv).toFixed(1); first = false; }
  svg.appendChild(mk("path", {d: pd, fill: "none", stroke: "var(--graphite)", "stroke-width": "1.1"}));
  /* the two steps, gaps left open, hollow termini */
  function step(row, refused, color, dash, w){
    if(!row) return;
    var d = "", openS = false, holes = [];
    for(var i = 0; i < xs.length; i++){
      var v = row[i];
      if(v == null){ openS = false; continue; }
      var x = X(xs[i]), xn = i + 1 < xs.length ? X(xs[i + 1]) : W - R;
      d += (openS ? "L" : "M") + x.toFixed(1) + "," + Y(v).toFixed(1) + "L" + xn.toFixed(1) + "," + Y(v).toFixed(1);
      openS = true;
      if((i > 0 && refused[i - 1]) || (i + 1 < xs.length && refused[i + 1])) holes.push([(i > 0 && refused[i - 1]) ? x : xn, Y(v)]);
    }
    var at = {d: d, fill: "none", stroke: color, "stroke-width": w, "stroke-linejoin": "miter"};
    if(dash) at["stroke-dasharray"] = dash;
    svg.appendChild(mk("path", at));
    holes.forEach(function(h){ svg.appendChild(mk("circle", {cx: h[0], cy: h[1], r: 4, fill: "var(--ground)", stroke: "var(--refusal)", "stroke-width": "1.3"})); });
    /* dotted bridges */
    var i2 = 0;
    while(i2 < xs.length){
      if(!refused[i2]){ i2++; continue; }
      var a = i2; while(i2 < xs.length && refused[i2]) i2++;
      var yv = a > 0 && row[a - 1] != null ? row[a - 1] : (i2 < xs.length && row[i2] != null ? row[i2] : null);
      if(yv == null) continue;
      svg.appendChild(mk("line", {x1: a > 0 ? X(xs[a - 1]) : L, x2: i2 < xs.length ? X(xs[i2]) : W - R, y1: Y(yv), y2: Y(yv), stroke: "var(--refusal)", "stroke-width": "1", "stroke-dasharray": "2 5"}));
    }
  }
  step(SERIES.industry, SERIES.refused[5] || [], "var(--industry)", "6 3", 1.7);
  step(SERIES.measured, SERIES.refused[4] || [], "var(--measured)", null, 2.6);
  if(SERIES.held){
    var hx0 = X(SERIES.held.from), hx1 = X(SERIES.held.to), hy = Y(SERIES.held.value);
    if(hx1 > hx0){
      svg.appendChild(mk("rect", {x: hx0, y: hy - 5, width: hx1 - hx0, height: 10, fill: "url(#hatchP)"}));
      var ht = mk("text", {x: (hx0 + hx1) / 2, y: hy - 9, "text-anchor": "middle", fill: "var(--caution)", "font-family": "Archivo, sans-serif", "font-size": "11"});
      ht.textContent = "held · " + heldQuarters + " quarters, no qualifying filing"; svg.appendChild(ht);
    }
  }
  box.appendChild(svg);
  var key = el("div", "key");
  function keyItem(swatchStyle, label){ var s = el("span"); var i = el("i"); i.setAttribute("style", swatchStyle); s.appendChild(i); s.appendChild(txt(label)); key.appendChild(s); }
  /* A price-only card draws neither model and no refusal marks; a key that
     lists them promises series the sheet does not carry. */
  if(SERIES.measured) keyItem("width:14px;height:2px;background:var(--measured)", "measured ▮ solid");
  if(SERIES.industry) keyItem("width:14px;height:0;border-top:1.5px dashed var(--industry)", "industry ▯ dashed");
  keyItem("width:14px;height:1px;background:var(--graphite)", "price");
  if(SERIES.bandHi) keyItem("width:14px;height:7px;border-top:0.6px solid var(--band-edge);border-bottom:0.6px solid var(--band-edge);background-image:radial-gradient(var(--ink) 0.5px, transparent 0.6px);background-size:3px 3px", "usual range (median ± 1 sd of price/▮)");
  if(SERIES.measured || SERIES.industry) keyItem("width:7px;height:7px;border-radius:50%;border:1px solid var(--refusal)", "refused vintage");
  if(SERIES.held) keyItem("width:14px;height:7px;background:repeating-linear-gradient(45deg,var(--caution) 0 1px,transparent 1px 4px)", "held past its evidence");
  box.appendChild(key);
  return box;
}

sheet.appendChild(mountChart());

/* ── 5. own norm ────────────────────────────────────────── */
(function(){
  var d = (M && M.delta) || (I && I.delta);
  if(!d) return;
  var box = el("div", "norm");
  var hd = el("div", "normhead");
  hd.appendChild(el("div", "display", "Where the price sits against this name's own norm"));
  var brm = B.measured || {};
  hd.appendChild(el("span", "caps only-screen", "median ln(price/value) " + signed(d.med, 2) + " ± " + num(d.std, 2) + " · " + d.n + " vintages"));
  box.appendChild(hd);
  var lo = d.med - 2 * d.std, hi = d.med + 2 * d.std, span = (hi - lo) || 1;
  function x(v){ return Math.max(0, Math.min(100, (v - lo) / span * 100)); }
  var sc = el("div", "scale");
  sc.appendChild(el("div", "track"));
  var usual = el("div", "usual"); usual.style.left = x(d.med - d.std) + "%"; usual.style.width = (x(d.med + d.std) - x(d.med - d.std)) + "%"; sc.appendChild(usual);
  var med = el("div", "med"); med.style.left = x(d.med) + "%"; sc.appendChild(med);
  [[M, "m", "▮ measured"], [I, "i", "▯ industry"]].forEach(function(t){
    var mm = t[0]; if(!mm || !mm.delta || mm.delta.now == null) return;
    var mk = el("div", "mark " + t[1]); mk.style.left = x(mm.delta.now) + "%";
    mk.title = t[2] + ": now " + signed(mm.delta.now, 2) + ", norm " + signed(mm.delta.med, 2); sc.appendChild(mk);
    var cap = el("div", "cap", t[2] + " z " + signed(mm.delta.z, 2));
    cap.style.left = "calc(" + x(mm.delta.now) + "% - 24px)"; sc.appendChild(cap);
  });
  var l = el("div", "ends", "cheaper than usual"); l.style.left = "0"; sc.appendChild(l);
  var r = el("div", "ends", "pricier than usual"); r.style.right = "0"; sc.appendChild(r);
  box.appendChild(sc);
  var note = el("div", "note");
  var z = M && M.delta ? M.delta.z : null, where = "";
  if(z != null && brm.z){
    where = z <= brm.z.p05 ? "below the 5th percentile of the corpus" : z <= brm.z.p10 ? "below the 10th percentile" : z >= brm.z.p90 ? "above the 90th percentile" : "inside the usual middle";
    where = " Today's z sits " + where + " (corpus p05 " + signed(brm.z.p05, 2) + ", median " + signed(brm.z.med, 2) + ", p90 " + signed(brm.z.p90, 2) + ").";
  }
  note.appendChild(txt("The band is this name's usual range: median ln(price/value) " + signed(d.med, 2) + " ± " + num(d.std, 2) + " across " + d.n + " vintages." + where + " Descriptive, not a signal."));
  var dis = el("span", "only-screen");
  dis.textContent = " These two readings are not the same question and they disagree often: for " + (brm.sign_flip != null ? brm.sign_flip : "—") + " of " + (brm.n_norm != null ? brm.n_norm : "—") + " names the sign of the gap and the sign of this deviation point opposite ways.";
  note.appendChild(dis);
  ["measured", "industry"].forEach(function(k){
    var br = B[k]; if(!br || !br.n_gaps) return;
    var s = el("span", "only-screen");
    s.textContent = " Across the corpus the median " + k + " gap is " + pct(br.median_gap) + " and the value stands above the price for " + br.above_price + " of " + br.n_gaps + " names — a positive gap is the minority case, and mostly a property of the model.";
    note.appendChild(s);
  });
  box.appendChild(note);
  sheet.appendChild(box);
})();

/* ── 6. evidence: the drivers, with the fade and the constants made explicit ── */
function section(title, lede){
  var s = el("div", "sec");
  s.appendChild(el("div", "display", title));
  if(lede) s.appendChild(el("div", "lede", lede));
  return s;
}
function table(headers){
  var t = el("table", "ev"), th = el("thead"), tr = el("tr");
  headers.forEach(function(h){ tr.appendChild(el("th", h[1] || null, h[0])); });
  th.appendChild(tr); t.appendChild(th);
  var tb = el("tbody"); t.appendChild(tb);
  return {table: t, body: tb};
}
(function(){
  var dr = (M && M.drivers) || null, di = (I && I.drivers) || null;
  if(!dr && !di) return;
  sheet.appendChild(section("What the valuation is made of",
    "The model does not pay for a perpetual moat: it fades growth and pulls returns back to a norm. This is how hard it does that. A constant is labelled as a constant."));
  var g2 = el("div", "two");
  function fade(a, b, fmt){
    var s = el("span", "fade");
    s.appendChild(el("s", null, fmt(a))); s.appendChild(el("span", "arrow", "→")); s.appendChild(el("span", null, fmt(b)));
    return s;
  }
  function p1(v){ return pct(v, 1); }
  function driverCell(d, key){
    if(!d) return el("span", "fade const", "refused");
    switch(key){
      case "growth": return fade(d.growth_start, d.growth_terminal, p1);
      case "margin": return fade(d.margin_current, d.margin_normalized != null ? d.margin_normalized : d.margin_target, p1);
      case "roic":
        if(d.roic_current != null) return fade(d.roic_current, d.roic_terminal, p1);
        var c = el("span", "fade const"); c.appendChild(el("b", null, "terminal " + p1(d.roic_terminal)));
        var eq = d.wacc_terminal != null && Math.abs(d.roic_terminal - d.wacc_terminal) < 1e-9;
        c.appendChild(el("span", "only-screen", eq ? " — set equal to the terminal discount rate, not observed" : " — terminal only, not observed"));
        c.appendChild(el("span", "only-a4-inline", eq ? " · = discount rate, constant" : " · terminal only"));
        return c;
      case "wacc":
        var w = el("span", "fade const"); w.appendChild(el("b", null, pct(d.wacc_stage1, 2)));
        w.appendChild(txt(" · beta " + (d.beta != null ? d.beta.toFixed(2) : "—")));
        if(d.beta === 1){ w.appendChild(el("span", "only-screen", " — fixed for every name, not observed")); w.appendChild(el("span", "only-a4-inline", " · constant")); }
        return w;
      case "tv": return el("span", "fade", d.terminal_value_share != null ? Math.round(d.terminal_value_share * 100) + "% of enterprise value" : "—");
      case "nd": return el("span", "fade", d.net_debt_to_market_cap != null ? pct(d.net_debt_to_market_cap, 0) + (d.net_debt_to_market_cap < 0 ? " (net cash)" : "") : "—");
      case "policy": var pp = el("span", "fade const"); pp.appendChild(txt(words(d.terminal_policy || "—"))); return pp;
      case "gsrc": var gs = el("span", "fade const"); gs.appendChild(txt(words(d.growth_source || "—"))); return gs;
    }
  }
  var rows = [["Revenue growth", ", now → terminal", "growth"], ["Growth source", "", "gsrc"], ["Operating margin", ", now → normalised", "margin"],
              ["Return on capital", ", now → terminal", "roic"], ["Discount rate · beta", "", "wacc"], ["Terminal share of value", "", "tv"],
              ["Net debt to market cap", "", "nd"], ["Terminal policy", "", "policy"]];
  var headers = [["Driver"]];
  if(dr) headers.push(["Measured ▮", "n"]);
  if(di) headers.push(["Industry ▯", "n"]);
  var tb = table(headers);
  rows.forEach(function(r){
    var tr = el("tr"); var k = el("td", "k"); k.appendChild(txt(r[0])); if(r[1]) k.appendChild(el("span", "only-screen", r[1])); tr.appendChild(k);
    if(dr){ var td = el("td", "n"); td.appendChild(driverCell(dr, r[2])); tr.appendChild(td); }
    if(di){ var td2 = el("td", "n"); td2.appendChild(driverCell(di, r[2])); tr.appendChild(td2); }
    tb.body.appendChild(tr);
  });
  g2.appendChild(tb.table);

  /* the business itself: two windows, never one */
  var right = el("div");
  var f = D.fundamentals || {}, cols = f.columns || [], rws = f.rows || [];
  if(rws.length){
    var ix = {}; cols.forEach(function(c, i){ ix[c] = i; });
    var firstR = rws[0], last = rws[rws.length - 1];
    function cagr(a, b, yrs){ if(!a || !b || a <= 0 || b <= 0 || !yrs) return null; return Math.pow(b / a, 1 / yrs) - 1; }
    function at(back){ return rws[Math.max(0, rws.length - 1 - back)]; }
    var w5 = at(20), w2 = at(8);
    function span(a){ return (ts(last[ix.filing_date]) - ts(a[ix.filing_date])) / (365.25 * 86400); }
    var yrs = (ts(last[ix.filing_date]) - ts(firstR[ix.filing_date])) / (365.25 * 86400);
    var t2 = table([["The business · " + yrs.toFixed(0) + " years of filings"], ["latest · USD · growth a year", "n"]]);
    [["Revenue TTM", "revenue_ttm", big], ["EBIT TTM", "ebit_ttm", big], ["Market cap", "market_cap", big],
     ["Shares outstanding", "shares_current_split_basis", function(v){ return v == null ? "—" : (v / 1e6).toFixed(1) + "M"; }]
    ].forEach(function(r){
      var b = last[ix[r[1]]];
      var c5 = cagr(w5[ix[r[1]]], b, span(w5)), c2 = cagr(w2[ix[r[1]]], b, span(w2));
      var tr = el("tr"); tr.appendChild(el("td", "k", r[0]));
      var td = el("td", "n"); var s = el("span", "fade"); s.style.display = "inline-block";
      s.appendChild(el("span", null, r[2](b)));
      if(c5 != null || c2 != null){
        var flip = c5 != null && c2 != null && (c5 > 0) !== (c2 > 0);
        var w = el("span", "windows");
        w.appendChild(el("span", flip ? "flip" : null, "5y " + (c5 == null ? "—" : pct(c5, 1))));
        w.appendChild(txt(" · "));
        w.appendChild(el("span", flip ? "flip" : null, "2y " + (c2 == null ? "—" : pct(c2, 1))));
        if(flip){ w.appendChild(txt(" · ")); w.appendChild(el("span", "flip-word", "sign reverses")); }
        s.appendChild(w);
      }
      td.appendChild(s); tr.appendChild(td); t2.body.appendChild(tr);
    });
    right.appendChild(t2.table);
  }
  /* the latest filing: the bridge items with their status — a stale field is hatched and named */
  if(LF.filing_date){
    var t3 = table([["Latest filing · " + LF.filing_date + " · period " + (LF.period_end || "—")], ["USD", "n"], ["source"], ["as of"]]);
    t3.table.style.marginTop = "14px";
    function frow(label, value, source, status, asof, screenOnly){
      var tr = el("tr"); var stale = status === "carried" || status === "stale";
      if(stale) tr.className = "stale";
      if(screenOnly) tr.classList.add("only-screen");
      var k = el("td", "k"); var wd = el("span", "word" + (status === "carried" ? " carried" : "")); wd.textContent = label; k.appendChild(wd); tr.appendChild(k);
      tr.appendChild(el("td", "n", value));
      tr.appendChild(el("td", "src", source || "—"));
      tr.appendChild(el("td", "when", asof || LF.filing_date || "—"));
      t3.body.appendChild(tr);
    }
    frow("Revenue TTM", big(LF.revenue_ttm), "edgar", "observed", LF.period_end, true);
    frow("EBIT TTM", big(LF.ebit_ttm), "edgar", "observed", LF.period_end, true);
    frow("Debt", big(LF.debt) + (UD ? " †" : ""), LF.debt_source ? words(LF.debt_source) : "—", LF.debt_status, LF.debt_asof);
    frow("Cash and securities", big(LF.cash_sec), "edgar", LF.cash_status, LF.period_end);
    frow("Lease liabilities", big(LF.lease_liab), "edgar", "observed", LF.period_end);
    frow("Equity, book", big(LF.equity), "edgar", "observed", LF.period_end);
    frow("Shares", LF.shares != null ? (LF.shares / 1e6).toFixed(1) + "M" : "—", "edgar", "observed", LF.period_end);
    right.appendChild(t3.table);
    if(UD){
      /* The value above this table is computed from a balance sheet the parser
         read incompletely. The mark goes on the row that is wrong, and the
         sentence under the table says by how much and against what. */
      var ud = el("p", "unread-debt-note");
      ud.appendChild(txt("† " + (UD.tag || "a debt tag") + " was never read into this store" +
        (UD.unread != null ? " (" + big(UD.unread) + " unread)" : "") +
        (UD.stale_days != null ? ", and the debt observation is " + UD.stale_days + " days old" : "") +
        (UD.overstated_pct != null ? ". Equity at fair is overstated by " +
          Math.round(UD.overstated_pct) + "%" +
          (UD.last_vintage ? " at the " + UD.last_vintage + " vintage" : "") + "." : ".")));
      right.appendChild(ud);
    }
  }
  g2.appendChild(right);
  sheet.appendChild(g2);
})();

/* ── 7. what this card does not know ────────────────────── */
(function(){
  sheet.appendChild(section("What this card does not know", "Limitations and refusals are shown here on purpose, not buried in a footer."));
  var fl = el("div", "tags");
  function tag(cls, text, hollowMark){ var t = el("span", cls); if(hollowMark) t.appendChild(el("span", "hollow")); t.appendChild(txt(text)); fl.appendChild(t); }
  if(!valued){
    tag("tag refusal", "no valuation on this name — refused at every vintage", true);
  } else {
    if(lowConf) tag("tag-caution", "latest valuation is low confidence"); else tag("tag", "confidence normal");
    if(staleFlag) tag("tag-caution", "valuation rests on a stale field"); else tag("tag", "fields are fresh");
    if(disagree) tag("tag", "models " + Math.round(apart * 100) + " points apart · no headline figure");
    if(held) tag("tag-caution", "held · " + heldQuarters + " quarters without a new vintage");
  }
  if(LF.debt_source) tag(debtCarried ? "tag-caution" : "tag", "debt: " + words(LF.debt_source) + (LF.debt_asof ? " · as of " + LF.debt_asof : ""));
  if(refusedTotal) tag("tag refusal", refusedTotal + " refused vintage" + (refusedTotal === 1 ? "" : "s") + " on this name", true); else tag("tag", "no refusals");
  sheet.appendChild(fl);
  if(RR.length){
    var t = table([["Model"], ["Refusal reason"], ["Vintages", "n"], ["Period", "n"]]);
    t.table.classList.add("only-screen");
    RR.forEach(function(r){
      var tr = el("tr");
      tr.appendChild(el("td", "k", r.model + (r.model === "measured" ? " ▮" : " ▯")));
      tr.appendChild(el("td", null, words(r.reason)));
      tr.appendChild(el("td", "n", String(r.n)));
      tr.appendChild(el("td", "n when", r.first + " — " + r.last));
      t.body.appendChild(tr);
    });
    sheet.appendChild(t.table);
    var byModel = {}, reasons = {};
    RR.forEach(function(r){ byModel[r.model] = (byModel[r.model] || 0) + r.n; reasons[r.reason] = (reasons[r.reason] || 0) + r.n; });
    var sum = el("p", "whisper only-a4");
    sum.textContent = "Refused: " + Object.keys(byModel).map(function(k){ return byModel[k] + " " + k; }).join(", ") + ". Reasons: " +
      Object.keys(reasons).map(function(k){ return words(k) + " (" + reasons[k] + ")"; }).join("; ") +
      ". Period " + RR.map(function(r){ return r.first; }).sort()[0] + " — " + RR.map(function(r){ return r.last; }).sort().slice(-1)[0] + ".";
    sheet.appendChild(sum);
  }
  var lim = (H && H.limitations) || [];
  if(lim.length){
    var ul = el("ul", "lim");
    lim.forEach(function(x, ix){ var li = el("li", ix >= 4 ? "only-screen" : null, words(x)); ul.appendChild(li); });
    if(lim.length > 4){ var more = el("li", "only-a4", (lim.length - 4) + " further limitation" + ((lim.length - 4) === 1 ? "" : "s") + " are listed on the screen card"); ul.appendChild(more); }
    sheet.appendChild(ul);
  }
})();

/* ── 8. provenance ──────────────────────────────────────── */
(function(){
  var f = el("div", "foot");
  f.appendChild(txt("Every number on this page stands on a stored row. Latest filing: period " + (LF.period_end || "—") + ", filed " + (LF.filing_date || "—") + ". " +
    "Price is as-traded, the last close strictly before the filing date. Profile: " + (P.source || "—") + (P.enrichment_source ? " + " + P.enrichment_source : "") + ". " +
    "The gap is the model's position against the market — not a price target and not advice. "));
  if(P.edgar_url){ var a = el("a", null, "Filings at EDGAR ↗"); a.href = P.edgar_url; a.target = "_blank"; a.rel = "noopener"; f.appendChild(a); }
  sheet.appendChild(f);
})();

/* ── print: preview and paper are one class ─────────────── */
function fitA4(){
  /* The sheet is one page by layout; this is the backstop. Under body.a4 the page is laid out at paper
     width, so its height is the printed height. If it would spill, the whole sheet is scaled down
     (never below 0.6) and the scale is recorded on <body data-a4-scale> so nobody has to guess. */
  sheet.style.zoom = ""; sheet.style.width = ""; delete document.body.dataset.a4Scale;
  if(!document.body.classList.contains("a4")) return;
  var preview = document.body.classList.contains("previewing");
  var h = sheet.getBoundingClientRect().height / 96 * 25.4 - (preview ? 28 : 0);   // the preview frame carries the margins
  var scale = h > 269 ? Math.max(0.6, 269 / h) : 1;
  if(scale < 1){ sheet.style.zoom = String(scale); if(!preview) sheet.style.width = (186 / scale) + "mm"; }
  document.body.dataset.a4Scale = scale.toFixed(3);
}
window.addEventListener("beforeprint", function(){ document.body.classList.add("a4"); readTokens(); fitA4(); });
window.addEventListener("afterprint", function(){
  if(bA4.getAttribute("aria-pressed") !== "true"){ document.body.classList.remove("a4"); document.body.classList.remove("previewing"); readTokens(); }
  fitA4();
});
document.addEventListener("keydown", function(e){
  if(e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if(e.key === "t"){ applyTheme(root.getAttribute("data-theme") === "light" ? "dark" : "light", true); }
  if(e.key === "Escape" && document.body.classList.contains("a4")) bA4.click();
});
})();
