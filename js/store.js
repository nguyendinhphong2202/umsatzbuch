// Datenhaltung: Supabase (Login + Sync über alle Geräte) oder Demo-Modus (nur dieses Gerät).
// Beide liefern dieselbe Schnittstelle an app.js.
import { FIELDS, isNum, ym, validDate } from "./domain.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const COLS = { datum:"datum", uhrzeit:"uhrzeit", zNr:"z_nr", umsatz:"umsatz", bar:"bar", barAnzahl:"bar_anzahl", kredit:"kredit",
  kreditAnzahl:"kredit_anzahl", kunden:"kunden", netto:"netto", mwst:"mwst", storno:"storno", stornoAnzahl:"storno_anzahl", gt1:"gt1" };

const num = v => v == null || v === "" ? null : (isFinite(Number(v)) ? Number(v) : null);

function rowToReport(row) {
  const r = {};
  for (const [k, c] of Object.entries(COLS)) r[k] = (k === "datum" || k === "uhrzeit") ? (row[c] ?? null) : num(row[c]);
  if (r.datum) r.datum = String(r.datum).slice(0, 10);
  r.monat = r.datum ? ym(r.datum) : null;
  r.warengruppen = Array.isArray(row.warengruppen) ? row.warengruppen : [];
  r.quelle = row.quelle || null;
  return r;
}
function reportToRow(o, userId) {
  const row = { user_id: userId };
  for (const [k, c] of Object.entries(COLS)) row[c] = o[k] == null ? null : o[k];
  row.warengruppen = (o.warengruppen || []).map(w => ({ code: w.code ?? null, name: w.name ?? null, anzahl: isNum(w.anzahl) ? w.anzahl : null, betrag: isNum(w.betrag) ? w.betrag : null }));
  row.quelle = o.quelle || "manuell";
  row.aktualisiert = new Date().toISOString();
  return row;
}

function authMessage(error) {
  const m = (error && error.message || "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "E-Mail oder Passwort stimmt nicht.";
  if (m.includes("email not confirmed")) return "Die E-Mail-Adresse ist noch nicht bestätigt.";
  if (m.includes("fetch") || m.includes("network")) return "Keine Verbindung. Bitte Internet prüfen.";
  return "Anmelden fehlgeschlagen: " + (error && error.message || "unbekannter Fehler");
}

export async function createStore(cfg) {
  if (cfg && cfg.supabaseUrl && cfg.supabaseAnonKey) return supabaseStore(cfg);
  return demoStore();
}

/* ---------------- Supabase ---------------- */
async function supabaseStore(cfg) {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "umsatzbuch-auth" } });
  let session = (await sb.auth.getSession()).data.session;

  return {
    mode: "supabase",
    session: () => session,
    onAuth(cb) { sb.auth.onAuthStateChange((e, s) => { session = s; cb(s, e); }); },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(authMessage(error));
      session = data.session; return session;
    },
    async signOut() { await sb.auth.signOut(); session = null; },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
      if (error) throw new Error(error.message);
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },

    /** Lädt alles und hält es live aktuell. onData(reportsMap, cfg), onStatus("ok"|"err"|"loading", text). */
    subscribe(onData, onStatus) {
      let alive = true, timer = null;
      const load = async () => {
        onStatus("loading", "Lade…");
        const [a, b] = await Promise.all([
          sb.from("zbons").select("*").order("datum"),
          sb.from("einstellungen").select("*").maybeSingle()
        ]);
        if (!alive) return;
        if (a.error) { onStatus("err", "nicht erreichbar"); return; }
        const map = new Map();
        for (const row of a.data) { const r = rowToReport(row); if (validDate(r.datum)) map.set(r.datum, r); }
        const s = b.data || {};
        onData(map, { ziele: s.ziele || {}, standardZiel: num(s.standard_ziel) });
        onStatus("ok", "synchron");
      };
      const soon = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
      const ch = sb.channel("umsatzbuch")
        .on("postgres_changes", { event: "*", schema: "public", table: "zbons" }, soon)
        .on("postgres_changes", { event: "*", schema: "public", table: "einstellungen" }, soon)
        .subscribe();
      // iOS trennt die Live-Verbindung im Hintergrund: beim Zurückkehren neu laden
      const vis = () => { if (document.visibilityState === "visible") soon(); };
      document.addEventListener("visibilitychange", vis);
      window.addEventListener("online", soon);
      load().catch(() => onStatus("err", "nicht erreichbar"));
      return () => { alive = false; sb.removeChannel(ch); document.removeEventListener("visibilitychange", vis); window.removeEventListener("online", soon); };
    },

    async saveReport(o, oldDatum) {
      const uid = session && session.user.id;
      if (!uid) throw new Error("Bitte erneut anmelden.");
      const { error } = await sb.from("zbons").upsert(reportToRow(o, uid), { onConflict: "user_id,datum" });
      if (error) throw new Error("Speichern fehlgeschlagen: " + error.message);
      if (oldDatum && oldDatum !== o.datum) {
        const d = await sb.from("zbons").delete().eq("datum", oldDatum);
        if (d.error) throw new Error("Alter Eintrag konnte nicht entfernt werden: " + d.error.message);
      }
    },
    async deleteReport(datum) {
      const { error } = await sb.from("zbons").delete().eq("datum", datum);
      if (error) throw new Error("Löschen fehlgeschlagen: " + error.message);
    },
    async saveConfig(c) {
      const uid = session && session.user.id;
      const { error } = await sb.from("einstellungen").upsert({ user_id: uid, ziele: c.ziele || {}, standard_ziel: c.standardZiel ?? null }, { onConflict: "user_id" });
      if (error) throw new Error("Speichern fehlgeschlagen: " + error.message);
    }
  };
}

/* ---------------- Demo (localStorage) ---------------- */
function demoStore() {
  const KEY = "umsatzbuch-demo";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { zbons: {}, cfg: { ziele: {}, standardZiel: null } }; } catch { return { zbons: {}, cfg: { ziele: {}, standardZiel: null } }; } };
  const write = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  let listener = null;
  const emit = () => {
    if (!listener) return;
    const d = read(), map = new Map();
    for (const r of Object.values(d.zbons)) if (validDate(r.datum)) map.set(r.datum, { ...r, monat: ym(r.datum) });
    listener(map, d.cfg);
  };
  const session = { user: { email: "Demo-Modus", id: "demo" } };
  return {
    mode: "demo",
    session: () => session,
    onAuth() {},
    async signIn() { return session; },
    async signOut() {},
    async resetPassword() {},
    async updatePassword() {},
    subscribe(onData, onStatus) {
      listener = onData; onStatus("ok", "Demo-Modus"); emit();
      const st = e => { if (e.key === KEY) emit(); };
      window.addEventListener("storage", st);
      return () => { listener = null; window.removeEventListener("storage", st); };
    },
    async saveReport(o, oldDatum) {
      const d = read(), r = {};
      for (const k of FIELDS) r[k] = o[k] == null ? null : o[k];
      r.warengruppen = o.warengruppen || []; r.quelle = o.quelle || "manuell";
      d.zbons[o.datum] = r;
      if (oldDatum && oldDatum !== o.datum) delete d.zbons[oldDatum];
      write(d); emit();
    },
    async deleteReport(datum) { const d = read(); delete d.zbons[datum]; write(d); emit(); },
    async saveConfig(c) { const d = read(); d.cfg = { ziele: c.ziele || {}, standardZiel: c.standardZiel ?? null }; write(d); emit(); }
  };
}
