import type { KonfiChallenge, ChallengeConsent } from '../types/challenges';

// Textbausteine rund um Challenges — als pure Funktionen, damit Einzahl/Mehrzahl
// und die Sichtbarkeits-Sätze testbar sind, ohne die Ionic-Modale zu rendern.

export const anzahlBeitraege = (n: number): string =>
  n === 1 ? '1 Beitrag' : `${n} Beiträge`;

/** Tooltip/aria-Text für das Zähler-Badge in der Moderationsliste. */
export const wartenAufFreigabe = (n: number): string =>
  n === 1 ? '1 Beitrag wartet auf Freigabe' : `${n} Beiträge warten auf Freigabe`;

/** Vorlesetext der orangen Zahl im Reiter-Knopf, ohne fuehrende Zahl: "wartet auf Freigabe" / "warten auf Freigabe". */
export const wartenAufFreigabeKurz = (n: number): string =>
  n === 1 ? 'wartet auf Freigabe' : 'warten auf Freigabe';

/**
 * Vorlesetext der roten Kugel am Challenge-Eintrag von Leitung und Team
 * ohne die fuehrende Zahl -- die setzt ZaehlerKugel davor. Die
 * Kugel zaehlt neue Beitraege seit dem letzten Oeffnen, auch wartende; der
 * Text sagt, wie viele davon noch auf Freigabe warten.
 *   (3, 0) -> "neue Beiträge"                         => "3 neue Beiträge"
 *   (1, 0) -> "neuer Beitrag"                         => "1 neuer Beitrag"
 *   (3, 1) -> "neue Beiträge, davon wartet 1 auf Freigabe"
 *   (3, 2) -> "neue Beiträge, davon warten 2 auf Freigabe"
 *   (1, 1) -> "neuer Beitrag, wartet auf Freigabe"
 */
export const kugelTextNeueBeitraege = (anzahl: number, wartend: number): string => {
  const neu = anzahl === 1 ? 'neuer Beitrag' : 'neue Beiträge';
  if (!(wartend > 0)) return neu;
  if (anzahl === 1 && wartend === 1) return `${neu}, wartet auf Freigabe`;
  return `${neu}, davon ${wartend === 1 ? 'wartet 1' : `warten ${wartend}`} auf Freigabe`;
};

export const kugelTextAmEintrag = (pending: number, neu: number): string => {
  if (!(pending > 0)) return 'neue Beiträge';
  const teile = [wartenAufFreigabe(pending)];
  if (neu > 0) teile.push(`${neu} neue Beiträge`);
  return `offen: ${teile.join(', ')}`;
};

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
