import {
  eur, eur0, intf, pct, MONATE, MK, FIELDS, NUMF, isNum, r2, pad, todayISO, ym, daysIn, shiftM, mLabel, wday, deDate,
  validDate, money, fmtIn, parseDe, sum, monthReports, goalFor, complete, checks, toCsv
} from "./domain.js";
import { createStore } from "./store.js";
import { scan, recognize, warmUp } from "./scanner.js";
import { parseZBon, mergeParts } from "./parser.js";

const $ = s => document.querySelector(s);
const S = { reports: new Map(), cfg: { ziele: {}, standardZiel: null }, month: ym(todayISO()), moved: false, loaded: false, store: null, unsub: null };

/* ---------- kleine Helfer ---------- */
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
function setSync(state, text) { const s = $("#sync"); s.className = "sync " + (state || ""); s.lastElementChild.textContent = text; }
function banner(text) { const b = $("#banner"); if (!text) { b.hidden = true; return; } b.className = "banner"; b.textContent = text; b.hidden = false; }
const errBox = () => el("div", { class: "status err", hidden: true });
const showErr = (box, msg) => { box.textContent = msg; box.hidden = false; };

/* ---------- Monatsansicht ---------- */
function render() {
  const m = S.month, list = monthReports(S.reports, m), tm = ym(todayISO());
  $("#mTitle").textContent = mLabel(m);
  $("#nextM").disabled = m >= tm;

  const tot = sum(list, "umsatz"), bar = sum(list, "bar"), kr = sum(list, "kredit");
  const split = list.filter(r => isNum(r.bar) && isNum(r.kredit) && isNum(r.umsatz));
  const unk = r2(tot - sum(split, "umsatz"));
  $("#tot").textContent = eur.format(tot);
  $("#totSub").textContent = list.length ? (list.length === 1 ? "1 Tagesabschluss" : list.length + " Tagesabschlüsse") : "noch keine Daten";

  // Ziel
  const g = goalFor(S.cfg, m), gb = $("#goalBox"); gb.replaceChildren();
  if (g) {
    const share = tot / g, dim = daysIn(m);
    const paceShare = (m < tm ? dim : (m === tm ? new Date().getDate() : 0)) / dim;
    const fill = el("div", { class: "fill" }); fill.style.width = Math.min(100, share * 100) + "%";
    const track = el("div", { class: "track", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(g), "aria-valuenow": String(tot), "aria-label": "Fortschritt zum Monatsziel" }, fill);
    if (m === tm) { const p = el("div", { class: "pace", title: "Soll-Stand heute" }); p.style.left = "calc(" + (paceShare * 100) + "% - 1px)"; track.append(p); }
    const rest = r2(g - tot);
    let right;
    if (rest <= 0) right = el("span", { class: "good" }, "Ziel erreicht · +" + eur0.format(-rest));
    else if (m === tm) right = el("span", { class: "muted" }, (tot >= g * paceShare ? "vor Plan · " : "hinter Plan · ") + "noch " + eur0.format(rest));
    else right = el("span", { class: "muted" }, "noch " + eur0.format(rest));
    gb.append(el("div", { class: "goalrow" },
      el("span", {}, el("b", {}, pct.format(share)), " von ", el("button", { class: "linkbtn", onclick: openGoal, "aria-label": "Monatsziel ändern" }, eur0.format(g))), right), track);
  } else {
    gb.append(el("div", { class: "goalrow" }, el("span", { class: "muted" }, "Kein Monatsziel gesetzt"), el("button", { class: "linkbtn", onclick: openGoal }, "Ziel festlegen")));
  }

  // Bar / Kredit
  const sb = $("#splitbar"); sb.replaceChildren();
  if (tot > 0) {
    const mk = (v, c) => { const s = el("span"); s.style.width = (v / tot * 100) + "%"; s.style.background = c; return s; };
    sb.append(mk(bar, "var(--cash)"), mk(kr, "var(--card)"));
    if (unk > 0.009) sb.append(mk(unk, "var(--unk)"));
  }
  const nBar = list.reduce((a, r) => a + (isNum(r.barAnzahl) ? r.barAnzahl : 0), 0);
  const nKr = list.reduce((a, r) => a + (isNum(r.kreditAnzahl) ? r.kreditAnzahl : 0), 0);
  const known = bar + kr;
  $("#barV").textContent = eur.format(bar); $("#krV").textContent = eur.format(kr);
  $("#barS").textContent = known > 0 ? pct.format(bar / known) + (nBar ? " · " + intf.format(nBar) + " Zahlungen" : "") : "–";
  $("#krS").textContent = known > 0 ? pct.format(kr / known) + (nKr ? " · " + intf.format(nKr) + " Zahlungen" : "") : "–";
  const u = $("#unk");
  if (unk > 0.009) { u.hidden = false; u.textContent = eur.format(unk) + " noch nicht in Bar/Kredit aufgeteilt (Bon unvollständig)."; } else u.hidden = true;

  // Kennzahlen
  const kunden = list.filter(r => isNum(r.kunden)), kSum = sum(kunden, "kunden");
  $("#sTage").textContent = String(list.length);
  $("#sAvg").textContent = list.length ? eur0.format(tot / list.length) : "–";
  $("#sKunden").textContent = kunden.length ? intf.format(kSum) : "–";
  $("#sBon").textContent = kSum > 0 ? eur.format(sum(kunden, "umsatz") / kSum) : "–";
  $("#sNetto").textContent = list.length ? eur0.format(sum(list, "netto")) : "–";
  $("#sMwst").textContent = list.length ? eur0.format(sum(list, "mwst")) : "–";
  const st = sum(list, "storno"); $("#sStorno").textContent = list.length ? (st > 0 ? eur0.format(st) : "0 €") : "–";
  let best = null; for (const r of list) if (isNum(r.umsatz) && (!best || r.umsatz > best.umsatz)) best = r;
  $("#sBest").textContent = best ? (Number(best.datum.slice(8)) + ". · " + eur0.format(best.umsatz)) : "–";

  renderChart(m, list); renderList(list); renderYear(m);
}

