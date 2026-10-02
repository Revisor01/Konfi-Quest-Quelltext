import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback, useMemo, useRef } from 'react';
import { Badge } from '@capawesome/capacitor-badge';
import { Capacitor } from '@capacitor/core';
import api from '../services/api';
import { writeQueue } from '../services/writeQueue';
import { networkMonitor } from '../services/networkMonitor';
import { initializeWebSocket } from '../services/websocket';
import { getToken } from '../services/tokenStore';
import { removeDeliveredForChatRoom } from '../services/notifications';
import { appSymbolZahlNativ, appSymbolZahlSetzen } from '../services/appSymbolZahl';
import { offlineCache } from '../services/offlineCache';
import { summeAllerGemeindenAusAntwort } from '../utils/offenJeGemeinde';
import { useApp } from './AppContext';
import { useLiveRefresh, useLiveUpdate, LiveUpdateType } from './LiveUpdateContext';

// Stabiles Array (Modul-Ebene) -> useLiveRefresh re-subscribt nicht bei jedem Render.
const BADGE_LIVE_TYPES: LiveUpdateType[] = ['requests', 'events', 'challenges'];

// Badge Context Interface
interface BadgeContextType {
  // Chat
  chatUnreadByRoom: Record<number, number>;
  chatUnreadTotal: number;
  // Admin-only
  pendingRequestsCount: number;
  pendingEventsCount: number;
  // Leitung (Admin + Teamer): offene Challenge-Freigaben
  pendingChallengesCount: number;
  /**
   * Offene Freigaben je Challenge (nur Team und Leitung) -- fuer die Kugel
   * am Listeneintrag, wie chatUnreadByRoom fuer den Chat. Der Server
   * liefert sie in challengeApprovals.byChallenge; die Summe ist
   * pendingChallengesCount. Konfis bekommen hier immer leer: ihre Zahl an
   * der Challenge sind die Neuigkeiten (challengeUpdatesByChallenge), das
   * ist etwas anderes und wird nicht vermischt.
   */
  pendingChallengesByChallenge: Record<number, number>;
  /** Ungesehene Abzeichen (Konfis und Teamer:innen). Die Leitung kann keine verdienen -> immer 0. */
  newBadgesCount: number;
  /**
   * Challenge-Neuigkeiten (nur Konfis), das Gegenstueck zu chatUnreadByRoom:
   * je laufender Challenge, was seit dem letzten Oeffnen dazukam -- die
   * Challenge selbst, fremde Galerie-Beitraege, Moderation eigener Beitraege.
   * Team und Leitung bekommen hier immer leer/0: ihr Reiter zaehlt Freigaben.
   */
  challengeUpdatesByChallenge: Record<number, number>;
  challengeUpdatesTotal: number;
  /**
   * null heisst: der Server liefert das Feld nicht (aelterer Server) --
   * dann rechnet die Liste wie bisher offene Freigaben + challengeUpdates.
   * Fuer Konfis bleibt es null; ihre Kugel liest challengeUpdatesByChallenge.
   *
   * Reiter und App-Symbol lesen es NICHT: Dort bleibt es bei
   * pendingChallengesCount + challengeUpdatesTotal, ein Beitrag zaehlt nie
   * doppelt.
   */
  challengeNeueBeitraegeByChallenge: Record<number, number> | null;
  /** Wie viele der neuen Beitraege je Challenge noch auf Freigabe warten (Vorlesetext der Kugel). */
  challengeNeueWartendByChallenge: Record<number, number>;
  postfachUngelesen: number;
  /**
   * Meldet eine Challenge als geoeffnet -- wie markRoomAsRead fuer den Chat:
   * optimistisch sofort auf 0 (challengeUpdatesByChallenge und
   * challengeNeueBeitraegeByChallenge), dann POST. Fuer super_admin ein No-op.
   */
  markChallengeAsRead: (challengeId: number) => Promise<void>;
  postfachGelesen: (anzahl: number | 'alle') => void;
  // Gesamt (Role-abhaengig) -- die Reiter der AKTIVEN Gemeinde, ohne Postfach
  totalBadgeCount: number;
  /**
   * Die Zahl, die die App aufs App-Symbol setzt.
   * Bei einer Gemeinde ist das totalBadgeCount. Bei mehreren die Summe aller
   * Gemeinden aus GET /notifications/badge-counts/je-organisation -- je
   * Gemeinde mit der dortigen Rolle, dieselbe Zahl, die Push und
   * Hintergrund-Lauf setzen.
   */
  appSymbolZahl: number;
  // Actions
  refreshAllCounts: () => Promise<void>;
  /**
   * Meldet einen Raum als gelesen. Das Promise wird erfuellt, wenn der
   * Server den Lesevorgang verbucht hat -- WER DANACH ZAEHLER NEU LAEDT,
   * MUSS DARAUF WARTEN. Sonst liest er den Stand von vor dem Lesen.
   */
  markRoomAsRead: (roomId: number) => Promise<void>;
  // Legacy Alias (Abwaertskompatibilitaet)
  badgeCount: number;
  refreshFromAPI: () => Promise<void>;
}

