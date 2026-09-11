import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useRef } from 'react';
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonItem, IonLabel, IonInput, IonIcon, IonSpinner, IonList, IonListHeader, IonCard, IonCardContent, IonRange, useIonAlert } from '@ionic/react';
import {
  ICON_BEARBEITEN_GEFUELLT,
  ICON_GRUPPE,
  ICON_HAKEN,
  ICON_KATEGORIE_GEFUELLT,
  ICON_SCHLIESSEN,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

interface Activity {
  id: number;
  name: string;
  points: number;
  type: 'gottesdienst' | 'gemeinde' | null;
  categories?: Category[];
  target_role?: 'konfi' | 'teamer';
}

interface Category {
  id: number;
  name: string;
  description?: string;
  type: 'activity' | 'event' | 'both';
}

interface ActivityManagementModalProps {
  activity?: Activity | null;
  activityId?: number | null;
  targetRole?: 'konfi' | 'teamer';
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
}

const ActivityManagementModal: React.FC<ActivityManagementModalProps> = ({
  activity,
  activityId,
  targetRole = 'konfi',
  onClose,
  onSuccess,
  dismiss
}) => {
  const { setSuccess, setError } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentActivity, setCurrentActivity] = useState<Activity | null>(activity || null);
  const [isDirty, setIsDirty] = useState(false);
  const [presentAlert] = useIonAlert();
  const initializedRef = useRef(false);

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

  const [formData, setFormData] = useState({
    name: '',
    points: targetRole === 'teamer' ? 0 : 1,
    type: (targetRole === 'teamer' ? '' : 'gottesdienst') as string,
    category_ids: [] as number[],
    target_role: targetRole
  });

  // isDirty nach Initialisierung bei jeder formData-Änderung setzen
  useEffect(() => {
    if (initializedRef.current) {
      setIsDirty(true);
    }
  }, [formData]);

  // Load activity by ID from all activities
  const loadActivity = async (id: number) => {
    try {
      const response = await api.get('/admin/activities');
      const activities = response.data;
      const activityData = activities.find((act: Activity) => act.id === id);

      if (activityData) {
        setCurrentActivity(activityData);
        const categoryIds = activityData.categories?.map((cat: Category) => cat.id) || [];
        setFormData({
          name: activityData.name,
          points: activityData.points,
          type: activityData.type,
          category_ids: categoryIds,
          target_role: activityData.target_role || targetRole
        });
      } else {
 console.error('Activity not found with ID:', id);
        setError('Aktivität nicht gefunden');
      }
    } catch (error) {
 console.error('Error loading activity:', error);
      setError('Fehler beim Laden der Aktivität');
    }
  };

  useEffect(() => {
    const initializeModal = async () => {
      setInitializing(true);
      try {
        // First load categories
        await loadCategories();

        // Then load activity if activityId is provided
        if (activityId) {
          await loadActivity(activityId);
        } else if (activity) {
          setCurrentActivity(activity);
          setFormData({
            name: activity.name,
            points: activity.points,
            type: activity.type ?? '',
            category_ids: activity.categories?.map((cat: Category) => cat.id) || [],
            target_role: activity.target_role || targetRole
          });
        } else {
          // Reset form for new activity
          setCurrentActivity(null);
          setFormData({
            name: '',
            points: targetRole === 'teamer' ? 0 : 1,
            type: targetRole === 'teamer' ? '' : 'gottesdienst',
            category_ids: [],
            target_role: targetRole
          });
        }
      } catch (error) {
 console.error('Error during initialization:', error);
        setError('Fehler beim Initialisieren des Modals');
      } finally {
        setInitializing(false);
      }
    };

    initializeModal().then(() => {
      setTimeout(() => { initializedRef.current = true; }, 100);
    });
  }, [activityId, activity]);

  const loadCategories = async () => {
    try {
      const response = await api.get('/admin/categories');

      // Don't filter - show ALL categories for activities
      // Categories with type=null should also be available for activities
      const allCategories = response.data;
      setCategories(allCategories);
      return allCategories;
    } catch (error) {
 console.error('Error loading categories:', error);
      throw error;
    }
  };


  const handleSubmit = async () => {
    if (!formData.name.trim()) return;

    await guard(async () => {
    setLoading(true);
    try {
      const payload = {
        name: formData.name.trim(),
        points: formData.target_role === 'teamer' ? 0 : formData.points,
        type: formData.target_role === 'teamer' ? null : formData.type,
        category_ids: formData.category_ids,
        target_role: formData.target_role
      };

      if (networkMonitor.isOnline) {
        // Online-Pfad: direkt senden
        if (currentActivity) {
          await api.put(`/admin/activities/${currentActivity.id}`, payload);
        } else {
          await api.post('/admin/activities', payload);
        }
      } else {
        // Offline-Pfad: Queue-Fallback
        if (currentActivity) {
          await writeQueue.enqueue({
            method: 'PUT',
            url: `/admin/activities/${currentActivity.id}`,
            body: payload,
            maxRetries: 5,
            hasFileUpload: false,
            metadata: { type: 'admin', clientId: safeUUID(), label: 'Aktivität bearbeiten' },
          });
          setSuccess('Aktivität wird aktualisiert sobald du wieder online bist');
        } else {
          await writeQueue.enqueue({
            method: 'POST',
            url: '/admin/activities',
            body: payload,
            maxRetries: 5,
            hasFileUpload: false,
            metadata: { type: 'admin', clientId: safeUUID(), label: 'Aktivität erstellen' },
          });
          setSuccess('Aktivität wird erstellt sobald du wieder online bist');
        }
      }

      setIsDirty(false);
      onSuccess();
    } catch (error) {
      setError(fehlerText(error, 'Fehler beim Speichern der Aktivität'));
    } finally {
      setLoading(false);
    }
    });
  };

  const isFormValid = formData.name.trim().length > 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            {currentActivity ? 'Aktivität bearbeiten' : 'Neue Aktivität'}
          </IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen"
              onClick={handleClose}
              disabled={loading}
              className="app-modal-close-btn"
            >
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Aktivität speichern"
              onClick={handleSubmit}
              disabled={!isFormValid || loading || isSubmitting}
              className="app-modal-submit-btn app-modal-submit-btn--activities"
            >
              {loading ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={ICON_HAKEN} />
              )}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* SEKTION: Zielgruppe (nur bei neuer Aktivität) */}
        {!currentActivity && (
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--activities">
              <IonIcon icon={ICON_GRUPPE} />
            </div>
            <IonLabel>Zielgruppe</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                <div
                  className="app-list-item"
                  onClick={() => !loading && setFormData({ ...formData, target_role: 'konfi', points: formData.target_role === 'teamer' ? 1 : formData.points, type: formData.target_role === 'teamer' ? 'gottesdienst' : formData.type })}
                  style={{
                    cursor: loading ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    borderLeftColor: 'var(--app-color-success-strong)',
                    background: formData.target_role === 'konfi' ? 'rgba(var(--app-color-success-strong-rgb), 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>Konfis</span>
                </div>
                <div
                  className="app-list-item"
                  onClick={() => !loading && setFormData({ ...formData, target_role: 'teamer', points: 0, type: '' })}
                  style={{
                    cursor: loading ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    borderLeftColor: 'var(--app-color-success-strong)',
                    background: formData.target_role === 'teamer' ? 'rgba(var(--app-color-success-strong-rgb), 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>Team</span>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>
        )}

        {/* SEKTION: Grunddaten */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--activities">
              <IonIcon icon={ICON_BEARBEITEN_GEFUELLT} />
            </div>
            <IonLabel>Grunddaten</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Name *</IonLabel>
                  <IonInput
                    value={formData.name}
                    onIonInput={(e) => setFormData({ ...formData, name: e.detail.value! })}
                    placeholder="z.B. Sonntagsgottesdienst"
                    disabled={loading}
                    clearInput={true}
                  />
                </IonItem>

                {formData.target_role === 'teamer' && (
                  <div style={{ padding: 'var(--app-abstand-eng) var(--app-abstand-basis)', color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-sekundaer)' }}>
                    Aktivitäten fürs Team haben keine Punkte und keinen Typ.
                  </div>
                )}

                {formData.target_role !== 'teamer' && (
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked" style={{ marginBottom: 'var(--app-abstand-eng)' }}>Punkte * <span style={{ fontWeight: 'var(--app-schrift-fett)', color: 'var(--ion-color-primary)' }}>{formData.points}</span></IonLabel>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', width: '100%' }}>
                    <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>1</span>
                    <IonRange
                      min={1} max={5} step={1}
                      pin={true} pinFormatter={(value: number) => `${value}`}
                      value={formData.points}
                      onIonChange={(e) => setFormData({ ...formData, points: e.detail.value as number })}
                      disabled={loading}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>5</span>
                  </div>
                </IonItem>
                )}

              </IonList>
              {formData.target_role !== 'teamer' && (
              <>
                <div style={{ padding: 'var(--app-abstand-eng) 0 0' }}>
                  <span style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', padding: '0 var(--app-abstand-basis)' }}>Typ *</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                  <div
                    className="app-list-item"
                    onClick={() => !loading && setFormData({ ...formData, type: 'gottesdienst' })}
                    style={{
                      cursor: loading ? 'default' : 'pointer',
                      opacity: loading ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0',
                      borderLeftColor: 'var(--app-color-gottesdienst)',
                      background: formData.type === 'gottesdienst' ? 'rgba(var(--app-color-gottesdienst-rgb), 0.1)' : undefined
                    }}
                  >
                    <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>Gottesdienst</span>
                  </div>
                  <div
                    className="app-list-item"
                    onClick={() => !loading && setFormData({ ...formData, type: 'gemeinde' })}
                    style={{
                      cursor: loading ? 'default' : 'pointer',
                      opacity: loading ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0',
                      borderLeftColor: 'var(--app-color-success-strong)',
                      background: formData.type === 'gemeinde' ? 'rgba(var(--app-color-gemeinde-rgb), 0.1)' : undefined
                    }}
                  >
                    <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>Gemeinde</span>
                  </div>
                </div>
              </>
              )}
            </IonCardContent>
        </IonCard>
      </IonList>

        {/* SEKTION: Kategorien */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--activities">
              <IonIcon icon={ICON_KATEGORIE_GEFUELLT} />
            </div>
            <IonLabel>Kategorien</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
            {initializing ? (
              <div style={{ padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)', textAlign: 'center' }}>
                <IonSpinner name="crescent" />
              </div>
            ) : categories.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {categories.map((category, index) => {
                  const isChecked = formData.category_ids.includes(category.id);
                  return (
                    <div
                      key={category.id}
                      className="app-list-item app-list-item--categories"
                      onClick={() => {
                        if (!loading) {
                          setFormData(prev => ({
                            ...prev,
                            category_ids: prev.category_ids.includes(category.id)
                              ? prev.category_ids.filter(id => id !== category.id)
                              : [...prev.category_ids, category.id]
                          }));
                        }
                      }}
                      style={{
                        cursor: loading ? 'default' : 'pointer',
                        opacity: loading ? 0.6 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: index < categories.length - 1 ? 'var(--app-abstand-eng)' : '0',
                        background: isChecked ? 'rgba(var(--app-color-categories-rgb), 0.08)' : undefined
                      }}
                    >
                      <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>{category.name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)',
                textAlign: 'center',
                color: 'var(--app-text-secondary)'
              }}>
                <IonIcon icon={ICON_KATEGORIE_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-riesig)', opacity: 0.3, marginBottom: 'var(--app-abstand-basis)' }} />
                <p style={{ margin: '0', fontSize: 'var(--app-text-standard)' }}>Keine Kategorien verfügbar</p>
              </div>
            )}
          </IonCardContent>
        </IonCard>
      </IonList>

      </IonContent>
    </IonPage>
  );
};

export default ActivityManagementModal;
