import React, { useState, useEffect, useRef } from 'react';
import { getMediaObjectUrl, getCachedObjectUrl } from '../../services/mediaCache';

interface LazyImageProps {
  filePath: string;
  fileName: string;
  onError: () => void;
  onClick: () => void;
}

const LazyImage: React.FC<LazyImageProps> = ({ filePath, fileName, onError, onClick }) => {
  // Synchron pruefen, ob das Bild bereits im In-Memory-Cache liegt. Wenn ja, ist
  // imageSrc schon beim ERSTEN Render gesetzt -> das Bild erscheint sofort, ohne
  // Lazy-Load-Zwischenzustand und ohne Ruckeln beim Hochscrollen. Nur ungecachte
  // Bilder werden lazy nachgeladen (spart Bandbreite beim allerersten Oeffnen).
  const cachedUrl = getCachedObjectUrl(filePath);
  const [imageSrc, setImageSrc] = useState<string>(cachedUrl || '');
  const [isLoading, setIsLoading] = useState(!cachedUrl);
  const imgRef = useRef<HTMLDivElement>(null);
  // Merker, ob bereits geladen wurde (verhindert doppeltes Triggern). Die
  // Object-URL selbst gehoert dem geteilten In-Memory-Cache (mediaCache) und wird
  // hier NICHT revoked — so ueberlebt sie das Unmount und das Bild ist beim
  // erneuten Oeffnen des Chats sofort da.
  const loadedRef = useRef(!!cachedUrl);
  // onError als Ref halten: MessageBubble uebergibt einen Inline-Arrow, der bei
  // JEDEM Render neu entsteht. Laege er in der useEffect-Dependency-Liste, wuerde
  // der Effekt staendig neu laufen, die Object-URL revoken und das Bild neu laden
  // -> Reload-Loop + Springen beim Scrollen. Ueber die Ref bleibt der Effekt an
  // `filePath` gebunden und laeuft pro Bild nur EINMAL.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    // Cache-Treffer beim Mount -> schon angezeigt, kein Observer/Laden noetig.
    if (loadedRef.current) return;

    let cancelled = false;

    const loadOnce = async () => {
      // Schon geladen? Nichts tun (z.B. wenn das Bild raus- und wieder
      // reinscrollt — es ist bereits da, kein erneuter Cache-/Netz-Zugriff).
      if (loadedRef.current) return;
      loadedRef.current = true;
      setIsLoading(true);
      try {
        // Liefert die geteilte, persistente Object-URL (sofort bei Cache-Treffer).
        const url = await getMediaObjectUrl(filePath);
        if (cancelled) return;
        setImageSrc(url);
      } catch (error) {
        console.error('Error loading lazy image:', error);
        loadedRef.current = false; // bei Fehler erneuter Versuch erlauben
        if (!cancelled) onErrorRef.current();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadedRef.current) {
          // Einmal (vor-)sichtbar -> laden, danach nicht mehr beobachten. So gibt
          // es kein wiederholtes Re-Triggern beim Scrollen.
          observer.disconnect();
          loadOnce();
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
      cancelled = true;
      observer.disconnect();
    };
    // NUR filePath — onError/onClick bewusst ausgeklammert (siehe onErrorRef).
    // Object-URL wird NICHT revoked (gehoert dem geteilten Cache).
  }, [filePath]);

  return (
    <div
      ref={imgRef}
      style={{
        maxWidth: '100%',
        maxHeight: '300px',
        borderRadius: '8px',
        // Hintergrund/feste minHeight NUR im Lade-/Fehlerzustand. Sobald das Bild
        // da ist, bestimmt es selbst die Hoehe -> KEIN Sprung von der 100px-
        // Platzhalter-Box auf die echte Bildhoehe (das war das Ruckeln).
        backgroundColor: imageSrc ? 'transparent' : '#f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: imageSrc ? 'pointer' : 'default',
        minHeight: imageSrc ? undefined : '100px'
      }}
      onClick={imageSrc ? onClick : undefined}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={fileName}
          // Cache-Treffer beim Mount: synchron dekodieren -> Bild ist sofort im
          // ersten Frame da (kein nachtraegliches Reinpoppen/Ruckeln).
          decoding={cachedUrl ? 'sync' : 'async'}
          style={{
            maxWidth: '100%',
            maxHeight: '300px',
            borderRadius: '8px',
            objectFit: 'cover',
            display: 'block'
          }}
        />
      ) : isLoading ? (
        <div style={{ color: '#666', fontSize: '0.9rem' }}>
          Bild wird geladen...
        </div>
      ) : (
        <div style={{ color: '#999', fontSize: '0.8rem' }}>
          Bild konnte nicht geladen werden
        </div>
      )}
    </div>
  );
};

export default LazyImage;
