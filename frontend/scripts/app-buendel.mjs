/**
 * Das App-Bündel: was die nativen Apps (iOS, Android) aus dem Web-Build
 * mitnehmen.
 *
 * WARUM ES EIN EIGENES VERZEICHNIS GIBT
 *
 * Jetzt legt derselbe `vite build` daneben dist-app/ an, und NUR das nimmt
 * Capacitor (`webDir: 'dist-app'`). Das greift ohne jede Workflow-Änderung
 * überall, wo gebaut wird: in beiden Release-Workflows (`npm run build` →
 * `npx cap sync`), beim lokalen `npx cap sync` nach einem Build und bei
 * `npx vite build` allein. Vergessen lässt es sich nicht: Ohne Build fehlt
 * dist-app/, und `cap sync` bricht mit "Could not find the web assets
 * directory" ab, statt still das Web-Verzeichnis einzupacken.
 *
 * WAS HINEIN DARF — eine Positivliste
 *
 * Alles, was Vite selbst erzeugt (index.html, die gehashten Skripte und
 * Stile unter assets/, Worker, wasm), kommt immer mit. Von den Dateien, die
 * Vite nur unverändert aus public/ kopiert, kommt NUR mit, was unten in
 * APP_DATEIEN_AUS_PUBLIC steht. Eine neue Datei in public/ ist damit
 * zunächst reine Web-Datei. Braucht die App sie, schlägt der Test
 * appBuendel.test.ts an (er sucht die Pfade im App-Quelltext) — ein
 * fehlendes Bild in der App fällt also nicht erst am Gerät auf.
 *
 * WAS NIE HINEIN DARF, egal was in der Liste steht: docs/ und jede
 * HTML-Datei außer index.html. Dazu eine Obergrenze in Bytes. Beides prüft
 * appBuendelPruefen(); der Build bricht ab, wenn es nicht stimmt, und die
 * Release-Workflows prüfen nach `cap sync` noch einmal die Kopie im
 * nativen Projekt (scripts/app-buendel-pruefen.mjs).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Verzeichnis neben frontend/dist, das Capacitor als webDir nimmt. */
export const APP_VERZEICHNIS = 'dist-app';

/**
 * Obergrenze für das App-Bündel in Bytes.
 */
export const APP_BUDGET_BYTES = 11_000_000;

/**
 * Obergrenze für das, was die Seite beim START lädt — gzip, wie es über die
 * Leitung geht.
 */
export const START_BUDGET_GZIP_BYTES = 600_000;

/**
 * Dateien aus public/, die die App selbst lädt. Pfade relativ zu public/,
 * mit "/" am Ende für ein ganzes Verzeichnis.
 */
export const APP_DATEIEN_AUS_PUBLIC = [
  // Hülle von index.html (<link rel=manifest/icon/apple-touch-icon>). Die
  // WebView fragt sie nicht zwingend an, aber index.html verweist darauf —
  // mitgenommen, damit dort nichts ins Leere zeigt. Zusammen 37 kB.
  'manifest.json',
  'apple-touch-icon.png',
  'assets/icon/favicon-16x16.png',
  'assets/icon/favicon-32x32.png',
  // Lutherrose auf Anmeldung, Ladebildschirm, Sperre, Fehlerseite, Tour.
  'assets/icon/logo-mark.png',
  // Absender-Symbol auf der Teilen-Karte des Rückblicks (ShareCard).
  'assets/icon/icon-192x192.png',
  // Taube im Fuß der Seiten (SpiritFooter).
  'assets/branding/bird.png',
  // Hintergründe des Rückblicks (wrapped/hintergrundbilder.ts).
  'assets/wrapped/',
];

/** Pfad mit "/" als Trenner, unabhängig vom Betriebssystem. */
const alsPosix = (pfad) => pfad.split(sep).join('/');

/** Alle Dateien unter `verzeichnis`, relativ und mit "/" getrennt, sortiert. */
export function alleDateien(verzeichnis) {
  const liste = [];
  const lauf = (ordner) => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const voll = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) lauf(voll);
      else if (eintrag.isFile()) liste.push(alsPosix(relative(verzeichnis, voll)));
    }
  };
  if (existsSync(verzeichnis)) lauf(verzeichnis);
  return liste.sort();
}

/** Steht die public/-Datei auf der Positivliste? */
export function istAppDateiAusPublic(pfad) {
  return APP_DATEIEN_AUS_PUBLIC.some((eintrag) =>
    eintrag.endsWith('/') ? pfad.startsWith(eintrag) : pfad === eintrag);
}

/**
 * Welche Dateien aus `dist` ins App-Bündel gehören: alles, was Vite erzeugt
 * hat, plus die freigegebenen public/-Dateien. Erkannt wird eine public/-
 * Datei daran, dass sie unter demselben Pfad in `publicVerzeichnis` liegt.
 */
export function appDateien(distVerzeichnis, publicVerzeichnis) {
  const ausPublic = new Set(publicVerzeichnis ? alleDateien(publicVerzeichnis) : []);
  return alleDateien(distVerzeichnis).filter((pfad) =>
    !ausPublic.has(pfad) || istAppDateiAusPublic(pfad));
}

