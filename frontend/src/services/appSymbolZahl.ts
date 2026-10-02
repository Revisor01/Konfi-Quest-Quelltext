import { Capacitor, registerPlugin } from '@capacitor/core';

/*
 * Zahl am App-Symbol auf Android.
 *
 * Deshalb setzt auf Android die App selbst die Zahl, ueber das eigene Plugin
 * AppSymbolZahl (frontend/android/.../AppSymbolZahl.java). Dieselbe Stelle
 * benutzt der Push-Dienst der App bei geschlossener App
 * (KonfiMessagingService, stilles badge_update). Welcher Weg zum
 * Startbildschirm passt, bestimmt das Plugin und meldet die App bei der
 * Token-Anmeldung an den Server (backend/utils/appSymbolWeg.js):
 *
 *   anbieter      der Startbildschirm nimmt eine Zahl von der App an
 *   mitteilungen  er rechnet die Zahl aus den liegenden Mitteilungen
 *   punkt         kein bekannter Weg zu einer Zahl
 *
 * iOS bleibt, wie es ist (BadgeContext ruft dort weiter das Badge-Plugin).
 */

export type AppSymbolWeg = 'anbieter' | 'mitteilungen' | 'punkt';

const WEGE: readonly string[] = ['anbieter', 'mitteilungen', 'punkt'];

interface AppSymbolZahlPlugin {
  art(): Promise<{ weg?: string; startbildschirm?: string }>;
  setzen(optionen: { zahl: number }): Promise<void>;
}

// Erst beim ersten Gebrauch anmelden, nicht beim Laden des Moduls: Die
// Kontext-Tests ersetzen @capacitor/core durch eine Attrappe ohne
// registerPlugin, und ein Aufruf auf Modulebene braeche dort jeden Import.
let nativ: AppSymbolZahlPlugin | null = null;
const plugin = (): AppSymbolZahlPlugin => {
  if (!nativ) nativ = registerPlugin<AppSymbolZahlPlugin>('AppSymbolZahl');
  return nativ;
};

/**
 * Laeuft die App auf Android mit dem eigenen Plugin? Nur dann gilt der
 * Android-Weg; sonst (iOS, Browser) bleibt es beim Badge-Plugin.
 */
export const appSymbolZahlNativ = (): boolean =>
  Capacitor.getPlatform?.() === 'android' && Capacitor.isPluginAvailable?.('AppSymbolZahl') === true;

/**
 * Setzt die Zahl am App-Symbol auf Android. Negative und gebrochene Werte
 * werden zu ganzen Zahlen ab 0.
 */
export const appSymbolZahlSetzen = async (zahl: number): Promise<void> => {
  if (!appSymbolZahlNativ()) return;
  const ganz = Math.max(0, Math.floor(Number(zahl) || 0));
  await plugin().setzen({ zahl: ganz });
};

/**
 * Die Angaben fuer die Token-Anmeldung (POST /notifications/device-token):
 * Weg und Startbildschirm, nur auf Android. Schlaegt die Abfrage fehl, fehlen
 * die Felder -- der Server behandelt das Geraet dann wie bisher. Die
 * Anmeldung des Push-Tokens darf daran nie scheitern.
 */
export const appSymbolAngaben = async (): Promise<{ app_symbol_weg?: AppSymbolWeg; startbildschirm?: string }> => {
  if (!appSymbolZahlNativ()) return {};
  try {
    const { weg, startbildschirm } = await plugin().art();
    return {
      ...(typeof weg === 'string' && WEGE.includes(weg) ? { app_symbol_weg: weg as AppSymbolWeg } : {}),
      ...(typeof startbildschirm === 'string' && startbildschirm ? { startbildschirm } : {}),
    };
  } catch {
    return {};
  }
};
