import { useCallback, useEffect, useState } from 'react';
import { useIonAlert } from '@ionic/react';
import { clearMediaCache, getMediaCacheSize } from '../services/mediaCache';
import { formatFileSize } from '../utils/helpers';

// Gemeinsame Logik für den "Medien-Cache leeren"-Eintrag in allen Profil-Seiten
// (Konfi/Teamer/Admin). Liefert die belegte Größe (formatiert) und einen
// Handler, der nach Bestaetigung den Medien-Cache löscht — Chat, Challenges
// und Material zusammen, es ist EIN Cache.
export function useMediaCacheControl() {
  const [presentAlert] = useIonAlert();
  const [cacheSize, setCacheSize] = useState<number>(0);

  const reload = useCallback(async () => {
    try {
      setCacheSize(await getMediaCacheSize());
    } catch {
      setCacheSize(0);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const clear = useCallback(() => {
    presentAlert({
      header: 'Cache leeren',
      message: 'Gespeicherte Bilder, Videos und Dateien aus Chat, Challenges und Material werden vom Gerät gelöscht. Sie werden bei Bedarf neu geladen.',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Leeren',
          role: 'destructive',
          handler: async () => {
            await clearMediaCache();
            await reload();
          },
        },
      ],
    });
  }, [presentAlert, reload]);

  const label = cacheSize > 0 ? `${formatFileSize(cacheSize)} gespeichert` : 'Keine Medien gespeichert';

  return { cacheSize, cacheLabel: label, clearMediaCache: clear, reloadCacheSize: reload };
}
