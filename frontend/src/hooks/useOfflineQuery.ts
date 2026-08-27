import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineCache } from '../services/offlineCache';
import { networkMonitor } from '../services/networkMonitor';

interface UseOfflineQueryOptions<T> {
  ttl?: number;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  select?: (data: T) => T;
}

interface UseOfflineQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isStale: boolean;
  isOffline: boolean;
  refresh: () => Promise<void>;
  refreshLive: () => Promise<void>;
}

const DEFAULT_TTL = 5 * 60 * 1000; // 5 Min

export function useOfflineQuery<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  options?: UseOfflineQueryOptions<T>
): UseOfflineQueryResult<T> {
  const {
    ttl = DEFAULT_TTL,
    enabled = true,
    onSuccess,
    onError,
    select,
  } = options || {};

  const [data, setData] = useState<T | null>(null);
  const dataRef = useRef<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isOffline, setIsOffline] = useState(!networkMonitor.isOnline);

  // Race-Condition-Schutz: Key kann sich ändern während fetch läuft
  const currentKeyRef = useRef(cacheKey);
  const mountedRef = useRef(true);

  const inflightRef = useRef<Promise<void> | null>(null);
  const inflightKeyRef = useRef<string | null>(null);

  const nachfolgeRef = useRef(false);

  const lastSuccessRef = useRef<{ key: string; t: number } | null>(null);
  const JUST_FETCHED_MS = 1500;

  // Refs für Callbacks (vermeidet Dependency-Probleme)
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const selectRef = useRef(select);
  const fetcherRef = useRef(fetcher);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;
  selectRef.current = select;
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async (istLive = false) => {
    // Läuft bereits ein Fetch für DENSELBEN Key, dessen Ergebnis abwarten
    // statt einen zweiten identischen Request zu starten.
    if (inflightRef.current && inflightKeyRef.current === cacheKey) {
      // Mitwarten. Bei einem Live-Ereignis zusaetzlich einen Nachfolge-Abruf
      // vormerken: Der laufende Abruf startete VOR der Aenderung und kann sie
      // noch nicht enthalten. Beim Mount-Pfad (gleicher Stand, nur doppelt
      // angefordert) waere ein Nachfolge-Abruf dagegen reine Verschwendung.
      if (istLive) nachfolgeRef.current = true;
      return inflightRef.current;
    }

    const doFetch = async () => {
      try {
        const freshData = await fetcherRef.current();
        // Race-Condition: Prüfen ob Key sich geändert hat
        if (!mountedRef.current || currentKeyRef.current !== cacheKey) return;

        // Raw-Daten in Cache speichern (vor select)
        await offlineCache.set(cacheKey, freshData, ttl);

        const transformed = selectRef.current ? selectRef.current(freshData) : freshData;
        setData(transformed);
        dataRef.current = transformed;
        lastSuccessRef.current = { key: cacheKey, t: Date.now() };
        setIsStale(false);
        setError(null);
        setLoading(false);
        onSuccessRef.current?.(transformed);
      } catch (err) {
        if (!mountedRef.current || currentKeyRef.current !== cacheKey) return;

        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';

        // Wenn Cache vorhanden: Daten behalten, als stale markieren
        if (dataRef.current !== null) {
          setIsStale(true);
        } else {
          setError(message);
          setLoading(false);
        }
        onErrorRef.current?.(err instanceof Error ? err : new Error(message));
      } finally {
        if (inflightKeyRef.current === cacheKey) {
          inflightRef.current = null;
          inflightKeyRef.current = null;
        }
      }

      // Waehrend des Abrufs kam mindestens eine weitere Anforderung herein.
      // Genau EINEN Nachfolge-Abruf starten — egal wie viele es waren, sonst
      // loest eine Ereignis-Salve (z.B. Sammel-Anwesenheit) einen Abruf-Sturm
      // aus. Das Flag wird VOR dem Abruf zurueckgesetzt, damit Anforderungen
      // waehrend des Nachfolge-Abrufs erneut greifen koennen.
      if (nachfolgeRef.current && mountedRef.current && currentKeyRef.current === cacheKey) {
        nachfolgeRef.current = false;
        await revalidateRef.current(true);
      }
    };

    // Frischer Abruf: dieser Stand ist aktuell, alte Vormerkung verfaellt.
    nachfolgeRef.current = false;
    inflightKeyRef.current = cacheKey;
    inflightRef.current = doFetch();
    return inflightRef.current;
  }, [cacheKey, ttl]);

  // Selbstbezug fuer den Nachfolge-Abruf in doFetch (revalidate referenziert
  // sich sonst in seiner eigenen Definition).
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  // Initial Load
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    currentKeyRef.current = cacheKey;
    let cancelled = false;

    const loadFromCache = async () => {
      const cached = await offlineCache.get<T>(cacheKey);

      if (cancelled) return;

      // Gerade eben (z.B. durch useIonViewWillEnter -> refresh) erfolgreich
      // geladen? Dann keinen sofortigen zweiten, identischen Request starten.
      const justFetched = lastSuccessRef.current !== null
        && lastSuccessRef.current.key === cacheKey
        && Date.now() - lastSuccessRef.current.t < JUST_FETCHED_MS;

      if (cached) {
        const transformed = selectRef.current ? selectRef.current(cached.data) : cached.data;
        setData(transformed);
        dataRef.current = transformed;
        setLoading(false);
        setError(null);

        if (offlineCache.isStale(cached)) {
          setIsStale(true);
          if (networkMonitor.isOnline && !justFetched) {
            revalidate();
          }
        } else {
          setIsStale(false);
          // Auch bei frischem Cache im Hintergrund revalidieren (SWR)
          if (networkMonitor.isOnline && !justFetched) {
            revalidate();
          }
        }
      } else if (networkMonitor.isOnline) {
        // Kein Cache, aber online — direkt laden (justFetched: Daten sind
        // bereits im State, ein erneuter Fetch braechte nichts Neues)
        if (!justFetched) {
          revalidate();
        } else {
          setLoading(false);
        }
      } else {
        // Kein Cache + offline
        setError('Keine Daten verfügbar (offline)');
        setLoading(false);
        setIsStale(false);
      }
    };

    loadFromCache();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, revalidate]);

  // Network-Listener: Bei Online-Wechsel revalidieren
  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((online) => {
      if (!mountedRef.current) return;

      setIsOffline(!online);

      if (online && isStale) {
        revalidate();
      }
    });

    return unsubscribe;
  }, [isStale, revalidate]);

  // Org-Wechsel (Multi-Org-Switcher): ALLE Queries frisch neu laden — auch wenn
  // die Page im IonRouterOutlet-Stack gecacht ist (nativer WebView) und daher
  // kein Remount/useEffect feuert. Das window-Event ist plattformunabhaengig und
  // greift unabhaengig vom Ionic-Page-Lifecycle. switchOrg (AppContext) feuert es.
  useEffect(() => {
    const handler = () => {
      if (mountedRef.current && networkMonitor.isOnline) {
        revalidate();
      }
    };
    window.addEventListener('org:switched', handler);
    return () => window.removeEventListener('org:switched', handler);
  }, [revalidate]);

  // Socket-Reconnect (sync:reconnect): Nach einem Verbindungsabriss (z.B. Deploy,
  // Netzwerkwechsel, App-Resume) laedt die gerade SICHTBARE View frische Daten.
  // Ionic haelt Pages im IonRouterOutlet-Stack gecacht -> kein Remount/useEffect,
  // daher greift das plattformunabhaengige window-Event analog zu 'org:switched'.
  // Der Reconnect-Handler in websocket.ts hat zuvor den Cache invalidiert; wir
  // nutzen bewusst denselben revalidate-Pfad (kein separater fetch), damit kein
  // Doppel-Fetch entsteht.
  useEffect(() => {
    const handler = () => {
      if (mountedRef.current && networkMonitor.isOnline) {
        revalidate();
      }
    };
    window.addEventListener('sync:reconnect', handler);
    return () => window.removeEventListener('sync:reconnect', handler);
  }, [revalidate]);

  // Cleanup bei Unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!networkMonitor.isOnline) return;
    await revalidate();
  }, [revalidate]);

  // Fuer Live-Ereignisse (Socket). Anders als refresh() sorgt es dafuer, dass
  // die Aenderung auch dann ankommt, wenn beim Eintreffen gerade schon ein
  // Abruf laeuft — der wuerde sonst den Stand VON VOR der Aenderung liefern.
  const refreshLive = useCallback(async () => {
    if (!networkMonitor.isOnline) return;
    await revalidate(true);
  }, [revalidate]);

  return { data, loading, error, isStale, isOffline, refresh, refreshLive };
}
