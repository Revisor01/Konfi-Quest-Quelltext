import { Capacitor } from '@capacitor/core';
import { PushNotifications, type PushNotificationSchema } from '@capacitor/push-notifications';

// Zugestellte Notifications aus dem Mitteilungszentrum/Sperrbildschirm entfernen.
//
// Strategie (bewusst NICHT "beim App-Start alles löschen", damit ungelesene
// Erinnerungen nicht verschwinden, nur weil die App geoeffnet wurde):
//   1) Beim Antippen einer Notification -> genau diese entfernen.
//   2) Beim Oeffnen des zugehörigen Bereichs (Chat-Raum, Events) -> die
//      Notifications dieses Bereichs entfernen (an die Read-/Badge-Logik gekoppelt).
//
// Alle Funktionen sind no-ops im Web (kein natives Mitteilungszentrum) und
// schlucken Fehler defensiv: ein fehlgeschlagenes Aufräumen darf den Flow
// (Navigation, Mark-Read) nie blockieren.

/**
 * Nutzdaten eines Pushes, soweit die App sie liest.
 *
 * FCM liefert alle data-Werte als String, APNs teils als Zahl — deshalb sind
 * die Kennungen bewusst offen und werden vor dem Vergleich per String()
 * normalisiert.
 */
export interface PushNutzdaten {
  type?: string;
  roomId?: string | number;
  room_id?: string | number;
  organization_id?: string | number;
  [feld: string]: unknown;
}

// ---------------------------------------------------------------------------
// Benachrichtigungskanaele (nur Android)
//
// Die Kennungen muessen zu KANAL_JE_TYP in backend/push/firebase.js passen —
// der Server schickt die channelId mit. Wer hier einen Kanal ergaenzt, traegt
// ihn DORT ebenfalls ein, sonst wird er nie benutzt.
//
// Nur Android: iOS kennt keine Kanaele, dort ist createChannel nicht
// verfuegbar. Ein erneuter Aufruf fuer einen bestehenden Kanal ist harmlos —
// Android aktualisiert dann nur Name und Beschreibung. Was Nutzer:innen selbst
// eingestellt haben (Ton, Wichtigkeit), bleibt dabei unangetastet; deshalb ist
// das hier bei jedem App-Start gefahrlos.
// ---------------------------------------------------------------------------

interface Kanal {
  id: string;
  name: string;
  description: string;
}

const KANAELE: Kanal[] = [
  {
    id: 'konfi_chat',
    name: 'Nachrichten',
    description: 'Neue Nachrichten in deinen Chats',
  },
  {
    id: 'konfi_termine',
    name: 'Events',
    description: 'Anmeldungen, Änderungen, Absagen und Erinnerungen',
  },
  {
    id: 'konfi_fortschritt',
    name: 'Punkte und Badges',
    description: 'Punkte, Badges, Level, Challenges und der Rückblick',
  },
  {
    // Geht an Leitung und org_admin; bei der Challenge-Einreichung zusaetzlich
    // an die Teamer:innen des betroffenen Jahrgangs (siehe
    // sendChallengeSubmissionToLeadership). Deshalb kein Name wie "Fuer die
    // Leitung" — Teamer:innen bekaemen sonst Meldungen in einer Kategorie, die
    // ihnen sagt, sie sei nicht fuer sie. Bei Konfis bleibt der Kanal leer und
    // Android blendet ihn aus.
    id: 'konfi_verwaltung',
    name: 'Anfragen und Freigaben',
    description: 'Was auf deine Entscheidung wartet',
  },
];

// IMPORTANCE_DEFAULT (3): Ton und Einblendung, aber kein Vollbild-Overlay.
// Bewusst derselbe Wert wie beim bisherigen Notfallkanal, damit sich fuer
// niemanden die Lautstaerke aendert — neu ist nur, dass es mehrere Kanaele
// gibt und sie Namen haben.
const WICHTIGKEIT_STANDARD = 3;

export const benachrichtigungskanaeleAnlegen = async (): Promise<void> => {
  if (Capacitor.getPlatform() !== 'android') return;
  for (const kanal of KANAELE) {
    try {
      await PushNotifications.createChannel({
        id: kanal.id,
        name: kanal.name,
        description: kanal.description,
        importance: WICHTIGKEIT_STANDARD,
        visibility: 1, // VISIBILITY_PUBLIC: auch auf dem Sperrbildschirm lesbar
        vibration: true,
      });
    } catch (error) {
      // Kein Hard-Fail: ohne Kanal landet die Mitteilung im Notfallkanal und
      // kommt trotzdem an. Das darf den App-Start nicht aufhalten.
      console.warn(`notifications: Kanal ${kanal.id} nicht angelegt:`, error);
    }
  }
};


