<p align="center">
  <img src="frontend/public/apple-touch-icon.png" alt="Konfi Quest" width="128" height="128">
</p>

<h1 align="center">Konfi Quest</h1>

<p align="center">
  Die App für die Konfizeit — für Konfis, Teamer:innen und die Gemeindeleitung.<br>
  Punkte sammeln, Termine finden, miteinander reden. Auf iPhone, Android und im Browser.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Plattform-iOS%20%C2%B7%20Android%20%C2%B7%20Web-blue" alt="Plattform">
  <img src="https://img.shields.io/badge/Ionic-9-3880ff?logo=ionic" alt="Ionic">
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React">
  <img src="https://img.shields.io/badge/Quelle-offen%20einsehbar-2ea44f" alt="Quelle offen einsehbar">
  <img src="https://img.shields.io/badge/Nutzung-nur%20mit%20Erlaubnis-orange" alt="Nutzung nur mit Erlaubnis">
</p>

<p align="center">
  <img src="frontend/public/hero-ios-1.webp" width="200" alt="Konfi Quest auf dem iPhone">
  <img src="frontend/public/hero-ios-2.webp" width="200" alt="Konfi Quest auf dem iPhone">
  <img src="frontend/public/hero-ios-3.webp" width="200" alt="Konfi Quest auf dem iPhone">
  <img src="frontend/public/hero-ios-4.webp" width="200" alt="Konfi Quest auf dem iPhone">
</p>

## Worum es geht

In der Konfizeit passiert viel: Gottesdienste, Freizeiten, Projekte, das
Mitarbeiten in der Gemeinde. Konfi Quest hält fest, wer wobei dabei war —
nicht als Pflichtheft, sondern als etwas, das man gern in die Hand nimmt.

Konfis sammeln Punkte für Gottesdienste und für die Gemeinde, melden sich zu
Events an, stellen sich Challenges, sammeln Badges und bekommen am Ende des
Jahres einen Rückblick auf ihre Konfizeit. Teamer:innen begleiten ihre
Gruppen. Die Leitung verwaltet Jahrgänge, gibt Anträge frei und behält den
Überblick — auch über mehrere Gemeinden hinweg, sauber voneinander getrennt.

