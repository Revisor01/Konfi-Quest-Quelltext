import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { migrateToPreferences } from './services/migrateStorage';
import { initTokenStore } from './services/tokenStore';
import { globaleFehlerkanaeleAnhaengen, diagnoseStarten } from './services/absturzdiagnose';
import { tempDateienAufraeumen } from './utils/nativeFileViewer';

// KEINE Messung an dieser Stelle — und das ist Absicht.
//
// Jetzt sauber getrennt:
//   Anwendung   -> services/analytics.ts, eigene Kennung, ohne Personenbezug
//   Werbeseiten -> eigene <script>-Zeile in public/landing.html und den drei
//                  weiteren statischen Seiten, unveraendert
//
// Die Werbeseiten brauchen von hier nichts: sie sind statisches HTML und
// laden ihr Script selbst. Die native App misst weiterhin ueber
// analytics.ts, das zur Laufzeit ohnehin nur in Produktion sendet.

// Globale Fehlerkanaele ALS ERSTES anhaengen — vor dem Vorbereiten und vor dem
// ersten render().
//
// DIE LUECKE: Das Projekt hatte weder einen `unhandledrejection`- noch einen
// `window.onerror`-Handler. Eine abgelehnte Promise ohne catch verschwand
// damit vollstaendig — kein Eintrag, keine Meldung. Genau die weisse Seite
// beim Start war so ein Fall: Das Log endete, und niemand
// erfuhr, woran.
//
// Hier oben, weil die beiden Schritte darunter (Migration, Token-Store) selbst
// Kandidaten fuer eine unbehandelte Ablehnung sind. Der Aufruf ist im Browser
// harmlos: die Handler werden gesetzt, melden dort aber nichts (no-op).
globaleFehlerkanaeleAnhaengen();

// Die Wahl "Absturzberichte senden" aus dem Profil an Crashlytics geben --
// ohne await, der Start haengt an nichts (siehe unten). Ist sie aus, verwirft
// das die Berichte, die noch auf dem Geraet liegen, bevor Crashlytics sie
// hinausschickt (services/absturzdiagnose.ts, ABSCHALTBARKEIT). Im Browser
// ein no-op.
void diagnoseStarten();

const container = document.getElementById('root');
const root = createRoot(container!);

// Jetzt: Fehler abfangen (die App startet dann ohne wiederhergestellte
// Sitzung, also auf dem Login) und ein hartes Zeitlimit, damit ein
// haengendes Preferences-Plugin den Start nicht blockiert. Gerendert wird
// in JEDEM Fall.
const mitZeitlimit = <T,>(p: Promise<T>, ms: number): Promise<T | void> =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);

(async () => {
  try {
    await mitZeitlimit(migrateToPreferences(), 4000);
  } catch (err) {
    console.error('Storage-Migration beim Start fehlgeschlagen:', err);
  }
  try {
    await mitZeitlimit(initTokenStore(), 4000);
  } catch (err) {
    console.error('Token-Store beim Start fehlgeschlagen:', err);
  }
  root.render(
    // <React.StrictMode>  // Temporarily disabled to avoid double routing in development
      <App />
    // </React.StrictMode>
  );

  void tempDateienAufraeumen();
})();