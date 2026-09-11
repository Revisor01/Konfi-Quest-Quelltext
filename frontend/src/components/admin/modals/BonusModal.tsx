import { fehlerText } from '../../../utils/fehler';
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
import { ICON_BONUS_GEFUELLT, ICON_CHAT, ICON_HAKEN, ICON_SCHLIESSEN } from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
import {
  aktivePunktearten,
  ersteAktivePunkteart,
  PUNKTEART_NAME,
  type Punkteart,
  type PunkteartFlags,
} from '../../../utils/punktearten';

interface BonusModalProps {
  konfiId: number;
  onClose: () => void;
  onSave: () => Promise<void>;
  dismiss?: () => void;
  /**
   * Punktearten-Schalter des Jahrgangs, zu dem die Konfi gehoert. Ohne diese
   * Angabe gelten beide Arten als aktiv -- die Auswahl bot dann auch eine
   * abgeschaltete Art an, und das Speichern scheiterte am Server (400).
   */
  punkteartFlags?: PunkteartFlags;
}

const BonusModal: React.FC<BonusModalProps> = ({ konfiId, onClose, onSave, dismiss, punkteartFlags }) => {
  const { setError } = useApp();
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
  // Vorbelegung nur aus den AKTIVEN Arten. Vorher stand fest 'gemeinde' hier --
  // war ausgerechnet Gemeinde abgeschaltet, war die Voreinstellung die verbotene.
  const verfuegbareArten = aktivePunktearten(punkteartFlags);
  const [type, setType] = useState<Punkteart | null>(
    () => ersteAktivePunkteart(punkteartFlags, 'gemeinde')
  );
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const { isSubmitting, guard } = useActionGuard();

  const handleSave = async () => {
    if (!name.trim() || points <= 0) return;
    // Ohne aktive Punkteart gibt es nichts zu vergeben -- der Server wiese das
    // mit 400 zurueck. Hier abfangen, statt eine leere type-Angabe zu senden.
    if (!type) {
      setError('Für diesen Jahrgang ist keine Punkteart aktiv.');
      return;
    }

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
        } catch (err) {
          console.error('Error saving bonus points:', err);
          setError(fehlerText(err, 'Bonus-Punkte konnten nicht gespeichert werden'));
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
            <IonButton aria-label="Schließen" onClick={handleClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Bonuspunkte speichern" onClick={handleSave} disabled={!isValid || isSubmitting} className="app-modal-submit-btn app-modal-submit-btn--bonus">
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Bonuspunkt Detail */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--bonus">
              <IonIcon icon={ICON_BONUS_GEFUELLT} />
            </div>
            <IonLabel>Bonuspunkt Detail</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
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

              <p className="app-text-sub" style={{ marginTop: 'var(--app-abstand-basis)', marginBottom: 'var(--app-abstand-mini)' }}>Datum *</p>
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

              <p className="app-text-sub" style={{ marginTop: 'var(--app-abstand-basis)', marginBottom: 'var(--app-abstand-mini)' }}>
                Punkte * <span style={{ fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-color-bonus)' }}>{points}</span>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', padding: '0 var(--app-abstand-eng)' }}>
                <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>1</span>
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
                  } as React.CSSProperties}
                />
                <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>10</span>
              </div>

              <div style={{ marginTop: 'var(--app-abstand-basis)', marginBottom: 'var(--app-abstand-eng)' }}>
                <span style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)' }}>Typ *</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                {verfuegbareArten.map((art) => {
                  // Farben wie bisher: Gemeinde gruen, Gottesdienst blau.
                  const rahmen = art === 'gemeinde' ? 'var(--app-color-gemeinde)' : 'var(--app-color-gottesdienst)';
                  const fuellung = art === 'gemeinde'
                    ? 'rgba(var(--app-color-success-strong-rgb), 0.1)'
                    : 'rgba(var(--app-color-gottesdienst-rgb), 0.1)';
                  return (
                    <div
                      key={art}
                      className="app-list-item"
                      onClick={() => !isSubmitting && setType(art)}
                      style={{
                        cursor: isSubmitting ? 'default' : 'pointer',
                        opacity: isSubmitting ? 0.6 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '0',
                        borderLeftColor: rahmen,
                        backgroundColor: type === art ? fuellung : undefined
                      }}
                    >
                      <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>{PUNKTEART_NAME[art]}</span>
                    </div>
                  );
                })}
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Begründung (optional) */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--bonus">
              <IonIcon icon={ICON_CHAT} />
            </div>
            <IonLabel>Begründung (optional)</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
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
