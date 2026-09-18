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
    name: 'Termine',
    description: 'Anmeldungen, Aenderungen, Absagen und Erinnerungen',
  },
  {
    id: 'konfi_fortschritt',
    name: 'Punkte und Abzeichen',
    description: 'Punkte, Abzeichen, Level, Challenges und der Rueckblick',
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

// ALLE zugestellten Notifications entfernen. Bewusst sparsam einsetzen
// (z.B. für Admins, die ohnehin laufend Erinnerungen bekommen) — für
// normale Nutzer wäre "beim App-Start alles weg" zu aggressiv.
export const removeAllDelivered = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch (error) {
    console.warn('notifications: removeAllDelivered fehlgeschlagen:', error);
  }
};

// Genau EINE zugestellte Notification anhand ihrer id entfernen.
export const removeDeliveredById = async (id: string): Promise<void> => {
  if (!Capacitor.isNativePlatform() || !id) return;
  try {
    await PushNotifications.removeDeliveredNotifications({
      // Nur die id ist relevant; restliche Felder werden vom Plugin ignoriert.
      notifications: [{ id } as PushNotificationSchema],
    });
  } catch (error) {
    console.warn('notifications: removeDeliveredById fehlgeschlagen:', error);
  }
};

// Alle zugestellten Notifications entfernen, die ein Praedikat erfuellen.
// Das Praedikat bekommt das vom Plugin gelieferte PushNotificationSchema
// (inkl. data-Payload). Liefert getDeliveredNotifications keine data (kommt
// auf manchen iOS-Versionen vor), wird die Notification NICHT entfernt
// (lieber liegen lassen als faelschlich löschen).
export const removeDeliveredWhere = async (
  predicate: (n: PushNotificationSchema) => boolean
): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const delivered = await PushNotifications.getDeliveredNotifications();
    const match = (delivered.notifications || []).filter((n) => {
      try {
        return predicate(n);
      } catch {
        return false;
      }
    });
    if (match.length === 0) return;
    await PushNotifications.removeDeliveredNotifications({ notifications: match });
  } catch (error) {
    console.warn('notifications: removeDeliveredWhere fehlgeschlagen:', error);
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
  });

// Bequemer Wrapper: alle event-bezogenen Notifications entfernen
// (wird beim Oeffnen der Events-Seite genutzt).
const EVENT_NOTIFICATION_TYPES = new Set([
  'new_event',
  'event_registered',
  'event_unregistered',
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
  });
