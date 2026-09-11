import { fehlerText } from '../utils/fehler';
import { useIonAlert } from '@ionic/react';
import { useApp } from '../contexts/AppContext';
import api from '../services/api';
import { getChallengeStatus } from '../components/admin/views/ChallengesManageView';
import type { AdminChallenge } from '../types/challenges';

// Gemeinsame Loesch-Logik für Admin- und Teamer-Challenges-Seite (identischer
// Bestaetigungsdialog und identische Backend-Anfrage in beiden Seiten -> hier
// einmal zusammengefasst statt dupliziert).
//
// Entwuerfe können ohne Weiteres weg. Alles, was schon läuft oder lief,
// hängt an echten Beitraegen von Konfis -> destruktive Nachfrage mit
// force=true (Backend löscht dann auch hochgeladene Dateien mit).

interface UseChallengeDeleteOptions {
  /** Wird nach erfolgreichem Löschen gerufen, um die Liste neu zu laden. */
  onDeleted: () => void | Promise<void>;
}

export function useChallengeDelete({ onDeleted }: UseChallengeDeleteOptions) {
  const { setError, setSuccess } = useApp();
  const [presentAlert] = useIonAlert();

  const doDelete = async (challenge: AdminChallenge, force: boolean) => {
    try {
      await api.delete(`/challenges/admin/${challenge.id}${force ? '?force=true' : ''}`);
      await onDeleted();
      setSuccess('Challenge gelöscht');
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Löschen der Challenge'));
    }
  };

  const handleDelete = (challenge: AdminChallenge) => {
    const status = getChallengeStatus(challenge);
    if (status === 'draft') {
      presentAlert({
        header: 'Entwurf löschen',
        message: `Entwurf "${challenge.title}" wirklich löschen?`,
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Löschen', role: 'destructive', handler: () => { doDelete(challenge, false); } }
        ]
      });
      return;
    }

    const count = challenge.submission_count || 0;
    presentAlert({
      header: 'Challenge unwiderruflich löschen',
      message: `"${challenge.title}" wurde bereits gestartet. Beim Löschen ${count > 0 ? `werden ${count} Beiträge samt hochgeladener Dateien` : 'wird die Challenge'} endgültig entfernt. Das lässt sich nicht rückgängig machen.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        { text: 'Endgültig löschen', role: 'destructive', handler: () => { doDelete(challenge, true); } }
      ]
    });
  };

  return { handleDelete };
}
