# Umsatzbuch

Web-App fürs iPhone: Z-Bons (Tagesabschlüsse) der Kasse scannen, Umsatz pro Monat verfolgen, Bar und Kredit getrennt sehen. Daten werden über alle Geräte abgeglichen, Zugang nur mit Login.

- **Scannen statt Fotos:** Die Kamera liest den Bon live, die Texterkennung läuft auf dem Gerät (Tesseract.js). Es wird kein Bild gespeichert, nur die Zahlen (ca. 1 KB pro Bon).
- **Prüfung:** Bar + Kredit = Umsatz, Netto + MwSt = Umsatz und die GT1-Differenz zum Vortag werden automatisch kontrolliert.
- **Kosten:** 0 € (GitHub Pages + Supabase-Gratistarif).

Ohne Eintrag in `config.js` läuft die App im Demo-Modus (Daten nur im Browser).

---

## Einrichtung (einmalig, ca. 20 Minuten)

### 1. Supabase (Datenbank + Login)

1. Auf [supabase.com](https://supabase.com) kostenlos registrieren → **New project**. Region: *Central EU (Frankfurt)*. Datenbank-Passwort notieren.
2. Links **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
3. **Authentication → Users → Add user → Create new user**: deine E-Mail und ein Passwort eingeben, *Auto Confirm User* anhaken.
4. **Authentication → Sign In / Providers**: *Allow new users to sign up* **ausschalten**. So kann sich niemand sonst ein Konto anlegen.
5. **Project Settings → API**: *Project URL* und den Schlüssel *anon public* kopieren und in [`config.js`](config.js) eintragen.
   Den Schlüssel *service_role* **niemals** verwenden.
6. Optional: alte Daten übernehmen – die Datei `daten-import-august-2026.sql` (liegt außerhalb dieses Ordners) im SQL Editor ausführen.

### 2. GitHub Pages (Veröffentlichung)

1. Auf [github.com](https://github.com) → **New repository** → Name `umsatzbuch`, **Public** → *Create repository*.
2. **uploading an existing file** → alle Dateien und Ordner aus diesem Ordner hineinziehen (ohne `testdaten`) → *Commit changes*.
3. **Settings → Pages** → *Source: Deploy from a branch* → Branch `main`, Ordner `/ (root)` → *Save*.
4. Nach 1–2 Minuten ist die App erreichbar unter `https://DEIN-NAME.github.io/umsatzbuch/`.
5. Zurück in Supabase: **Authentication → URL Configuration → Site URL** auf diese Adresse setzen (für „Passwort vergessen“).

### 3. Aufs iPhone

1. Die Adresse in **Safari** öffnen und anmelden.
2. **Teilen** (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → *Hinzufügen*.
3. App vom Home-Bildschirm starten → **⋯ → Texterkennung jetzt herunterladen** (einmalig ca. 10 MB, danach offline).
4. Beim ersten Scan die Kamera erlauben.

---

## Gut scannen

- Bon flach auf einen dunklen Untergrund legen, gutes Licht, keine Schatten.
- Den Rahmen mit dem Bon ausfüllen. Ist der Bon zu lang: erst oben scannen, dann **Teil 2 scannen** für den Finanzbericht.
- Nach dem Scan die Werte kurz mit dem Bon vergleichen. Gelbe Felder wurden nicht sicher erkannt.

## Sicherheit

- Der Code ist öffentlich, deine Daten nicht: Ohne Login gibt die Datenbank nichts heraus, und jeder Nutzer sieht nur seine eigenen Zeilen (Row Level Security).
- Der *anon*-Schlüssel in `config.js` ist zum Veröffentlichen gedacht. Passwörter und den *service_role*-Schlüssel nie ins Repository schreiben.
- Testbilder und Daten-Exporte sind über `.gitignore` ausgeschlossen.

## Updates

Geänderte Dateien auf GitHub ersetzen und in `sw.js` die Zeile `VERSION` hochzählen (z. B. `umsatzbuch-v2`), damit iPhones die neue Version laden.

## Hinweis Supabase-Gratistarif

Projekte ohne Zugriff für ca. eine Woche werden pausiert. Bei täglicher Nutzung passiert das nicht; ein pausiertes Projekt lässt sich im Dashboard mit einem Klick fortsetzen.
