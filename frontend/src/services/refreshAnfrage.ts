import axios, { type AxiosResponse } from 'axios';
import { API_BASE_URL } from './apiBasis';
import { geraeteKennung } from './geraeteKennung';

/**
 * Der Tausch Refresh-Token -> neues Token-Paar, mit Zeitlimit.
 *
 * WARUM EIN EIGENER BAUSTEIN:
 * Der Refresh laeuft bewusst am Interceptor der API-Instanz vorbei (api.ts
 * performRefresh: sonst Interceptor-Schleife; auth.ts mitBiometrieAnmelden:
 * dort ist noch niemand angemeldet). Damit fehlte ihm auch deren Zeitlimit
 * von 20 s. Genau der Fall, fuer den die Instanz ihr Limit hat -- WLAN/LTE-
 * Wechsel, tote TCP-Verbindung --, liess den Refresh haengen, bis das
 * Betriebssystem aufgab (iOS 60 s, Android bis zu mehreren Minuten). Solange
 * stand `isRefreshing`, und jede Anfrage wartete mit: Die App lud nichts und
 * schickte nichts, ohne Meldung.
 *
 * Zwei Sicherungen: `timeout` fuer den Adapter (so bricht auch die Leitung
 * selbst ab) und ein eigener Wecker, der die Anfrage abbricht und das
 * Versprechen in jedem Fall nach REFRESH_ZEITLIMIT_MS mit einem Fehler
 * beendet -- auch wenn ein Adapter das Limit nicht kennt. Der Fehler sieht aus
 * wie der Zeitlimit-Fehler von axios (`code: 'ECONNABORTED'`, keine Antwort),
 * damit die Aufrufer ihn auf dem bestehenden Fehlerweg behandeln.
 *
 * GERAETEBINDUNG: Jeder
 * Refresh traegt die Geraete-Kennung als `device_id` (geraeteKennung.ts). Der
 * Server gibt ein an das Geraet gebundenes Token nur mit derselben Kennung
 * heraus und bindet ein ungebundenes (Sitzung von vor dem Update) an sie.
 * Ohne ermittelbare Kennung geht der Koerper wie bisher hinaus.
 */
export const REFRESH_ZEITLIMIT_MS = 20000;

export async function refreshAnfordern(
  koerper: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<AxiosResponse> {
  const abbruch = new AbortController();
  let wecker: ReturnType<typeof setTimeout> | undefined;
  const zeitlimit = new Promise<never>((_, ablehnen) => {
    wecker = setTimeout(() => {
      abbruch.abort();
      ablehnen(Object.assign(new Error(`timeout of ${REFRESH_ZEITLIMIT_MS}ms exceeded`), {
        name: 'AxiosError',
        code: 'ECONNABORTED',
        isAxiosError: true,
      }));
    }, REFRESH_ZEITLIMIT_MS);
  });

  const anfrage = (async () => {
    const kennung = await geraeteKennung();
    return axios.post(`${API_BASE_URL}/auth/refresh`, kennung ? { ...koerper, device_id: kennung } : koerper, {
      timeout: REFRESH_ZEITLIMIT_MS,
      signal: abbruch.signal,
      ...(headers ? { headers } : {}),
    });
  })();

  try {
    return await Promise.race([anfrage, zeitlimit]);
  } finally {
    clearTimeout(wecker);
  }
}
