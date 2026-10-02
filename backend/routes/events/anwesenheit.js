const express = require('express');
const PushService = require('../../services/pushService');
const liveUpdate = require('../../utils/liveUpdate');
const { checkPointTypeEnabled } = require('../../utils/pointTypeGuard');
const { nachAntwort } = require('../../utils/nachAntwort');
const { darfTermin } = require('../../utils/jahrgangsZugriff');
const { rueckeNach } = require('../../utils/bookingUtils');
const { meldeNachrueckern } = require('../../utils/nachrueckMeldung');

// Deshalb requireAdmin (org_admin, admin) statt des frueheren requireTeamer.
// Gesperrt wird in BEIDEN Ebenen: Oberflaeche und Backend.
module.exports = (db, rbacVerifier, { requireAdmin }, checkAndAwardBadges) => {
  const router = express.Router();

  // Abgemeldete (status <> 'confirmed') und bereits Verbuchte
  // (attendance_status IS NOT NULL) bleiben in BEIDEN Faellen unangetastet:
  // "Alle verbuchen" darf keine getroffene Entscheidung ueberschreiben.
  //
  // Seit Migration 153 greift das bei einer von der Leitung
  // eingetragenen Abmeldung DOPPELT: Sie steht weder auf status='confirmed'
  // (sondern auf 'excused') noch auf attendance_status IS NULL. Beide
  // Bedingungen unten schliessen sie aus, jede fuer sich -- so bleibt der
  // Sammelknopf harmlos, auch wenn eine davon spaeter einmal wandert.
  router.put('/:id/participants/attendance-all', rbacVerifier, requireAdmin, async (req, res) => {
    const { id: eventId } = req.params;
    const rolle = req.body?.rolle === 'teamer' ? 'teamer' : 'konfi';
    const client = await db.getClient();
    try {
      const { rows: [event] } = await client.query(
        "SELECT organization_id, name, points, point_type, mandatory FROM events WHERE id = $1",
        [eventId]
      );
      if (!event) { return res.status(404).json({ error: 'Event nicht gefunden' }); }
      if (event.organization_id !== req.user.organization_id) { return res.status(403).json({ error: 'Zugriff verweigert' }); }

      const zugriff = await darfTermin(client, req, eventId);
      if (!zugriff.erlaubt) {
        return res.status(403).json({ error: 'Kein Zugriff auf dieses Event' });
      }

      await client.query('BEGIN');

      // Nur ANGEMELDETE Konfis ohne Anwesenheits-Status. Die Team-Seite
      // (Teamer:innen und zugeordnete Leitung) wird ueber rolle='teamer'
      // getrennt verbucht — eigene Liste, keine Punkte.
      //
      // Getrennt wird nach "ist Konfi" / "ist kein Konfi", nicht
      // mehr nach "ist Teamer": Sonst faellt eine zugeordnete Leitung in den
      // Konfi-Zweig und bekaeme dort Event-Punkte gutgeschrieben.
      const { rows: unprocessed } = await client.query(
        `SELECT eb.id AS booking_id, eb.user_id
         FROM event_bookings eb
         JOIN users u ON eb.user_id = u.id
         JOIN roles r ON u.role_id = r.id
         WHERE eb.event_id = $1 AND eb.status = 'confirmed'
           AND eb.attendance_status IS NULL
           AND (CASE WHEN $2 = 'teamer' THEN COALESCE(r.name, '') <> 'konfi' ELSE r.name = 'konfi' END)
         ORDER BY eb.created_at ASC`,
        [eventId, rolle]
      );

      const awarded = []; // Konfis, die Punkte bekommen haben
      const marked = [];  // alle als anwesend verbuchten Konfis
      const pointType = event.point_type || 'gemeinde';

      for (const b of unprocessed) {
        // Urheber wird hier MITGESCHRIEBEN (Migration 148): "Alle verbuchen"
        // ist eine Entscheidung der Leitung -- sie drueckt den Knopf und
        // erklaert damit alle Angemeldeten fuer anwesend. Dass es viele auf
        // einmal waren, aendert nichts daran, wer es war; bei einer Rueckfrage
        // ("wer hat das verbucht?") ist genau diese Person gemeint.
        //
        // Die QUELLE wird ebenfalls mitgeschrieben (Migration 151): 'manuell'
        // trennt diesen Weg vom Selbst-Check-in per QR-Code. Ohne ihn stuenden
        // "von Hand gesetzt" und "Altbestand" im selben NULL.
        await client.query(
          "UPDATE event_bookings SET attendance_status = 'present', attendance_set_by = $2, attendance_set_at = NOW(), checkin_quelle = 'manuell', checked_in_at = NOW() WHERE id = $1",
          [b.booking_id, req.user.id]
        );
        marked.push(b.user_id);

        // Punkte-Logik identisch zum Einzel-Handler: nur nicht-Pflicht-Events
        // mit Punkten. Deaktivierter Punkt-Typ bricht den Bulk NICHT ab —
        // die Person wird verbucht, nur ohne Punkte (anders als der 400 des
        // Einzel-Handlers, der bei einem Bulk alle uebrigen blockieren wuerde).
        // Punkte nur fuer Konfis. Teamer werden verbucht (fuer Abzeichen und
        // Anwesenheit), bekommen aber keine Konfi-Punkte.
        if (rolle === 'konfi' && event.points > 0 && !event.mandatory) {
          const { enabled: ptEnabled } = await checkPointTypeEnabled(client, b.user_id, pointType);
          if (!ptEnabled) continue;

          const { rowCount } = await client.query(
            `INSERT INTO event_points (konfi_id, event_id, points, point_type, description, awarded_date, admin_id, organization_id)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
             ON CONFLICT (konfi_id, event_id) DO NOTHING`,
            [b.user_id, eventId, event.points, pointType, `Event-Teilnahme: ${event.name}`, req.user.id, req.user.organization_id]
          );
          if (rowCount > 0) {
            const updateProfileQuery = pointType === 'gottesdienst'
              ? "UPDATE konfi_profiles SET gottesdienst_points = gottesdienst_points + $1 WHERE user_id = $2"
              : "UPDATE konfi_profiles SET gemeinde_points = gemeinde_points + $1 WHERE user_id = $2";
            await client.query(updateProfileQuery, [event.points, b.user_id]);
            awarded.push(b.user_id);
          }
        }
      }

      await client.query('COMMIT');
      res.json({
        message: marked.length > 0
          ? `${marked.length} Teilnehmer:in(nen) als anwesend verbucht${awarded.length > 0 ? `, ${event.points} Punkte je ${awarded.length}x vergeben` : ''}`
          : 'Keine unverbuchten Angemeldeten vorhanden',
        confirmed: marked.length,
        points_awarded: awarded.length
      });

      // Seiteneffekte NACH COMMIT (Muster Einzel-Handler): Badges, Level-Up,
      // Push und LiveUpdates pro Person fehlertolerant.
      nachAntwort(req, async () => {
        for (const userId of marked) {
          try {
            await checkAndAwardBadges(db, userId, { organizationId: req.user.organization_id });
          } catch (badgeErr) {
            console.error('Error checking badges after bulk attendance:', badgeErr);
          }
        }
        for (const userId of marked) {
          const gotPoints = awarded.includes(userId);
          try {
            if (gotPoints) {
              await PushService.checkAndSendLevelUp(db, userId, req.user.organization_id);
            }
            await PushService.sendEventAttendanceToKonfi(db, userId, event.name, 'present', gotPoints ? event.points : 0, eventId, req.user.organization_id);
          } catch (pushErr) {
            console.error('Push notification failed (bulk attendance):', pushErr);
          }
          if (gotPoints) {
            // sendToUserByRole: die Sammel-Anwesenheit laeuft ueber ALLE
            // Teilnehmenden eines Termins — darunter Teamer:innen, die in
            // user_teamer_<id> sitzen und hart adressiert nichts mitbekamen.
            liveUpdate.sendToUserByRole(userId, 'dashboard', 'update', { points: event.points });
          }
          liveUpdate.sendToUserByRole(userId, 'events', 'update', { eventId });
        }
        if (marked.length > 0) {
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
        }
      }, 'PUT /events/:eventId/participants/attendance-all');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /events/:eventId/participants/attendance-all:', eventId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      client.release();
    }
  });


  // Update participant attendance and award event points
  router.put('/:id/participants/:participantId/attendance', rbacVerifier, requireAdmin, async (req, res) => {
    const { id: eventId, participantId } = req.params;
    const { excuse_reason, attendance_note } = req.body;

    // Freitexte begrenzen und leere Eingaben auf NULL normalisieren, damit
    // "gar keine Notiz" und "Notiz aus Leerzeichen" nicht zweierlei sind.
    const textOderNull = (wert) => {
      if (typeof wert !== 'string') return null;
      const getrimmt = wert.trim();
      return getrimmt === '' ? null : getrimmt.slice(0, 500);
    };

    // Bis hierher kannte diese Route nur die drei gesetzten Zustaende. Wer
    // sich vertippt hatte, kam aus dem Eintrag nicht mehr heraus: Es gab
    // keinen Weg zurueck auf "noch nicht verbucht". Das war eine LUECKE, keine
    // Absicht -- die Notiz laesst sich loeschen (13.09.), der Abmeldegrund
    // wird beim Statuswechsel geleert, die Terminabsage laesst sich
    // zuruecknehmen. Nur der Status selbst hatte keinen Loeschweg.
    //
    // NULL ist der richtige Wert, kein vierter Status: "noch nicht verbucht"
    // ist genau der Zustand, in dem jede Buchung anfaengt. Ein eigener Status
    // waere ein zweiter Ausdruck fuer dasselbe -- und alle Abfragen, die
    // heute `attendance_status IS NULL` schreiben (Sammelverbuchung, Zaehlung,
    // Erinnerungen), muessten ihn zusaetzlich kennen.
    //
    // LEERER STRING UND undefined WIE NULL: Derselbe Weg, den die Notiz seit
    // dem 13.09. geht -- ein geleertes Feld heisst "weg damit". Genutzt wird
    // dafuer derselbe Helfer `textOderNull` statt eines neuen.
    //
    // ALT-APP-VERTRAG: Ausgelieferte Fassungen schicken immer einen der drei
    // Werte; keine schickt null, leer oder gar nichts. Fuer sie aendert sich
    // nichts. Der Fall, der bisher 400 lieferte, bekommt eine Bedeutung --
    // keine alte Fassung stuetzt sich darauf, dass das fehlschlaegt.
    const statusRoh = textOderNull(req.body.attendance_status);
    if (statusRoh !== null && !['present', 'absent', 'excused'].includes(statusRoh)) {
      return res.status(400).json({ error: 'Ungültiger Anwesenheitsstatus' });
    }
    const attendance_status = statusRoh;

    const grund = textOderNull(excuse_reason);
    const notiz = textOderNull(attendance_note);

    // Bis hierher stand im UPDATE `attendance_note = COALESCE($4,
    // attendance_note)`. Das hielt die Notiz fest, wenn das Feld gar nicht
    // mitkam -- gewollt, denn ein Statuswechsel soll sie nicht wegwerfen --,
    // machte sie aber zugleich unloeschbar: NULL kam durch COALESCE nie
    // durch. Setzen und aendern ging, entfernen nicht.
    //
    // WARUM EIN LEERER STRING UND KEIN EIGENES FLAG:
    // Die Route muss drei Faelle auseinanderhalten koennen --
    //   (a) Feld fehlt         -> Notiz bleibt, wie sie ist
    //   (b) Feld hat Text      -> Notiz wird gesetzt
    //   (c) Feld ist leer ("") -> Notiz wird geloescht
    // Ein zusaetzliches Flag (z. B. attendance_note_loeschen: true) waere ein
    // zweites Feld fuer dieselbe Sache und liesse den Widerspruch zu, Text
    // UND Loeschwunsch gleichzeitig zu schicken. Der leere String sagt
    // dagegen genau das, was die Nutzerin tut: Sie leert das Feld und
    // speichert. Die Unterscheidung "fehlt" gegen "ist leer" trifft
    // `attendance_note !== undefined` -- der Fall (a) bleibt damit exakt so,
    // wie er war.
    //
    // ALT-APP-VERTRAG: Ausgelieferte App-Fassungen schicken das Feld gar
    // nicht mit (Fall a) oder mit Text (Fall b). Beide verhalten sich
    // unveraendert. Nur der Fall, der bisher nichts bewirken KONNTE -- ein
    // leer geschicktes Feld -- bekommt eine Bedeutung. Keine alte Fassung
    // stuetzt sich darauf, dass das Leeren folgenlos bleibt; sie bietet das
    // Leeren gar nicht an.
    const notizMitgeschickt = attendance_note !== undefined;

    // Dedizierter Client für Transaction - pool.query() kann verschiedene
    // Connections nutzen, was BEGIN/COMMIT auf unterschiedliche Connections verteilt!
    const client = await db.getClient();
    // Im try steht NUR die Transaktion. Frueher Ausstieg und Nacharbeit
    // (Badges, Push, Live-Update, Antwort) laufen hinter dem finally — sonst
    // rollt ein Fehler aus der Nacharbeit eine Verbindung zurueck, die
    // inzwischen ein anderer Request aus dem Pool hat.
    let fruehAntwort = null;
    let eventData = null;
    let isKonfiParticipant = false;
    // Der Grundtext haengt am Fall: "aktualisiert" passt nicht auf eine
    // Ruecknahme. Die FELDER der Antwort bleiben in beiden Faellen dieselben
    // (message/points_awarded/points_removed) -- alte App-Fassungen lesen die
    // Form, nicht den Wortlaut.
    let responseData = {
      message: attendance_status === null ? 'Eintrag zurückgesetzt' : 'Anwesenheit aktualisiert',
      points_awarded: false,
      points_removed: false
    };
    let pointsAwarded = false;
    let pointsRemoved = false;
    let removedPointsAmount = 0;
    let nachgerueckt = [];
    try {
      await client.query('BEGIN');

      const eventDataQuery = `
        SELECT e.name, e.points, e.point_type, e.mandatory, eb.user_id, r.name AS participant_role,
               eb.status AS booking_status, eb.timeslot_id
        FROM events e
        JOIN event_bookings eb ON e.id = eb.event_id
        JOIN users u ON eb.user_id = u.id
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE e.id = $1 AND eb.id = $2 AND e.organization_id = $3
      `;
      const { rows: [gefunden] } = await client.query(eventDataQuery, [eventId, participantId, req.user.organization_id]);
      eventData = gefunden;
      if (!eventData) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 404, body: { error: 'Event oder Teilnehmer nicht gefunden, oder Zugriff verweigert' } };
      } else {

      const zugriff = await darfTermin(client, req, eventId);
      if (!zugriff.erlaubt) {
        await client.query('ROLLBACK');
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf dieses Event' } };
      } else {

      // Punkte gibt es NUR für Konfis. Teamer:innen nehmen zwar teil (Anwesenheit
      // wird gesetzt), bekommen aber keine Punkte -> Punkte-Logik (inkl.
      // checkPointTypeEnabled, das ein konfi_profile voraussetzt) ueberspringen.
      isKonfiParticipant = eventData.participant_role === 'konfi';

      // Der Grund gehoert zu 'excused' und wird beim Wechsel auf einen anderen
      // Status geleert -- sonst bliebe "krank" an einer Buchung stehen, die
      // inzwischen auf anwesend steht. Die Notiz dagegen haengt NICHT am
      // Status ("ging um 14 Uhr" gilt bei Anwesenheit) und bleibt, solange
      // nichts Neues geschickt wird. Kommt sie leer mit, wird sie geloescht
      // (siehe notizMitgeschickt oben).
      //
      //   attendance_set_by/_at -- Status samt Abmeldegrund
      //   note_set_by/_at       -- die Notiz
      //
      // GESCHRIEBEN WIRD, WAS SICH TATSAECHLICH GEAENDERT HAT -- nicht, was
      // mitgeschickt wurde. Die Route verlangt attendance_status bei JEDEM
      // Aufruf; wer nur eine Notiz nachtraegt, muss den bestehenden Status
      // (und bei 'excused' den Grund) mitschicken, damit er nicht verloren
      // geht. "Feld kam mit" heisst hier also nicht "jemand hat es
      // geaendert". Der Vergleich mit dem Bestand (IS DISTINCT FROM, das
      // NULL richtig behandelt) trennt beides.
      //
      // Aendert ein Aufruf beides, werden beide Paare gesetzt. Aendert er
      // nichts, bleibt jeder Urheber stehen -- ein erneutes Speichern
      // desselben Standes macht niemanden zur Urheberin.
      //
      // Beim LOESCHEN der Notiz faellt ihr Paar zurueck auf NULL: Es gibt
      // dann nichts mehr, dessen Urheberschaft festzuhalten waere, und ein
      // stehengebliebener Name behauptete eine Notiz, die nicht existiert.
      //
      // Bis hierher setzte eine Abmeldung nur attendance_status = 'excused'
      // und liess status auf 'confirmed' stehen. Daran hingen drei Fehler auf
      // einmal: Die Erinnerung ging weiter raus, der Platz blieb belegt, die
      // Warteliste rueckte nicht nach, und in der Teilnehmerliste stand die
      // abgemeldete Person ganz oben zwischen den Anwesenden. Eine Abmeldung
      // ist eine Aussage ueber die BUCHUNG, nicht nur ueber die Anwesenheit.
      //
      // ZURUECK AUF 'confirmed', wenn die Abmeldung aufgehoben wird: Wer von
      // 'excused' auf 'present' oder 'absent' gesetzt wird, ist wieder
      // gebucht. Ohne diesen Rueckweg waere jede Abmeldung endgueltig.
      //
      // 'waitlist' -> 'excused' -> 'confirmed' ist der einzige Uebergang, der
      // etwas verschiebt: Wer auf der Warteliste stand, abgemeldet und dann
      // doch verbucht wurde, landet auf 'confirmed'. Das ist richtig -- er
      // war da, also hatte er einen Platz. Der Weg zurueck auf die Warteliste
      // waere eine Aussage ueber einen Termin, der schon gelaufen ist.
      //
      // BEIM ZURUECKSETZEN ($1 IS NULL) durchlaufen die Zweige der Reihe nach:
      //   attendance_status        -> NULL (der Eintrag ist weg)
      //   status                   -> war er 'excused', faellt er auf
      //                               'confirmed' zurueck; 'opted_out',
      //                               'cancelled', 'pending' und 'waitlist'
      //                               bleiben unberuehrt. Genau derselbe Weg
      //                               wie beim Wechsel 'excused' -> 'present'.
      //   abgemeldet_durch_absage  -> FALSE, wenn die Abmeldung aufgeht
      //   excuse_reason            -> NULL (der Grund gehoert zu 'excused')
      //   attendance_note          -> BLEIBT. Sie haengt nicht am Status --
      //                               dieselbe Regel wie beim Wechsel zwischen
      //                               present und absent, wo sie auch stehen
      //                               bleibt. "Mutter hat angerufen" ist auch
      //                               dann noch wahr, wenn der Eintrag
      //                               zurueckgenommen wird; wer sie loswerden
      //                               will, loescht sie ueber ihren eigenen
      //                               Weg (leeres Feld, seit 13.09.).
      //   Urheber/Quelle/Zeit      -> NULL. Ein stehengebliebener Name
      //                               behauptete einen Eintrag, den es nicht
      //                               mehr gibt -- dieselbe Ueberlegung, die
      //                               beim Loeschen der Notiz ihr Urheber-Paar
      //                               zurueckfallen laesst.
      await client.query(
        `UPDATE event_bookings
            SET attendance_status = $1,
                status = CASE
                  WHEN status NOT IN ('confirmed', 'waitlist', 'excused') THEN status
                  WHEN $1 = 'excused' THEN 'excused'
                  WHEN status = 'excused' THEN 'confirmed'
                  ELSE status
                END,
                abgemeldet_durch_absage = CASE
                  WHEN status = 'opted_out' THEN FALSE
                  WHEN status NOT IN ('confirmed', 'waitlist', 'excused') THEN abgemeldet_durch_absage
                  WHEN $1 = 'excused' THEN FALSE
                  WHEN status = 'excused' THEN FALSE
                  ELSE abgemeldet_durch_absage
                END,
                excuse_reason = CASE WHEN $1 = 'excused' THEN $3 ELSE NULL END,
                attendance_note = CASE WHEN $6 THEN $4 ELSE attendance_note END,
                attendance_set_by = CASE
                  WHEN $1::text IS NULL THEN NULL
                  WHEN attendance_status IS DISTINCT FROM $1
                    OR excuse_reason IS DISTINCT FROM (CASE WHEN $1 = 'excused' THEN $3 ELSE NULL END)
                  THEN $5::integer ELSE attendance_set_by END,
                attendance_set_at = CASE
                  WHEN $1::text IS NULL THEN NULL
                  WHEN attendance_status IS DISTINCT FROM $1
                    OR excuse_reason IS DISTINCT FROM (CASE WHEN $1 = 'excused' THEN $3 ELSE NULL END)
                  THEN NOW() ELSE attendance_set_at END,
                note_set_by = CASE
                  WHEN $6 AND attendance_note IS DISTINCT FROM $4::text
                  THEN (CASE WHEN $4::text IS NULL THEN NULL ELSE $5::integer END)
                  ELSE note_set_by END,
                note_set_at = CASE
                  WHEN $6 AND attendance_note IS DISTINCT FROM $4::text
                  THEN (CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END)
                  ELSE note_set_at END,
                checkin_quelle = CASE
                  WHEN $1::text IS NULL THEN NULL
                  WHEN attendance_status IS DISTINCT FROM $1
                    OR excuse_reason IS DISTINCT FROM (CASE WHEN $1 = 'excused' THEN $3 ELSE NULL END)
                  THEN 'manuell' ELSE checkin_quelle END,
                checked_in_at = CASE
                  WHEN $1::text IS NULL THEN NULL
                  WHEN attendance_status IS DISTINCT FROM $1
                    OR excuse_reason IS DISTINCT FROM (CASE WHEN $1 = 'excused' THEN $3 ELSE NULL END)
                  THEN NOW() ELSE checked_in_at END
          WHERE id = $2`,
        [attendance_status, participantId, grund, notiz, req.user.id, notizMitgeschickt]
      );

      // Ab hier entscheidet `punkteGesperrt`, ob die Route noch weiterlaeuft:
      // Der fruehe 400 bei abgeschaltetem Punkt-Typ darf nicht mehr mitten im
      // try zurueckkehren (siehe Kommentar oben am Client).
      let punkteGesperrt = false;

      if (isKonfiParticipant && attendance_status === 'present' && eventData.points > 0 && !eventData.mandatory) {
        const pointType = eventData.point_type || 'gemeinde';
        const { enabled: ptEnabled, error: ptError } = await checkPointTypeEnabled(client, eventData.user_id, pointType);
        if (!ptEnabled) {
          await client.query('ROLLBACK');
          fruehAntwort = { status: 400, body: { error: ptError } };
          punkteGesperrt = true;
        } else {

        const description = `Event-Teilnahme: ${eventData.name}`;
        const awardPointsQuery = `
          INSERT INTO event_points (konfi_id, event_id, points, point_type, description, awarded_date, admin_id, organization_id)
          VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
          ON CONFLICT (konfi_id, event_id) DO NOTHING
        `;
        const { rowCount } = await client.query(awardPointsQuery, [
          eventData.user_id, eventId, eventData.points, pointType, description,
          req.user.id, req.user.organization_id
        ]);

        if (rowCount > 0) {
          const updateProfileQuery = pointType === 'gottesdienst'
          ? "UPDATE konfi_profiles SET gottesdienst_points = gottesdienst_points + $1 WHERE user_id = $2"
          : "UPDATE konfi_profiles SET gemeinde_points = gemeinde_points + $1 WHERE user_id = $2";
          await client.query(updateProfileQuery, [eventData.points, eventData.user_id]);

          try {
            await checkAndAwardBadges(client, eventData.user_id, { organizationId: req.user.organization_id });
          } catch (badgeErr) {
            console.error('Error checking badges after event attendance:', badgeErr);
          }

          pointsAwarded = true;
          responseData = { message: `Anwesenheit aktualisiert und ${eventData.points} ${pointType}-Punkte vergeben`, points_awarded: true };
        } else {
          responseData = { message: 'Anwesenheit aktualisiert (Punkte bereits vergeben)', points_awarded: false };
        }

        } // Punkt-Typ freigeschaltet
      } else if (isKonfiParticipant && (attendance_status === null || attendance_status === 'absent' || attendance_status === 'excused')) {
        // NULL GEHOERT IN DIESEN ZWEIG: Ein zurueckgesetzter
        // Eintrag darf keine Punkte hinterlassen. Sonst stuende die Person
        // danach als "noch nicht verbucht" in der Liste und haette die Punkte
        // trotzdem -- und ein spaeteres 'present' liefe in den
        // ON-CONFLICT-DO-NOTHING-Zweig ("Punkte bereits vergeben"), obwohl die
        // Leitung sie gerade erst vergeben zu haben glaubt.
        //
        // Das ist derselbe Weg, den die Herabstufung auf die Warteliste geht
        // (teilnehmer.js -> takeBackEventPoints): Wer keinen verbuchten
        // Eintrag hat, hat keine Event-Punkte. Die Punkte kommen zurueck,
        // sobald jemand wieder 'present' setzt.
        const { rows: [existingPoints] } = await client.query("SELECT id, points, point_type FROM event_points WHERE konfi_id = $1 AND event_id = $2", [eventData.user_id, eventId]);

        if (existingPoints) {
          await client.query("DELETE FROM event_points WHERE id = $1", [existingPoints.id]);
          const updateProfileQuery = existingPoints.point_type === 'gottesdienst'
          ? "UPDATE konfi_profiles SET gottesdienst_points = GREATEST(0, gottesdienst_points - $1) WHERE user_id = $2"
          : "UPDATE konfi_profiles SET gemeinde_points = GREATEST(0, gemeinde_points - $1) WHERE user_id = $2";
          await client.query(updateProfileQuery, [existingPoints.points, eventData.user_id]);
          pointsRemoved = true;
          removedPointsAmount = existingPoints.points;
          responseData = {
            message: attendance_status === null
              ? `Eintrag zurückgesetzt und ${existingPoints.points} Punkte entfernt`
              : `Anwesenheit aktualisiert und ${existingPoints.points} Punkte entfernt`,
            points_removed: true
          };
        }
      }

      // DER SCHAERFSTE DER SECHS FAELLE: "Die Mutter ruft an, das Kind ist
      // krank" passiert typischerweise Tage vor dem Termin -- genau dann, wenn
      // Nachruecken noch etwas bringt. Diese Datei rief bookingUtils bis heute
      // nicht einmal auf; der Platz verfiel still.
      //
      // Die Bedingung haengt am BUCHUNGSstatus, nicht am Anwesenheitsstatus:
      // Erst seit Migration 153 setzt das UPDATE oben auch status = 'excused',
      // und erst damit ist der Platz rechnerisch frei (zaehleBuchungen zaehlt
      // nur 'confirmed'). `rueckeNach` zaehlt selbst nach und befoerdert nur,
      // wenn wirklich Luft ist -- ein 'excused' auf einer Wartelisten-Buchung
      // gibt keinen Platz frei und loest deshalb nichts aus.
      //
      // Die SEITE folgt der Rolle der abgemeldeten Person: Ein frei gewordener
      // Konfi-Platz geht nie an einen wartenden Teamer und umgekehrt
      // (promoteFromWaitlist trennt ueber roleFilter).
      if (!punkteGesperrt && attendance_status === 'excused' && eventData.booking_status === 'confirmed') {
        nachgerueckt = await rueckeNach(client, {
          eventId,
          timeslotId: isKonfiParticipant ? eventData.timeslot_id : null,
          seite: isKonfiParticipant ? 'konfi' : 'team'
        });
      }

      if (!punkteGesperrt) {
        await client.query('COMMIT');
      }
      } // Jahrgangs-Zugriff
      } // Event/Teilnehmer gefunden
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /events/:eventId/participants/:participantId/attendance:', eventId, participantId, txErr);
      return res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      // KEIN client.release() im try — nur hier. Die Nacharbeit (Badges,
      // Pushes, Live-Updates, Antwort) steht bewusst dahinter.
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    try {
      // Wer durch die Abmeldung nachgerueckt ist, erfaehrt es — ueber denselben
      // Weg wie an allen anderen Nachrueck-Stellen (utils/nachrueckMeldung).
      await meldeNachrueckern(
        db,
        req.user.organization_id,
        nachgerueckt.map((userId) => ({
          eventId,
          userId,
          seite: isKonfiParticipant ? 'konfi' : 'team'
        }))
      );

      // Badge-Check NACH COMMIT für alle User (Teamer + Konfis)
      if (attendance_status === 'present') {
        try {
          await checkAndAwardBadges(db, eventData.user_id, { organizationId: req.user.organization_id });
        } catch (badgeErr) {
          console.error('Error checking badges after attendance update:', badgeErr);
        }
      }

      // Push und LiveUpdate NACH COMMIT und client.release() - nutzt pool (db) statt client.
      // Konfi-spezifische Pushes/Dashboard-Updates nur für Konfis; das Admin-
      // LiveUpdate (Liste/Badge) feuert immer.
        if (attendance_status === 'present') {
          if (isKonfiParticipant && pointsAwarded) {
            try { await PushService.checkAndSendLevelUp(db, eventData.user_id, req.user.organization_id); } catch (e) { console.error('Level-up check failed:', e); }
            try { await PushService.sendEventAttendanceToKonfi(db, eventData.user_id, eventData.name, 'present', eventData.points, eventId, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
            liveUpdate.sendToUser('konfi', eventData.user_id, 'dashboard', 'update', { points: eventData.points });
          } else if (isKonfiParticipant) {
            try { await PushService.sendEventAttendanceToKonfi(db, eventData.user_id, eventData.name, 'present', 0, eventId, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
          }
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
        } else if (attendance_status === 'absent') {
          if (isKonfiParticipant) {
            try { await PushService.sendEventAttendanceToKonfi(db, eventData.user_id, eventData.name, 'absent', 0, eventId, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
            if (pointsRemoved) {
              liveUpdate.sendToUser('konfi', eventData.user_id, 'dashboard', 'update', { points: -removedPointsAmount });
            }
          }
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
        } else if (attendance_status === 'excused') {
          // Der Text ist NICHT der von 'absent' ("nicht erschienen") -- das
          // klaenge nach unentschuldigtem Fehlen. Siehe
          // pushService.sendEventAttendanceToKonfi.
          if (isKonfiParticipant) {
            try { await PushService.sendEventAttendanceToKonfi(db, eventData.user_id, eventData.name, 'excused', 0, eventId, req.user.organization_id); } catch (e) { console.error('Push notification failed:', e); }
            if (pointsRemoved) {
              liveUpdate.sendToUser('konfi', eventData.user_id, 'dashboard', 'update', { points: -removedPointsAmount });
            }
          }
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
        } else {
          // ZURUECKGESETZT (attendance_status === null): KEIN Push an die
          // Person. Die drei Pushes oben melden ein Ergebnis ("du warst da",
          // "du hast gefehlt", "deine Abmeldung ist eingetragen") -- ein
          // zurueckgenommener Eintrag meldet nichts, er nimmt zurueck. Eine
          // Nachricht "dein Eintrag wurde geloescht" verunsichert nur; die
          // Leitung korrigiert hier einen eigenen Fehler.
          //
          // Das Live-Update an die Leitung feuert dagegen wie ueberall: Die
          // Teilnehmerliste steht in mehreren Fenstern offen und muss die
          // Ruecknahme sehen.
          liveUpdate.sendToOrgAdmins(req.user.organization_id, 'events', 'update', { eventId, action: 'attendance' });
          if (isKonfiParticipant) {
            liveUpdate.sendToUser('konfi', eventData.user_id, 'events', 'update', { eventId });
            if (pointsRemoved) {
              liveUpdate.sendToUser('konfi', eventData.user_id, 'dashboard', 'update', { points: -removedPointsAmount });
            }
          }
        }
    } catch (nachErr) {
      // Die Anwesenheit ist festgeschrieben — ein Fehler in der Nacharbeit
      // darf die Antwort nicht mehr kippen.
      console.error('Post-commit error in PUT /events/:eventId/participants/:participantId/attendance:', eventId, participantId, nachErr);
    }

    res.json(responseData);
  });

  return router;
};
