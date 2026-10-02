import api from './api';
import { refreshAnfordern } from './refreshAnfrage';
import { geraeteKennung } from './geraeteKennung';
import { Device } from '@capacitor/device';
import { Capacitor } from '@capacitor/core';
import { setToken, setUser, setRefreshToken, getRefreshToken, clearAuth, getDeviceId, setLoggingOut } from './tokenStore';
import {
  mitBiometrieEntsperren,
  gespeichertenTokenAuffrischen,
  biometrieVergessen,
  istBiometrieAktiv
} from './biometrics';
import { offlineCache } from './offlineCache';
import { clearMediaCache } from './mediaCache';
import { writeQueue } from './writeQueue';
import { disconnectWebSocket } from './websocket';
import { networkMonitor } from './networkMonitor';
import { BaseUser } from '../types/user';
import { fehlerFuersProtokoll } from '../utils/fehler';

// Race Condition User-Wechsel: Backend POST /device-token löscht alte Tokens
// (anderer user_id mit gleichem device_token) automatisch VOR dem INSERT.
// Frontend-seitig wird logout() mit await ausgeführt und blockiert bis DELETE durch ist.
/**
 * Uebernimmt eine frisch vom Server ausgestellte Sitzung in den tokenStore:
 * Access-Token, Refresh-Token und Nutzer -- fuer Login UND Registrierung.
 */
export const sitzungUebernehmen = async (
  daten: { token?: string; refresh_token?: string; user?: BaseUser }
): Promise<BaseUser> => {
  const { token, refresh_token, user } = daten;
  if (!token || !user) throw new Error('Fehlender Token oder Benutzer');

  await setToken(token);
  if (refresh_token) await setRefreshToken(refresh_token);
  await setUser(user);

  return user;
};

export const loginWithAutoDetection = async (username: string, password: string): Promise<BaseUser> => {

  try {
    // Geraete-Kennung mitschicken: Der Server bindet das Refresh-Token an
    // dieses Geraet. Ohne
    // ermittelbare Kennung wie bisher ohne -- das Token bleibt dann ungebunden.
    const kennung = await geraeteKennung();
    const response = await api.post('/auth/login', kennung ? { username, password, device_id: kennung } : { username, password });
    return await sitzungUebernehmen(response.data);
  } catch (error: unknown) {
    const err = error as {
      response?: { status?: number; statusText?: string; data?: { error?: string } };
      message?: string;
      code?: string;
      rateLimitMessage?: string;
    };
    // NUR unkritische Felder ins Protokoll: Der
    // axios-Fehler traegt die gesendete Anfrage mit, `config.data` ist
    // '{"username":…,"password":…}' im Klartext. Frueher stand hier
    // `fullError: error` -- das Passwort landete im Protokoll des Geraets.
    // Test: anmeldedatenNichtImProtokoll.test.ts.
    console.error('Login fehlgeschlagen:', fehlerFuersProtokoll(error));
    // Antwort, Fehlercode und Rate-Limit-Meldung MITGEBEN. Die Anmeldeseite
    // entscheidet daran, was sie zeigt (LoginView: 429 -> Meldung des
    // Servers, keine Antwort -> "Keine Verbindung", 401 -> "Falsches
    // Passwort"). Ohne die Felder landete jede Ablehnung durch den Server im
    // Zweig "Keine Verbindung zum Server" -- auch "zu viele Versuche", deren
    // Meldung sagt, was zu tun ist. Test: anmeldefehlerSichtbar.test.tsx.
    //
    // Die Antwort wird dabei NACHGEBAUT, nicht durchgereicht: Eine
    // axios-Antwort haengt an `config` und `request` -- mit dem Passwort.
    // Aus demselben Grund geht der gefangene Fehler nicht als `cause` mit.
    const antwort = err?.response
      ? { status: err.response.status, statusText: err.response.statusText, data: err.response.data }
      : undefined;
    throw Object.assign(
      new Error('Login fehlgeschlagen: ' + (err?.response?.data?.error || err.message)),
      { response: antwort, code: err?.code, rateLimitMessage: err?.rateLimitMessage }
    );
  }
};

