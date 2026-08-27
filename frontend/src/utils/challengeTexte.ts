import type { KonfiChallenge, ChallengeConsent } from '../types/challenges';

// Textbausteine rund um Challenges — als pure Funktionen, damit Einzahl/Mehrzahl
// und die Sichtbarkeits-Sätze testbar sind, ohne die Ionic-Modale zu rendern.

export const anzahlBeitraege = (n: number): string =>
  n === 1 ? '1 Beitrag' : `${n} Beiträge`;

/** Tooltip/aria-Text für das Zähler-Badge in der Moderationsliste. */
export const wartenAufFreigabe = (n: number): string =>
  n === 1 ? '1 Beitrag wartet auf Freigabe' : `${n} Beiträge warten auf Freigabe`;

type SichtbarkeitsRelevant = Pick<KonfiChallenge, 'visibility' | 'moderated'>;

export const getVisibilityInfo = (challenge: SichtbarkeitsRelevant): string => {
  if (challenge.visibility === 'private') {
    return 'Deinen Beitrag sieht nur das Leitungsteam';
  }
  if (challenge.visibility === 'public') {
    return challenge.moderated
      ? 'Für deine Gruppe sichtbar — nach Freigabe durch das Leitungsteam'
      : 'Für deine Gruppe sofort sichtbar';
  }
  return challenge.moderated
    ? 'Du entscheidest unten, wer deinen Beitrag sieht — veröffentlicht wird nach Freigabe'
    : 'Du entscheidest unten, wer deinen Beitrag sieht';
};

/** Erfolgsmeldung nach dem Absenden — spiegelt den tatsächlichen Behandlungsweg. */
export const getSuccessMessage = (
  challenge: SichtbarkeitsRelevant,
  consent: ChallengeConsent
): string => {
  const willBePublic =
    challenge.visibility === 'public' ||
    (challenge.visibility === 'konfi_choice' && consent !== 'private');
  if (challenge.moderated && willBePublic) {
    return 'Eingereicht — dein Beitrag wartet auf Freigabe.';
  }
  if (willBePublic) {
    return 'Veröffentlicht!';
  }
  return 'Eingereicht — dein Beitrag ist nur für die Leitung sichtbar.';
};