function niceMax(v) { if (v <= 0) return 100; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p; return 10 * p; }
function renderChart(m, list) {
  const svg = $("#chart"), NS = "http://www.w3.org/2000/svg"; svg.replaceChildren();
  const W = 340, H = 170, L = 40, R = 6, T = 8, B = 20, dim = daysIn(m);
  const byDay = new Map(list.map(r => [Number(r.datum.slice(8)), r]));
  const mx = niceMax(Math.max(0, ...list.map(r => isNum(r.umsatz) ? r.umsatz : 0)));
  const y = v => T + (H - T - B) * (1 - v / mx), bw = (W - L - R) / dim;
  const add = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
  for (const f of [0, .5, 1]) {
    const v = mx * f, yy = y(v);
    add("line", { x1: L, x2: W - R, y1: yy, y2: yy, stroke: "var(--line)", "stroke-width": f === 0 ? 1 : .6, "stroke-dasharray": f === 0 ? "" : "2 3" });
    add("text", { x: L - 5, y: yy + 3, "text-anchor": "end" }).textContent = eur0.format(v);
  }
  const td = ym(todayISO()) === m ? new Date().getDate() : 0;
  for (let d = 1; d <= dim; d++) {
    const x = L + (d - 1) * bw + bw * .15, w = Math.max(1, bw * .7);
    if (d === 1 || d % 5 === 0) add("text", { x: L + (d - .5) * bw, y: H - 6, "text-anchor": "middle" }).textContent = String(d);
    if (d === td) add("line", { x1: L + (d - .5) * bw, x2: L + (d - .5) * bw, y1: T, y2: H - B, stroke: "var(--accent)", "stroke-width": .8, "stroke-dasharray": "2 2" });
    const r = byDay.get(d); if (!r || !isNum(r.umsatz)) continue;
    const t = document.createElementNS(NS, "title"); t.textContent = d + ". " + mLabel(m) + ": " + eur.format(r.umsatz);
    if (isNum(r.bar) && isNum(r.kredit)) {
      const yb = y(r.bar), yk = y(r.bar + r.kredit);
      add("rect", { x, y: yb, width: w, height: Math.max(0, H - B - yb), fill: "var(--cash)", rx: 1 });
      add("rect", { x, y: yk, width: w, height: Math.max(0, yb - yk), fill: "var(--card)", rx: 1 }).append(t);
    } else {
      const yy = y(r.umsatz); add("rect", { x, y: yy, width: w, height: Math.max(0, H - B - yy), fill: "var(--unk)", rx: 1 }).append(t);
    }
  }
  $("#chartNote").textContent = list.length ? "Ø " + eur0.format(sum(list, "umsatz") / list.length) + " pro Öffnungstag" : "";
}

