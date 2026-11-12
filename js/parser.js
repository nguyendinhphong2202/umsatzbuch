// Liest den erkannten Text eines Z-Berichts (Kopf "*Z1*", GT1–GT3, Warengruppen, Finanzbericht)
// und macht daraus Zahlen. Typische Fehler der Texterkennung werden toleriert:
//  - das Sternchen vor Beträgen wird oft als x, #, + oder sogar als "4" gelesen
//  - "Q" hinter Stückzahlen wird zu "0" oder verschwindet
//  - M wird zu H/N, Z zu 2, O zu 0
// Mehrdeutige Werte werden über die Summen auf dem Bon entschieden.

const PREFIX = `*X#+«»%"'‘’`;
const AMT = /([*X#+«»%"'‘’\-]?)\s?(\d+)\s?[.,]\s?(\d{2})(?!\d)/g;
const pad2 = n => String(n).padStart(2, "0");
const eq = (a, b, tol = 0.011) => a != null && b != null && Math.abs(a - b) < tol;

/** O→0 und l/I/|→1 in Zahlen; Störzeichen vor dem ersten Wort entfernen. */
function normalizeLine(l) {
  let s = l.toUpperCase().replace(/\s+/g, " ").trim();
  s = s.replace(/(?<=[\d*.,])O|O(?=\d|[.,]\d)/g, "0").replace(/(?<=\d)[lI|](?=[\d.,])|(?<=[*\s])[lI|](?=\d)/g, "1");
  s = s.replace(/^[^A-Z0-9]*(?:\d\s?)?[^A-Z0-9]*(?=[A-Z]{2})/, "");
  return s;
}

/** Beträge einer Zeile. alt = Wert ohne führende "4", falls das Sternchen als 4 gelesen wurde. */
function amounts(line) {
  return [...line.matchAll(AMT)].map(m => {
    const sign = m[1] === "-" ? -1 : 1;
    const v = sign * Number(m[2] + "." + m[3]);
    const alt = !m[1] && m[2].length >= 2 && m[2][0] === "4" ? Number(m[2].slice(1) + "." + m[3]) : null;
    return alt == null ? [v] : [alt, v];
  });
}
const onlyAmount = l => /^[^A-Z0-9]*[*X#+«»%]{0,2}\s?\d+\s?[.,]\s?\d{2}[^A-Z0-9]*$/.test(l);

/** Stückzahl am Zeilenende: "17 Q", "17 0", "170" (Q als 0 angehängt), "12". Liefert Kandidaten, wahrscheinlichster zuerst. */
function countCands(tail) {
  let m = tail.match(/(\d{1,4})\s?Q\b/);
  if (m) return [Number(m[1])];
  m = tail.match(/(\d{1,4})\s[0O]\s*[^\dA-Z]*$/);
  if (m) return [Number(m[1])];
  m = tail.match(/(\d{1,4})\s*[^\dA-Z]*$/);
  if (!m) return null;
  const t = m[1];
  if (t.length >= 2 && t.endsWith("0")) return [Number(t.slice(0, -1)), Number(t)];
  return [Number(t)];
}

/** GT-Zähler: Ziffern nach der Nullenfolge, so stört ein als Ziffer gelesenes Sternchen nicht. */
function gtValue(line) {
  const m = line.match(/\d*?0{3,}(\d{3,})\s?[.,]\s?(\d{2})(?!\d)/);
  if (m) return Number(m[1] + "." + m[2]);
  const a = amounts(line); return a.length ? Math.abs(a[0][a[0].length - 1]) : null;
}

export function parseZBon(text) {
  const L = String(text || "").split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const find = (re, from = 0, to = L.length) => { for (let i = Math.max(0, from); i < Math.min(to, L.length); i++) if (re.test(L[i])) return i; return -1; };
  const findLast = (re, from = 0) => { for (let i = L.length - 1; i >= from; i--) if (re.test(L[i])) return i; return -1; };
  const amountAt = i => {
    if (i < 0) return null;
    const a = amounts(L[i]); if (a.length) return a[a.length - 1];
    for (let j = i + 1; j <= i + 2 && j < L.length; j++) { if (!onlyAmount(L[j])) break; const b = amounts(L[j]); if (b.length) return b[0]; }
    return null;
  };
  const countAt = (i, labelRe) => i < 0 ? null : countCands(L[i].replace(labelRe, " "));

  const r = { datum: null, uhrzeit: null, zNr: null, umsatz: null, bar: null, barAnzahl: null, kredit: null, kreditAnzahl: null,
    kunden: null, netto: null, mwst: null, storno: null, stornoAnzahl: null, gt1: null, warengruppen: [] };

  /* Kopf */
  for (const l of L) {
    const m = l.match(/(\d{2})\s?[\/.\-]\s?(\d{2})\s?[\/.\-]\s?(\d{2,4})\s+(\d{1,2})\s?[:.]\s?(\d{2})/);
    if (!m) continue;
    let [, d, mo, y, h, mi] = m;
    if (y.length === 2) y = "20" + y;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31 && +h < 24 && +mi < 60) { r.datum = `${y}-${mo}-${d}`; r.uhrzeit = pad2(h) + ":" + mi; break; }
  }
  for (const l of L) {
    const m = l.match(/(?:^|\s)[Z2]\s?[1lI]\s+(\d{4})\b/) || l.match(/\bZ\s?[1lI]\s+0*(\d{1,5})\b/);
    if (m) { r.zNr = Number(m[1]); break; }
  }
  let gi = find(/G\s?T\s?[1lI]\b/);
  if (gi < 0) gi = find(/(?:^|[^\-\d])\d{0,2}0{4,}\d{3,}\s?[.,]\s?\d{2}/);
  if (gi >= 0) r.gt1 = gtValue(L[gi]);

  /* Abschnitte */
  const wi = find(/WARENGRUPPEN/);
  let fi = find(/FINANZ/);
  if (fi < 0) fi = find(/^NETT[O0]\s?[O0]?[1lI]\b/);
  const fs = fi >= 0 ? fi : 0;

  /* Finanzbericht: Kandidaten sammeln */
  const RE = {
    bez: /GES\W{0,2}\s?BEZ\S*/, n1: /^NETT[O0]\s?[O0]?[1lI]\b/, netto: /^NETT[O0]\b(?!\s?[O0]?[1lI])/,
    mwst: /[MHN]\s?[WN]\s?S\s?T\s?GES\S*/, mwst19: /^[MHN]\s?[WN]\s?ST\s?19\s?%/,
    bar: /^[B8]\s?AR\b(?!\s?(IN\b|\/|SCH))/, kredit: /^KRED[I1L]T/, kunden: /^KUNDEN/, storno: /^STORN\S*/
  };
  const idx = {
    bez: find(RE.bez, fs), n1: find(RE.n1, fs), netto: findLast(RE.netto, fs), mwst: find(RE.mwst, fs), mwst19: find(RE.mwst19, fs),
    bar: find(RE.bar, fs), kredit: find(RE.kredit, fs), kunden: find(RE.kunden, fs), storno: find(RE.storno, fs)
  };
  const C = {};
  for (const k of ["bez", "n1", "netto", "mwst", "mwst19", "bar", "kredit", "storno"]) C[k] = amountAt(idx[k]);

  const finanz = idx.bez >= 0 && C.bez && (idx.bar >= 0 || idx.kredit >= 0);
  if (finanz && idx.bar < 0) C.bar = [0];
  if (finanz && idx.kredit < 0) C.kredit = [0];

  // Beste Kombination: möglichst viele Summen stimmen, sonst die wahrscheinlichsten Werte
  const keys = ["bez", "n1", "netto", "mwst", "mwst19", "bar", "kredit"];
  let best = null;
  const walk = (i, pick, alts) => {
    if (i === keys.length) {
      const u = pick.bez ?? pick.n1;
      let s = 0;
      if (eq(pick.bez, pick.n1)) s += 2;
      if (u != null && pick.netto != null && pick.mwst != null && eq(pick.netto + pick.mwst, u, 0.021)) s += 2;
      if (u != null && pick.netto != null && pick.mwst == null && pick.mwst19 != null && eq(pick.netto + pick.mwst19, u, 0.021)) s += 2;
      if (u != null && pick.bar != null && pick.kredit != null && eq(pick.bar + pick.kredit, u)) s += 2;
      if (eq(pick.mwst, pick.mwst19)) s += 1;
      if (u != null && (pick.mwst ?? pick.mwst19) != null && eq(u * 19 / 119, pick.mwst ?? pick.mwst19, 0.021)) s += 0.5;
      if (!best || s > best.s || (s === best.s && alts < best.alts)) best = { s, alts, pick: { ...pick } };
      return;
    }
    const k = keys[i], c = C[k];
    if (!c) { pick[k] = null; walk(i + 1, pick, alts); return; }
    c.forEach((v, j) => { pick[k] = v; walk(i + 1, pick, alts + j); });
  };
  walk(0, {}, 0);
  const P = best.pick;
  r.umsatz = P.bez ?? P.n1;
  r.netto = P.netto;
  r.mwst = P.mwst ?? P.mwst19;
  r.bar = P.bar; r.kredit = P.kredit;
  r.storno = C.storno ? C.storno[0] : (finanz ? 0 : null);

  // Stückzahlen: Bar-Anzahl + Kredit-Anzahl = Kunden
  const cb = idx.bar >= 0 ? countAt(idx.bar, RE.bar) : (finanz ? [0] : null);
  const ck = idx.kredit >= 0 ? countAt(idx.kredit, RE.kredit) : (finanz ? [0] : null);
  const cu = idx.kunden >= 0 ? countAt(idx.kunden, RE.kunden) : null;
  let cnt = null;
  if (cb && ck && cu) for (const a of cb) for (const b of ck) for (const c of cu) if (!cnt && a + b === c) cnt = [a, b, c];
  r.barAnzahl = cnt ? cnt[0] : (cb ? cb[0] : null);
  r.kreditAnzahl = cnt ? cnt[1] : (ck ? ck[0] : null);
  r.kunden = cnt ? cnt[2] : (cu ? cu[0] : null);
  const cs = idx.storno >= 0 ? countAt(idx.storno, RE.storno) : null;
  r.stornoAnzahl = cs ? cs[0] : (finanz ? 0 : null);

  /* Warengruppen */
  if (wi >= 0) {
    const end = fi > wi ? fi : L.length;
    for (let i = wi + 1; i < end; i++) {
      const m = L[i].match(/^D\s?[O0]?(\d{1,2})\b/);
      if (!m) continue;
      const w = { code: "D" + pad2(m[1].slice(-2)), name: null, anzahl: null, betrag: null };
      const c = countCands(L[i].slice(m[0].length)); if (c && c.length === 1) w.anzahl = c[0];
      const nx = L[i + 1] || "";
      const n = nx.match(/^([A-ZÄÖÜ][A-ZÄÖÜ .\-]{1,30}?)\s+[*X#+«»%]{0,2}\s?\d/) || nx.match(/^([A-ZÄÖÜ][A-ZÄÖÜ\-]{2,30})$/);
      if (n && !/WGR|GESAMT/.test(n[1])) {
        const nm = n[1].trim(); w.name = nm.charAt(0) + nm.slice(1).toLowerCase();
        const a = amountAt(i + 1); if (a) w.betrag = a[0];
      }
      r.warengruppen.push(w);
    }
  }

  r.kopfGefunden = r.datum != null || r.zNr != null || r.gt1 != null;
  r.finanzGefunden = r.umsatz != null || r.bar != null || r.kredit != null;
  r.unsicher = unsicherFelder(r);
  return r;
}

function unsicherFelder(r) {
  const req = ["datum", "zNr", "gt1", "umsatz", "bar", "kredit", "kunden", "mwst", "netto"];
  return req.filter(k => r[k] == null);
}

/** Zwei Teil-Scans (oben/unten) zusammenführen: vorhandene Werte gewinnen. */
export function mergeParts(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (k === "warengruppen") out.warengruppen = (a.warengruppen && a.warengruppen.length) ? a.warengruppen : b.warengruppen;
    else if (out[k] == null) out[k] = b[k];
  }
  out.kopfGefunden = !!(a.kopfGefunden || b.kopfGefunden);
  out.finanzGefunden = !!(a.finanzGefunden || b.finanzGefunden);
  out.unsicher = unsicherFelder(out);
  return out;
}