// Create Context
const BadgeContext = createContext<BadgeContextType | undefined>(undefined);

/** Zahl je Challenge aus einer Server-Antwort: nur Eintraege > 0, Schluessel als Zahl. */
const nurPositive = (roh: unknown): Record<number, number> => {
  const ergebnis: Record<number, number> = {};
  if (!roh || typeof roh !== 'object') return ergebnis;
  Object.entries(roh as Record<string, unknown>).forEach(([id, wert]) => {
    const n = Number(wert) || 0;
    if (n > 0) ergebnis[Number(id)] = n;
  });
  return ergebnis;
};

/** Gleicher Inhalt? Dann behaelt der State seine Referenz (kein unnoetiges Neuzeichnen). */
const gleicherInhalt = (a: Record<number, number>, b: Record<number, number>): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && bKeys.every(k => a[Number(k)] === b[Number(k)]);
};

// Badge Provider Component
export const BadgeProvider = ({ children }: { children: ReactNode }) => {
  const { user, organizations } = useApp();
  // Erhoeht sich nach Socket-Reconnect-mit-neuem-Token (LiveUpdateContext). Als
  // Dependency des newMessage-Effekts unten nötig, damit der Listener nach
  // reconnectWithToken am NEUEN Socket-Objekt neu gebunden wird (der alte Socket
  // wurde verworfen -> ohne Neubindung kaeme kein 'newMessage' mehr an).
  const { socketEpoch } = useLiveUpdate();

  const [chatUnreadByRoom, setChatUnreadByRoom] = useState<Record<number, number>>({});
  const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [pendingEventsCount, setPendingEventsCount] = useState(0);
  const [pendingChallengesCount, setPendingChallengesCount] = useState(0);
  const [pendingChallengesByChallenge, setPendingChallengesByChallenge] = useState<Record<number, number>>({});
  const [newBadgesCount, setNewBadgesCount] = useState(0);
  const [challengeUpdatesByChallenge, setChallengeUpdatesByChallenge] = useState<Record<number, number>>({});
  const [challengeUpdatesTotal, setChallengeUpdatesTotal] = useState(0);
  const [challengeNeueBeitraegeByChallenge, setChallengeNeueBeitraegeByChallenge] = useState<Record<number, number> | null>(null);
  const [challengeNeueWartendByChallenge, setChallengeNeueWartendByChallenge] = useState<Record<number, number>>({});
  const [postfachUngelesen, setPostfachUngelesen] = useState(0);

  /**
   * Quelle ist die Aufteilung des Gemeinde-Umschalters: Deren Summe IST die
   * Zahl des Servers. null heisst "nicht geladen" (eine Gemeinde, aelterer
   * Server, Fehler) -- dann gilt totalBadgeCount wie bisher.
   */
  const [summeAllerGemeinden, setSummeAllerGemeinden] = useState<number | null>(null);

  /**
   * Hat seit dem Start (bzw. dem letzten Gemeindewechsel) eine Zaehlung
   * gegolten? Nur fuer Android: Dort setzt die App die Zahl am
   * App-Symbol erst, wenn sie eine hat. Vor der ersten Antwort steht
   * appSymbolZahl auf 0 -- auf dem iPhone stoert das nicht, auf Android
   * haette es die Zahl, die der stille Push bei geschlossener App gesetzt hat,
   * beim Oeffnen kurz auf 0 gezogen (und auf Samsung und Xiaomi die Zahl in
   * der liegenden Mitteilung).
   */
  const [zahlGeladen, setZahlGeladen] = useState(false);

  // Nur wer mehreren Gemeinden angehoert, braucht die zweite Abfrage. Die
  // Liste kommt aus GET /auth/my-organizations (AppContext) und fuehrt
  // dieselben Gemeinden wie je-organisation (beide Quellen, gesperrte nicht).
  // Solange sie noch nicht geladen ist, gilt die Person als Single-Org --
  // kommt sie an, entsteht refreshAllCounts neu und laedt nach.
  const mehrereGemeinden = (organizations?.length ?? 0) > 1;

  /**
   * Sie zaehlt bei jedem Gemeindewechsel hoch und entscheidet, WESSEN Antwort
   * noch gelten darf: refreshAllCounts merkt sich beim Start den Stand und
   * verwirft seine Antwort, wenn inzwischen gewechselt wurde. Ohne das
   * ueberschreibt eine noch laufende Abfrage der ALTEN Gemeinde die Zahlen der
   * neuen -- derselbe Wettlauf, der bei markRoomAsRead schon einmal zugeschlagen
   * hat.
   *
   * Als ref, nicht als State: Der Wert muss in der laufenden Abfrage sofort
   * sichtbar sein, nicht erst im naechsten Rendern.
   */
  const gemeindeLauf = useRef(0);

  const zaehlungGestartet = useRef(0);
  const zaehlungGilt = useRef(0);

  /**
   * Fuer welchen Lauf der Wechsel-Horcher schon geladen hat.
   */
  const bereitsGeladenFuerLauf = useRef<number | null>(null);

  const isAdmin = user?.type === 'admin' && user?.role_name !== 'super_admin';
  // Challenge-Freigaben betreffen die ganze Leitung — Teamer moderieren ihre
  // zugewiesenen Jahrgänge selbst (das Backend zählt entsprechend gefiltert).
  const isLeadership = isAdmin || user?.type === 'teamer';

  const totalBadgeCount = useMemo(() => {
    if (isAdmin) {
      return chatUnreadTotal + pendingRequestsCount + pendingEventsCount + pendingChallengesCount
        + challengeUpdatesTotal;
    }
    if (isLeadership) {
      return chatUnreadTotal + pendingChallengesCount + newBadgesCount + challengeUpdatesTotal;
    }
    return chatUnreadTotal + newBadgesCount + challengeUpdatesTotal;
  }, [chatUnreadTotal, pendingRequestsCount, pendingEventsCount, pendingChallengesCount, newBadgesCount, challengeUpdatesTotal, isAdmin, isLeadership]);

  // Zentraler Refresh aller Counts. Nutzt den leichtgewichtigen Zähler-Endpoint
  // statt der frueheren drei Voll-Fetches (/chat/rooms +
  // /admin/activities/requests + /events), die nur für Zahlen geladen wurden.
  // Die Semantik der Zähler repliziert der Server exakt aus den Listen-Queries
  // (unread pro Raum, pending-Anträge, unverarbeitete vergangene Events).
  const refreshAllCounts = useCallback(async () => {
    if (!user) return;

    // Zu welcher Gemeinde diese Abfrage gehoert. Wird beim Eintreffen der
    // Antwort gegen den aktuellen Stand geprueft (siehe gemeindeLauf oben).
    const lauf = gemeindeLauf.current;
    const nummer = ++zaehlungGestartet.current;

    try {
      // Bei mehreren Gemeinden zusaetzlich die Aufteilung je Gemeinde, fuer
      // die Zahl am App-Symbol. Parallel, nicht nacheinander;
      // ein Fehler dort laesst die Reiter unberuehrt (null -> totalBadgeCount).
      // Personen mit EINER Gemeinde -- fast alle Konfis -- fragen sie nie ab:
      // Ihre Summe ist totalBadgeCount, und badge-counts laeuft bei jeder
      // Zaehler-Aktualisierung jedes Kontos.
      const [{ data }, alleGemeinden] = await Promise.all([
        api.get('/notifications/badge-counts'),
        mehrereGemeinden
          ? api.get('/notifications/badge-counts/je-organisation')
            .then((res) => summeAllerGemeindenAusAntwort(res?.data))
            .catch(() => null)
          : Promise.resolve(null),
      ]);

      if (lauf !== gemeindeLauf.current) return;
      // Hat inzwischen eine SPAETER gestartete Zaehlung gegolten (oder eine
      // Aenderung von Hand), ist diese Antwort veraltet (zaehlungGestartet).
      if (nummer <= zaehlungGilt.current) return;
      zaehlungGilt.current = nummer;

      setSummeAllerGemeinden(alleGemeinden);
      setZahlGeladen(true);

      // chatUnreadByRoom-Struktur (Record<number, number>) beibehalten —
      // ChatRoom (initialUnreadRef) und ChatOverview (Effect-Trigger) hängen dran.
      const byRoomRaw: Record<string, number> = data?.chat?.byRoom || {};
      const unreadByRoom: Record<number, number> = {};
      let totalUnread = 0;
      Object.entries(byRoomRaw).forEach(([roomId, count]) => {
        const unread = Number(count) || 0;
        unreadByRoom[Number(roomId)] = unread;
        totalUnread += unread;
      });
      setChatUnreadByRoom(prev => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(unreadByRoom);
        const unveraendert = prevKeys.length === nextKeys.length
          && nextKeys.every(k => prev[Number(k)] === unreadByRoom[Number(k)]);
        return unveraendert ? prev : unreadByRoom;
      });
      setChatUnreadTotal(totalUnread);

      if (isAdmin) {
        setPendingRequestsCount(Number(data?.pendingRequests) || 0);
        setPendingEventsCount(Number(data?.pendingEvents) || 0);
      }
      setNewBadgesCount(Number(data?.newBadges) || 0);
      setPostfachUngelesen(Number(data?.postfach?.ungelesen) || 0);

      if (isLeadership) {
        // pendingChallenges bleibt die Quelle fuer den Reiter (Altfeld, das
        // auch aeltere Server liefern). Die Aufschluesselung je Challenge
        // kommt additiv in challengeApprovals -- aeltere Server
        // ohne das Feld: keine Kugel am Eintrag, kein Fehler.
        setPendingChallengesCount(Number(data?.pendingChallenges) || 0);
        const byChallengeRaw: Record<string, number> = data?.challengeApprovals?.byChallenge || {};
        const freigaben: Record<number, number> = {};
        Object.entries(byChallengeRaw).forEach(([challengeId, count]) => {
          const n = Number(count) || 0;
          if (n > 0) freigaben[Number(challengeId)] = n;
        });
        setPendingChallengesByChallenge(prev => {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(freigaben);
          const unveraendert = prevKeys.length === nextKeys.length
            && nextKeys.every(k => prev[Number(k)] === freigaben[Number(k)]);
          return unveraendert ? prev : freigaben;
        });

        // Neue Beitraege je Challenge, wartende eingeschlossen --
        // die rote Kugel am Eintrag. Fehlt das Feld (aelterer Server), bleibt
        // es null und die Liste rechnet wie bisher (Freigaben + Neuigkeiten).
        const neueRaw = data?.challengeNeueBeitraege;
        if (neueRaw && typeof neueRaw === 'object' && neueRaw.byChallenge && typeof neueRaw.byChallenge === 'object') {
          const neue = nurPositive(neueRaw.byChallenge);
          const wartend = nurPositive(neueRaw.wartendByChallenge);
          setChallengeNeueBeitraegeByChallenge(prev => (prev && gleicherInhalt(prev, neue)) ? prev : neue);
          setChallengeNeueWartendByChallenge(prev => gleicherInhalt(prev, wartend) ? prev : wartend);
        } else {
          setChallengeNeueBeitraegeByChallenge(null);
          setChallengeNeueWartendByChallenge(prev => Object.keys(prev).length === 0 ? prev : {});
        }
      }
      const byChallengeRaw: Record<string, number> = data?.challengeUpdates?.byChallenge || {};
      const neuigkeiten: Record<number, number> = {};
      let neuigkeitenTotal = 0;
      Object.entries(byChallengeRaw).forEach(([challengeId, count]) => {
        const n = Number(count) || 0;
        if (n > 0) {
          neuigkeiten[Number(challengeId)] = n;
          neuigkeitenTotal += n;
        }
      });
      // Referenz stabil halten, wenn sich inhaltlich nichts geaendert hat
      // (dasselbe Argument wie bei chatUnreadByRoom oben).
      setChallengeUpdatesByChallenge(prev => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(neuigkeiten);
        const unveraendert = prevKeys.length === nextKeys.length
          && nextKeys.every(k => prev[Number(k)] === neuigkeiten[Number(k)]);
        return unveraendert ? prev : neuigkeiten;
      });
      setChallengeUpdatesTotal(neuigkeitenTotal);
    } catch (error) {
      console.error('BadgeContext: refreshAllCounts fehlgeschlagen:', error);
    }
  }, [user, isAdmin, isLeadership, mehrereGemeinden]);

  const appSymbolZahl = mehrereGemeinden && summeAllerGemeinden != null
    ? summeAllerGemeinden
    : totalBadgeCount;

  /**
   * Setzt alle Zaehler zurueck, die zur AKTIVEN GEMEINDE gehoeren.
   *
   * Das Postfach bleibt bewusst stehen: Es zaehlt die Mitteilungen des KONTOS
   * ueber alle Gemeinden (routes/notifications.js zaehlt sie ohne Org-Filter,
   * die Begruendung steht dort). Wer wechselt, hat nicht weniger ungelesene
   * Mitteilungen -- der Punkt an der Glocke darf nicht kurz
   * verschwinden.
   * Aus demselben Grund bleibt summeAllerGemeinden stehen: Sie haengt nicht
   * an der aktiven Gemeinde, das Symbol soll beim Wechsel nicht springen.
   */
  const setzeGemeindeZaehlerZurueck = useCallback(() => {
    setChatUnreadByRoom({});
    setChatUnreadTotal(0);
    setPendingRequestsCount(0);
    setPendingEventsCount(0);
    setPendingChallengesCount(0);
    setPendingChallengesByChallenge({});
    setNewBadgesCount(0);
    setChallengeUpdatesByChallenge({});
    setChallengeUpdatesTotal(0);
    setChallengeNeueBeitraegeByChallenge(null);
    setChallengeNeueWartendByChallenge({});
    // Bis die neue Gemeinde gezaehlt ist, setzt Android keine Zahl
    // (zahlGeladen oben) -- sonst stuende dort kurz die zurueckgesetzte 0.
    setZahlGeladen(false);
  }, []);

  /*
   * WARUM DAS HIER STEHEN MUSS: Der BadgeProvider liegt in App.tsx AUSSERHALB
   * des Routers -- und nur der Router haengt am orgVersion-Schluessel. Der
   * Remount, der alle Ansichten frisch laedt, erreicht diesen Provider also
   * nie; seine Zahlen ueberleben den Wechsel unberuehrt. Dass sie sich
   * ueberhaupt irgendwann erneuerten, lag allein daran, dass AppContext beim
   * Wechsel ein neues user-Objekt setzt und damit refreshAllCounts neu
   * erzeugt. Darauf ist kein Verlass: Rolle und Gemeinde koennen gleich
   * bleiben, und bis die Antwort da ist, steht die alte Zahl weiter am Reiter.
   *
   * DIE REIHENFOLGE IST DER FIX: erst zuruecksetzen, dann neu laden. Umgekehrt
   * (oder nur neu laden) bleibt die Zahl der alten Gemeinde sichtbar, bis der
   * Server antwortet -- und in einer Gemeinde ohne Challenges verschwindet sie
   * nur, weil die Antwort sie auf 0 setzt. Sind Rollen verschieden (Teamer:in
   * in A, Konfi in B), setzt refreshAllCounts die Zaehler der anderen Rolle
   * gar nicht: pendingChallenges stuende in der Konfi-Gemeinde dauerhaft auf
   * dem Wert aus A.
   *
   * gemeindeLauf hochzaehlen verwirft zugleich alle noch laufenden Abfragen
   * der alten Gemeinde (siehe refreshAllCounts).
   *
   * Das Postfach bleibt stehen, siehe setzeGemeindeZaehlerZurueck.
   *
   * 'auth:org-fallback' gehoert dazu: Verliert jemand den Zugang zur
   * Zweitgemeinde (403), setzt AppContext die App auf die Stamm-Gemeinde
   * zurueck -- ohne 'org:switched' zu feuern. Das ist derselbe Wechsel und
   * braucht dieselbe Behandlung, sonst zeigten die Reiter weiter die Zahlen
   * einer Gemeinde, die die Person nicht mehr sehen darf.
   */
  useEffect(() => {
    const beiWechsel = () => {
      gemeindeLauf.current += 1;
      setzeGemeindeZaehlerZurueck();
      // Dieser Lauf ist damit bedient -- der user-Effekt unten, den AppContext
      // im selben Wechsel ebenfalls anstoesst, laesst ihn aus.
      bereitsGeladenFuerLauf.current = gemeindeLauf.current;
      refreshAllCounts();
    };
    window.addEventListener('org:switched', beiWechsel);
    window.addEventListener('auth:org-fallback', beiWechsel);
    return () => {
      window.removeEventListener('org:switched', beiWechsel);
      window.removeEventListener('auth:org-fallback', beiWechsel);
    };
  }, [setzeGemeindeZaehlerZurueck, refreshAllCounts]);

  // Aktueller Postfach-Stand fuer postfachGelesen: Wie viele tatsaechlich
  // wegfallen, muss VOR den beiden set-Aufrufen feststehen -- die Summe
  // aller Gemeinden (App-Symbol bei mehreren Gemeinden) sinkt um genau so
  // viele, nie unter 0.
  const postfachStand = useRef(0);
  useEffect(() => { postfachStand.current = postfachUngelesen; }, [postfachUngelesen]);

  const postfachGelesen = useCallback((anzahl: number | 'alle') => {
    zaehlungGilt.current = zaehlungGestartet.current;
    const weg = anzahl === 'alle'
      ? postfachStand.current
      : Math.min(postfachStand.current, Math.max(0, anzahl));
    postfachStand.current -= weg;
    setPostfachUngelesen(n => Math.max(0, n - weg));
  }, []);

  // markRoomAsRead: Optimistisch + API Call
  const markRoomAsRead = useCallback(async (roomId: number): Promise<void> => {
    // Zugestellte Chat-Notifications dieses Raums aus dem Mitteilungszentrum
    // entfernen (Bereich wurde geoeffnet/gelesen). Fire-and-forget.
    removeDeliveredForChatRoom(roomId);

    // Beide Zaehler aus DERSELBEN Quelle bedienen.
    //
    // Jetzt merkt sich der erste Setter den tatsaechlich abgezogenen Wert und
    // der zweite rechnet damit. React fuehrt beide Updater nacheinander mit
    // dem jeweils aktuellen Zustand aus, deshalb stimmt die Reihenfolge.
    let abgezogen = 0;
    setChatUnreadByRoom(prev => {
      abgezogen = prev[roomId] || 0;
      if (abgezogen === 0) return prev;
      return { ...prev, [roomId]: 0 };
    });
    setChatUnreadTotal(prev => Math.max(0, prev - abgezogen));

    // API Call im Hintergrund — offline: Queue-Fallback
    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'POST',
        url: `/chat/rooms/${roomId}/mark-read`,
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: `mark-read-${roomId}-${Date.now()}`, label: 'Mark-Read' },
      });
      return;
    }
    // AWAIT, NICHT FIRE-AND-FORGET.
    await api.post(`/chat/rooms/${roomId}/mark-read`)
      .then(() => {
        // Den zwischengespeicherten Raum-Stand verwerfen.
        //
        // remove() statt set(): Der naechste Aufruf der Uebersicht holt die
        // Raeume frisch vom Server, statt dass wir hier eine zweite Wahrheit
        // pflegen, die wieder auseinanderlaufen kann.
        if (user?.id) offlineCache.remove(`chat:rooms:${user.id}`);
      })
      .catch(err => {
        console.error('BadgeContext: markRoomAsRead API fehlgeschlagen:', err);
      });
  }, [chatUnreadByRoom, user?.id]);

  const markChallengeAsRead = useCallback(async (challengeId: number): Promise<void> => {
    if (!user || user.role_name === 'super_admin') return;
    if (user.type !== 'konfi' && user.type !== 'teamer' && user.type !== 'admin') return;

    // Beide Zaehler aus DERSELBEN Quelle bedienen -- dasselbe Muster wie in
    // markRoomAsRead: der erste Updater merkt sich, was
    // tatsaechlich abgezogen wurde, der zweite rechnet damit.
    let abgezogen = 0;
    setChallengeUpdatesByChallenge(prev => {
      abgezogen = prev[challengeId] || 0;
      if (abgezogen === 0) return prev;
      const next = { ...prev };
      delete next[challengeId];
      return next;
    });
    setChallengeUpdatesTotal(prev => Math.max(0, prev - abgezogen));
    // Die rote Kugel am Eintrag von Leitung und Team geht beim
    // Oeffnen ebenso sofort auf 0 -- auch wenn darin wartende Beitraege
    // standen; die bleiben orange, bis jemand freigibt.
    const ohneDiese = (prev: Record<number, number>) => {
      if (!(challengeId in prev)) return prev;
      const next = { ...prev };
      delete next[challengeId];
      return next;
    };
    setChallengeNeueBeitraegeByChallenge(prev => (prev ? ohneDiese(prev) : prev));
    setChallengeNeueWartendByChallenge(ohneDiese);

    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'POST',
        url: `/challenges/konfi/${challengeId}/mark-read`,
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: `challenge-mark-read-${challengeId}-${Date.now()}`, label: 'Challenge gelesen' },
      });
      return;
    }
    // AWAIT wie bei markRoomAsRead: Wer danach die
    // Zaehler neu laedt, muss den verbuchten Stand bekommen.
    await api.post(`/challenges/konfi/${challengeId}/mark-read`)
      .catch(err => {
        console.error('BadgeContext: markChallengeAsRead API fehlgeschlagen:', err);
      });
  }, [user]);

  // Sync Device Badge bei Änderung von appSymbolZahl.
  // Nur auf nativen Plattformen: im Desktop-Browser existiert navigator.setAppBadge/
  // clearAppBadge nicht (z.B. Firefox) -> der Web-Fallback des Plugins wirft eine
  // unhandled rejection. Promises zusaetzlich mit .catch absichern.
  const setzeGeraeteBadge = useCallback(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (appSymbolZahlNativ()) {
      if (!zahlGeladen) return;
      appSymbolZahlSetzen(appSymbolZahl).catch((error) => {
        console.warn('BadgeContext: Zahl am App-Symbol nicht gesetzt:', error);
      });
      return;
    }
    const p = appSymbolZahl > 0
      ? Badge.set({ count: appSymbolZahl })
      : Badge.clear();
    Promise.resolve(p).catch((error) => {
      console.warn('BadgeContext: Badge nicht verfügbar:', error);
    });
  }, [appSymbolZahl, zahlGeladen]);

  useEffect(() => { setzeGeraeteBadge(); }, [setzeGeraeteBadge]);

  // WebSocket: Live-Update bei neuen Nachrichten
  useEffect(() => {
    const token = getToken();
    if (!token || !user) return;

    const socket = initializeWebSocket(token);

    const handleNewMessage = () => {
      refreshAllCounts();
    };

    socket.on('newMessage', handleNewMessage);

    return () => {
      socket.off('newMessage', handleNewMessage);
    };
    // socketEpoch in den Deps: nach Reconnect-mit-neuem-Token (reconnectWithToken)
    // ist getSocket() ein anderes Objekt -> Listener am frischen Socket neu binden.
  }, [refreshAllCounts, user, socketEpoch]);

  // LiveUpdateContext-basierte Subscriptions für Daten-Events.
  // Stabiles Array (Modul-Konstante BADGE_LIVE_TYPES) -> kein Re-Subscribe pro Render.
  useLiveRefresh(BADGE_LIVE_TYPES, refreshAllCounts);

  // Sync: Reconnect + Resume Badge-Refresh
  useEffect(() => {
    if (!user) return;

    const handleSyncReconnect = () => {
      refreshAllCounts();
    };

    // Push-Empfang/-Tap: Counts sofort aktualisieren. Der Push-Listener
    // (inkl. Navigation) liegt zentral in AppContext und feuert dieses Event,
    // damit hier KEIN zweiter PushNotifications-Listener nötig ist.
    window.addEventListener('sync:reconnect', handleSyncReconnect);
    window.addEventListener('push:received', handleSyncReconnect);
    return () => {
      window.removeEventListener('sync:reconnect', handleSyncReconnect);
      window.removeEventListener('push:received', handleSyncReconnect);
    };
  }, [user, refreshAllCounts]);

  // Initialer Load der Counts. KEIN Dauer-Polling mehr:
  // - Chat-Unread aktualisiert der WebSocket ('newMessage')
  // - Aktivitäten/Events aktualisiert LiveUpdate ('requests'/'events', s. useLiveRefresh oben)
  // - Nach Verbindungsabriss/Push feuert sync:reconnect bzw. push:received einen Refresh
  // Das frühere 30s-Intervall war durch diese Live-Kanäle redundant und erzeugte den
  // Großteil des /chat/rooms-Traffics (Admin-App offen = 120 Requests/h ohne Nutzen).
  useEffect(() => {
    if (!user) return;
    // Hat der Wechsel-Horcher fuer diesen Lauf schon geladen, waere das hier
    // dieselbe Abfrage ein zweites Mal (siehe bereitsGeladenFuerLauf oben).
    // Den Merker danach loeschen: Jeder weitere Anlass soll wieder laden.
    if (bereitsGeladenFuerLauf.current === gemeindeLauf.current) {
      bereitsGeladenFuerLauf.current = null;
      return;
    }
    refreshAllCounts();
  }, [user, refreshAllCounts]);

  // Reset bei Logout. Hier faellt AUCH das Postfach, anders als beim
  // Gemeindewechsel: Ohne Konto gibt es keine Mitteilungen, die zaehlen
  // koennten -- der Punkt an der Glocke waere der des abgemeldeten Kontos.
  useEffect(() => {
    if (!user) {
      setzeGemeindeZaehlerZurueck();
      setPostfachUngelesen(0);
      setSummeAllerGemeinden(null);
    }
  }, [user, setzeGemeindeZaehlerZurueck]);

  return (
    <BadgeContext.Provider value={{
      chatUnreadByRoom,
      chatUnreadTotal,
      pendingRequestsCount,
      pendingEventsCount,
      pendingChallengesCount,
      pendingChallengesByChallenge,
      newBadgesCount,
      challengeUpdatesByChallenge,
      challengeUpdatesTotal,
      challengeNeueBeitraegeByChallenge,
      challengeNeueWartendByChallenge,
      postfachUngelesen,
      totalBadgeCount,
      appSymbolZahl,
      refreshAllCounts,
      markRoomAsRead,
      markChallengeAsRead,
      postfachGelesen,
      // Legacy Alias
      badgeCount: chatUnreadTotal,
      refreshFromAPI: refreshAllCounts,
    }}>
      {children}
    </BadgeContext.Provider>
  );
};

// Custom Hook for easy access
export const useBadge = () => {
  const context = useContext(BadgeContext);
  if (context === undefined) {
    throw new Error('useBadge must be used within a BadgeProvider');
  }
  return context;
};
