import React, { useEffect, useRef } from 'react';
import type { MedienQuelle } from '../../services/mediaCache';
import { useMedienDatei } from '../../hooks/useMedienDatei';
import MedienPlatzhalter from '../shared/MedienPlatzhalter';
import { tastaturKlick } from '../../utils/tastatur';

interface LazyImageProps {
  filePath: string;
  fileName: string;
  onError?: () => void;
  onClick?: () => void;
  /** Woher das Bild kommt; ohne Angabe der Chat. */
  quelle?: MedienQuelle;
  /**
   * Volle Breite der Karte statt der Breite des Bildes (Challenge-Beiträge).
   * Im Chat steht das Bild so breit, wie es ist, in der Sprechblase.
   */
  vollbreite?: boolean;
  /** Höchste Höhe in px; im Chat 300. */
  maxHoehe?: number;
}

const LazyImage: React.FC<LazyImageProps> = ({
  filePath,
  fileName,
  onError,
  onClick,
  quelle = 'chat',
  vollbreite = false,
  maxHoehe = 300,
}) => {
  // Liegt das Bild bereits im Speicher, ist es schon beim ERSTEN Zeichnen da
  // -> kein Lazy-Load-Zwischenzustand, kein Ruckeln beim Hochscrollen. Nur
  // Bilder, die noch nicht geladen sind, warten auf das Sichtbarwerden (spart
  // Bandbreite beim allerersten Oeffnen).
  const { url: imageSrc, zustand, prozent, sofortDa, laden, erneutVersuchen } = useMedienDatei(filePath, {
    quelle,
    sofort: false,
    onFehler: onError,
  });
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Schon da (Speicher-Treffer) oder schon angestossen -> kein Beobachter.
    if (zustand !== 'wartet') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // Einmal (vor-)sichtbar -> laden, danach nicht mehr beobachten. So gibt
          // es kein wiederholtes Re-Triggern beim Scrollen.
          observer.disconnect();
          laden();
        }
      },
      // rootMargin grosszuegig: Bilder laden schon ~600px BEVOR sie in den
      // Viewport scrollen. Beim Hochscrollen ist das (gecachte) Bild dann meist
      // fertig -> kein sichtbarer Spinner->Bild-Sprung mehr.
      { threshold: 0.01, rootMargin: '600px 0px' }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
    // Die Object-URL wird NICHT freigegeben: Sie gehört dem geteilten Cache
    // und überlebt das Abhängen — beim erneuten Öffnen ist das Bild sofort da.
  }, [zustand, laden]);

  const antippbar = !!imageSrc && !!onClick;

  return (
    <div role={antippbar ? 'button' : undefined} tabIndex={antippbar ? 0 : undefined} onKeyDown={antippbar ? tastaturKlick : undefined} aria-label={antippbar ? `Bild öffnen: ${fileName}` : undefined}
      ref={imgRef}
      style={{
        maxWidth: '100%',
        width: vollbreite ? '100%' : undefined,
        maxHeight: `${maxHoehe}px`,
        borderRadius: 'var(--app-radius-klein)',
        overflow: vollbreite ? 'hidden' : undefined,
        // Hintergrund/feste minHeight NUR im Lade-/Fehlerzustand. Sobald das Bild
        // da ist, bestimmt es selbst die Hoehe -> KEIN Sprung von der 100px-
        // Platzhalter-Box auf die echte Bildhoehe (das war das Ruckeln).
        backgroundColor: imageSrc ? 'transparent' : 'var(--app-surface-dim)',
        color: 'var(--app-text-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: antippbar ? 'pointer' : 'default',
        minHeight: imageSrc ? undefined : '100px'
      }}
      onClick={antippbar ? onClick : undefined}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={fileName}
          // Speicher-Treffer beim Mount: synchron dekodieren -> Bild ist sofort
          // im ersten Frame da (kein nachtraegliches Reinpoppen/Ruckeln).
          decoding={sofortDa ? 'sync' : 'async'}
          style={{
            maxWidth: '100%',
            width: vollbreite ? '100%' : undefined,
            maxHeight: `${maxHoehe}px`,
            borderRadius: 'var(--app-radius-klein)',
            objectFit: 'cover',
            display: 'block'
          }}
        />
      ) : (
        <MedienPlatzhalter zustand={zustand} prozent={prozent} was="Das Bild" onErneut={erneutVersuchen} />
      )}
    </div>
  );
};

export default LazyImage;