function renderList(list) {
  const box = $("#list"); box.replaceChildren();
  if (!list.length) {
    box.append(el("div", { class: "empty" },
      el("b", {}, S.loaded ? "Keine Tagesabschlüsse im " + MONATE[Number(S.month.slice(5)) - 1] : "Lade Tagesabschlüsse…"),
      el("span", {}, S.loaded ? "Tippe auf „Bon scannen“ und halte den Z-Bon in den Rahmen." : "Die Daten werden mit deinen Geräten abgeglichen.")));
    $("#listNote").textContent = ""; return;
  }
  const wrap = el("div", { class: "days" });
  for (const r of [...list].reverse()) {
    const cs = checks(r, S.reports);
    const pay = el("div", { class: "pay" });
    if (isNum(r.bar)) pay.append(el("span", { class: "c" }, "Bar " + money(r.bar)));
    if (isNum(r.kredit)) pay.append(el("span", { class: "k" }, "Kredit " + money(r.kredit)));
    const meta = [isNum(r.zNr) ? "Z " + r.zNr : null, isNum(r.kunden) ? r.kunden + " Kunden" : null, r.uhrzeit || null].filter(Boolean).join(" · ");
    wrap.append(el("button", { class: "day", onclick: () => openEdit(r), "aria-label": "Tagesabschluss " + deDate(r.datum) + " bearbeiten" },
      el("div", { class: "date" }, el("small", {}, wday(r.datum)), el("b", {}, String(Number(r.datum.slice(8))))),
      el("div", { class: "mid" }, el("div", { class: "meta" }, meta || "Tagesabschluss"), pay,
        cs.length ? el("div", { class: "chips" }, cs.map(([l, t]) => el("span", { class: "chip " + l }, t))) : null),
      el("div", { class: "amt" }, money(r.umsatz))));
  }
  box.append(wrap);
  const issues = list.filter(r => checks(r, S.reports).length).length;
  $("#listNote").textContent = issues ? issues + " prüfen" : "alles stimmig";
}

function renderYear(m) {
  const y = m.slice(0, 4), box = $("#year"); box.replaceChildren();
  const tot = new Array(12).fill(0);
  for (const r of S.reports.values()) if (r.monat && r.monat.startsWith(y) && isNum(r.umsatz)) tot[Number(r.monat.slice(5)) - 1] += r.umsatz;
  const mx = Math.max(1, ...tot), tm = ym(todayISO());
  tot.forEach((v, i) => {
    const key = y + "-" + pad(i + 1), b = el("div", { class: "bar" }); b.style.height = Math.max(3, Math.round(v / mx * 64)) + "px";
    box.append(el("button", { class: "ym" + (v > 0 ? " has" : "") + (key === m ? " cur" : ""), "aria-label": MONATE[i] + " " + y + ": " + eur.format(r2(v)), disabled: key > tm,
      onclick: () => { S.month = key; S.moved = true; render(); window.scrollTo({ top: 0, behavior: "smooth" }); } }, b, el("small", {}, MK[i])));
  });
  $("#yTitle").textContent = "Jahr " + y;
  const ys = r2(tot.reduce((a, b) => a + b, 0));
  $("#ySum").textContent = ys > 0 ? eur0.format(ys) + " bisher" : "";
}

