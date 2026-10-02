import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bleibtAufDemGeraet,
  getCachedObjectUrl,
  getMediaBlob,
  getMediaObjectUrl,
  istGecacht,
  type MedienQuelle,
} from '../services/mediaCache';
import { networkMonitor } from '../services/networkMonitor';

// Ein Medium aus einer geschützten Route laden und anzeigen — für Chat,
// Challenges und die Nachweisfotos der Anträge derselbe Weg.
//
// Vorher hatte jede Anzeige ihren eigenen Lader: LazyImage und VideoPreview
// im Chat (mit Cache), dazu drei Challenge-Lader ohne Cache, ohne
// Fortschritt, ohne zweiten Versuch. Jetzt kommen Laden, Fortschritt,
// Fehler, zweiter Versuch und das Verhalten ohne Netz aus diesem Hook.

/**
 * - `wartet`: noch nicht angestoßen (Lazy-Load, noch nicht sichtbar)
 * - `laedt`: Download läuft oder der Cache wird gelesen
 * - `bereit`: `url` zeigt auf das Medium
 * - `fehler`: der Server hat es nicht geliefert — erneut versuchen möglich
 * - `offline`: kein Netz und nicht auf dem Gerät; lädt von selbst, sobald
 *   wieder Netz da ist
 * - `weg`: der Server liefert die Datei für diese Person nicht mehr
 *   (gelöscht oder kein Zugriff mehr) — ein zweiter Versuch hilft nicht
 */
export type MedienZustand = 'wartet' | 'laedt' | 'bereit' | 'fehler' | 'offline' | 'weg';

export interface MedienDateiOptionen {
  quelle: MedienQuelle;
  /**
   * Eigener Blob mit diesem Typ (Video, Tonaufnahme) statt der geteilten
   * Object-URL des Caches. Die Wiedergabe braucht den richtigen Typ; der
   * Cache kennt ihn nicht, weil die Server Dateinamen ohne Endung vergeben.
   * Liefert der Server selbst einen brauchbaren Typ, gilt der.
   */
  typ?: string;
  /** false: erst laden, wenn `laden()` gerufen wird (Lazy-Load). */
  sofort?: boolean;
  /** Siehe MedienAbruf.netzZuerst — für eingefrorene Listen (Rückblick). */
  netzZuerst?: boolean;
  /** Wird bei einem Fehlschlag gerufen (nicht nach dem Abhängen). */
  onFehler?: () => void;
}

export interface MedienDatei {
  url: string;
  zustand: MedienZustand;
  /** Download-Fortschritt in Prozent; null, solange keine Größe bekannt ist. */
  prozent: number | null;
  /** true, wenn das Medium schon beim ersten Zeichnen aus dem Speicher kam. */
  sofortDa: boolean;
  laden: () => void;
  erneutVersuchen: () => void;
}

export function useMedienDatei(
  datei: string | null | undefined,
  { quelle, typ, sofort = true, netzZuerst = false, onFehler }: MedienDateiOptionen
): MedienDatei {
  // Geteilte Object-URL nur ohne eigenen Typ und ohne "Netz zuerst" — die
  // geteilte URL überdauert das Abhängen und würde den Server sonst beim
  // nächsten Mal nicht mehr fragen. Nachweisfotos nie (bleibtAufDemGeraet):
  // Ihre URL gehört der Anzeige und geht beim Schließen mit.
  const geteilt = !typ && !netzZuerst && bleibtAufDemGeraet(quelle);

  // Synchron prüfen, ob das Medium schon im Speicher liegt: dann ist es beim
  // ERSTEN Zeichnen da — ohne Ladeanzeige, ohne Springen beim Scrollen.
  const [sofortUrl] = useState(() => (geteilt && datei ? getCachedObjectUrl(datei, quelle) : null));
  const [url, setUrl] = useState<string>(sofortUrl || '');
  const [zustand, setZustand] = useState<MedienZustand>(sofortUrl ? 'bereit' : 'wartet');
  const [prozent, setProzent] = useState<number | null>(null);
  const [angestossen, setAngestossen] = useState<boolean>(sofort);
  const [versuch, setVersuch] = useState(0);

  const onFehlerRef = useRef(onFehler);
  onFehlerRef.current = onFehler;

  useEffect(() => {
    if (!datei || !angestossen) return;

    if (geteilt) {
      const schon = getCachedObjectUrl(datei, quelle);
      if (schon) {
        setUrl(schon);
        setZustand('bereit');
        return;
      }
    }

    // Abbruch-Merker: Ohne ihn las das
    // Aufräumen die eigene URL aus dem Effekt-Umfang, während der Download
    // noch lief — die danach erzeugte URL wurde nie freigegeben. Außerdem
    // meldete der Fehlerzweig Fehler für eine Anzeige, die längst weg ist.
    let cancelled = false;
    let eigeneUrl = '';

    const ladeVorgang = async () => {
      setZustand('laedt');
      setProzent(null);

      // Ohne Netz gar nicht erst fragen, wenn nichts auf dem Gerät liegt:
      // Sonst stünde die Ladeanzeige bis zum Zeitlimit (180 s) da.
      if (!networkMonitor.isOnline && !(await istGecacht(datei, quelle))) {
        if (!cancelled) setZustand('offline');
        return;
      }

      const abruf = {
        quelle,
        netzZuerst,
        onFortschritt: (p: number | null) => { if (!cancelled) setProzent(p); },
      };

      try {
        if (geteilt) {
          const geteilteUrl = await getMediaObjectUrl(datei, abruf);
          if (cancelled) return;
          setUrl(geteilteUrl);
        } else {
          const blob = await getMediaBlob(datei, abruf);
          const blobTyp = blob.type && blob.type !== 'application/octet-stream' ? blob.type : typ;
          eigeneUrl = URL.createObjectURL(blobTyp ? new Blob([blob], { type: blobTyp }) : blob);
          // Während des Ladens abgehängt: die eben erzeugte URL sofort wieder
          // freigeben und nichts mehr in einen toten Zustand schreiben.
          if (cancelled) {
            URL.revokeObjectURL(eigeneUrl);
            eigeneUrl = '';
            return;
          }
          setUrl(eigeneUrl);
        }
        setZustand('bereit');
      } catch (error) {
        if (cancelled) return;
        console.warn('Medium konnte nicht geladen werden:', quelle, error);
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 403 || status === 404 || status === 410) {
          setZustand('weg');
        } else {
          setZustand(networkMonitor.isOnline ? 'fehler' : 'offline');
        }
        onFehlerRef.current?.();
      }
    };
    void ladeVorgang();

    return () => {
      cancelled = true;
      if (eigeneUrl) URL.revokeObjectURL(eigeneUrl);
    };
  }, [datei, quelle, typ, netzZuerst, geteilt, angestossen, versuch]);

  // Ohne Netz gescheitert: von selbst neu laden, sobald das Netz zurück ist.
  useEffect(() => {
    if (zustand !== 'offline') return;
    return networkMonitor.subscribe((online) => {
      if (online) setVersuch((v) => v + 1);
    });
  }, [zustand]);

  const laden = useCallback(() => setAngestossen(true), []);
  const erneutVersuchen = useCallback(() => {
    setAngestossen(true);
    setVersuch((v) => v + 1);
  }, []);

  return { url, zustand, prozent, sofortDa: !!sofortUrl, laden, erneutVersuchen };
}
