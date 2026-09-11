
// ------------------------------------------------------------------
// Uebersetzungen
// ------------------------------------------------------------------

const BIBEL_UEBERSETZUNGEN = ['LUT', 'ELB', 'GNB', 'BIGS', 'NIV', 'LSG'];

// Gueltige Translation-Keys für den KONFISPRUCH (deskriptiv, NICHT die
// Kuerzel der Tageslosung). Diese Werte landen in der dedizierten Spalte
// konfi_profiles.konfspruch_translation — getrennt von der Tageslosungs-
// Praeferenz bible_translation, damit sich die beiden Features nicht
// gegenseitig ueberschreiben.
const KONFSPRUCH_TRANSLATIONS = ['luther2017', 'bigs', 'gute_nachricht', 'elberfelder'];

// ------------------------------------------------------------------
// Kuratierte Spruchliste (Auswahl-Modal)
// ------------------------------------------------------------------

const SPRUCHLISTE_QUERY = `
  SELECT ks.id, ks.reference, ks.book, ks.chapter, ks.verse,
         COALESCE(
           json_object_agg(ku.translation, ku.text) FILTER (WHERE ku.translation IS NOT NULL),
           '{}'::json
         ) AS uebersetzungen
  FROM konfsprueche ks
  LEFT JOIN konfspruch_uebersetzungen ku ON ku.spruch_id = ks.id
  WHERE ks.is_active = true
    AND (ks.organization_id IS NULL OR ks.organization_id = $1)
  GROUP BY ks.id, ks.reference, ks.book, ks.chapter, ks.verse, ks.sort_order
  ORDER BY ks.sort_order, ks.id
`;

/**
 * Kuratierte Spruchliste einer Organisation (org-eigene plus globale).
 * Jeder Spruch traegt ALLE vier Uebersetzungs-Keys; fehlende sind ein
 * leerer String, damit die Oberflaeche keine undefined-Tabs bekommt.
 *
 * @param {object} db - pg Pool
 * @param {number} organizationId
 * @returns {Promise<object[]>} [{id, reference, book, chapter, verse, uebersetzungen}]
 */
async function ladeSpruchliste(db, organizationId) {
  const { rows } = await db.query(SPRUCHLISTE_QUERY, [organizationId]);
  return rows.map((row) => {
    const uebersetzungen = {};
    for (const key of KONFSPRUCH_TRANSLATIONS) {
      uebersetzungen[key] = (row.uebersetzungen && row.uebersetzungen[key]) || '';
    }
    return {
      id: row.id,
      reference: row.reference,
      book: row.book,
      chapter: row.chapter,
      verse: row.verse,
      uebersetzungen
    };
  });
}

// ------------------------------------------------------------------
// Gewaehlten Spruch aufloesen
// ------------------------------------------------------------------

/**
 * Loest den gespeicherten Konfispruch eines Users auf. Genau EINE Quelle ist
 * aktiv: Listen-Wahl ODER Freitext.
 *
 * Nimmt die bereits geladene konfi_profiles-Zeile entgegen (das Konfi-Profil
 * liest sie ohnehin) — so entsteht keine zusaetzliche Abfrage.
 *
 * @param {object} db - pg Pool
 * @param {object|null} profil - Zeile mit konfspruch_id, konfspruch_freitext,
 *                               konfspruch_freitext_referenz, konfspruch_translation
 * @param {number} organizationId
 * @returns {Promise<object|null>} {source:'liste',id,reference,text,translation}
 *                                 | {source:'freitext',text,reference} | null
 */
async function loeseKonfspruchAuf(db, profil, organizationId) {
  if (!profil) return null;

  if (profil.konfspruch_id) {
    // Listen-Wahl: gewaehlte Uebersetzung nachladen. Org-gescopt + is_active
    // wie in der Listen- und der PATCH-Route. Bei NULL-Translation greift ein
    // Default (luther2017), damit der Text nicht leer bleibt.
    const spruchTranslation = profil.konfspruch_translation || 'luther2017';
    const { rows: [spruch] } = await db.query(
      `SELECT ks.id, ks.reference, ku.text
       FROM konfsprueche ks
       LEFT JOIN konfspruch_uebersetzungen ku
         ON ku.spruch_id = ks.id AND ku.translation = $2
       WHERE ks.id = $1 AND ks.is_active = true
         AND (ks.organization_id IS NULL OR ks.organization_id = $3)`,
      [profil.konfspruch_id, spruchTranslation, organizationId]
    );
    if (!spruch) return null;
    return {
      source: 'liste',
      id: spruch.id,
      reference: spruch.reference,
      text: spruch.text || '',
      translation: profil.konfspruch_translation || null
    };
  }

  if (profil.konfspruch_freitext) {
    return {
      source: 'freitext',
      text: profil.konfspruch_freitext,
      reference: profil.konfspruch_freitext_referenz
    };
  }
  return null;
}

/**
 * Wie loeseKonfspruchAuf, laedt die Profilzeile aber selbst.
 * Fuer Aufrufer ohne bereits geladenes Profil (Teamer-Weg).
 */
async function ladeKonfspruch(db, userId, organizationId) {
  const { rows: [profil] } = await db.query(
    `SELECT konfspruch_id, konfspruch_freitext, konfspruch_freitext_referenz,
            konfspruch_translation
     FROM konfi_profiles WHERE user_id = $1`,
    [userId]
  );
  return loeseKonfspruchAuf(db, profil, organizationId);
}

module.exports = {
  BIBEL_UEBERSETZUNGEN,
  KONFSPRUCH_TRANSLATIONS,
  ladeSpruchliste,
  loeseKonfspruchAuf,
  ladeKonfspruch,
};
