import { fehlerStatus, fehlerText } from '../../utils/fehler';
import React, { useState } from 'react';
import { useActionGuard } from '../../hooks/useActionGuard';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonIcon,
  IonButton,
  IonButtons,
  IonInput,
  IonList,
  IonListHeader,
  IonSpinner,
  IonText
} from '@ionic/react';
import {
  ICON_LOESCHEN,
  ICON_OFFLINE,
  ICON_SCHLIESSEN,
  ICON_SICHTBAR,
  ICON_SPERRE,
  ICON_VERBORGEN,
  ICON_WARNUNG,
} from './icons';
import { useApp } from '../../contexts/AppContext';
import api from '../../services/api';

interface DeleteAccountModalProps {
  onClose: () => void;
  onDeleted?: () => void;
}

const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({ onClose, onDeleted }) => {
  const { setError, isOnline, signOut } = useApp();
  const { isSubmitting, guard } = useActionGuard();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inlineError, setInlineError] = useState('');

  const handleDelete = async () => {
    if (!password) {
      setInlineError('Bitte gib dein Passwort zur Bestätigung ein');
      return;
    }

    await guard(async () => {
      try {
        await api.post('/auth/delete-account', { password });

        // Account gelöscht: sauber ausloggen (räumt Token/Cache + State -> Login).
        onDeleted?.();
        onClose();
        await signOut();
      } catch (err) {
        if (fehlerStatus(err) === 400) {
          setInlineError('Passwort ist falsch');
        } else {
          setError(fehlerText(err, 'Fehler beim Löschen des Accounts'));
        }
      }
    });
  };

  const isValid = password.length > 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Account löschen</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Warnung */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--danger">
              <IonIcon icon={ICON_WARNUNG} />
            </div>
            <IonLabel>Achtung</IonLabel>
          </IonListHeader>
          <IonCard className="app-card" style={{ background: 'rgba(var(--app-color-danger-rgb), 0.08)', border: '1px solid rgba(var(--app-color-danger-rgb), 0.2)' }}>
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <IonText color="danger">
                <p style={{ margin: 0, fontSize: 'var(--app-text-basis)', lineHeight: 1.5 }}>
                  Dein Account wird endgültig gelöscht. Dieser Vorgang kann NICHT
                  rückgängig gemacht werden. Alle deine Daten (Punkte, Badges,
                  Einträge) werden entfernt.
                </p>
              </IonText>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Passwort-Bestätigung */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--danger">
              <IonIcon icon={ICON_SPERRE} />
            </div>
            <IonLabel>Passwort bestätigen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Dein Passwort *</IonLabel>
                  <IonInput
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onIonInput={(e) => {
                      setPassword(e.detail.value!);
                      if (inlineError) setInlineError('');
                    }}
                    placeholder="Passwort zur Bestätigung eingeben"
                    disabled={isSubmitting}
                  />
                  <IonButton aria-label="Passwort anzeigen oder verbergen"
                    slot="end"
                    fill="clear"
                    onClick={() => setShowPassword(prev => !prev)}
                  >
                    <IonIcon icon={showPassword ? ICON_VERBORGEN : ICON_SICHTBAR} />
                  </IonButton>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Inline-Fehler */}
        {inlineError && (
          <IonList inset={true} className="app-modal-section">
            <IonCard className="app-card" style={{ background: 'rgba(var(--app-color-danger-rgb), 0.08)', border: '1px solid rgba(var(--app-color-danger-rgb), 0.2)' }}>
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel) var(--app-abstand-basis)' }}>
                <IonText color="danger">
                  <p style={{ margin: 0, fontSize: 'var(--app-text-sekundaer)' }}>{inlineError}</p>
                </IonText>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Löschen-Button */}
        <IonList inset={true} className="app-modal-section">
          <IonButton
            expand="block"
            color="danger"
            onClick={handleDelete}
            disabled={isSubmitting || !isValid || !isOnline}
          >
            {!isOnline ? (
              <><IonIcon slot="start" icon={ICON_OFFLINE} /> Du bist offline</>
            ) : isSubmitting ? (
              <IonSpinner name="crescent" />
            ) : (
              <><IonIcon slot="start" icon={ICON_LOESCHEN} /> Account endgültig löschen</>
            )}
          </IonButton>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default DeleteAccountModal;
