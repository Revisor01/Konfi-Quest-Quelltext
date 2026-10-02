// ====================================================================
// ZENTRALE SICHTBARKEITSLOGIK FUER CHALLENGE-BEITRAEGE -- hier und NUR hier
// ====================================================================
//
// Eine Submission ist oeffentlich sichtbar (Galerie fuer die Konfis der
// zugewiesenen Jahrgaenge) genau dann, wenn:
//   moderation_status = 'approved'
//   UND ( challenge.visibility = 'public'
//         ODER (challenge.visibility = 'konfi_choice'
//               UND konfi_consent IN ('publish','anonymous')) )
//
// visibility='private' ist NIE oeffentlich. 'hidden' schlaegt alles.
//
// SQL-Fragment fuer Queries, die challenges als "c" und challenge_submissions
// als "cs" aliasieren.
const PUBLIC_SUBMISSION_SQL = `(
  cs.moderation_status = 'approved'
  AND (
    c.visibility = 'public'
    OR (c.visibility = 'konfi_choice' AND cs.konfi_consent IN ('publish', 'anonymous'))
  )
)`;

module.exports = { PUBLIC_SUBMISSION_SQL };
