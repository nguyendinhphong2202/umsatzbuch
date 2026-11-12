// Fachlogik: Formatierung, Monatsrechnung, Plausibilitätsprüfungen. Keine DOM-Zugriffe.

export const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const intf = new Intl.NumberFormat("de-DE");
export const pct = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 });
export const MONATE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
export const MK = ["J","F","M","A","M","J","J","A","S","O","N","D"];
export const WT = ["So","Mo","Di","Mi","Do","Fr","Sa"];
export const FIELDS = ["datum","uhrzeit","zNr","umsatz","bar","barAnzahl","kredit","kreditAnzahl","kunden","netto","mwst","storno","stornoAnzahl","gt1"];
export const NUMF = ["zNr","umsatz","bar","barAnzahl","kredit","kreditAnzahl","kunden","netto","mwst","storno","stornoAnzahl","gt1"];

export const isNum = v => typeof v === "number" && isFinite(v);
export const r2 = v => Math.round(v * 100) / 100;
export const pad = n => String(n).padStart(2, "0");
export const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
export const ym = d => d.slice(0, 7);
export const daysIn = m => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).getDate(); };
export const shiftM = (m, dl) => { let [y, mo] = m.split("-").map(Number); mo += dl; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + "-" + pad(mo); };
export const mLabel = m => { const [y, mo] = m.split("-").map(Number); return MONATE[mo - 1] + " " + y; };
export const wday = d => { const [y, m, dd] = d.split("-").map(Number); return WT[new Date(y, m - 1, dd).getDay()]; };
export const deDate = d => d.split("-").reverse().join(".");
export const validDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + "T12:00:00"));
export const money = v => isNum(v) ? eur.format(v) : "–";
export const fmtIn = v => isNum(v) ? String(v).replace(".", ",") : "";

/** Deutsche oder englische Zahl aus einem Eingabefeld. null = leer, NaN = ungültig. */
export function parseDe(s) {
  if (s == null) return null;
  if (typeof s === "number") return isFinite(s) ? s : null;
  s = String(s).trim().replace(/[\s€*]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

export function sum(list, f) { let s = 0; for (const r of list) if (isNum(r[f])) s += r[f]; return r2(s); }

export function monthReports(reports, m) {
  return [...reports.values()].filter(r => r.monat === m).sort((a, b) => a.datum < b.datum ? -1 : 1);
}

export function goalFor(cfg, m) {
  const z = cfg.ziele && cfg.ziele[m];
  if (isNum(z) && z > 0) return z;
  return isNum(cfg.standardZiel) && cfg.standardZiel > 0 ? cfg.standardZiel : null;
}

function findByZ(z, reports, batch) {
  if (!isNum(z)) return null;
  if (batch) for (const b of batch) if (b.zNr === z) return b;
  for (const r of reports.values()) if (r.zNr === z) return r;
  return null;
}
const prevReport = (r, reports, batch) => findByZ(isNum(r.zNr) ? r.zNr - 1 : NaN, reports, batch);

/**
 * Füllt Lücken über den Gesamtzähler GT1 der Kasse: GT1 steigt jeden Tag genau um den Tagesumsatz.
 * Schreibt Hinweise nach r._notes.
 */
export function complete(batch, reports) {
  for (const r of batch) r._notes = r._notes || [];
  for (const r of batch) {
    if (!isNum(r.gt1) && isNum(r.zNr)) {
      const nx = findByZ(r.zNr + 1, reports, batch);
      if (nx && isNum(nx.gt1) && isNum(nx.umsatz)) { r.gt1 = r2(nx.gt1 - nx.umsatz); r._notes.push("GT1 aus dem Folgetag berechnet"); }
    }
  }
  for (const r of batch) {
    if (!isNum(r.umsatz)) {
      const pv = prevReport(r, reports, batch);
      if (pv && isNum(pv.gt1) && isNum(r.gt1)) { r.umsatz = r2(r.gt1 - pv.gt1); r._notes.push("Umsatz aus GT1-Differenz zum Vortag berechnet"); }
    }
    if (isNum(r.umsatz)) {
      if (!isNum(r.bar) && isNum(r.kredit)) { r.bar = r2(r.umsatz - r.kredit); r._notes.push("Bar = Umsatz − Kredit berechnet"); }
      else if (!isNum(r.kredit) && isNum(r.bar)) { r.kredit = r2(r.umsatz - r.bar); r._notes.push("Kredit = Umsatz − Bar berechnet"); }
      if (!isNum(r.mwst)) { r.mwst = r2(r.umsatz * 19 / 119); r.netto = r2(r.umsatz - r.mwst); r._notes.push("MwSt mit 19 % berechnet"); }
      else if (!isNum(r.netto)) r.netto = r2(r.umsatz - r.mwst);
    }
  }
  return batch;
}

/** Liefert [[stufe, text], ...] mit stufe "bad" oder "warn". */
export function checks(r, reports, batch) {
  const out = [];
  if (!isNum(r.umsatz)) out.push(["bad", "Umsatz fehlt"]);
  if (!isNum(r.bar) || !isNum(r.kredit)) out.push(["warn", "Bar/Kredit offen"]);
  else if (isNum(r.umsatz) && Math.abs(r.bar + r.kredit - r.umsatz) > 0.009) out.push(["bad", "Bar + Kredit ≠ Umsatz"]);
  if (isNum(r.netto) && isNum(r.mwst) && isNum(r.umsatz) && Math.abs(r.netto + r.mwst - r.umsatz) > 0.019) out.push(["warn", "Netto + MwSt ≠ Umsatz"]);
  const pv = prevReport(r, reports, batch);
  if (pv && isNum(pv.gt1) && isNum(r.gt1) && isNum(r.umsatz) && Math.abs(r2(r.gt1 - pv.gt1) - r.umsatz) > 0.009)
    out.push(["warn", "GT1-Differenz " + eur.format(r2(r.gt1 - pv.gt1))]);
  return out;
}

export function toCsv(list) {
  const dz = v => isNum(v) ? v.toFixed(2).replace(".", ",") : "";
  const rows = [["Datum","Z-Nr","Umsatz brutto","Bar","Kredit","Kunden","Netto","MwSt","Storno","GT1"].join(";")];
  for (const r of list) rows.push([deDate(r.datum), r.zNr ?? "", dz(r.umsatz), dz(r.bar), dz(r.kredit), r.kunden ?? "", dz(r.netto), dz(r.mwst), dz(r.storno), dz(r.gt1)].join(";"));
  rows.push(["Summe", "", dz(sum(list, "umsatz")), dz(sum(list, "bar")), dz(sum(list, "kredit")), sum(list, "kunden") || "", dz(sum(list, "netto")), dz(sum(list, "mwst")), dz(sum(list, "storno")), ""].join(";"));
  return rows.join("\r\n");
}
