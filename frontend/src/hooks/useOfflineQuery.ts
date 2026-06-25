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

  // Refs für Callbacks (vermeidet Dependency-Probleme)
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const selectRef = useRef(select);
  const fetcherRef = useRef(fetcher);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;
  selectRef.current = select;
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    try {
      const freshData = await fetcherRef.current();
      // Race-Condition: Prüfen ob Key sich geändert hat
      if (!mountedRef.current || currentKeyRef.current !== cacheKey) return;

      // Raw-Daten in Cache speichern (vor select)
      await offlineCache.set(cacheKey, freshData, ttl);

      const transformed = selectRef.current ? selectRef.current(freshData) : freshData;
      setData(transformed);
      dataRef.current = transformed;
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
    }
  }, [cacheKey, ttl]);

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

      if (cached) {
        const transformed = selectRef.current ? selectRef.current(cached.data) : cached.data;
        setData(transformed);
        dataRef.current = transformed;
        setLoading(false);
        setError(null);

        if (offlineCache.isStale(cached)) {
          setIsStale(true);
          if (networkMonitor.isOnline) {
            revalidate();
          }
        } else {
          setIsStale(false);
          // Auch bei frischem Cache im Hintergrund revalidieren (SWR)
          if (networkMonitor.isOnline) {
            revalidate();
          }
        }
      } else if (networkMonitor.isOnline) {
        // Kein Cache, aber online — direkt laden
        revalidate();
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

  return { data, loading, error, isStale, isOffline, refresh };
}