// ANTI-SPAM: Verhindere mehrfache Logout-Calls
let logoutInProgress = false;

// Erlaubt anderen Modulen (api.ts 401-Interceptor) zu erkennen, dass gerade ein
// BEWUSSTER Logout läuft — dann darf ein 401 NICHT als "Sitzung abgelaufen"
// gemeldet werden (der User loggt sich ja absichtlich aus).
export const isLoggingOut = (): boolean => logoutInProgress;

export const logout = async (): Promise<void> => {
  if (logoutInProgress) {
 console.warn('Logout bereits in Bearbeitung, wird übersprungen');
    return;
  }
  
  logoutInProgress = true;
  try {
    // 401-Interceptor (api.ts) soll während des bewussten Logouts NICHT
    // "Sitzung abgelaufen" melden — der Push-Cleanup-Call nach clearAuth() läuft
    // ohne Token und liefert sonst einen 401.
    setLoggingOut(true);

    // WICHTIG: Der LOKALE Logout (clearAuth) darf NIEMALS an haengenden
    // Netzwerk-Calls scheitern (früher blieb der User offline nach Reload
    // eingeloggt). Alle Server-Calls laufen mit hartem Timeout.
    //
    // REIHENFOLGE: Push-Token-DELETE MUSS VOR clearAuth laufen — der Endpoint
    // verlangt Auth (verifyTokenRBAC). Frueher lief er danach, bekam 401, der
    // Token blieb registriert und der alte Account erhielt nach Account-Wechsel
    // weiter Pushes auf diesem Geraet. Best-effort: schlägt der DELETE fehl
    // (offline/Timeout), hängt POST /device-token den Token beim nächsten
    // Login serverseitig an den neuen User um.

    // Helper: Request mit hartem Timeout, damit ein falsch-positives isOnline
    // (Network-Plugin meldet sporadisch connected trotz keiner Verbindung) nicht hängt.
    const withTimeout = <T>(p: Promise<T>, ms = 4000): Promise<T | undefined> =>
      Promise.race([p, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);

    // Ungesendete Queue-Items (z.B. Chat-Nachrichten) JETZT noch zustellen,
    // solange das Token gilt. Items, die den Logout ueberleben wuerden, gingen
    // beim naechsten Login unter dem DANN angemeldeten Konto raus — also unter
    // falscher Identitaet, wenn sich jemand anderes anmeldet. Deshalb unten
    // nach clearAuth auch writeQueue.clear().
    try {
      if (networkMonitor.isOnline) {
        await withTimeout(writeQueue.flush(), 8000);
      }
    } catch (error) {
      console.warn('Queue-Flush beim Logout fehlgeschlagen (unkritisch):', fehlerFuersProtokoll(error));
    }

    // Push-Token serverseitig löschen (best-effort, mit Timeout, NOCH authentifiziert)
    let deviceId: string | undefined;
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          const deviceInfo = await Device.getId();
          deviceId = deviceInfo.identifier;
        } catch (err) {
          console.warn('Could not get device ID via Capacitor, using TokenStore fallback:', err);
          deviceId = getDeviceId() || undefined;
        }
      } else {
        deviceId = getDeviceId() || undefined;
      }

      if (deviceId && networkMonitor.isOnline) {
        await withTimeout(api.delete('/notifications/device-token', {
          data: { device_id: deviceId, platform: Capacitor.getPlatform() }
        }));
      }
    } catch (error) {
      // Nur Status und Code: der axios-Fehler traegt das Zugangs-Token im
      // Authorization-Header mit.
      console.warn('Push-Token-Cleanup beim Logout fehlgeschlagen (unkritisch):', fehlerFuersProtokoll(error));
    }

    // SEC-02: Refresh Token serverseitig revokieren (best-effort, mit Timeout)
    try {
      const refreshToken = getRefreshToken();
      if (refreshToken && networkMonitor.isOnline) {
        await withTimeout(api.post('/auth/logout', {
          refresh_token: refreshToken,
          device_id: deviceId,
          platform: Capacitor.getPlatform()
        }));
      }
    } catch (error) {
      // Nur Status und Code: `config.data` traegt den Refresh-Token im
      // Klartext.
      console.warn('Serverseitiges Token-Revoke fehlgeschlagen (wird lokal geloescht):', fehlerFuersProtokoll(error));
    }

    // GARANTIERT: lokale Auth-Daten löschen. Ab hier ist der User ausgeloggt.
    // Absichern: Wirft dieser Aufruf -- Preferences
    // koennen das im WebView --, brach die Funktion hier ab. logoutInProgress
    // blieb dann fuer immer true, und JEDER weitere Logout kehrte in Zeile 1
    // wirkungslos zurueck: Token blieb liegen, nach dem Neustart war man wieder
    // im alten Konto, und ein neuer Login schrieb ueber einen halb geraeumten
    // Zustand (Tab-Leiste der alten Rolle, Inhalt der neuen).
    try {
      await clearAuth();
    } catch (error) {
      console.error('clearAuth beim Logout fehlgeschlagen:', error);
    }

    // Ausdrueckliches Abmelden loescht IMMER auch die biometrisch gesicherte
    // Sitzung. Bliebe sie liegen, koennte man sich nach dem Abmelden per Face ID
    // wieder in genau das Konto entsperren, aus dem man gerade herausgegangen ist.
    try {
      await biometrieVergessen();
    } catch (error) {
      console.warn('Biometrie-Aufraeumen beim Logout fehlgeschlagen:', error);
    }

    // Queue leeren: was jetzt noch drin ist, darf nach dem naechsten Login
    // nicht unter fremdem Konto gesendet werden (siehe Flush oben).
    try {
      await writeQueue.clear();
    } catch (error) {
      console.warn('Queue-Clear beim Logout fehlgeschlagen:', error);
    }

    // Socket trennen: ohne das ueberlebt die Verbindung den Logout und der
    // nächste angemeldete Nutzer sitzt weiter in den Räumen des vorherigen
    // Der Aufbau erfolgt beim nächsten Login neu.
    try {
      disconnectWebSocket();
    } catch (error) {
      console.warn('Socket-Trennung beim Logout fehlgeschlagen:', error);
    }
    try {
      await offlineCache.clearAll();
    } catch (error) {
      console.warn('Cache-Clear beim Logout fehlgeschlagen:', error);
    }

    // Medien-Cache leeren: Chat-Anhänge und Challenge-Dateien
    // des abgemeldeten Kontos dürfen nicht auf dem Gerät liegen bleiben. Bis
    // dahin wurde er nur von Hand geleert — wer sich danach anmeldete, fand
    // die Medien der vorigen Person vor.
    try {
      await clearMediaCache();
    } catch (error) {
      console.warn('Medien-Cache beim Logout nicht geleert:', error);
    }

    // Device ID NICHT löschen - bleibt für das Geraet persistent
    // (wird im finally zurueckgesetzt -- siehe unten)
  } finally {
    logoutInProgress = false;
    // Kurz verzoegert zuruecksetzen, damit auch ein knapp nachlaufender 401
    // vom Push-Cleanup noch unterdrueckt wird, dann wieder normales Verhalten.
    setTimeout(() => setLoggingOut(false), 2000);
  }
};


