import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonIcon,
  IonSpinner,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonRange,
  IonModal,
  useIonAlert
} from '@ionic/react';
import { checkmarkOutline, closeOutline, create, pricetag, checkmarkCircle, peopleOutline } from 'ionicons/icons';
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
  type: 'gottesdienst' | 'gemeinde';
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
  const { setSuccess, setError, isOnline } = useApp();
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
            type: activity.type,
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
      const payload: any = {
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
    } catch (error: any) {
      if (error.response?.data?.error) {
        setError(error.response.data.error);
      } else {
        setError('Fehler beim Speichern der Aktivität');
      }
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
            <IonButton
              onClick={handleClose}
              disabled={loading}
              className="app-modal-close-btn"
            >
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              onClick={handleSubmit}
              disabled={!isFormValid || loading || isSubmitting}
              className="app-modal-submit-btn app-modal-submit-btn--activities"
            >
              {loading ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={checkmarkOutline} />
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
              <IonIcon icon={peopleOutline} />
            </div>
            <IonLabel>Zielgruppe</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div
                  className="app-list-item"
                  onClick={() => !loading && setFormData({ ...formData, target_role: 'konfi', points: formData.target_role === 'teamer' ? 1 : formData.points, type: formData.target_role === 'teamer' ? 'gottesdienst' : formData.type })}
                  style={{
                    cursor: loading ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    borderLeftColor: '#059669',
                    background: formData.target_role === 'konfi' ? 'rgba(5, 150, 105, 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: '500', color: '#333' }}>Konfis</span>
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
                    borderLeftColor: '#059669',
                    background: formData.target_role === 'teamer' ? 'rgba(5, 150, 105, 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: '500', color: '#333' }}>Teamer:innen</span>
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
              <IonIcon icon={create} />
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
                  <div style={{ padding: '8px 16px', color: '#666', fontSize: '0.85rem' }}>
                    Teamer:innen-Aktivitäten haben keine Punkte und keinen Typ.
                  </div>
                )}

                {formData.target_role !== 'teamer' && (
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Punkte *</IonLabel>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                    <span style={{ fontSize: '0.75rem', color: '#8e8e93', minWidth: '24px', textAlign: 'center' }}>1</span>
                    <IonRange
                      min={1} max={5} step={1}
                      pin={true} pinFormatter={(value: number) => `${value}`}
                      value={formData.points}
                      onIonChange={(e) => setFormData({ ...formData, points: e.detail.value as number })}
                      disabled={loading}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ion-color-primary)', minWidth: '28px', textAlign: 'center' }}>{formData.points}</span>
                  </div>
                </IonItem>
                )}

              </IonList>
              {formData.target_role !== 'teamer' && (
              <>
                <div style={{ padding: '8px 0 0' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', padding: '0 16px' }}>Typ *</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                      borderLeftColor: '#3b82f6',
                      background: formData.type === 'gottesdienst' ? 'rgba(59, 130, 246, 0.1)' : undefined
                    }}
                  >
                    <span style={{ fontWeight: '500', color: '#333' }}>Gottesdienst</span>
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
                      borderLeftColor: '#059669',
                      background: formData.type === 'gemeinde' ? 'rgba(5, 150, 105, 0.1)' : undefined
                    }}
                  >
                    <span style={{ fontWeight: '500', color: '#333' }}>Gemeinde</span>
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
              <IonIcon icon={pricetag} />
            </div>
            <IonLabel>Kategorien</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
            {initializing ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
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
                        marginBottom: index < categories.length - 1 ? '8px' : '0',
                        background: isChecked ? 'rgba(14, 165, 233, 0.08)' : undefined
                      }}
                    >
                      <span style={{ fontWeight: '500', color: '#333' }}>{category.name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#666'
              }}>
                <IonIcon icon={pricetag} style={{ fontSize: '3rem', opacity: 0.3, marginBottom: '16px' }} />
                <p style={{ margin: '0', fontSize: '1rem' }}>Keine Kategorien verfügbar</p>
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
