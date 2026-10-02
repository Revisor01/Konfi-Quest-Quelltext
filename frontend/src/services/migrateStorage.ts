import { Preferences } from '@capacitor/preferences';

/** Die vier Schluessel, die vor storage_migrated_v1 im localStorage lagen. */
const ALTE_SCHLUESSEL = ['konfi_token', 'konfi_user', 'device_id', 'push_token_last_refresh'];

/**
 * Entfernt die Originale der migrierten Schluessel aus dem localStorage.
 *
 * `nurAnmeldung` laesst `device_id` stehen -- das Abmelden behaelt die
 * Geraetekennung (tokenStore.clearAuth).
 */
export const alteSchluesselEntfernen = (optionen: { nurAnmeldung?: boolean } = {}): void => {
  try {
    for (const key of ALTE_SCHLUESSEL) {
      if (optionen.nurAnmeldung && key === 'device_id') continue;
      localStorage.removeItem(key);
    }
  } catch {
    // Kein localStorage (gesperrt, privater Modus): nichts aufzuraeumen.
  }
};

/**
 * Einmalige Migration von localStorage nach Capacitor Preferences.
 * Nach erfolgreicher Migration werden die Originale entfernt -- auch auf
 * Geraeten, die frueher schon migriert wurden. Scheitert die Migration,
 * bleiben sie stehen und der naechste Start versucht es erneut.
 */
export const migrateToPreferences = async (): Promise<void> => {
  try {
    // Prüfe ob Migration bereits durchgeführt wurde
    const migrated = await Preferences.get({ key: 'storage_migrated_v1' });
    if (migrated.value) {
      alteSchluesselEntfernen();
      return;
    }

    for (const key of ALTE_SCHLUESSEL) {
      const val = localStorage.getItem(key);
      if (val) {
        await Preferences.set({ key, value: val });
      }
    }

    // Migration als erledigt markieren
    await Preferences.set({ key: 'storage_migrated_v1', value: 'true' });
    alteSchluesselEntfernen();
  } catch (err) {
    // Bei Fehler nur loggen — App soll trotzdem starten
    console.error('Storage-Migration fehlgeschlagen:', err);
  }
};