/*
 * Genau EINE zugestellte Notification anhand ihrer id entfernen.
 *
 *   java.lang.NullPointerException: Attempt to invoke virtual method
 *   'int java.lang.Integer.intValue()' on a null object reference
 *     at PushNotificationsPlugin.removeDeliveredNotifications (…:170)
 *
 * Hier stand der Kommentar "restliche Felder werden vom Plugin ignoriert" —
 * das war falsch, und zwar gerade fuer die id. Das Plugin macht (Quelle:
 * capacitor-plugins/push-notifications, Android):
 *
 *   Integer id = notif.getInteger("id");
 *   if (tag == null) { notificationManager.cancel(id); }
 *
 * `getInteger` liefert null, sobald der Wert keine Zahl ist. Das folgende
 * `cancel(id)` erwartet ein primitives int, entpackt die null — und wirft.
 * Der Absturz passiert NATIV, im Bridge-Thread: Das try/catch hier unten
 * faengt ihn NICHT. Die Notification-ids von FCM sind auf Android Zahlen,
 * koennen aber als String ankommen; alles andere (etwa APNs-Kennungen, oder
 * eine leere Angabe) darf diesen Aufruf nie erreichen.
 *
 * Deshalb: nur numerische ids weitergeben, und zwar als Zahl. Ist die id
 * keine, wird NICHT aufgeraeumt — eine liegenbleibende Mitteilung im
 * Mitteilungszentrum ist ungleich harmloser als eine abstuerzende App.
 */
export const removeDeliveredById = async (id: string | number): Promise<void> => {
  if (!Capacitor.isNativePlatform() || id === '' || id === null || id === undefined) return;

  // Number() statt parseInt: "12abc" darf NICHT als 12 durchgehen, sonst
  // loeschen wir eine fremde Mitteilung. Number('') waere 0 — deshalb steht
  // die Leerpruefung oben.
  const nummer = Number(id);
  if (!Number.isInteger(nummer)) {
    // Kein Fehlerfall fuer die Nutzenden, nur nichts zu tun. Als Warnung, weil
    // es bedeutet, dass eine Mitteilung stehen bleibt.
    console.warn('notifications: id ist keine Zahl, kein Aufraeumen:', id);
    return;
  }

  try {
    await PushNotifications.removeDeliveredNotifications({
      // `as` bleibt noetig: Das Schema verlangt Felder, die das Plugin beim
      // Entfernen nicht liest — die id liest es sehr wohl (siehe oben).
      notifications: [{ id: nummer } as unknown as PushNotificationSchema],
    });
  } catch (error) {
    // Faengt nur JS-seitige Fehler; der native NPE oben ist damit NICHT
    // abgedeckt und deshalb vorher ausgeschlossen.
    console.warn('notifications: removeDeliveredById fehlgeschlagen:', error);
  }
};

// ---------------------------------------------------------------------------
// Art und Raum einer liegenden Mitteilung
//
// Tester-Rueckmeldung Build 130: Die Mitteilung zu einem Chat blieb in der
// Leiste, nachdem der Chat gelesen war. Auf dem iPhone ist `data` hier der
// Push-Inhalt (userInfo). Auf Android NICHT: Das Plugin gibt dort die
// Notification.extras zurueck (android.title, android.text ...), den
// Push-Inhalt legt das FCM-SDK nur in den Intent zum Antippen. Der Vergleich
// auf data.type/data.roomId traf auf Android deshalb nie.
//
// Lesbar ist dort der tag. Der Server schreibt Art und Raum hinein
// (backend/utils/mitteilungsKennung.js): "kq:<art>:<raum>:<eindeutig>". Wer
// das Format aendert, aendert es an beiden Stellen; der Backend-Test
// mitteilungsKennung.test.js liest diese Datei mit.
//
// Nicht erkannt und deshalb nie weggeraeumt: Mitteilungen von Servern vor
// dieser Aenderung ("FCM-Notification:<Zeit>") und die EINE Mitteilung, an
// der auf Samsung und Xiaomi die Zahl am Symbol haengt (konfi_app_symbol) --
// die geht erst, wenn die Zahl auf 0 sinkt (AppSymbolZahl.java).
// ---------------------------------------------------------------------------
export const TAG_PRAEFIX = 'kq';

/** Art und Raum aus dem tag "kq:<art>:<raum>:<eindeutig>", sonst null. */
export const nutzdatenAusTag = (tag: unknown): PushNutzdaten | null => {
  if (typeof tag !== 'string') return null;
  const [praefix, art, raum] = tag.split(':');
  if (praefix !== TAG_PRAEFIX || !art) return null;
  return raum ? { type: art, roomId: raum } : { type: art };
};

