// jahrgangsZugriff.js — Ein Ort fuer die Frage "darf dieser Aufrufer in diesem
// Jahrgang?". Vorher stand dieselbe Pruefung an vier Stellen kopiert und lief
// dort jeweils nur gegen 'teamer', sodass ein Admin durchfiel.
//
// Sollregel, woertlich:
//   "org admin macht admins mit jahrgang / admin sieht jahrgang und alle teamer
//    / admin ohne jahrgang sieht nur alle teamer / admin kann teamer seinen
//    jahrgaengen zuordnen oder in seine verschieben / admin kann konfis in
//    seinen jahrgaengen erstellen und sie auch nur in solche verschieben /
//    sprich ein admin ist bis auf bei den teamern immer an seine jahrgaenge
//    gebunden"
//
// Daraus folgt fuer diesen Baustein:
//   - super_admin / org_admin: immer true, von allen Jahrgangsbeschraenkungen
//     ausgenommen.
//   - admin und teamer: nur bei zugewiesenem Jahrgang
//     (user_jahrgang_assignments).
//   - konfi: nie true. Konfis haben zwar einen Jahrgang, aber kein
//     Zugriffsrecht AUF ihn im Sinne dieser Frage; sie kaemen ueber
//     assigned_jahrgaenge sonst zufaellig durch.
//
// NICHT hier abgebildet ist die Teamer-Ausnahme ("admin sieht alle
// Teamer:innen"). Sie betrifft Personenlisten, nicht den Jahrgangszugriff —
// wer Teamer:innen auflistet, ruft diesen Baustein schlicht nicht auf.

/**
 * Darf der Aufrufer auf diesen Jahrgang zugreifen?
 *
 * @param {object} req            Express-Request mit req.user (aus rbacVerifier).
 * @param {number|string} jahrgangId
 * @param {object} [optionen]
 * @param {boolean} [optionen.edit=false]  true -> can_edit statt can_view.
 * @returns {boolean}
 */
function darfJahrgang(req, jahrgangId, { edit = false } = {}) {
  if (!req || !req.user) return false;

  // ABWEICHUNG, bewusst und heute folgenlos: challenges.js
  // (viewableJahrgangIds) gibt der ROLLE super_admin ein leeres Array
  // (= sieht nichts); die etablierte Regel im Repo ist "super_admin hat auf
  // Jahrgangs-Daten keinen Zugriff". Hier bekaeme sie true.
  // Folgenlos, weil requireRole (rbac.js:242) strikt den Rollennamen prueft
  // und 'super_admin' in KEINER der Listen requireAdmin/requireTeamer steht --
  // ein super_admin erreicht diese Pruefung also gar nicht.
  // Wer das aufloest, sollte es in EINE Richtung tun: Die etablierte Regel
  // im Repo ist "super_admin hat auf Jahrgangs-Daten keinen Zugriff".
  if (req.user.is_super_admin || req.user.role_name === 'super_admin') return true;
  if (req.user.role_name === 'org_admin') return true;

  // Konfis haben ueber diesen Weg nie Zugriff (s.o.).
  if (req.user.role_name === 'konfi') return false;

  const id = parseInt(jahrgangId, 10);
  if (!Number.isInteger(id)) return false;

  const zuweisung = (req.user.assigned_jahrgaenge || []).find(j => j.id === id);
  if (!zuweisung) return false;

  // can_view und can_edit sind getrennte Spalten: Wer lesen darf, darf nicht
  // automatisch schreiben. Deshalb zwei Varianten statt einer.
  //
  // Warum can_view der Normalfall ist: Die umgestellten Stellen (Punktevergabe,
  // Bonuspunkte) haengen an "darf ich diesen Konfi ueberhaupt sehen". Wer den
  // Konfi nicht sehen darf, darf ihm erst recht nichts geben. Die bisherigen
  // Teamer-Pruefungen an genau diesen Stellen liefen ebenfalls gegen can_view
  // (activities.js, konfi-management.js) — die Umstellung soll die Rolle
  // erweitern, nicht nebenbei die Rechtestufe anheben und Teamer:innen
  // aussperren, die heute can_view ohne can_edit haben.
  return edit ? Boolean(zuweisung.can_edit) : Boolean(zuweisung.can_view);
}