/* ---------- Dialogblatt ---------- */
let sheetCleanup = null;
function openSheet(title, body, foot, onClose) {
  if (sheetCleanup) { const f = sheetCleanup; sheetCleanup = null; f(); }
  $("#shTitle").textContent = title; $("#shBody").replaceChildren(...body); $("#shFoot").replaceChildren(...foot);
  $("#shFoot").hidden = !foot.length; $("#veil").hidden = false; sheetCleanup = onClose || null;
  document.body.classList.add("noscroll");
}
function closeSheet() { $("#veil").hidden = true; document.body.classList.remove("noscroll"); if (sheetCleanup) { const f = sheetCleanup; sheetCleanup = null; f(); } }
$("#shClose").onclick = closeSheet;
$("#veil").addEventListener("click", e => { if (e.target.id === "veil") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#veil").hidden) closeSheet(); });

/* ---------- Formular ---------- */
let formSeq = 0;
function reportForm(r, opts = {}) {
  const id = "f" + (++formSeq), unsure = new Set(r.unsicher || []);
  const f = (key, label, cls = "") => {
    const isDate = key === "datum";
    const inp = el("input", { id: id + "-" + key, inputmode: isDate ? null : "decimal", type: isDate ? "date" : "text", autocomplete: "off", value: isDate ? (r[key] || "") : fmtIn(r[key]) });
    return el("label", { class: "fld " + cls + (unsure.has(key) ? " unsure" : "") }, el("span", {}, label), inp);
  };
  const card = el("div", { class: "rcard" });
  card.append(
    el("div", { class: "grid" }, f("datum", "Datum"), f("zNr", "Z-Nr."), f("umsatz", "Umsatz €")),
    el("div", { class: "grid" }, f("bar", "Bar €", "cash"), f("kredit", "Kredit €", "card"), f("kunden", "Kunden")),
    el("div", { class: "grid" }, f("netto", "Netto €"), f("mwst", "MwSt €"), f("storno", "Storno €")),
    el("div", { class: "grid" }, f("barAnzahl", "Bar Anz."), f("kreditAnzahl", "Kredit Anz."), f("gt1", "GT1"))
  );
  if (Array.isArray(r.warengruppen) && r.warengruppen.length)
    card.append(el("div", { class: "wg" }, "Warengruppen: " + r.warengruppen.map(w => [w.code, w.name].filter(Boolean).join(" ") + " " + (isNum(w.anzahl) ? w.anzahl + "× " : "") + money(w.betrag)).join(" · ")));
  const cs = checks(r, S.reports, opts.batch);
  const notes = [...(r._notes || [])];
  if (unsure.size && opts.scanned) notes.push("Gelb markierte Felder wurden nicht sicher erkannt: bitte mit dem Bon vergleichen.");
  if (opts.checkExists && r.datum && S.reports.has(r.datum)) notes.push("Für dieses Datum gibt es schon einen Eintrag – Speichern überschreibt ihn.");
  if (cs.length) card.append(el("div", { class: "chips" }, cs.map(([l, t]) => el("span", { class: "chip " + l }, t))));
  if (notes.length) card.append(el("div", { class: "notes" }, notes.map(n => el("span", {}, "• " + n))));
  const read = () => {
    const o = { warengruppen: Array.isArray(r.warengruppen) ? r.warengruppen : [], quelle: r.quelle || "manuell", uhrzeit: r.uhrzeit || null };
    for (const k of FIELDS) {
      const inp = card.querySelector("#" + id + "-" + k); if (!inp) continue;
      if (k === "datum") o[k] = inp.value || null;
      else { const v = parseDe(inp.value); if (Number.isNaN(v)) throw new Error("„" + inp.previousSibling.textContent + "“ ist keine Zahl."); o[k] = v; }
    }
    if (!validDate(o.datum)) throw new Error("Bitte ein gültiges Datum eintragen.");
    if (!isNum(o.umsatz)) throw new Error("Bitte den Umsatz eintragen (GES. BEZAHLT).");
    return o;
  };
  return { card, read };
}

function openEdit(r) {
  const form = reportForm(r);
  const err = errBox();
  const save = el("button", { class: "btn primary" }, "Speichern");
  const del = el("button", { class: "btn danger" }, "Löschen");
  save.onclick = async () => {
    err.hidden = true; let o; try { o = form.read(); } catch (e) { showErr(err, e.message); return; }
    if (o.datum !== r.datum && S.reports.has(o.datum)) { showErr(err, "Für den " + deDate(o.datum) + " gibt es schon einen Eintrag."); return; }
    save.disabled = true;
    try { await S.store.saveReport(o, r.datum); closeSheet(); toast("Gespeichert"); }
    catch (e) { showErr(err, e.message); save.disabled = false; }
  };
  let armed = false;
  del.onclick = async () => {
    if (!armed) { armed = true; del.classList.add("armed"); del.textContent = "Wirklich löschen?"; return; }
    del.disabled = true;
    try { await S.store.deleteReport(r.datum); closeSheet(); toast("Tagesabschluss gelöscht"); }
    catch (e) { showErr(err, e.message); del.disabled = false; }
  };
  openSheet(wday(r.datum) + ", " + deDate(r.datum), [form.card, err], [del, save]);
}

function nextGuess() {
  const pre = { datum: todayISO(), quelle: "manuell" };
  const last = [...S.reports.values()].sort((a, b) => a.datum < b.datum ? 1 : -1)[0];
  if (last && isNum(last.zNr)) pre.zNr = last.zNr + 1;
  return pre;
}
function openManual() {
  const form = reportForm(nextGuess());
  const err = errBox();
  const save = el("button", { class: "btn primary" }, "Speichern");
  save.onclick = async () => {
    err.hidden = true; let o; try { o = form.read(); } catch (e) { showErr(err, e.message); return; }
    save.disabled = true;
    try { await S.store.saveReport(o); S.month = ym(o.datum); S.moved = true; closeSheet(); toast("Gespeichert"); render(); }
    catch (e) { showErr(err, e.message); save.disabled = false; }
  };
  openSheet("Tagesabschluss eintragen", [el("p", { class: "hint" }, "Werte vom Z-Bon: Umsatz = GES. BEZAHLT, Bar und Kredit aus dem Finanzbericht."), form.card, err], [save]);
}

/* ---------- Ziel ---------- */
function openGoal() {
  const m = S.month, cur = S.cfg.ziele && S.cfg.ziele[m];
  const inp = el("input", { id: "goal-in", inputmode: "decimal", value: isNum(cur) ? fmtIn(cur) : (isNum(S.cfg.standardZiel) ? fmtIn(S.cfg.standardZiel) : "") });
  const def = el("input", { id: "goal-def", type: "checkbox", checked: !isNum(cur) && !!S.cfg.standardZiel });
  const err = errBox();
  const save = el("button", { class: "btn primary" }, "Ziel speichern");
  save.onclick = async () => {
    const v = parseDe(inp.value);
    if (v != null && (Number.isNaN(v) || v < 0)) { showErr(err, "Bitte einen Betrag eintragen, z. B. 18000."); return; }
    const cfg = { ziele: { ...(S.cfg.ziele || {}) }, standardZiel: S.cfg.standardZiel ?? null };
    if (def.checked) { cfg.standardZiel = v || null; delete cfg.ziele[m]; } else { if (v) cfg.ziele[m] = v; else delete cfg.ziele[m]; }
    save.disabled = true;
    try { await S.store.saveConfig(cfg); S.cfg = cfg; closeSheet(); render(); toast("Ziel gespeichert"); }
    catch (e) { showErr(err, e.message); save.disabled = false; }
  };
  openSheet("Monatsziel " + mLabel(m), [
    el("label", { class: "fld" }, el("span", {}, "Umsatzziel brutto in €"), inp),
    el("label", { style: "display:flex;gap:8px;align-items:center" }, def, "Als Standard für alle Monate ohne eigenes Ziel"),
    el("p", { class: "hint" }, "Der Strich im Balken zeigt, wo du heute stehen müsstest, wenn der Umsatz gleichmäßig über den Monat käme."), err], [save]);
}

/* ---------- Scannen ---------- */
async function startScan(prev) {
  const canvas = await scan({ title: prev ? "Teil 2: fehlenden Bereich scannen" : "Bon in den Rahmen halten" });
  if (!canvas) { if (prev) showReview(prev.parsed, prev.canvas, prev.text); return; }
  const bar = el("i");
  const status = el("div", { class: "status" }, el("div", { class: "spin" }), el("span", {}, "Text wird erkannt …"));
  const prog = el("div", { class: "progress" }, bar);
  const thumb = canvas; thumb.className = "";
  openSheet("Bon wird gelesen", [el("div", { class: "preview" }, thumb, el("div", { style: "flex:1;display:flex;flex-direction:column;gap:10px" }, status, prog))], []);
  let text;
  try {
    text = await recognize(canvas, (st, p) => {
      bar.style.width = Math.round(p * 100) + "%";
      status.lastChild.textContent = /load|initial/i.test(st) ? "Texterkennung wird geladen (einmalig) …" : "Text wird erkannt …";
    });
  } catch (e) {
    status.className = "status err"; status.replaceChildren(el("span", {}, e.message || "Texterkennung fehlgeschlagen."));
    $("#shFoot").replaceChildren(el("button", { class: "btn", onclick: closeSheet }, "Schließen"), el("button", { class: "btn primary", onclick: () => { closeSheet(); openManual(); } }, "Manuell eintragen"));
    $("#shFoot").hidden = false; return;
  }
  let parsed = parseZBon(text);
  if (prev) { parsed = mergeParts(prev.parsed, parsed); text = prev.text + "\n----- Teil 2 -----\n" + text; }
  showReview(parsed, prev ? prev.canvas : canvas, text);
}

function showReview(parsed, canvas, text) {
  const r = { ...parsed, quelle: "scan", warengruppen: parsed.warengruppen || [] };
  if (!r.datum) r.datum = null;
  complete([r], S.reports);
  const form = reportForm(r, { checkExists: true, scanned: true });
  const err = errBox();
  const body = [];
  const found = parsed.kopfGefunden || parsed.finanzGefunden;
  if (!found) body.push(el("div", { class: "banner" }, "Auf dem Bild wurde kein Z-Bericht erkannt. Bon flach hinlegen, gut beleuchten und so halten, dass er den Rahmen ausfüllt."));
  else if (!parsed.kopfGefunden || !parsed.finanzGefunden) body.push(el("div", { class: "banner" }, !parsed.finanzGefunden ? "Der Finanzbericht (Bar, Kredit, GES. BEZAHLT) fehlt noch. Scanne den unteren Teil des Bons nach." : "Datum, Z-Nr. und GT1 fehlen noch. Scanne den oberen Teil des Bons nach."));
  const c2 = canvas; c2.className = "";
  body.push(el("div", { class: "preview" }, c2, el("p", { class: "hint", style: "flex:1" }, "Vergleiche die Werte kurz mit dem Bon. Das Bild wird nicht gespeichert.")));
  body.push(form.card, err, el("details", { class: "raw" }, el("summary", {}, "Erkannter Text"), el("pre", {}, text || "")));
  const save = el("button", { class: "btn primary" }, "Speichern");
  const more = el("button", { class: "btn" }, "Teil 2 scannen");
  more.onclick = () => { closeSheet(); startScan({ parsed, canvas, text }); };
  save.onclick = async () => {
    err.hidden = true; let o; try { o = form.read(); } catch (e) { showErr(err, e.message); return; }
    o.quelle = "scan"; save.disabled = true;
    try { await S.store.saveReport(o); S.month = ym(o.datum); S.moved = true; closeSheet(); toast("Tagesabschluss gespeichert"); render(); }
    catch (e) { showErr(err, e.message); save.disabled = false; }
  };
  openSheet("Erkannter Tagesabschluss", body, [more, save]);
}

/* ---------- CSV ---------- */
async function exportCsv() {
  const list = monthReports(S.reports, S.month);
  if (!list.length) { toast("Keine Daten in diesem Monat"); return; }
  const csv = toCsv(list), name = "Umsatz-" + S.month + ".csv";
  const file = new File(["﻿" + csv], name, { type: "text/csv" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  const a = el("a", { href: URL.createObjectURL(file), download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Menü ---------- */
function openMenu() {
  const s = S.store.session(), email = s && s.user && s.user.email;
  const list = el("div", { class: "menu-list" });
  list.append(el("p", { class: "hint" }, S.store.mode === "demo"
    ? "Demo-Modus: Die Daten liegen nur in diesem Browser. Für Sync über alle Geräte Supabase in config.js eintragen."
    : "Angemeldet als " + email + ". Deine Daten sind auf allen Geräten gleich, auf denen du angemeldet bist."));
  if (S.store.mode !== "demo") {
    list.append(el("button", { class: "btn", onclick: openPassword }, "Passwort ändern"));
    list.append(el("button", { class: "btn danger", onclick: async () => { await S.store.signOut(); closeSheet(); showLogin(); } }, "Abmelden"));
  }
  list.append(el("button", { class: "btn", onclick: async () => { closeSheet(); toast("Texterkennung wird geladen …"); try { await warmUp(); toast("Texterkennung ist offline bereit"); } catch (e) { toast(e.message); } } }, "Texterkennung jetzt herunterladen"));
  list.append(el("p", { class: "hint" }, "Aufs iPhone: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“."));
  openSheet("Einstellungen", [list], []);
}
function openPassword(_e, recovery) {
  const pw = el("input", { id: "pw-new", type: "password", autocomplete: "new-password" });
  const err = errBox();
  const save = el("button", { class: "btn primary" }, "Passwort speichern");
  save.onclick = async () => {
    if (pw.value.length < 8) { showErr(err, "Mindestens 8 Zeichen."); return; }
    save.disabled = true;
    try { await S.store.updatePassword(pw.value); closeSheet(); toast("Passwort geändert"); }
    catch (e) { showErr(err, e.message); save.disabled = false; }
  };
  openSheet(recovery ? "Neues Passwort festlegen" : "Passwort ändern", [el("label", { class: "fld" }, el("span", {}, "Neues Passwort"), pw), err], [save]);
}

/* ---------- Login & Start ---------- */
function showLogin() {
  if (S.unsub) { S.unsub(); S.unsub = null; }
  S.reports = new Map(); S.loaded = false;
  $("#app").hidden = true; $("#dock").hidden = true; $("#login").hidden = false;
  setTimeout(() => $("#lg-email").focus(), 50);
}
function showApp() {
  $("#login").hidden = true; $("#app").hidden = false; $("#dock").hidden = false;
  banner(S.store.mode === "demo" ? "Demo-Modus: Daten werden nur in diesem Browser gespeichert." : null);
  render();
  if (S.unsub) S.unsub();
  let timer = setTimeout(() => { if (!S.loaded) { S.loaded = true; render(); banner("Die Daten sind gerade nicht erreichbar. Bitte Internet prüfen."); } }, 10000);
  S.unsub = S.store.subscribe((map, cfg) => {
    clearTimeout(timer);
    S.reports = map; S.cfg = cfg || { ziele: {}, standardZiel: null };
    if (!S.moved && !S.loaded) {
      const cur = ym(todayISO());
      if (map.size && ![...map.values()].some(r => r.monat === cur)) S.month = [...map.keys()].sort().pop().slice(0, 7);
    }
    S.loaded = true; render();
    if (S.store.mode !== "demo") banner(null);
  }, (state, text) => setSync(state === "loading" ? "" : state, text));
}

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#lg-btn"), err = $("#lg-err"); err.hidden = true;
  const email = $("#lg-email").value.trim(), pw = $("#lg-pw").value;
  if (!email || !pw) { showErr(err, "Bitte E-Mail und Passwort eingeben."); return; }
  btn.disabled = true; btn.textContent = "Anmelden …";
  try { await S.store.signIn(email, pw); $("#lg-pw").value = ""; showApp(); }
  catch (ex) { showErr(err, ex.message); }
  finally { btn.disabled = false; btn.textContent = "Anmelden"; }
});
$("#lg-forgot").onclick = async () => {
  const err = $("#lg-err"), email = $("#lg-email").value.trim();
  if (!email) { showErr(err, "Gib zuerst deine E-Mail-Adresse ein."); return; }
  try { await S.store.resetPassword(email); err.hidden = true; toast("Link zum Zurücksetzen wurde gesendet"); }
  catch (ex) { showErr(err, ex.message); }
};
$("#prevM").onclick = () => { S.month = shiftM(S.month, -1); S.moved = true; render(); };
$("#nextM").onclick = () => { S.month = shiftM(S.month, 1); S.moved = true; render(); };
$("#scanBtn").onclick = () => startScan(null);
$("#manualBtn").onclick = openManual;
$("#goalBtn2").onclick = openGoal;
$("#csvBtn").onclick = exportCsv;
$("#menuBtn").onclick = openMenu;

async function boot() {
  try { S.store = await createStore(window.UMSATZBUCH_CONFIG || {}); }
  catch (e) {
    $("#login").hidden = false;
    showErr($("#lg-err"), "Verbindung zur Datenbank konnte nicht aufgebaut werden. Internet prüfen und neu laden.");
    return;
  }
  S.store.onAuth((session, event) => {
    if (event === "PASSWORD_RECOVERY") { showApp(); openPassword(null, true); }
    else if (event === "SIGNED_OUT") showLogin();
  });
  if (S.store.session()) showApp(); else showLogin();
}
boot();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
// für Tests in der Konsole
window.__umsatzbuch = { parseZBon, S };