/** Die Nutzdaten einer liegenden Mitteilung -- auf jeder Plattform dieselbe Form. */
const nutzdatenVon = (n: PushNotificationSchema): PushNutzdaten => {
  const daten = (n.data ?? {}) as PushNutzdaten;
  if (typeof daten.type === 'string') return daten;
  return nutzdatenAusTag((n as { tag?: unknown }).tag) ?? daten;
};

// ---------------------------------------------------------------------------
// Nachholen, was vor der Registrierung verweigert wurde (nur iOS)
//
// Das iOS-Plugin verweigert getDeliveredNotifications und
// removeDeliveredNotifications, bis die App fuer Pushes registriert ist
// ("event capacitorDidRegisterForRemoteNotifications not called",
// PushNotificationsPlugin.swift). Startet ein Push die App kalt und springt sie
// gleich in den Chat, wird der Raum gelesen, bevor die Registrierung durch
// ist -- das Aufraeumen ging dabei verloren. Deshalb merkt sich ein
// gescheitertes Aufraeumen seinen Bereich und laeuft noch einmal, sobald die
// Registrierung da ist (AppContext, Ereignis 'registration' bzw.
// 'registrationError' -- beide heben die Sperre im Plugin auf).
//
// Je Bereich hoechstens ein Eintrag (Schluessel "chat:62", "events"); die
// Liste waechst also nicht, wie oft der Raum auch geoeffnet wird.
// ---------------------------------------------------------------------------
const offeneAufraeumen = new Map<string, (n: PushNotificationSchema) => boolean>();

// Alle zugestellten Notifications entfernen, die ein Praedikat erfuellen.
// Das Praedikat bekommt das vom Plugin gelieferte PushNotificationSchema
// mit den Nutzdaten in `data` -- auf Android aus dem tag gelesen (oben).
// Liefert getDeliveredNotifications keine (kommt auf manchen iOS-Versionen
// vor), wird die Notification NICHT entfernt (lieber liegen lassen als
// faelschlich löschen). Zurueck ans Plugin geht die Mitteilung unveraendert:
// Android raeumt per cancel(tag, id), iOS per id.
export const removeDeliveredWhere = async (
  predicate: (n: PushNotificationSchema) => boolean,
  bereich?: string
): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const delivered = await PushNotifications.getDeliveredNotifications();
    const match = (delivered.notifications || []).filter((n) => {
      try {
        return predicate({ ...n, data: nutzdatenVon(n) });
      } catch {
        return false;
      }
    });
    if (bereich) offeneAufraeumen.delete(bereich);
    if (match.length === 0) return;
    await PushNotifications.removeDeliveredNotifications({ notifications: match });
  } catch (error) {
    if (bereich) offeneAufraeumen.set(bereich, predicate);
    console.warn('notifications: removeDeliveredWhere fehlgeschlagen:', error);
  }
};

/** Holt jedes verweigerte Aufraeumen einmal nach (siehe oben). */
export const aufraeumenNachholen = async (): Promise<void> => {
  const offen = [...offeneAufraeumen.entries()];
  offeneAufraeumen.clear();
  for (const [bereich, praedikat] of offen) {
    await removeDeliveredWhere(praedikat, bereich);
  }
};

// Bequemer Wrapper: alle Chat-Notifications eines Raums entfernen.
// roomId kann im Push-Payload als String oder Number liegen -> beide vergleichen.
export const removeDeliveredForChatRoom = (roomId: number): Promise<void> =>
  removeDeliveredWhere((n) => {
    const data = (n.data ?? {}) as PushNutzdaten;
    if (data.type !== 'chat') return false;
    const rid = data.roomId ?? data.room_id;
    return rid != null && String(rid) === String(roomId);
  }, `chat:${roomId}`);

// Bequemer Wrapper: alle event-bezogenen Notifications entfernen
// (wird beim Oeffnen der Events-Seite genutzt).
const EVENT_NOTIFICATION_TYPES = new Set([
  'new_event',
  'event_registered',
  'event_unregistered',
  'event_removed',
  'event_waitlisted',
  'waitlist_promotion',
  'event_attendance',
  'event_reminder',
  'event_cancelled',
  'event_reactivated',
  'event_unregistration',
  'events_pending_approval',
]);

export const removeDeliveredForEvents = (): Promise<void> =>
  removeDeliveredWhere((n) => {
    const typ = (n.data as PushNutzdaten | undefined)?.type;
    return typeof typ === 'string' && EVENT_NOTIFICATION_TYPES.has(typ);
  }, 'events');
