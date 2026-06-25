import { useCallback, useEffect, useState } from 'react';
import { useIonAlert } from '@ionic/react';
import { clearMediaCache, getMediaCacheSize } from '../services/mediaCache';
import { formatFileSize } from '../utils/helpers';

// Gemeinsame Logik fuer den "Medien-Cache leeren"-Eintrag in allen Profil-Seiten
// (Konfi/Teamer/Admin). Liefert die belegte Groesse (formatiert) und einen
// Handler, der nach Bestaetigung den Chat-Medien-Cache loescht.
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
      message: 'Gespeicherte Chat-Bilder und -Videos werden vom Gerät gelöscht. Sie werden bei Bedarf neu geladen.',
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
