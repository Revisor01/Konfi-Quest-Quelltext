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
 * @param {object} db             Pool oder Client (muss .query haben).
 * @param {object} req
 * @param {number|string} konfiId
 * @param {object} [optionen]
 * @param {boolean} [optionen.edit=false]
 * @returns {Promise<{gefunden: boolean, erlaubt: boolean, jahrgangId: number|null}>}
 */
async function darfKonfi(db, req, konfiId, { edit = false } = {}) {
  const { rows: [profil] } = await db.query(
    'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1',
    [konfiId]
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

module.exports = { darfJahrgang, darfKonfi };
