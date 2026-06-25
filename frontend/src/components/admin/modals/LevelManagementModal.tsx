import React, { useState, useEffect } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonIcon,
  IonPage,
  IonSpinner,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonAccordion,
  IonAccordionGroup,
  IonRange
} from '@ionic/react';
import {
  checkmarkOutline,
  closeOutline,
  create,
  trophy,
  medal,
  ribbon,
  star,
  flame,
  heart,
  thumbsUp,
  flash,
  diamond,
  rocket,
  shield,
  sparkles,
  sunny,
  moon,
  leaf,
  rose,
  gift,
  balloon,
  musicalNote,
  book,
  school,
  restaurant,
  fitness,
  bicycle,
  car,
  airplane,
  boat,
  home,
  business,
  construct,
  hammer,
  brush,
  colorPalette,
  camera,
  image,
  chatbubbles,
  people,
  personAdd,
  checkmarkCircle,
  alertCircle,
  informationCircle,
  helpCircle,
  flag,
  pin,
  navigate,
  location,
  compass,
  timer,
  stopwatch,
  calendar,
  today,
  time,
  chevronDownOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

// Level Icon Mapping
const LEVEL_ICONS = {
  trophy: { icon: trophy, name: 'Pokal', category: 'Erfolg' },
  medal: { icon: medal, name: 'Medaille', category: 'Erfolg' },
  ribbon: { icon: ribbon, name: 'Band', category: 'Erfolg' },
  star: { icon: star, name: 'Stern', category: 'Erfolg' },
  checkmarkCircle: { icon: checkmarkCircle, name: 'Bestanden', category: 'Erfolg' },
  diamond: { icon: diamond, name: 'Diamant', category: 'Erfolg' },
  shield: { icon: shield, name: 'Schild', category: 'Erfolg' },

  flame: { icon: flame, name: 'Flamme', category: 'Engagement' },
  flash: { icon: flash, name: 'Blitz', category: 'Engagement' },
  rocket: { icon: rocket, name: 'Rakete', category: 'Engagement' },
  sparkles: { icon: sparkles, name: 'Funken', category: 'Engagement' },
  thumbsUp: { icon: thumbsUp, name: 'Daumen hoch', category: 'Engagement' },

  heart: { icon: heart, name: 'Herz', category: 'Gemeinschaft' },
  people: { icon: people, name: 'Gruppe', category: 'Gemeinschaft' },
  personAdd: { icon: personAdd, name: 'Neue Person', category: 'Gemeinschaft' },
  chatbubbles: { icon: chatbubbles, name: 'Chat', category: 'Gemeinschaft' },
  gift: { icon: gift, name: 'Geschenk', category: 'Gemeinschaft' },

  book: { icon: book, name: 'Buch', category: 'Lernen' },
  school: { icon: school, name: 'Schule', category: 'Lernen' },
  construct: { icon: construct, name: 'Werkzeug', category: 'Lernen' },
  brush: { icon: brush, name: 'Pinsel', category: 'Lernen' },
  colorPalette: { icon: colorPalette, name: 'Farbpalette', category: 'Lernen' },

  sunny: { icon: sunny, name: 'Sonne', category: 'Natur' },
  moon: { icon: moon, name: 'Mond', category: 'Natur' },
  leaf: { icon: leaf, name: 'Blatt', category: 'Natur' },
  rose: { icon: rose, name: 'Rose', category: 'Natur' },

  calendar: { icon: calendar, name: 'Kalender', category: 'Zeit' },
  today: { icon: today, name: 'Heute', category: 'Zeit' },
  time: { icon: time, name: 'Uhr', category: 'Zeit' },
  timer: { icon: timer, name: 'Timer', category: 'Zeit' },
  stopwatch: { icon: stopwatch, name: 'Stoppuhr', category: 'Zeit' },

  restaurant: { icon: restaurant, name: 'Restaurant', category: 'Aktivitäten' },
  fitness: { icon: fitness, name: 'Fitness', category: 'Aktivitäten' },
  bicycle: { icon: bicycle, name: 'Fahrrad', category: 'Aktivitäten' },
  car: { icon: car, name: 'Auto', category: 'Aktivitäten' },
  airplane: { icon: airplane, name: 'Flugzeug', category: 'Aktivitäten' },
  boat: { icon: boat, name: 'Boot', category: 'Aktivitäten' },
  camera: { icon: camera, name: 'Kamera', category: 'Aktivitäten' },
  image: { icon: image, name: 'Bild', category: 'Aktivitäten' },
  musicalNote: { icon: musicalNote, name: 'Musik', category: 'Aktivitäten' },
  balloon: { icon: balloon, name: 'Ballon', category: 'Aktivitäten' },

  home: { icon: home, name: 'Zuhause', category: 'Orte' },
  business: { icon: business, name: 'Gebäude', category: 'Orte' },
  location: { icon: location, name: 'Standort', category: 'Orte' },
  navigate: { icon: navigate, name: 'Navigation', category: 'Orte' },
  compass: { icon: compass, name: 'Kompass', category: 'Orte' },
  pin: { icon: pin, name: 'Pin', category: 'Orte' },
  flag: { icon: flag, name: 'Flagge', category: 'Orte' },

  informationCircle: { icon: informationCircle, name: 'Info', category: 'Sonstiges' },
  helpCircle: { icon: helpCircle, name: 'Hilfe', category: 'Sonstiges' },
  alertCircle: { icon: alertCircle, name: 'Warnung', category: 'Sonstiges' },
  hammer: { icon: hammer, name: 'Hammer', category: 'Sonstiges' }
};

// Helper function to get icon from string
const getIconFromString = (iconName: string) => {
  return LEVEL_ICONS[iconName as keyof typeof LEVEL_ICONS]?.icon || trophy;
};

interface Level {
  id?: number;
  name: string;
  title: string;
  description?: string;
  points_required: number;
  icon?: string;
  color?: string;
  reward_type?: string;
  reward_value?: number;
  is_active?: boolean;
}

interface LevelManagementModalProps {
  level?: Level;
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
}

const LevelManagementModal: React.FC<LevelManagementModalProps> = ({ level, onClose, onSuccess, dismiss }) => {
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };
  const { setSuccess, setError, isOnline } = useApp();
  const [formData, setFormData] = useState<Level>({
    name: '',
    title: '',
    description: '',
    points_required: 0,
    icon: 'trophy',
    color: '#ec4899',
    is_active: true
  });
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (level) {
      setFormData(level);
    }
  }, [level]);

  const isFormValid = formData.title.trim().length > 0 && formData.points_required >= 0;

  const handleSubmit = async () => {
    if (!isFormValid) return;

    await guard(async () => {
    setLoading(true);
    try {
      // Auto-generate name from title if empty
      const generatedName = formData.name.trim() ||
        formData.title.toLowerCase()
          .replace(/ä/g, 'ae')
          .replace(/ö/g, 'oe')
          .replace(/ü/g, 'ue')
          .replace(/ß/g, 'ss')
          .replace(/[^a-z0-9]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');

      const payload = {
        name: generatedName,
        title: formData.title.trim(),
        description: formData.description?.trim() || '',
        points_required: formData.points_required,
        icon: formData.icon || 'trophy',
        color: formData.color || '#ec4899',
        reward_type: formData.reward_type || null,
        reward_value: formData.reward_value || null,
        is_active: formData.is_active !== false
      };

      if (networkMonitor.isOnline) {
        // Online-Pfad: direkt senden
        if (level?.id) {
          await api.put(`/levels/${level.id}`, payload);
        } else {
          await api.post('/levels', payload);
        }
      } else {
        // Offline-Pfad: Queue-Fallback
        if (level?.id) {
          await writeQueue.enqueue({
            method: 'PUT',
            url: `/levels/${level.id}`,
            body: payload,
            maxRetries: 5,
            hasFileUpload: false,
            metadata: { type: 'admin', clientId: safeUUID(), label: 'Level bearbeiten' },
          });
          setSuccess('Level wird aktualisiert sobald du wieder online bist');
        } else {
          await writeQueue.enqueue({
            method: 'POST',
            url: '/levels',
            body: payload,
            maxRetries: 5,
            hasFileUpload: false,
            metadata: { type: 'admin', clientId: safeUUID(), label: 'Level erstellen' },
          });
          setSuccess('Level wird erstellt sobald du wieder online bist');
        }
      }
      onSuccess();
      handleClose();
    } catch (error: any) {
      setError(error.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setLoading(false);
    }
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{level ? 'Level bearbeiten' : 'Neues Level'}</IonTitle>
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
              className="app-modal-submit-btn app-modal-submit-btn--level"
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
        {/* SEKTION: Grunddaten */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--level">
              <IonIcon icon={create} />
            </div>
            <IonLabel>Level Details</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Titel *</IonLabel>
                  <IonInput
                    value={formData.title}
                    onIonInput={(e) => setFormData({ ...formData, title: e.detail.value! })}
                    placeholder="z.B. Anfänger, Bronze, Meister"
                    disabled={loading}
                    clearInput={true}
                  />
                </IonItem>

                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Benötigte Punkte *</IonLabel>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                    <span style={{ fontSize: '0.75rem', color: '#8e8e93', minWidth: '24px', textAlign: 'center' }}>1</span>
                    <IonRange
                      min={1} max={40} step={1}
                      pin={true} pinFormatter={(value: number) => `${value}`}
                      value={formData.points_required}
                      onIonChange={(e) => setFormData({ ...formData, points_required: e.detail.value as number })}
                      disabled={loading}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ion-color-primary)', minWidth: '28px', textAlign: 'center' }}>{formData.points_required}</span>
                  </div>
                </IonItem>

                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Beschreibung</IonLabel>
                  <IonTextarea
                    value={formData.description}
                    onIonInput={(e) => setFormData({ ...formData, description: e.detail.value! })}
                    placeholder="Optionale Beschreibung..."
                    rows={3}
                    disabled={loading}
                  />
                </IonItem>

              {/* Icon Picker */}
              <div style={{ marginTop: '16px' }}>
                <IonAccordionGroup>
                  <IonAccordion value="icon-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                    <IonItem slot="header" lines="none" style={{ '--background': 'transparent' }}>
                      <div className="app-icon-circle app-icon-circle--lg" style={{
                        backgroundColor: formData.color,
                        borderRadius: '12px',
                        width: '50px',
                        height: '50px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                        marginRight: '12px'
                      }}>
                        <IonIcon
                          icon={getIconFromString(formData.icon || 'trophy')}
                          style={{ fontSize: '1.8rem', color: 'white' }}
                        />
                      </div>
                      <IonLabel>
                        <h3 className="app-settings-item__subtitle" style={{ margin: '0 0 4px 0' }}>
                          Icon *
                        </h3>
                        {formData.icon && LEVEL_ICONS[formData.icon as keyof typeof LEVEL_ICONS] && (
                          <p className="app-settings-item__title" style={{ margin: '0' }}>
                            {LEVEL_ICONS[formData.icon as keyof typeof LEVEL_ICONS].name} ({LEVEL_ICONS[formData.icon as keyof typeof LEVEL_ICONS].category})
                          </p>
                        )}
                      </IonLabel>
                    </IonItem>
                    <div slot="content" style={{ padding: '16px' }}>
                      {Object.entries(LEVEL_ICONS).reduce<{ category: string; icons: { key: string; data: typeof LEVEL_ICONS[keyof typeof LEVEL_ICONS] }[] }[]>((acc, [key, data]) => {
                        const categoryIndex = acc.findIndex((group) => group.category === data.category);
                        if (categoryIndex === -1) {
                          acc.push({ category: data.category, icons: [{ key, data }] });
                        } else {
                          acc[categoryIndex].icons.push({ key, data });
                        }
                        return acc;
                      }, []).map((group) => (
                        <div key={group.category} style={{ marginBottom: '16px' }}>
                          <span className="app-settings-item__subtitle" style={{ fontWeight: '600', marginBottom: '8px', display: 'block' }}>
                            {group.category}
                          </span>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: '8px' }}>
                            {group.icons.map(({ key, data }) => (
                              <div
                                key={key}
                                onClick={() => setFormData({ ...formData, icon: key })}
                                style={{
                                  width: '100%',
                                  aspectRatio: '1',
                                  backgroundColor: formData.icon === key ? formData.color : '#f8f9fa',
                                  borderRadius: '12px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  border: formData.icon === key ? '2px solid ' + formData.color : '1px solid #e0e0e0',
                                  boxShadow: formData.icon === key ? '0 2px 8px rgba(0,0,0,0.15)' : '0 1px 3px rgba(0,0,0,0.1)',
                                  transition: 'all 0.2s'
                                }}
                              >
                                <IonIcon
                                  icon={data.icon}
                                  style={{
                                    fontSize: '1.5rem',
                                    color: formData.icon === key ? 'white' : '#666'
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </IonAccordion>
                </IonAccordionGroup>
              </div>

              {/* Color Picker */}
              <IonItem lines="none" style={{ '--background': 'transparent', marginTop: '16px' }}>
                <IonLabel position="stacked">Level-Farbe</IonLabel>
                <div style={{ marginTop: '8px', width: '100%' }}>
                  <input
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    disabled={loading}
                    style={{
                      width: '100%',
                      height: '60px',
                      border: '2px solid #e0e0e0',
                      borderRadius: '12px',
                      cursor: 'pointer'
                    }}
                  />
                </div>
              </IonItem>
            </IonList>
          </IonCardContent>
        </IonCard>
      </IonList>
      {/* Abstand unten */}
      <div style={{ height: '32px' }} />
      </IonContent>
    </IonPage>
  );
};

export default LevelManagementModal;