/**
 * Darf der Aufrufer auf diese Konfi zugreifen? Prueft ueber den Jahrgang der
 * Konfi (konfi_profiles.jahrgang_id).
 *
 * Unterscheidet bewusst zwischen "Konfi gibt es nicht" und "kein Zugriff",
 * damit die Aufrufer weiterhin 404 bzw. 403 senden koennen wie bisher.
 *
 * NUR KONFIS DER AKTIVEN GEMEINDE: Eine
 * Konfi einer anderen Gemeinde gilt als nicht gefunden. Vorher las die
 * Abfrage konfi_profiles ohne Gemeinde, und die Leitung (org_admin) stieg in
 * darfJahrgang vor jeder Pruefung mit "erlaubt" aus -- fuer JEDE Konfi im
 * System. Die Grenze hielt dann nur noch, wo die Route spaeter selbst nach
 * der Gemeinde filterte: Bonuspunkte und nachgetragene Aktivitaeten liefen
 * in ein UPDATE mit 0 Zeilen und endeten mit 500, die Event-Punkte
 * antworteten 200 mit leerer Liste. Jetzt greift die Grenze an allen
 * Aufrufern zugleich.
 *
 * Die Gemeinde der Konfi steht in konfi_profiles.organization_id -- nicht in
 * users.organization_id: Wer am Konto in Gemeinde A zuhause ist und ueber
 * user_organizations in Gemeinde B Konfi ist, hat sein Profil in B
 * (konfi_profiles.user_id ist eindeutig, eine Person hat genau ein Profil).
 *
 * @param {object} db             Pool oder Client (muss .query haben).
 * @param {object} req            req.user.organization_id = aktive Gemeinde.
 * @param {number|string} konfiId
 * @param {object} [optionen]
 * @param {boolean} [optionen.edit=false]
 * @returns {Promise<{gefunden: boolean, erlaubt: boolean, jahrgangId: number|null}>}
 */
async function darfKonfi(db, req, konfiId, { edit = false } = {}) {
  const organisation = req && req.user ? req.user.organization_id : null;
  const { rows: [profil] } = await db.query(
    'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1 AND organization_id = $2',
    [konfiId, organisation]
  );

  if (!profil) return { gefunden: false, erlaubt: false, jahrgangId: null };

  // Konfi ohne Jahrgang: Nur der Vollzugriff kommt durch. darfJahrgang gibt
  // fuer null korrekt false zurueck, org_admin/super_admin steigen vorher aus.
  return {
    gefunden: true,
    erlaubt: darfJahrgang(req, profil.jahrgang_id, { edit }),
    jahrgangId: profil.jahrgang_id
  };
}

/**
 * Darf der Aufrufer diesen TERMIN bearbeiten?
 *
 * Die Regel folgt genau der Listen-Route, damit beide dasselbe meinen:
 *   - reine Teamer-Termine: immer erlaubt (haengen an keinem Jahrgang)
 *   - Termine ohne Jahrgangszuordnung: immer erlaubt (allgemeine Termine)
 *   - jahrgangsgebundene Termine: nur bei Ueberschneidung mit den eigenen
 *   - org_admin / super_admin: ausgenommen (ueber darfJahrgang)
 *
 * @param {object} db          Pool oder Client (muss .query haben).
 * @param {object} req
 * @param {number|string} eventId
 * @param {object} [optionen]
 * @param {boolean} [optionen.edit=false]  true -> can_edit statt can_view.
 * @returns {Promise<{gefunden: boolean, erlaubt: boolean}>}
 */
async function darfTermin(db, req, eventId, { edit = false } = {}) {
  const { rows: [termin] } = await db.query(
    `SELECT e.teamer_only,
            ARRAY_REMOVE(ARRAY_AGG(eja.jahrgang_id), NULL) AS jahrgang_ids
     FROM events e
     LEFT JOIN event_jahrgang_assignments eja ON eja.event_id = e.id
     WHERE e.id = $1
     GROUP BY e.id, e.teamer_only`,
    [eventId]
  );

  if (!termin) return { gefunden: false, erlaubt: false };

  // Reine Teamer-Termine haengen an keinem Jahrgang — es gibt nichts zu
  // schuetzen, und sie sind laut Sollregel ausdruecklich ausgenommen.
  if (termin.teamer_only) return { gefunden: true, erlaubt: true };

  // Allgemeine Termine (keine Zuordnung) sind fuer alle da.
  const ids = termin.jahrgang_ids || [];
  if (ids.length === 0) return { gefunden: true, erlaubt: true };

  // Sonst genuegt EIN gemeinsamer Jahrgang — wie in der Listen-Route.
  return { gefunden: true, erlaubt: ids.some(id => darfJahrgang(req, id, { edit })) };
}

