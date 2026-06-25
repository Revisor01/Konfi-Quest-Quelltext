import { Preferences } from '@capacitor/preferences';

/**
 * Einmalige Migration von localStorage nach Capacitor Preferences.
 * localStorage-Keys werden NICHT gelöscht (Fallback für Rollback).
 */
export const migrateToPreferences = async (): Promise<void> => {
  try {
    // Prüfe ob Migration bereits durchgeführt wurde
    const migrated = await Preferences.get({ key: 'storage_migrated_v1' });
    if (migrated.value) {
      return;
    }

    // 4 Keys migrieren
    const keys = ['konfi_token', 'konfi_user', 'device_id', 'push_token_last_refresh'];

    for (const key of keys) {
      const val = localStorage.getItem(key);
      if (val) {
        await Preferences.set({ key, value: val });
      }
    }

    // Migration als erledigt markieren
    await Preferences.set({ key: 'storage_migrated_v1', value: 'true' });
  } catch (err) {
    // Bei Fehler nur loggen — App soll trotzdem starten
    console.error('Storage-Migration fehlgeschlagen:', err);
  }
};
