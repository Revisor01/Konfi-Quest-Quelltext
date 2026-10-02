import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
// defineConfig aus vitest/config: Es kennt den Block `test` unten. Das
// frühere `/// <reference types="vitest" />` hängt die Typen seit Vitest 4
// nicht mehr ein, `tsc -p tsconfig.test.json` meldete den Block als Fehler.
import { defineConfig } from 'vitest/config'
import { appBuendelPlugin } from './scripts/app-buendel.mjs'

// Version aus version.json zur Bauzeit einsetzen (__APP_VERSION__).
// Gebraucht von utils/appVersion.ts als Browser-Rueckfallebene: Dort gibt es
// kein App.getInfo(), und der ausgelieferte Web-Build IST die laufende
// Version. version.json ist die eine Stelle, die scripts/apply-version.sh
// pflegt -- die Zahl wird hier NICHT zusaetzlich gepflegt.
const versionsDatei = fileURLToPath(new URL('./version.json', import.meta.url))
const appVersion = JSON.parse(readFileSync(versionsDatei, 'utf8')).version as string

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Legt nach dem Build dist-app/ an: das Bündel fuer die nativen Apps,
    // ohne Handbuch, API-Referenz, Werbeseite und Rechtstexte.
    // Capacitor nimmt nur dieses Verzeichnis
    // (capacitor.config.ts, webDir). dist/ bleibt die Web-Auslieferung.
    // Was hinein darf und warum: scripts/app-buendel.mjs.
    appBuendelPlugin(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    // Vites Warnung "Some chunks are larger than 500 kB" angehoben
    // Der eine grosse Chunk (1.405.726
    // Bytes) ist zu 1,02 MB die Komponenten-Bibliothek von Ionic, die
    // @ionic/react beim Start vollstaendig laedt -- ihn zu teilen aenderte
    // nichts an der Menge, die der Start braucht. Die Summe des Starts
    // bewacht START_BUDGET_GZIP_BYTES in scripts/app-buendel.mjs (der Build
    // bricht dort ab). Die Grenze hier warnt, wenn der Chunk noch waechst.
    chunkSizeWarningLimit: 1500,
  },
  // Worker als ES-Modul bündeln. Einziger Worker über Vite ist
  // der von pdf.js (utils/pdfDokument.ts, ?worker&url). pdf.js startet ihn mit
  // `new Worker(url, { type: 'module' })`, und der Worker selbst ist ein
  // ES-Modul mit export und import.meta.url — das Vite-Standardformat iife
  // passt dazu nicht.
  worker: {
    format: 'es',
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Der Bonjour-Name des Entwicklungsrechners muss hier stehen, sonst
    // antwortet Vite mit 403 (Host-Pruefung) -- am Geraet sieht das aus wie
    // ein weisser Bildschirm. Der Name ist der stabile Weg fuer CAP_LIVE_URL:
    // Die IP wechselt bei jedem Netzwechsel (WLAN/Hotspot/USB) und macht dann
    // jedes Mal einen Neubau noetig, der Name bleibt gleich.
    // Eigenen Namen ermitteln: `scutil --get LocalHostName`.
    allowedHosts: ['.local'],
  },
  resolve: {
    alias: {
      /*
       * `firebase/messaging` gibt es bei uns absichtlich NICHT.
       *
       * @capacitor-firebase/messaging brauchen wir nur fuer den aktiven
       * Token-Abruf auf den GERAETEN — dort laeuft das native SDK. Sein
       * Web-Fallback (dist/esm/web.js) importiert `firebase/messaging` aber
       * statisch, und der Build zieht diesen Zweig mit hinein: fuenf
       * MISSING_EXPORT-Fehler, obwohl der Code nie ausgefuehrt wird.
       *
       * Statt das 37 MB schwere `firebase`-Paket aufzunehmen, zeigt der Alias
       * auf einen leeren Ersatz. Im Browser gibt es damit keine Push-Nachrichten
       * — die gab es dort ohnehin nie (Capacitor.isNativePlatform() sperrt
       * jeden Push-Weg in AppContext).
       */
      'firebase/messaging': fileURLToPath(
        new URL('./src/stubs/firebase-messaging-leer.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    env: {
      TZ: 'Europe/Berlin',
    },
    alias: {
      /*
       * Im Testlauf zusaetzlich auf die ESM-Fassung des Plugins zeigen.
       *
       * Vitest greift sonst zu dist/plugin.cjs.js, und die hat
       * `require('firebase/messaging')` UNBEDINGT am Dateianfang — der Alias
       * oben auf den leeren Ersatz greift bei einem CJS-require nicht. Alle
       * Tests, die AppContext importieren, brachen damit an "Cannot find
       * module 'firebase/messaging'".
       *
       * Die ESM-Fassung laedt den Web-Zweig nur dynamisch, sodass der Alias
       * oben greift, wenn er ueberhaupt gebraucht wird.
       */
      '@capacitor-firebase/messaging': fileURLToPath(
        new URL(
          './node_modules/@capacitor-firebase/messaging/dist/esm/index.js',
          import.meta.url,
        ),
      ),
    },
  }
})
