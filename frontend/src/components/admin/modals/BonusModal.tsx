import React, { useState } from 'react';
import { useActionGuard } from '../../../hooks/useActionGuard';
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
  IonInput,
  IonList,
  IonListHeader,
  IonIcon,
  IonTextarea,
  IonCard,
  IonCardContent,
  IonSpinner,
  IonRange,
  IonDatetime,
  IonDatetimeButton,
  IonModal,
} from '@ionic/react';
import { closeOutline, checkmarkOutline, gift, chatbubbleOutline } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

interface BonusModalProps {
  konfiId: number;
  onClose: () => void;
  onSave: () => Promise<void>;
  dismiss?: () => void;
}

const BonusModal: React.FC<BonusModalProps> = ({ konfiId, onClose, onSave, dismiss }) => {
  const { isOnline, setError } = useApp();
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };
  const [name, setName] = useState('');
  const [points, setPoints] = useState<number>(1);
  const [reason, setReason] = useState('');
  const [type, setType] = useState('gemeinde');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const { isSubmitting, guard } = useActionGuard();

  const handleSave = async () => {
    if (!name.trim() || points <= 0) return;

    const body = {
      points: points,
      type: type,
      description: `${name.trim()}${reason.trim() ? ': ' + reason.trim() : ''}`,
      completed_date: selectedDate
    };

    await guard(async () => {
      if (networkMonitor.isOnline) {
        try {
          await api.post(`/admin/konfis/${konfiId}/bonus-points`, body);
          await onSave();
          handleClose();
        } catch (err: any) {
          console.error('Error saving bonus points:', err);
          setError(err?.response?.data?.error || 'Bonus-Punkte konnten nicht gespeichert werden');
        }
      } else {
        await writeQueue.enqueue({
          method: 'POST',
          url: `/admin/konfis/${konfiId}/bonus-points`,
          body,
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'admin',
            clientId: safeUUID(),
            label: 'Bonus-Punkte vergeben'
          }
        });
        await onSave();
        handleClose();
      }
    });
  };

  const isValid = name.trim().length > 0 && points > 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Bonuspunkte hinzufügen</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={handleClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={handleSave} disabled={!isValid || isSubmitting} className="app-modal-submit-btn app-modal-submit-btn--bonus">
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Bonuspunkt Detail */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--bonus">
              <IonIcon icon={gift} />
            </div>
            <IonLabel>Bonuspunkt Detail</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Bezeichnung *</IonLabel>
                  <IonInput
                    value={name}
                    onIonInput={(e) => setName(e.detail.value!)}
                    placeholder="z.B. Hilfe beim Aufräumen"
                    clearInput={true}
                    disabled={isSubmitting}
                  />
                </IonItem>

              </IonList>

              <p className="app-text-sub" style={{ marginTop: '16px', marginBottom: '4px' }}>Datum *</p>
              <IonDatetimeButton datetime="bonus-date" style={{ justifyContent: 'flex-start' }} />
              <IonModal keepContentsMounted={true}>
                <IonDatetime
                  id="bonus-date"
                  presentation="date"
                  firstDayOfWeek={1}
                  value={selectedDate}
                  onIonChange={(e) => {
                    const val = e.detail.value;
                    if (typeof val === 'string') {
                      setSelectedDate(val.split('T')[0]);
                    }
                  }}
                  locale="de-DE"
                />
              </IonModal>

              <p className="app-text-sub" style={{ marginTop: '16px', marginBottom: '4px' }}>Punkte * ({points})</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px' }}>
                <span style={{ fontSize: '0.75rem', color: '#8e8e93', minWidth: '24px', textAlign: 'center' }}>1</span>
                <IonRange
                  min={1} max={10} step={1}
                  pin={true} pinFormatter={(value: number) => `${value}`}
                  value={points}
                  onIonChange={(e) => setPoints(e.detail.value as number)}
                  disabled={isSubmitting}
                  style={{
                    flex: 1,
                    '--bar-background': 'rgba(var(--app-color-bonus-rgb), 0.2)',
                    '--bar-background-active': 'var(--app-color-bonus)',
                    '--knob-background': 'var(--app-color-bonus)',
                    '--pin-background': 'var(--app-color-bonus)',
                  } as any}
                />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--app-color-bonus)', minWidth: '28px', textAlign: 'center' }}>10</span>
              </div>

              <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666' }}>Typ *</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div
                  className="app-list-item"
                  onClick={() => !isSubmitting && setType('gemeinde')}
                  style={{
                    cursor: isSubmitting ? 'default' : 'pointer',
                    opacity: isSubmitting ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    borderLeftColor: '#059669',
                    backgroundColor: type === 'gemeinde' ? 'rgba(5, 150, 105, 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: '500', color: '#333' }}>Gemeinde</span>
                </div>
                <div
                  className="app-list-item"
                  onClick={() => !isSubmitting && setType('gottesdienst')}
                  style={{
                    cursor: isSubmitting ? 'default' : 'pointer',
                    opacity: isSubmitting ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    borderLeftColor: '#3b82f6',
                    backgroundColor: type === 'gottesdienst' ? 'rgba(59, 130, 246, 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: '500', color: '#333' }}>Gottesdienst</span>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Begründung (optional) */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--bonus">
              <IonIcon icon={chatbubbleOutline} />
            </div>
            <IonLabel>Begründung (optional)</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Begründung</IonLabel>
                  <IonTextarea
                    value={reason}
                    onIonInput={(e) => setReason(e.detail.value!)}
                    placeholder="Warum werden diese Bonuspunkte vergeben?"
                    rows={3}
                    disabled={isSubmitting}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default BonusModal;
