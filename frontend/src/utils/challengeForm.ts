// Pure Formular-Logik des Challenge-Formulars (ChallengeManageModal) —
// ausgelagert, damit Pflichtfeld-Regeln und Payload-Aufbau testbar sind,
// ohne das Ionic-Modal zu rendern.
import type {
  ChallengeAudience,
  ChallengeMediaType,
  ChallengeVisibility
} from '../types/challenges';

export interface ChallengeFormData {
  title: string;
  description: string;
  audience: ChallengeAudience;
  visibility: ChallengeVisibility;
  moderated: boolean;
  allowed_media: ChallengeMediaType[];
  allow_multiple: boolean;
  badge_icon: string;
  badge_name: string;
  author_freetext: string;
  jahrgang_ids: number[];
  starts_at: string;
  ends_at: string;
  is_draft: boolean;
}

// Bei 'nur_team' gibt es keine Jahrgangs-Auswahl (org-weit über die Rolle),
// deshalb ist die Jahrgangs-Pflicht dort aufgehoben.
export const istNurTeam = (formData: ChallengeFormData) => formData.audience === 'nur_team';

// Für den Versand ans Backend: die lokale Wandzeit aus dem Picker in einen
// echten UTC-Zeitstempel wandeln. Ohne diese Wandlung landet der naive String
// in einer TIMESTAMPTZ-Spalte und wird in der Server-Zeitzone interpretiert —
// auf einem Geraet außerhalb Europe/Berlin verschiebt sich die Challenge
// dadurch bei jeder Bearbeitung. Gleiches Muster wie im EventModal.
export const toBackendTimestamp = (localTimeString: string) => {
  if (!localTimeString) return null;
  return new Date(localTimeString).toISOString();
};

export const istChallengeFormularGueltig = (formData: ChallengeFormData): boolean =>
  formData.title.trim().length > 0 &&
  formData.description.trim().length > 0 &&
  formData.badge_name.trim().length > 0 &&
  formData.allowed_media.length > 0 &&
  (istNurTeam(formData) || formData.jahrgang_ids.length > 0) &&
  (formData.is_draft || (!!formData.starts_at && !!formData.ends_at));

// Zeitraum-Prüfung nur, wenn der Zeitraum verbindlich ist (kein Entwurf).
export const zeitraumFehler = (formData: ChallengeFormData): string | null => {
  if (formData.is_draft) return null;
  if (new Date(formData.ends_at).getTime() <= new Date(formData.starts_at).getTime()) {
    return 'Das Ende muss nach dem Start liegen.';
  }
  return null;
};

export const baueChallengePayload = (
  formData: ChallengeFormData,
  isStarted: boolean
): Record<string, any> => {
  const payload: Record<string, any> = {
    title: formData.title.trim(),
    description: formData.description.trim(),
    allow_multiple: formData.allow_multiple,
    badge_icon: formData.badge_icon,
    badge_name: formData.badge_name.trim(),
    // Urheber nur noch als optionaler Freitext (author_user_id entfaellt).
    author_user_id: null,
    author_freetext: formData.author_freetext.trim() || null,
    jahrgang_ids: istNurTeam(formData) ? [] : formData.jahrgang_ids,
    ends_at: toBackendTimestamp(formData.ends_at),
    // Nach dem Start ist is_draft fixiert (Backend erzwingt false).
    is_draft: isStarted ? false : formData.is_draft
  };

  // Gesperrte Felder nach dem Start GAR NICHT mitsenden. Das Backend vergleicht
  // sie auf Gleichheit — und weil das Formular die Zeitstempel über die lokale
  // IonDatetime-Darstellung (ohne Sekunden/Zeitzone) fuehrt, könnte ein
  // unveraendertes starts_at sonst als Änderung gelten und faelschlich 409 werfen.
  if (!isStarted) {
    payload.audience = formData.audience;
    payload.visibility = formData.visibility;
    payload.moderated = formData.moderated;
    payload.allowed_media = formData.allowed_media;
    payload.starts_at = toBackendTimestamp(formData.starts_at);
  }

  return payload;
};