- **App Store:** [Konfi Quest laden](https://apps.apple.com/de/app/konfi-quest/id6748016619)
- **Google Play:** [Konfi Quest laden](https://play.google.com/store/apps/details?id=de.godsapp.konfiquest)
- **Im Browser:** [konfi-quest.de](https://konfi-quest.de)
- **Handbuch:** [konfi-quest.de/docs](https://konfi-quest.de/docs/)

## Über dieses Repository

Hier steht der Quelltext von Konfi Quest **zum Stand jeder veröffentlichten
Version** — ein Commit je Release, mit Tag und Release-Notiz. Wer nachlesen
will, wie die App arbeitet, welche Daten sie verarbeitet und wie sie
gesichert ist, findet hier den Code, der in den Stores und im Browser läuft.

Entwickelt wird in einem nicht öffentlichen Arbeitsrepository. Von dort
kommt nur der Code hierher: Backend, Oberfläche, die nativen Hüllen für iOS
und Android und das Grundschema der Datenbank. Nicht dabei sind die Tests,
die Werkzeuge für Build und Betrieb, Planung und Doku sowie interne
Anmerkungen in Kommentaren (Verweise auf interne Unterlagen, Namen, Daten). Die
Erklärungen, warum der Code so ist, wie er ist, bleiben stehen.

Was sich je Version geändert hat, steht unter
[Releases](../../releases).

## Aufbau

```
├── frontend/          — Ionic 9 + React 19, TypeScript
│   ├── src/
│   │   ├── components/  — nach Rolle getrennt: konfi, teamer, admin, shared
│   │   ├── contexts/    — App-Zustand, Badges, Anmeldung
│   │   └── services/    — API, Offline-Warteschlange, Biometrie, Push
│   └── ios/ · android/  — Capacitor
├── backend/           — Node und Express, PostgreSQL
│   ├── routes/          — nach Bereich getrennt, Rechte je Route
│   ├── services/        — Push, Badges, Rückblick, E-Mail
│   └── migrations/      — additiv, nie zerstörend
└── init-scripts/      — Grundschema einer neuen Instanz
```

## Selbst ausprobieren

Zum Ausprobieren auf dem eigenen Rechner — die Lizenz erlaubt das. Nötig
sind Node (die Fassung steht in `.nvmrc`), npm und PostgreSQL 15 oder 16.

**1. Datenbank anlegen.** Das Grundschema kommt aus `init-scripts/`; die
Migrationen unter `backend/migrations/` führt der Server beim Start aus.

```bash
createdb konfi_quest
psql -d konfi_quest -f init-scripts/01-create-schema.sql
psql -d konfi_quest -f init-scripts/02-migrationsstand.sql
```

**2. Backend starten.** Es liest keine `.env`-Datei — die Variablen müssen
in der Umgebung stehen. Ohne `JWT_SECRET` und `QR_SECRET` beendet sich der
Server sofort.

```bash
cd backend && npm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/konfi_quest
JWT_SECRET=$(openssl rand -hex 32) \
QR_SECRET=$(openssl rand -hex 32) \
ACTIVITY_PHOTO_ENCRYPTION_KEY=$(openssl rand -hex 32) \
npm start
# hört auf Port 5000 — Probe: curl http://localhost:5000/api/health
```

Für Benachrichtigungen und E-Mail kommen Firebase- und SMTP-Zugangsdaten
dazu; ohne sie läuft alles andere weiter, es wird nur nichts verschickt.

**3. Ein erstes Konto.** Eine frische Datenbank ist leer. Das erste Konto
legt `backend/scripts/ersteinrichtung.js` an, nachdem der Server einmal
gestartet ist; danach im Browser anmelden und dort die erste Gemeinde
anlegen.

```bash
cd backend && ERST_BENUTZERNAME=admin ERST_PASSWORT='…' ERST_ANZEIGENAME='Support' \
node scripts/ersteinrichtung.js
```

**4. Oberfläche starten.** Ohne eigene Adresse spricht sie die
Produktions-API an; für den lokalen Server die Adresse mitgeben.

```bash
cd frontend && npm install
VITE_API_URL=http://localhost:5000/api npm run dev
# öffnet http://localhost:5173
```

## Sicherheitslücken melden

Bitte **nicht** als Issue, sondern vertraulich: im Repository unter
**Security → Report a vulnerability** oder per Mail an
[moin@konfi-quest.de](mailto:moin@konfi-quest.de). Konfi Quest verarbeitet
Daten von Jugendlichen; eine öffentlich beschriebene Lücke gefährdet alle
Gemeinden gleichzeitig. Bitte nur mit eigenen Konten prüfen und keine Last-
oder Zerstörungstests gegen den Betrieb.

## Lizenz

**Quelloffen zur Einsicht — Nutzung nur mit schriftlicher Erlaubnis.**
Der vollständige Text steht in [LICENSE](LICENSE).

- **Ohne Weiteres erlaubt:** lesen, herunterladen, studieren, zu Lern- und
  Prüfzwecken auf eigenen Geräten ausführen, Sicherheitslücken melden,
  darüber berichten.
- **Braucht eine Vereinbarung:** der Betrieb für echte Nutzer:innen, die
  Weitergabe an Dritte, die Verwendung von Teilen des Codes in anderer
  Software — unabhängig davon, ob damit Geld verdient wird.

Sie möchten Konfi Quest in Ihrer Gemeinde einsetzen? Schreiben Sie an
[moin@konfi-quest.de](mailto:moin@konfi-quest.de), das lässt sich regeln.

## Kontakt

Pastor Simon Luthe · [moin@konfi-quest.de](mailto:moin@konfi-quest.de) ·
[konfi-quest.de](https://konfi-quest.de)
