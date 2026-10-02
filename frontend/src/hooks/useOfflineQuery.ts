import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineCache } from '../services/offlineCache';
import { networkMonitor } from '../services/networkMonitor';

interface UseOfflineQueryOptions<T> {
  ttl?: number;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  select?: (data: T) => T;
  /**
   * Beim Wechsel des Schluessels die Daten des alten stehen lassen, bis der
   * neue geantwortet hat (ohne Ladeanzeige) -- fuer Such- und Filterfelder,
   * die selbst im Inhalt der Seite stehen und beim Laden nicht verschwinden
   * duerfen (Material der Leitung). Scheitert der neue Abruf oder gibt es
   * offline nichts fuer ihn, verschwinden die alten Daten trotzdem.
   * Ohne die Option leert ein Schluesselwechsel den Stand sofort.
   */
  vorigeDatenZeigen?: boolean;
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
    vorigeDatenZeigen = false,
  } = options || {};

  const [data, setData] = useState<T | null>(null);
  const dataRef = useRef<T | null>(null);
  // Zu welchem Schluessel gehoeren die Daten im Zustand? Nur mit
  // vorigeDatenZeigen kann das ein anderer als der aktuelle sein.
  const datenSchluesselRef = useRef<string | null>(null);
  // Schluessel des letzten Initial-Laufs: erkennt einen ECHTEN Wechsel,
  // nicht das erste Laden und nicht einen Neulauf wegen ttl/enabled.
  const vorigerSchluesselRef = useRef(cacheKey);
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
        datenSchluesselRef.current = cacheKey;
        lastSuccessRef.current = { key: cacheKey, t: Date.now() };
        setIsStale(false);
        setError(null);
        setLoading(false);
        onSuccessRef.current?.(transformed);
      } catch (err) {
        if (!mountedRef.current || currentKeyRef.current !== cacheKey) return;

        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';

        // Wenn Cache vorhanden: Daten behalten, als stale markieren -- aber
        // nur Daten DIESES Schluessels. Daten eines vorigen (vorigeDatenZeigen)
        // waeren sonst als "stale" das Ergebnis einer Anfrage, die gescheitert
        // ist.
        if (dataRef.current !== null && datenSchluesselRef.current === cacheKey) {
          setIsStale(true);
        } else {
          setData(null);
          dataRef.current = null;
          datenSchluesselRef.current = null;
          setIsStale(false);
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
    // Schluesselwechsel innerhalb einer gemounteten Seite:
    // Bis dahin blieb der Stand des alten Schluessels
    // stehen, bis der neue geantwortet hatte -- auf Badges und Aktivitaeten
    // der Leitung stand beim Umschalten Konfis <-> Teamer:innen die falsche
    // Liste unter dem neuen Reiter, bei einem Fehlschlag dauerhaft als
    // "stale". Jetzt beginnt der neue Schluessel leer und ladend. Nur bei
    // einem ECHTEN Wechsel: erstes Laden und ein Neulauf wegen ttl oder
    // enabled lassen den Stand, wie er ist.
    if (vorigerSchluesselRef.current !== cacheKey) {
      vorigerSchluesselRef.current = cacheKey;
      if (!vorigeDatenZeigen) {
        setData(null);
        dataRef.current = null;
        datenSchluesselRef.current = null;
        setIsStale(false);
        setLoading(true);
      }
      setError(null);
    }

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
        datenSchluesselRef.current = cacheKey;
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
        // Kein Cache + offline. Daten eines vorigen Schluessels
        // (vorigeDatenZeigen) gehoeren nicht zu diesem.
        if (datenSchluesselRef.current !== null && datenSchluesselRef.current !== cacheKey) {
          setData(null);
          dataRef.current = null;
          datenSchluesselRef.current = null;
        }
        setError('Keine Daten verfügbar (offline)');
        setLoading(false);
        setIsStale(false);
      }
    };

    loadFromCache();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, revalidate, vorigeDatenZeigen]);

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
  //
  // 'auth:org-fallback' gehoert dazu: Verliert jemand den Zugang
  // zur Zweitgemeinde, faellt die App per 403 auf die Stamm-Gemeinde zurueck --
  // api.ts feuert dabei NUR dieses Event, nicht 'org:switched'. Das ist
  // derselbe Wechsel, AppContext leert dafuer sogar den Zwischenspeicher. Ohne
  // diesen Horcher zeigte eine geparkte Seite weiter die Daten einer Gemeinde,
  // die die Person nicht mehr sehen darf. BadgeContext behandelt beide Events
  // aus demselben Grund gemeinsam.
  useEffect(() => {
    const handler = () => {
      if (mountedRef.current && networkMonitor.isOnline) {
        revalidate();
      }
    };
    window.addEventListener('org:switched', handler);
    window.addEventListener('auth:org-fallback', handler);
    return () => {
      window.removeEventListener('org:switched', handler);
      window.removeEventListener('auth:org-fallback', handler);
    };
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
