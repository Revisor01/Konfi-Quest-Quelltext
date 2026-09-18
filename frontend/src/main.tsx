import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { migrateToPreferences } from './services/migrateStorage';
import { initTokenStore } from './services/tokenStore';
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