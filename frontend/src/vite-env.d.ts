/// <reference types="vite/client" />

// Zur Bauzeit aus version.json eingesetzt (vite.config.ts, `define`).
// Browser-Rueckfallebene fuer utils/appVersion.ts -- auf dem Geraet kommt
// die Version aus App.getInfo().
declare const __APP_VERSION__: string;
