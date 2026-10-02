// backend/utils/mitteilungsKennung.js
//
// Kennung (Android-tag) einer sichtbaren Mitteilung, an der die App sie
// wiederfindet.
//
// WARUM ES AUF ANDROID NIE GING: Die App sucht beim Oeffnen eines Chats die
// liegenden Mitteilungen dieses Raums ueber getDeliveredNotifications und
// vergleicht data.type und data.roomId (frontend/src/services/
// notifications.ts). Auf dem iPhone ist data der Push-Inhalt (userInfo). Auf
// Android ist es etwas anderes: Das Plugin (@capacitor/push-notifications
// 8.1.2, PushNotificationsPlugin.getDeliveredNotifications) gibt dort die
// Notification.extras zurueck -- android.title, android.text und Aehnliches.
// Den Push-Inhalt legt das FCM-SDK nur in den Intent zum Antippen, und den
// kann niemand zuruecklesen. Der Vergleich traf deshalb nie, und keine
// Mitteilung verschwand. Lesbar ist auf Android neben id und extras nur der
// tag.
//
// Deshalb traegt jede sichtbare Mitteilung auf Android einen tag, aus dem die
// App Art und Raum zuruecklesen kann:
//
// Der letzte Teil macht jeden tag einmalig. Zwei Mitteilungen mit gleichem
// tag ersetzen einander in der Leiste; ohne tag vergab das FCM-SDK
// "FCM-Notification:<Zeit>" -- ebenfalls einmalig. In der Leiste aendert sich
// also nichts: Jede Mitteilung liegt weiter einzeln. Beim Chat ist es die
// Nachrichten-ID, damit ein zweimal verschickter Push derselben Nachricht die
// erste Mitteilung ersetzt statt sie zu verdoppeln.
//
// AUSNAHME Weg "mitteilungen" (Samsung, Xiaomi): Dort liegt alles unter dem
// festen tag konfi_app_symbol, damit nur eine Mitteilung die Zahl traegt
// (utils/appSymbolWeg.js). Diesen tag setzt firebase.js vorrangig; die
// Kennung hier kommt dort nicht zum Zug.
//
// Die App liest das Format in frontend/src/services/notifications.ts
// (nutzdatenAusTag). Wer es hier aendert, aendert es dort mit; ein Test
// (tests/utils/mitteilungsKennung.test.js) haelt beide Seiten zusammen.
const crypto = require('crypto');

const PRAEFIX = 'kq';

/** Nur Zeichen, die das Format nicht zerlegen: kein ":" und nichts Exotisches. */
function teil(wert) {
  if (wert === undefined || wert === null) return '';
  return String(wert).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/**
 * Der tag fuer eine sichtbare Mitteilung mit diesen Nutzdaten.
 *
 * @param {object} [daten]  data des Pushes ({ type, roomId, messageId, ... })
 * @returns {string}
 */
function mitteilungsKennung(daten = {}) {
  const art = teil(daten.type);
  const raum = art === 'chat' ? teil(daten.roomId ?? daten.room_id) : '';
  const eindeutig = teil(daten.messageId) || crypto.randomBytes(4).toString('hex');
  return `${PRAEFIX}:${art}:${raum}:${eindeutig}`;
}

module.exports = { mitteilungsKennung, PRAEFIX };