// ---------------------------------------------------------------------------
// Biometrische Anmeldung: Sitzung wiederherstellen
// ---------------------------------------------------------------------------

export type BiometrieAnmeldung =
  | { status: 'ok'; user: BaseUser }
  /** Abgebrochen oder nicht erkannt — normaler Anmeldeweg, keine Fehlermeldung. */
  | { status: 'abgebrochen' }
  /** Nichts gespeichert / Frist abgelaufen — normaler Anmeldeweg. */
  | { status: 'nichts-gespeichert' }
  /** Der gespeicherte Token gilt nicht mehr — normaler Anmeldeweg mit Hinweis. */
  | { status: 'abgelaufen' }
  /** Kein Netz — der gespeicherte Token laesst sich gerade nicht einloesen. */
  | { status: 'offline' }
  /** Unerwarteter Fehler — normaler Anmeldeweg mit Hinweis. */
  | { status: 'fehler' };

/**
 * Stellt die Sitzung nach erfolgreicher Biometrie wieder her.
 *
 * Ablauf: Token biometrisch aus dem sicheren Speicher lesen -> beim Server
 * gegen ein frisches Token-Paar tauschen -> das rotierte Token zurueck in den
 * sicheren Speicher schreiben.
 *
 * Der Tausch laeuft bewusst ueber direktes axios statt ueber api.ts: der
 * dortige 401-Interceptor wuerde bei einem abgelaufenen Token ein
 * 'auth:relogin-required'-Event feuern und clearAuth() aufrufen. Wir sind hier
 * aber noch GAR NICHT angemeldet — das Event traefe ins Leere und der
 * Fehlerfall waere nicht mehr sauber unterscheidbar. Hier entscheidet allein
 * der Rueckgabewert, was die Oberflaeche anzeigt.
 */