/**
 * Gehoert diese PERSON zu diesem Termin? — die Frage nach der hinzugefuegten
 * oder buchenden Person, nicht nach dem Aufrufer (dafuer: darfTermin).
 *
 * Bis dahin pruefte POST /events/:id/participants nur den HANDELNDEN Admin
 * (darfTermin) und holte die hinzugefuegte Person allein ueber
 * organization_id — ein Konfi aus Jahrgang B liess sich in einen Termin von
 * Jahrgang A eintragen, eine Teamer:in ohne jede Zuweisung ebenso.
 *
 * ZWEI DATENWEGE fuer die Jahrgaenge der Person, deshalb das UNION:
 *   - Konfis tragen EINEN Jahrgang in konfi_profiles.jahrgang_id
 *   - Teamer:innen und Admins tragen MEHRERE in user_jahrgang_assignments
 * Ein Konfi hat keine user_jahrgang_assignments, eine Teamer:in kein
 * konfi_profiles — das UNION liefert also fuer jede Rolle genau ihren Weg.
 * can_view/can_edit spielen hier KEINE Rolle: Es geht um Zugehoerigkeit zum
 * Jahrgang, nicht um ein Zugriffsrecht (wie in darfTeamerAnDiesenTermin).
 *
 * In SQL statt ueber req, weil die geprueften Personen nie der Aufrufer sind.
 *
 * VOLLZUGRIFF JE GEMEINDE: Die Gemeindeleitung zaehlt mit der
 * Rolle, die die Person in der Gemeinde DES TERMINS hat (events.
 * organization_id) -- nicht mit der Rolle am Konto. Vorher las die Abfrage
 * users.role_id: Wer zuhause org_admin ist und in Gemeinde B nur
 * Teamer:in, buchte in B jeden Termin fremder Jahrgaenge (ueber
 * darfTeamerAnDiesenTermin, POST /events/:id/book und
 * POST /teamer/events/:id/zusage). Umgekehrt blieb eine Person, die in B
 * ueber user_organizations org_admin ist, dort an Jahrgaenge gebunden.
 * Dieselben zwei Quellen wie utils/orgMitglieder.js und rbac.js:
 * Stamm-Gemeinde -> users.role_id (sie gewinnt, wenn user_organizations die
 * Stamm-Gemeinde doppelt fuehrt), weitere Gemeinden -> user_organizations.
 * role_id. Ohne Mitgliedschaft in der Gemeinde des Termins gibt es keine
 * Rolle und damit keinen Vollzugriff.
 *
 * Das Flag users.is_super_admin gilt dagegen gemeindeuebergreifend, bewusst:
 * rbac.js setzt req.user.is_super_admin aus dem Flag unabhaengig von der
 * aktiven Gemeinde, requireSuperAdmin laesst es in jeder Gemeinde durch
 * (Gemeinden anlegen, sperren, verwalten), und darfJahrgang oben gibt ihm
 * ueberall true. Ein Super-Admin administriert gemeindeuebergreifend; ihn
 * hier anders zu behandeln als beim Aufrufer (darfTermin) hiesse, dass er
 * einen Termin bearbeiten, sich selbst aber nicht eintragen darf.
 *
 * @param {object} db            Pool oder Client (muss .query haben).
 * @param {number|string} userId Die Person, um die es geht.
 * @param {number|string} eventId
 * @returns {Promise<boolean>}   true = passt zum Termin. Ein unbekannter
 *                               Termin ergibt true — der Aufrufer hat ihn
 *                               vorher selbst geladen und 404 gesendet.
 */
async function gehoertZumTermin(db, userId, eventId) {
  const { rows: [zugang] } = await db.query(
    `SELECT
       e.teamer_only,
       EXISTS (SELECT 1 FROM event_jahrgang_assignments WHERE event_id = $1) AS hat_jahrgang,
       EXISTS (
         SELECT 1 FROM event_jahrgang_assignments eja
         WHERE eja.event_id = $1
           AND eja.jahrgang_id IN (
             SELECT uja.jahrgang_id FROM user_jahrgang_assignments uja WHERE uja.user_id = $2
             UNION
             SELECT kp.jahrgang_id FROM konfi_profiles kp
              WHERE kp.user_id = $2 AND kp.jahrgang_id IS NOT NULL
           )
       ) AS gemeinsam,
       (
         EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_super_admin = true)
         OR COALESCE(
           -- Stamm-Gemeinde: Rolle am Konto (gewinnt)
           (SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id
             WHERE u.id = $2 AND u.organization_id = e.organization_id),
           -- weitere Gemeinde: Rolle aus user_organizations
           (SELECT r.name FROM user_organizations uo JOIN roles r ON r.id = uo.role_id
             WHERE uo.user_id = $2 AND uo.organization_id = e.organization_id
             LIMIT 1)
         ) IN ('org_admin', 'super_admin')
       ) AS vollzugriff
     FROM events e WHERE e.id = $1`,
    [eventId, userId]
  );
  if (!zugang) return true;
  return Boolean(zugang.teamer_only || !zugang.hat_jahrgang || zugang.gemeinsam || zugang.vollzugriff);
}

module.exports = { darfJahrgang, darfKonfi, darfTermin, gehoertZumTermin };
