// Zugriffsregel für Socket-Räume im Chat.
//
// Über den Socket-Raum `room_<id>` verteilt chat.js das vollstaendige
// Nachrichtenobjekt (newMessage, pollUpdated, reactionAdded, messageDeleted)
// sowie die Tipp-Anzeige. Geprueft wurde beim Beitritt bisher NUR die
// Organisation — jeder angemeldete Nutzer derselben Gemeinde konnte damit
// jedem Raum beitreten und alle neuen Nachrichten mitlesen, auch fremde
// Direktchats.
//
// Die Regel entspricht der der HTTP-Routen in routes/chat.js:
//   - Raum muss zur aktiven Organisation des Nutzers gehören
//   - Leitung/Admins (type 'admin', also admin | org_admin | super_admin)
//     duerfen org-weit, ohne Teilnehmerschaft — AUSSER bei Direktchats:
//     ein Zwiegespraech ist privat (dieselbe Regel wie in routes/chat.js)
//   - alle anderen müssen Teilnehmer:in des Raums sein
//
// user_type ist dabei dreiwertig ('admin' | 'teamer' | 'konfi') und muss exakt
// dem Wert in chat_participants entsprechen — ein Teamer, der als 'admin'
// gesucht wird, findet seinen eigenen Raum nicht.

/**
 * Prueft, ob ein Nutzer den Socket-Raum eines Chats betreten darf.
 *
 * @param {object} db    Pool oder Client mit .query
 * @param {number} roomId
 * @param {{id:number, organization_id:number, type:string}} user
 * @returns {Promise<{ok:boolean, grund?:string}>}
 */
async function darfRaumBetreten(db, roomId, user) {
  if (!user || !Number.isInteger(Number(roomId))) {
    return { ok: false, grund: 'ungueltige Anfrage' };
  }

  const { rows: [raum] } = await db.query(
    'SELECT organization_id, type FROM chat_rooms WHERE id = $1',
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

  // Leitung/Admins duerfen gemeindeweit — aber NICHT in fremde Direktchats.
  // Sonst wäre der Schutz aus routes/chat.js (darfRaumOeffnen) hier zu
  // umgehen: Die Historie wäre gesperrt, der Live-Kanal aber offen, und über
  // newMessage liessen sich alle neuen Nachrichten mitlesen.
  if (user.type === 'admin' && raum.type !== 'direct') return { ok: true };

  const { rows: [teilnehmer] } = await db.query(
    'SELECT 1 FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3',
    [roomId, user.id, user.type]
  );
  if (!teilnehmer) return { ok: false, grund: 'kein Teilnehmer' };

  return { ok: true };
}

module.exports = { darfRaumBetreten };
