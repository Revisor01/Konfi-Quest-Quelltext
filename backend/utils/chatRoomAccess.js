// Wer darf einen Chat-Raum öffnen? — die EINE Regel für alle Wege hinein.
//
// Sie gilt für die REST-Routen in routes/chat.js (darfRaumOeffnen: Raum,
// Nachrichten lesen und schreiben, gelesen markieren, Teilnehmerliste,
// Teilnehmende hinzufügen und entfernen, Export, Dateien, Umfragen anlegen
// und abstimmen, fremde Nachrichten löschen, Reaktionen lesen, Raum löschen,
// Team-Chat leeren) und für den Socket (joinRoom, typing, stopTyping —
// socketRaumEreignisse unten, eingehängt in server.js). Über den Socket-Raum
// `room_<id>` verteilt chat.js das vollständige Nachrichtenobjekt; wer ihm
// beitritt, liest jede neue Nachricht live mit.

const { darfJahrgang, darfTermin } = require('./jahrgangsZugriff');

/**
 * Prüft, ob ein Nutzer einen Chat-Raum öffnen (und seinem Socket-Raum
 * beitreten) darf.
 *
 * Der Nutzer ist so geformt, wie rbac.js (req.user) und die Socket-Anmeldung
 * (utils/socketAnmeldung.js, socket.user) ihn bauen: id, organization_id (aktive Gemeinde),
 * role_name (Rolle IN dieser Gemeinde) und type. Zuweisungen und das
 * Super-Admin-Merkmal liest die Funktion selbst aus der Datenbank — der Socket
 * trägt sie nicht, und so antworten beide Wege aus derselben Quelle.
 *
 * @param {object} db    Pool oder Client mit .query
 * @param {number|string} roomId
 * @param {{id:number, organization_id:number|string, role_name?:string, type:string}} user
 * @returns {Promise<{ok:boolean, grund?:string}>}
 */
async function darfRaumBetreten(db, roomId, user) {
  if (!user || !Number.isInteger(Number(roomId))) {
    return { ok: false, grund: 'ungültige Anfrage' };
  }

  const { rows: [raum] } = await db.query(
    'SELECT organization_id, type, jahrgang_id, event_id FROM chat_rooms WHERE id = $1',
    [roomId]
  );
  if (!raum) return { ok: false, grund: 'nicht gefunden' };

  // Numerisch vergleichen, nicht strikt: Der pg-Treiber liefert bigint als
  // String ("1"), während die Socket-Auth nach einem Organisationswechsel
  // eine Zahl setzt (parseInt). Ein strikter Vergleich sperrte
  // Mehr-Organisations-Leitungen aus jedem Chat ihrer aktiven Zweitgemeinde
  // aus — auch aus ihren eigenen.
  if (Number(raum.organization_id) !== Number(user.organization_id)) {
    return { ok: false, grund: `Org-Isolation (Raum-Org ${raum.organization_id})` };
  }

  const { rows: [teilnehmer] } = await db.query(
    'SELECT 1 FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3',
    [roomId, user.id, user.type]
  );
  if (teilnehmer) return { ok: true };

  // Ohne Teilnahme: nur Admins (type 'admin' = admin | org_admin |
  // super_admin), und nie in Einzelchats — auch der Org-Admin nicht. Sonst
  // wäre der Schutz über den Live-Kanal zu umgehen.
  if (user.type !== 'admin' || raum.type === 'direct') {
    return { ok: false, grund: 'kein Teilnehmer' };
  }

  // Org-Admin und Super-Admin-Merkmal: gemeindeweit. Das Merkmal steht am
  // Konto (users.is_super_admin), nicht an der Rolle je Gemeinde.
  const { rows: [konto] } = await db.query(
    'SELECT is_super_admin FROM users WHERE id = $1',
    [user.id]
  );
  const vollzugriff = user.role_name === 'org_admin'
    || user.role_name === 'super_admin'
    || konto?.is_super_admin === true;
  if (vollzugriff) return { ok: true };

  // Admin: an seine Jahrgänge gebunden. Zuweisungen der Raum-Gemeinde, genau
  // wie rbac.js sie für req.user.assigned_jahrgaenge lädt — damit darfJahrgang
  // und darfTermin dieselbe Antwort geben wie Event-Liste und Jahrgangsdaten.
  const { rows: zuweisungen } = await db.query(
    `SELECT j.id, uja.can_view, uja.can_edit
       FROM user_jahrgang_assignments uja
       JOIN jahrgaenge j ON uja.jahrgang_id = j.id
      WHERE uja.user_id = $1 AND j.organization_id = $2`,
    [user.id, raum.organization_id]
  );
  const alsAnfrage = {
    user: {
      id: user.id,
      role_name: user.role_name || 'admin',
      is_super_admin: false,
      assigned_jahrgaenge: zuweisungen,
    },
  };

  if (raum.type === 'jahrgang') {
    return darfJahrgang(alsAnfrage, raum.jahrgang_id)
      ? { ok: true }
      : { ok: false, grund: 'Jahrgang nicht zugewiesen' };
  }

  if (raum.event_id) {
    const { erlaubt } = await darfTermin(db, alsAnfrage, raum.event_id);
    return erlaubt ? { ok: true } : { ok: false, grund: 'Event nicht in der eigenen Liste' };
  }

  // Team-Chat und Gruppen: offen, solange kein Konfi darin sitzt — dann ist
  // es Chat von Team zu Team. Eine Gruppe mit Konfis gehört zu deren
  // Jahrgängen; ohne Teilnahme bleibt sie zu.
  const { rows: [mitKonfi] } = await db.query(
    "SELECT 1 FROM chat_participants WHERE room_id = $1 AND user_type = 'konfi' LIMIT 1",
    [roomId]
  );
  return mitKonfi
    ? { ok: false, grund: 'Raum mit Konfis ohne Teilnahme' }
    : { ok: true };
}

/**
 * @param {import('socket.io').Socket} socket  mit socket.user wie oben
 * @param {object} db
 */
function socketRaumEreignisse(socket, db) {
  socket.on('joinRoom', async (roomId) => {
    try {
      const erlaubt = await darfRaumBetreten(db, roomId, socket.user);
      if (!erlaubt.ok) {
        console.warn(`Socket joinRoom abgelehnt: User ${socket.user.id} -> Room ${roomId} (${erlaubt.grund})`);
        return;
      }
      socket.join(`room_${roomId}`);
    } catch (err) {
      console.error('Socket joinRoom Fehler:', err.message);
    }
  });

  socket.on('leaveRoom', (roomId) => {
    socket.leave(`room_${roomId}`);
  });

  // Auch hier dieselbe Regel: Ohne sie liesse sich über die Tipp-Anzeige
  // verraten, wer gerade in einem fremden Raum schreibt.
  socket.on('typing', async (roomId) => {
    try {
      const erlaubt = await darfRaumBetreten(db, roomId, socket.user);
      if (!erlaubt.ok) return;
      socket.to(`room_${roomId}`).emit('userTyping', {
        roomId,
        userId: socket.user.id,
        userName: socket.user.display_name
      });
    } catch (err) {
      console.error('Socket typing Fehler:', err.message);
    }
  });

  socket.on('stopTyping', async (roomId) => {
    try {
      const erlaubt = await darfRaumBetreten(db, roomId, socket.user);
      if (!erlaubt.ok) return;
      socket.to(`room_${roomId}`).emit('userStoppedTyping', {
        roomId,
        userId: socket.user.id
      });
    } catch (err) {
      console.error('Socket stopTyping Fehler:', err.message);
    }
  });
}

module.exports = { darfRaumBetreten, socketRaumEreignisse };
