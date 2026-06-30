import { Capacitor } from '@capacitor/core';
import { PushNotifications, type PushNotificationSchema } from '@capacitor/push-notifications';

// Zugestellte Notifications aus dem Mitteilungszentrum/Sperrbildschirm entfernen.
//
// Strategie (bewusst NICHT "beim App-Start alles loeschen", damit ungelesene
// Erinnerungen nicht verschwinden, nur weil die App geoeffnet wurde):
//   1) Beim Antippen einer Notification -> genau diese entfernen.
//   2) Beim Oeffnen des zugehoerigen Bereichs (Chat-Raum, Events) -> die
//      Notifications dieses Bereichs entfernen (an die Read-/Badge-Logik gekoppelt).
//
// Alle Funktionen sind no-ops im Web (kein natives Mitteilungszentrum) und
// schlucken Fehler defensiv: ein fehlgeschlagenes Aufraeumen darf den Flow
// (Navigation, Mark-Read) nie blockieren.

// ALLE zugestellten Notifications entfernen. Bewusst sparsam einsetzen
// (z.B. fuer Admins, die ohnehin laufend Erinnerungen bekommen) — fuer
// normale Nutzer waere "beim App-Start alles weg" zu aggressiv.
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
// (lieber liegen lassen als faelschlich loeschen).
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
    const data: any = n.data || {};
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
  'event_unregistration',
  'events_pending_approval',
]);

export const removeDeliveredForEvents = (): Promise<void> =>
  removeDeliveredWhere((n) => EVENT_NOTIFICATION_TYPES.has((n.data as any)?.type));