/**
 * Was nie ins App-Bündel darf, unabhängig von der Liste oben: das Handbuch
 * samt API-Referenz (docs/) und jede eigene HTML-Seite außer der App selbst
 * (Werbeseite, Datenschutz, Impressum, Konto löschen).
 */
export function istNurWeb(pfad) {
  if (pfad === 'docs' || pfad.startsWith('docs/')) return true;
  if (pfad.endsWith('.html') && pfad !== 'index.html') return true;
  return false;
}

/**
 * Prüft ein fertiges App-Bündel (dist-app/ oder die Kopie im nativen
 * Projekt). Liefert die Fehler als Liste; leer heißt in Ordnung.
 *
 * `publicVerzeichnis` (optional): Dann gilt zusätzlich, dass jede Datei, die
 * es unter demselben Pfad in public/ gibt, auf der Positivliste stehen muss
 * — so fällt auch ein Rückfall auf `webDir: 'dist'` in der nativen Kopie auf.
 */
/**
 * Was index.html beim Start lädt: das Einstiegsskript, jede modulepreload-
 * Datei und die Stile. Liefert die Pfade und die Summe roh und gzip.
 */
export function startGroesse(verzeichnis) {
  const html = readFileSync(join(verzeichnis, 'index.html'), 'utf8');
  const dateien = [...new Set([...html.matchAll(/<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)="\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
  let roh = 0;
  let gzip = 0;
  for (const pfad of dateien) {
    const daten = readFileSync(join(verzeichnis, pfad));
    roh += daten.length;
    gzip += gzipSync(daten, { level: 9 }).length;
  }
  return { dateien, roh, gzip };
}

/**
 * @param {string} verzeichnis
 * @param {{ budget?: number, startBudget?: number, publicVerzeichnis?: string }} [optionen]
 */
export function appBuendelPruefen(verzeichnis, { budget = APP_BUDGET_BYTES, startBudget = START_BUDGET_GZIP_BYTES, publicVerzeichnis } = {}) {
  const fehler = [];
  if (!existsSync(join(verzeichnis, 'index.html'))) {
    fehler.push(`${verzeichnis}: index.html fehlt — ist das ein App-Bündel?`);
    return fehler;
  }
  const ausPublic = new Set(publicVerzeichnis ? alleDateien(publicVerzeichnis) : []);
  let bytes = 0;
  for (const pfad of alleDateien(verzeichnis)) {
    bytes += statSync(join(verzeichnis, pfad)).size;
    if (istNurWeb(pfad)) {
      fehler.push(`${pfad}: gehört nur ins Web, nicht in die App`);
    } else if (ausPublic.has(pfad) && !istAppDateiAusPublic(pfad)) {
      fehler.push(`${pfad}: Web-Datei aus public/, steht nicht auf der Liste der App-Dateien`);
    }
  }
  if (bytes > budget) {
    fehler.push(`App-Bündel ist ${bytes} Bytes groß, erlaubt sind ${budget} (APP_BUDGET_BYTES in scripts/app-buendel.mjs)`);
  }
  const start = startGroesse(verzeichnis);
  if (start.gzip > startBudget) {
    fehler.push(`Start lädt ${start.dateien.length} Dateien, ${start.gzip} Bytes gzip, erlaubt sind ${startBudget} (START_BUDGET_GZIP_BYTES in scripts/app-buendel.mjs)`);
  }
  return fehler;
}

export function appBuendelErzeugen(distVerzeichnis, publicVerzeichnis) {
  const ziel = `${distVerzeichnis}-app`;
  rmSync(ziel, { recursive: true, force: true });
  let bytes = 0;
  const dateien = appDateien(distVerzeichnis, publicVerzeichnis);
  for (const pfad of dateien) {
    const nach = join(ziel, pfad);
    mkdirSync(dirname(nach), { recursive: true });
    cpSync(join(distVerzeichnis, pfad), nach);
    bytes += statSync(nach).size;
  }
  const fehler = appBuendelPruefen(ziel, { publicVerzeichnis });
  if (fehler.length) {
    throw new Error(`App-Bündel ${ziel} ist nicht in Ordnung:\n  ${fehler.join('\n  ')}`);
  }
  return { ziel, dateien: dateien.length, bytes };
}

/**
 * Vite-Plugin: legt nach jedem Produktions-Build das App-Bündel an. Nur beim
 * Bauen, nicht im Entwicklungsserver und nicht in Vitest.
 */
export function appBuendelPlugin() {
  let outDir = '';
  let publicDir = '';
  return {
    name: 'konfi-app-buendel',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      publicDir = config.publicDir || '';
    },
    closeBundle() {
      // Bei einem abgebrochenen Build gibt es kein index.html — dann nichts
      // anlegen, der eigentliche Fehler steht schon im Log.
      if (!existsSync(join(outDir, 'index.html'))) return;
      const { ziel, dateien, bytes } = appBuendelErzeugen(outDir, publicDir);
      const start = startGroesse(ziel);
      console.log(`App-Bündel: ${relative(process.cwd(), ziel) || ziel} — ${dateien} Dateien, ${bytes} Bytes (Grenze ${APP_BUDGET_BYTES}); `
        + `Start ${start.dateien.length} Dateien, ${start.roh} Bytes, gzip ${start.gzip} (Grenze ${START_BUDGET_GZIP_BYTES})`);
    },
  };
}

/** frontend/ (für die Skripte, die ohne Vite laufen). */
export const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
