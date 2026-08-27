import React, { useState, useEffect, useRef } from 'react';
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
  IonDatetime,
  IonDatetimeButton,
  IonModal,
  useIonAlert
} from '@ionic/react';
import { closeOutline, checkmarkOutline, flash, calendar, home, people, pricetag, ribbon } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
import { istPunkteartAktiv, type PunkteartFlags } from '../../../utils/punktearten';

interface Activity {
  id: number;
  name: string;
  points: number;
  type: string;
  categories?: { id: number; name: string }[];
}

interface ActivityModalProps {
  konfiId: number;
  punkteartFlags?: PunkteartFlags;
  onClose: () => void;
  onSave: () => Promise<void>;
  dismiss?: () => void;
  targetRole?: string;
}

const ActivityModal: React.FC<ActivityModalProps> = ({ konfiId, onClose, onSave, dismiss, targetRole, punkteartFlags }) => {
  const { isOnline, setError } = useApp();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const { isSubmitting, guard } = useActionGuard();
  const [isDirty, setIsDirty] = useState(false);
  const [presentAlert] = useIonAlert();
  const initializedRef = useRef(false);

  // isDirty nach Initialisierung tracken
  useEffect(() => {
    if (initializedRef.current) {
      setIsDirty(true);
    }
  }, [selectedActivity, comment, selectedDate]);

  useEffect(() => {
    setTimeout(() => { initializedRef.current = true; }, 100);
  }, []);

  const doClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  const handleClose = () => {
    if (isDirty) {
      presentAlert({
        header: 'Ungespeicherte Änderungen',
        message: 'Möchtest du die Änderungen verwerfen?',
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Verwerfen', role: 'destructive', handler: () => doClose() }
        ]
      });
    } else {
      doClose();
    }
  };

  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    try {
      const url = targetRole ? `/admin/activities?target_role=${targetRole}` : '/admin/activities';
      const response = await api.get(url);
      // Nur Aktivitaeten anbieten, deren Punkteart im Jahrgang aktiv ist.
      // Teamer-Aktivitaeten haben type = NULL und keine Punkteart -- die
      // bleiben unabhaengig davon in der Liste.
      setActivities(
        (response.data || []).filter((activity: Activity) =>
          !activity.type || istPunkteartAktiv(punkteartFlags, activity.type as 'gottesdienst' | 'gemeinde')
        )
      );
    } catch (err) {
 console.error('Error loading activities:', err);
    }
  };

  const handleSave = async () => {
    if (!selectedActivity) return;

    const body = {
      activity_id: selectedActivity,
      completed_date: selectedDate,
      comment: comment
    };

    await guard(async () => {
      if (networkMonitor.isOnline) {
        try {
          await api.post(`/admin/konfis/${konfiId}/activities`, body);
          setIsDirty(false);
          await onSave();
          doClose();
        } catch (err: any) {
          // Ohne diese Meldung blieb das Modal bei einer Ablehnung des Servers
          // einfach offen stehen — etwa wenn die Punktart im Jahrgang
          // abgeschaltet ist. Für die Leitung sah das so aus, als passiere
          // nichts.
          console.error('Error saving activity:', err);
          setError(err?.response?.data?.error || 'Aktivität konnte nicht gespeichert werden');
        }
      } else {
        await writeQueue.enqueue({
          method: 'POST',
          url: `/admin/konfis/${konfiId}/activities`,
          body,
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'admin',
            clientId: safeUUID(),
            label: 'Aktivität zuweisen'
          }
        });
        setIsDirty(false);
        await onSave();
        doClose();
      }
    });
  };

  // Farben für Aktivitäten (CSS-Variablen statt Hex)
  const gottesdienstColor = 'var(--app-color-gottesdienst)';
  const gemeindeColor = 'var(--app-color-gemeinde)';
  const isTeamer = targetRole === 'teamer';
  const teamerColor = 'var(--app-color-teamer)';
  const sectionClass = isTeamer ? 'teamer' : 'activities';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Aktivität hinzufügen</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={handleClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Aktivität speichern" onClick={handleSave} disabled={!selectedActivity || isSubmitting} className={`app-modal-submit-btn app-modal-submit-btn--${sectionClass}`}>
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Datum & Kommentar */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--activities">
              <IonIcon icon={calendar} />
            </div>
            <IonLabel>Datum & Kommentar</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <p className="app-text-sub" style={{ marginBottom: '4px' }}>Datum *</p>
              <IonDatetimeButton datetime="activity-date" style={{ justifyContent: 'flex-start' }} />
              <IonModal keepContentsMounted={true}>
                <IonDatetime
                  id="activity-date"
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

              <p className="app-text-sub" style={{ marginTop: '16px', marginBottom: '4px' }}>Kommentar (optional)</p>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea
                    value={comment}
                    onIonInput={(e) => setComment(e.detail.value!)}
                    placeholder="Zusätzliche Informationen..."
                    rows={3}
                    disabled={isSubmitting}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Aktivität auswählen */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--activities">
              <IonIcon icon={flash} />
            </div>
            <IonLabel>Aktivität auswählen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[...activities]
                  .sort((a, b) => {
                    // NULL-SICHER: Teamer-Aktivitäten duerfen type = NULL haben
                    // ("Konfi-Wochenende", "Konfi-Freizeit begleitet"). Ein
                    // direktes a.type.localeCompare() warf dort sofort, der
                    // Render brach ab und die ErrorBoundary loggte aus — das war
                    // der Rauswurf beim Oeffnen (User-Hinweis 11.08.).
                    // Ausserdem NICHT mehr in-place sortieren: .sort() mutiert
                    // sonst das activities-State-Array bei jedem Render.
                    const typeA = a.type || '';
                    const typeB = b.type || '';
                    if (typeA !== typeB) {
                      return typeA.localeCompare(typeB);
                    }
                    return (a.name || '').localeCompare(b.name || '');
                  })
                  .map(activity => {
                    const isSelected = selectedActivity === activity.id;
                    // Bei Teamer einheitlich Pink, sonst Gottesdienst blau / Gemeinde dunkelgrün
                    const typeColor = isTeamer
                      ? teamerColor
                      : (activity.type === 'gottesdienst' ? gottesdienstColor : gemeindeColor);
                    // Selected-Background als rgba mit -rgb Variable
                    const typeColorRgb = isTeamer
                      ? 'var(--app-color-teamer-rgb)'
                      : (activity.type === 'gottesdienst' ? 'var(--app-color-gottesdienst-rgb)' : 'var(--app-color-gemeinde-rgb)');

                    return (
                      <div
                        key={activity.id}
                        className={`app-list-item app-list-item--${sectionClass}`}
                        onClick={() => !isSubmitting && setSelectedActivity(activity.id)}
                        style={{
                          cursor: isSubmitting ? 'default' : 'pointer',
                          opacity: isSubmitting ? 0.6 : 1,
                          marginBottom: '0',
                          borderLeftColor: typeColor,
                          backgroundColor: isSelected ? `rgba(${typeColorRgb}, 0.08)` : undefined,
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Corner Badge - nur bei Nicht-Teamer anzeigen */}
                        {targetRole !== 'teamer' && (
                          <div className="app-corner-badges">
                            <div
                              className="app-corner-badge"
                              style={{ backgroundColor: typeColor }}
                            >
                              +{activity.points}P
                            </div>
                          </div>
                        )}

                        <div className="app-list-item__row">
                          <div className="app-list-item__main">
                            <div
                              className="app-icon-circle app-icon-circle--lg"
                              style={{ backgroundColor: typeColor }}
                            >
                              {/* Teamer-Aktivitaeten haben keinen Typ — sonst
                                  bekaemen sie immer das Gemeinde-Icon.
                                  Gleiches Symbol wie in ActivitiesView. */}
                              <IonIcon icon={isTeamer ? ribbon : activity.type === 'gottesdienst' ? home : people} />
                            </div>
                            <div className="app-list-item__content">
                              <div className="app-list-item__title" style={{ paddingRight: isTeamer ? '0' : '60px', whiteSpace: 'normal' }}>
                                {activity.name}
                              </div>
                              {activity.categories && activity.categories.length > 0 && (
                                <div className="app-list-item__meta">
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={pricetag} style={{ color: 'var(--app-color-categories)' }} />
                                    {activity.categories.map(cat => cat.name).join(', ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default ActivityModal;
