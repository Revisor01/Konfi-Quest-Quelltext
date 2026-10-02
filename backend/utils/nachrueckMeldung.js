// Ein Ort fuer "sag den Nachgerueckten Bescheid".
//
// WARUM ES DIESE DATEI GIBT: Als am 15.09. die sechs Luecken
// geschlossen wurden, an denen ein Platz frei wurde und niemand nachrueckte,
// entstand an jeder Stelle derselbe Nachlauf: Terminnamen holen, Push
// schicken, Live-Update senden, Fehler je Person schlucken. Fuenfmal kopiert
// waere genau das Muster gewesen, gegen das promoteFromWaitlist und
// rueckeNach ueberhaupt angelegt wurden.
//
// bookingUtils bleibt bewusst frei davon: Dort steht die Datenbank-Logik, hier
// die Benachrichtigung. Der Schnitt ist derselbe wie im Kopf von
// bookingUtils ("Keine Push-Notifications oder liveUpdate-Aufrufe").
const PushService = require('../services/pushService');
const liveUpdate = require('./liveUpdate');

/**
 * Benachrichtigt alle, die auf einen frei gewordenen Platz nachgerueckt sind.
 *
 * NUR NACH DEM COMMIT aufrufen: Das Nachruecken selbst gehoert in die
 * Transaktion, die Benachrichtigung darf sie nicht kippen koennen. Deshalb
 * wird jeder Fehler je Person geschluckt und nur protokolliert.
 *
 * Der Wortlaut ist fuer Konfis und Teamer:innen derselbe
 * (sendWaitlistPromotionToTeamer ruft intern die Konfi-Fassung); der eigene
 * Einstiegspunkt macht an der Aufrufstelle sichtbar, welches Kontingent
 * gemeint war.
 *
 * @param {object} db - Pool (nicht der Transaktions-Client, der ist zurueck)
 * @param {number} organizationId
 * @param {Array<{eventId: number, userId: number, seite?: 'konfi'|'team'}>} nachgerueckt
 */
async function meldeNachrueckern(db, organizationId, nachgerueckt) {
  if (!Array.isArray(nachgerueckt) || nachgerueckt.length === 0) return;

  for (const eintrag of nachgerueckt) {
    try {
      const { rows: [event] } = await db.query(
        'SELECT name, event_date FROM events WHERE id = $1',
        [eintrag.eventId]
      );
      const name = event?.name || 'Event';
      const datum = event?.event_date || null;
      if (eintrag.seite === 'team') {
        await PushService.sendWaitlistPromotionToTeamer(db, eintrag.userId, name, datum, eintrag.eventId, organizationId);
      } else {
        await PushService.sendWaitlistPromotionToKonfi(db, eintrag.userId, name, datum, eintrag.eventId, organizationId);
      }
    } catch (pushErr) {
      console.error('Error sending waitlist promotion push:', pushErr);
    }
    // sendToUserByRole statt harter Adressierung: Nachruecken trifft Konfis
    // UND Teamer:innen, und die sitzen in verschiedenen Socket-Raeumen.
    liveUpdate.sendToUserByRole(eintrag.userId, 'events', 'update', { eventId: eintrag.eventId });
  }
}

module.exports = { meldeNachrueckern };