export const mitBiometrieAnmelden = async (): Promise<BiometrieAnmeldung> => {
  const entsperrt = await mitBiometrieEntsperren();

  if (entsperrt.status === 'abgebrochen') return { status: 'abgebrochen' };
  if (entsperrt.status === 'nichts-gespeichert') return { status: 'nichts-gespeichert' };
  if (entsperrt.status === 'fehler') return { status: 'fehler' };

  // Ohne Netz laesst sich der gespeicherte Token nicht einloesen. Die Sitzung
  // wird NICHT verworfen — beim naechsten Versuch mit Netz klappt es wieder.
  if (!networkMonitor.isOnline) return { status: 'offline' };

  try {
    // Mit Zeitlimit 20 s.
    const antwort = await refreshAnfordern({
      refresh_token: entsperrt.refreshToken
    });
    const { token, refresh_token: neuerRefreshToken } = antwort.data || {};
    if (!token || !neuerRefreshToken) return { status: 'fehler' };

    // Reihenfolge wie in api.ts performRefresh: erst der langlebige Schluessel.
    // Nur in den Arbeitsspeicher, NICHT in die Preferences: Wer per Biometrie
    // hereinkommt, hat den Schalter an -- dauerhaft liegt der Token dann allein
    // im sicheren Speicher.
    await setRefreshToken(neuerRefreshToken, { klartext: false });
    await setToken(token);
    await setUser(entsperrt.user);

    // Rotierten Token zurueckschreiben, solange auf Android das Zeitfenster der
    // gerade erfolgten Pruefung noch traegt. Die urspruengliche Frist bleibt
    // stehen (gespeichertAm wird durchgereicht, nicht erneuert).
    await gespeichertenTokenAuffrischen(neuerRefreshToken, entsperrt.gespeichertAm);

    return { status: 'ok', user: entsperrt.user };
  } catch (fehler: unknown) {
    const status = (fehler as { response?: { status?: number } })?.response?.status;
    if (status === 401) {
      // Der Server kennt den Token nicht mehr (abgelaufen, widerrufen, oder auf
      // einem anderen Geraet abgemeldet). Aufraeumen, sonst fragt die App bei
      // jedem Start nach Face ID und scheitert danach still — genau die
      // Schleife, die es nicht geben darf.
      await biometrieVergessen();
      return { status: 'abgelaufen' };
    }
    // Nur Status und Code: `config.data` traegt den gespeicherten
    // Refresh-Token im Klartext.
    console.warn('Anmeldung per Biometrie fehlgeschlagen:', fehlerFuersProtokoll(fehler));
    return { status: 'fehler' };
  }
};

/**
 * true, wenn die Anmeldemaske einen Knopf fuer die biometrische Anmeldung
 * zeigen soll. Prueft NUR den Schalter, loest also keine Abfrage aus.
 */
export const biometrieAnmeldungMoeglich = async (): Promise<boolean> =>
  istBiometrieAktiv();
