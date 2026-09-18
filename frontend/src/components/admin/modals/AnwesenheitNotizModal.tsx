import React, { useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonItem,
  IonLabel,
  IonTextarea,
  IonIcon,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonSpinner,
} from '@ionic/react';
import {
  ICON_HAKEN,
  ICON_LOESCHEN,
  ICON_SCHLIESSEN,
  ICON_TEXTDOKUMENT,
} from '../../shared/icons';
import { useActionGuard } from '../../../hooks/useActionGuard';
import { useApp } from '../../../contexts/AppContext';

// NOTIZ ZUR ANWESENHEIT
//
// LOESCHEN GEHOERT DAZU: Bis hierher liess sich eine Notiz setzen und
// aendern, aber nicht entfernen. Der Knopf erscheint nur, wenn es etwas zu
// loeschen gibt — an einer leeren Notiz waere er ohne Wirkung.

interface AnwesenheitNotizModalProps {
  /** Name der Person, um die es geht — steht im Kopf des Modals. */
  teilnehmerName: string;
  /** Die vorhandene Notiz, falls es eine gibt. */
  notiz?: string | null;
  /**
   * Speichert den neuen Text. Ein leerer String bedeutet LOESCHEN — die
   * Route unterscheidet "Feld fehlt" (Notiz bleibt) von "Feld ist leer"
   * (Notiz weg).
   */
  onSave: (notiz: string) => Promise<void> | void;
  dismiss: () => void;
}

const AnwesenheitNotizModal: React.FC<AnwesenheitNotizModalProps> = ({
  teilnehmerName,
  notiz,
  onSave,
  dismiss,
}) => {
  const { isOnline } = useApp();
  const [text, setText] = useState(notiz || '');
  const { isSubmitting, guard } = useActionGuard();

  const hatBestehendeNotiz = !!(notiz && notiz.trim().length > 0);
  const getrimmt = text.trim();

  // Speichern ist gesperrt, solange sich nichts geaendert hat, und bei einem
  // leeren Feld ohne bestehende Notiz: Da gaebe es nichts zu schreiben und
  // nichts zu loeschen. Ist eine Notiz vorhanden, ist das leere Feld dagegen
  // ein gueltiger Wunsch — es loescht.
  const hatAenderung = getrimmt !== (notiz || '').trim();
  const darfSpeichern = hatAenderung && (getrimmt.length > 0 || hatBestehendeNotiz);

  const handleSave = async () => {
    if (!darfSpeichern) return;
    await guard(async () => {
      await onSave(getrimmt);
      dismiss();
    });
  };

  const handleLoeschen = async () => {
    await guard(async () => {
      // Leerer String heisst loeschen — derselbe Weg wie ein geleertes Feld,
      // damit es nur eine Art gibt, eine Notiz zu entfernen.
      await onSave('');
      dismiss();
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Notiz</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={dismiss} disabled={isSubmitting}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              aria-label="Notiz speichern"
              className="app-modal-submit-btn app-modal-submit-btn--events"
              onClick={handleSave}
              disabled={!darfSpeichern || isSubmitting || !isOnline}
            >
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_TEXTDOKUMENT} />
            </div>
            <IonLabel>Notiz zu {teilnehmerName}</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea
                    value={text}
                    onIonInput={(e) => setText(e.detail.value ?? '')}
                    placeholder="z. B. „ging um 14 Uhr“"
                    rows={4}
                    autoGrow={true}
                    maxlength={500}
                    disabled={isSubmitting}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Loeschen nur, wenn es etwas zu loeschen gibt. An einer leeren
            Notiz waere der Knopf ohne Wirkung und stuende nur im Weg. */}
        {hatBestehendeNotiz && (
          <IonList inset={true} className="app-modal-section">
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                <IonButton
                  expand="block"
                  fill="outline"
                  color="danger"
                  className="app-gefahr-knopf"
                  aria-label="Notiz löschen"
                  onClick={handleLoeschen}
                  disabled={isSubmitting || !isOnline}
                >
                  <IonIcon icon={ICON_LOESCHEN} slot="start" />
                  Notiz löschen
                </IonButton>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AnwesenheitNotizModal;
