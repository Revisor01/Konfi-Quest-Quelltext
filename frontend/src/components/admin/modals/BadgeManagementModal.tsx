import React, { useState, useEffect, useRef } from 'react';
import { useActionGuard } from '../../../hooks/useActionGuard';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonPage,
  IonButtons,
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonSelect,
  IonSelectOption,
  IonToggle,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonGrid,
  IonRow,
  IonCol,
  IonIcon,
  IonText,
  IonCheckbox,
  IonSpinner,
  IonList,
  IonListHeader,
  IonAccordion,
  IonAccordionGroup,
  IonRange
} from '@ionic/react';
import {
  checkmarkOutline,
  closeOutline,
  ribbon,
  settings,
  trophy,
  star,
  medal,
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
  peopleOutline,
  chevronDownOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

// Badge Icon Mapping
const BADGE_ICONS = {
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
  return BADGE_ICONS[iconName as keyof typeof BADGE_ICONS]?.icon || trophy;
};

interface Badge {
  id: number;
  name: string;
  icon: string;
  description?: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_active: boolean;
  is_hidden: boolean;
  earned_count: number;
  created_at: string;
}

interface Activity {
  id: number;
  name: string;
  type: 'gottesdienst' | 'gemeinde';
  categories?: Category[];
}

interface Category {
  id: number;
  name: string;
}

interface BadgeManagementModalProps {
  badgeId?: number | null;
  targetRole?: 'konfi' | 'teamer';
  onClose: () => void;
  onSuccess: () => void;
  // Meldet den "ungespeicherte Aenderungen"-Stand nach aussen, damit die
  // praesentierende Seite ueber canDismiss auch Swipe/Backdrop-Schliessen abfangen kann.
  onDirtyChange?: (dirty: boolean) => void;
}

// Standardfarben pro Badge-Kategorie (criteria_type)
const CATEGORY_COLORS: Record<string, string> = {
  total_points: '#ffd700',
  gottesdienst_points: '#ff9500',
  gemeinde_points: '#059669',
  bonus_points: '#ff6b9d',
  both_categories: '#5856d6',
  activity_count: '#3880ff',
  unique_activities: '#10dc60',
  activity_combination: '#7044ff',
  category_activities: '#0cd1e8',
  specific_activity: '#ffce00',
  streak: '#eb445a',
  time_based: '#8e8e93',
  event_count: '#e63946',
  mandatory_event_count: '#b91c1c',
  teamer_year: '#5b21b6'
};

const getCategoryColor = (criteriaType: string) => CATEGORY_COLORS[criteriaType] || '#667eea';

const BadgeManagementModal: React.FC<BadgeManagementModalProps> = ({
  badgeId,
  targetRole = 'konfi',
  onClose,
  onSuccess,
  onDirtyChange
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const initializedRef = useRef(false);

  const doClose = () => onClose();

  // Schliessen anstossen. Die "ungespeicherte Aenderungen"-Nachfrage laeuft zentral
  // ueber canDismiss der praesentierenden Seite (faengt X-Button, Swipe UND Backdrop
  // einheitlich ab) -> hier keine zweite Abfrage.
  const handleClose = () => { doClose(); };

  // isDirty-Stand nach aussen melden (fuer canDismiss der praesentierenden Seite).
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  // Punkte-basierte Kriterien - bei Teamer ausblenden
  const POINTS_CRITERIA_TYPES = ['total_points', 'gottesdienst_points', 'gemeinde_points', 'both_categories', 'bonus_points'];
  const TEAMER_HIDDEN_TYPES = [...POINTS_CRITERIA_TYPES, 'time_based', 'streak', 'event_count', 'mandatory_event_count'];

  // Form data
  const defaultCriteriaType = targetRole === 'teamer' ? 'activity_count' : 'total_points';
  const [formData, setFormData] = useState({
    name: '',
    icon: 'trophy',
    description: '',
    criteria_type: defaultCriteriaType,
    criteria_value: targetRole === 'teamer' ? 5 : 10,
    criteria_extra: '{}',
    is_active: true,
    is_hidden: false,
    color: getCategoryColor(defaultCriteriaType),
    target_role: targetRole
  });

  // isDirty nach Initialisierung bei jeder formData-Änderung setzen
  useEffect(() => {
    if (initializedRef.current) {
      setIsDirty(true);
    }
  }, [formData]);

  // Available data for dropdowns
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [criteriaTypes, setCriteriaTypes] = useState<any>({});

  // Additional form fields for complex criteria
  const [extraCriteria, setExtraCriteria] = useState<any>({});

  const isEditMode = !!badgeId;

  const criteriaTypeLabels: Record<string, string> = {
    'total_points': 'Gesamtpunkte',
    'gottesdienst_points': 'Gottesdienst-Punkte',
    'gemeinde_points': 'Gemeinde-Punkte',
    'specific_activity': 'Spezielle Aktivität',
    'both_categories': 'Beide Kategorien',
    'activity_combination': 'Aktivitätskombination',
    'category_activities': 'Kategorie-Aktivitäten',
    'time_based': 'Zeitbasiert',
    'activity_count': 'Aktivitätsanzahl',
    'event_count': 'Event-Teilnahmen',
    'mandatory_event_count': 'Pflicht-Anwesenheit',
    'bonus_points': 'Bonuspunkte',
    'streak': 'Serie',
    'unique_activities': 'Einzigartige Aktivitäten',
    'teamer_year': 'Teamer-Jahre'
  };

  useEffect(() => {
    const init = async () => {
      await loadInitialData();
      if (isEditMode) {
        await loadBadge();
      }
      setTimeout(() => { initializedRef.current = true; }, 100);
    };
    init();
  }, [badgeId]);

  const [initialDataLoading, setInitialDataLoading] = useState(true);

  const loadInitialData = async () => {
    try {
      setInitialDataLoading(true);

      // Load activities
      const activitiesResponse = await api.get('/admin/activities');
      setActivities(Array.isArray(activitiesResponse.data) ? activitiesResponse.data : []);

      // Load categories
      const categoriesResponse = await api.get('/admin/categories');
      setCategories(Array.isArray(categoriesResponse.data) ? categoriesResponse.data : []);

      // Load criteria types
      const criteriaResponse = await api.get('/admin/badges/criteria-types');
      setCriteriaTypes(criteriaResponse.data || {});
    } catch (err) {
      console.error('Error loading initial data:', err);
      setError('Fehler beim Laden der Badge-Daten');
    } finally {
      setInitialDataLoading(false);
    }
  };

  const loadBadge = async () => {
    if (!badgeId) return;

    setLoading(true);
    try {
      const response = await api.get(`/admin/badges/${badgeId}`);
      const badge = response.data;

      if (badge) {
        // Parse extra criteria FIRST (kann doppelt escaped sein: "{\"days\":30}")
        let extra: any = {};
        try {
          let parsed = badge.criteria_extra;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed || '{}');
          }
          // Falls nach dem ersten Parse immer noch ein String (doppelt escaped)
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          extra = parsed || {};
        } catch (e) {
          console.error('Error parsing criteria_extra:', e);
          extra = {};
        }

        // time_based: DB speichert "days", Modal nutzt "weeks" - umrechnen
        if (badge.criteria_type === 'time_based' && extra.days && !extra.weeks) {
          extra.weeks = Math.round(extra.days / 7) || 1;
        }

        const newFormData = {
          name: badge.name || '',
          icon: badge.icon || 'trophy-outline',
          description: badge.description || '',
          criteria_type: badge.criteria_type || 'total_points',
          criteria_value: badge.criteria_value || 10,
          criteria_extra: badge.criteria_extra || '{}',
          is_active: badge.is_active !== undefined ? badge.is_active : true,
          is_hidden: badge.is_hidden !== undefined ? badge.is_hidden : false,
          color: badge.color || '#667eea',
          target_role: badge.target_role || targetRole
        };

        setFormData(newFormData);
        setExtraCriteria(extra);
      }
    } catch (err) {
      setError('Fehler beim Laden des Badges');
 console.error('Error loading badge:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('Name ist erforderlich');
      return;
    }

    await guard(async () => {
    setLoading(true);
    try {
      // Prepare criteria_extra based on criteria_type
      let criteriaExtra = {};
      
      switch (formData.criteria_type) {
        case 'specific_activity':
          if (extraCriteria.activity_id) {
            criteriaExtra = { activity_id: extraCriteria.activity_id };
          }
          break;
        case 'category_activities':
          if (extraCriteria.required_category) {
            criteriaExtra = { required_category: extraCriteria.required_category };
          }
          break;
        case 'time_based':
          if (extraCriteria.weeks) {
            criteriaExtra = { days: extraCriteria.weeks * 7 };
          }
          break;
        case 'activity_combination':
          if (extraCriteria.activity_ids && extraCriteria.activity_ids.length > 0) {
            criteriaExtra = { activity_ids: extraCriteria.activity_ids };
          }
          break;
      }

      const badgeData = {
        ...formData,
        criteria_extra: criteriaExtra
      };

      if (networkMonitor.isOnline) {
        // Online-Pfad: direkt senden
        if (isEditMode) {
          await api.put(`/admin/badges/${badgeId}`, badgeData);
        } else {
          await api.post('/admin/badges', badgeData);
        }
      } else {
        // Offline-Pfad: Queue-Fallback
        if (isEditMode) {
          await writeQueue.enqueue({
            method: 'PUT',
            url: `/admin/badges/${badgeId}`,
            body: badgeData,
            maxRetries: 5,
            hasFileUpload: false,
            metadata: { type: 'admin', clientId: safeUUID(), label: 'Badge bearbeiten' },
          });
          setSuccess('Badge wird aktualisiert sobald du wieder online bist');
        } else {
          await writeQueue.enqueue({
            method: 'POST',
            url: '/admin/badges',
            body: badgeData,
            maxRetries: 5,
            hasFileUpload: false,
            metadata: { type: 'admin', clientId: safeUUID(), label: 'Badge erstellen' },
          });
          setSuccess('Badge wird erstellt sobald du wieder online bist');
        }
      }

      setIsDirty(false);
      // WICHTIG: Dirty-Stand SYNCHRON nach aussen melden, bevor onSuccess() das Modal
      // ueber dismiss()/canDismiss schliesst. Sonst sieht canDismiss noch isDirty=true,
      // blockiert das programmatische Schliessen -> Modal bleibt offen, erneutes
      // Speichern legt das Badge mehrfach an.
      onDirtyChange?.(false);
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Speichern des Badges');
    } finally {
      setLoading(false);
    }
    });
  };

  const renderCriteriaSpecificFields = () => {
    switch (formData.criteria_type) {
      case 'specific_activity':
        const selectedActivity = activities.find(a => a.id === extraCriteria.activity_id);
        return (
          <div style={{ marginTop: '16px' }}>
            <IonAccordionGroup>
              <IonAccordion value="activity-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                      Aktivität auswählen
                    </h3>
                    {selectedActivity && (
                      <p style={{ fontSize: '0.85rem', color: '#333', margin: '0', fontWeight: '500' }}>
                        {selectedActivity.name} ({selectedActivity.type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'})
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: '8px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {activities.map(activity => {
                      const isSelected = extraCriteria.activity_id === activity.id;
                      return (
                        <div
                          key={activity.id}
                          className="app-list-item app-list-item--info"
                          onClick={() => setExtraCriteria({ ...extraCriteria, activity_id: activity.id })}
                          style={{
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '0',
                            borderLeftColor: activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f',
                            backgroundColor: isSelected ? 'rgba(0, 122, 255, 0.08)' : undefined
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                            <div
                              className="app-icon-circle"
                              style={{ backgroundColor: activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f' }}
                            >
                              <IonIcon icon={activity.type === 'gottesdienst' ? home : people} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="app-list-item__title">{activity.name}</div>
                              <div className="app-list-item__subtitle">
                                {activity.type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'}
                              </div>
                            </div>
                          </div>
                          <IonCheckbox
                            checked={isSelected}
                            style={{
                              '--checkbox-background-checked': activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f',
                              '--border-color-checked': activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f',
                              '--checkmark-color': 'white'
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
          </div>
        );

      case 'category_activities':
        const selectedCategory = categories.find(c => c.name === extraCriteria.required_category);
        return (
          <div style={{ marginTop: '16px' }}>
            <IonAccordionGroup>
              <IonAccordion value="category-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                      Kategorie auswählen
                    </h3>
                    {selectedCategory && (
                      <p style={{ fontSize: '0.85rem', color: '#333', margin: '0', fontWeight: '500' }}>
                        {selectedCategory.name}
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: '8px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {categories.map(category => {
                      const isSelected = extraCriteria.required_category === category.name;
                      return (
                        <div
                          key={category.id}
                          className="app-list-item app-list-item--warning"
                          onClick={() => setExtraCriteria({ ...extraCriteria, required_category: category.name })}
                          style={{
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '0',
                            backgroundColor: isSelected ? 'rgba(255, 149, 0, 0.08)' : undefined
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                            <div className="app-icon-circle app-icon-circle--warning">
                              <IonIcon icon={flag} />
                            </div>
                            <div className="app-list-item__title">{category.name}</div>
                          </div>
                          <IonCheckbox
                            checked={isSelected}
                            style={{
                              '--checkbox-background-checked': '#ff9500',
                              '--border-color-checked': '#ff9500',
                              '--checkmark-color': 'white'
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
          </div>
        );

      case 'time_based':
        return (
          <IonItem lines="none" style={{ '--background': 'transparent', marginTop: '16px' }}>
            <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Zeitraum (Wochen)</IonLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
              <span style={{ fontSize: '0.75rem', color: '#8e8e93', minWidth: '24px', textAlign: 'center' }}>1</span>
              <IonRange
                min={1} max={26} step={1}
                pin={true} pinFormatter={(value: number) => `${value}`}
                value={extraCriteria.weeks || 4}
                onIonChange={(e) => setExtraCriteria({ ...extraCriteria, weeks: e.detail.value as number })}
                disabled={loading}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ion-color-primary)', minWidth: '28px', textAlign: 'center' }}>{extraCriteria.weeks || 4}</span>
            </div>
          </IonItem>
        );

      case 'activity_combination':
        const selectedActivities = activities.filter(a => (extraCriteria.activity_ids || []).includes(a.id));
        return (
          <div style={{ marginTop: '16px' }}>
            <IonAccordionGroup>
              <IonAccordion value="activity-combination-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                      Aktivitäten kombinieren (mehrere auswählbar)
                    </h3>
                    {selectedActivities.length > 0 && (
                      <p style={{ fontSize: '0.85rem', color: '#333', margin: '0', fontWeight: '500' }}>
                        {selectedActivities.map(a => a.name).join(', ')}
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: '8px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {activities.map(activity => {
                      const activityIds = extraCriteria.activity_ids || [];
                      const isSelected = activityIds.includes(activity.id);

                      return (
                        <div
                          key={activity.id}
                          className="app-list-item app-list-item--info"
                          onClick={() => {
                            const currentIds = extraCriteria.activity_ids || [];
                            const newIds = isSelected
                              ? currentIds.filter((id: number) => id !== activity.id)
                              : [...currentIds, activity.id];
                            setExtraCriteria({ ...extraCriteria, activity_ids: newIds });
                          }}
                          style={{
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '0',
                            borderLeftColor: activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f',
                            backgroundColor: isSelected ? 'rgba(0, 122, 255, 0.08)' : undefined
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                            <div
                              className="app-icon-circle"
                              style={{ backgroundColor: activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f' }}
                            >
                              <IonIcon icon={activity.type === 'gottesdienst' ? home : people} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="app-list-item__title">{activity.name}</div>
                              <div className="app-list-item__subtitle">
                                {activity.type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'}
                              </div>
                            </div>
                          </div>
                          <IonCheckbox
                            checked={isSelected}
                            style={{
                              '--checkbox-background-checked': activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f',
                              '--border-color-checked': activity.type === 'gottesdienst' ? '#007aff' : '#2dd36f',
                              '--checkmark-color': 'white'
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
          </div>
        );

      default:
        return null;
    }
  };

  const getValueLabel = () => {
    switch (formData.criteria_type) {
      case 'total_points':
      case 'gottesdienst_points':
      case 'gemeinde_points':
      case 'both_categories':
      case 'bonus_points':
        return 'Punkte';
      case 'specific_activity':
        return 'Anzahl (Spezifische Aktivität)';
      case 'activity_count':
        return 'Anzahl (Aktivitäten & Events)';
      case 'event_count':
        return 'Anzahl (Events)';
      case 'mandatory_event_count':
        return 'Anzahl (Pflicht-Events)';
      case 'category_activities':
        return 'Anzahl (Kategorie-Aktivitäten & Events)';
      case 'unique_activities':
        return 'Anzahl (Verschiedene Aktivitäten)';
      case 'streak':
        return 'Anzahl (Aufeinanderfolgende Wochen)';
      case 'time_based':
        return 'Anzahl (Aktivitäten & Events im Zeitraum)';
      case 'teamer_year':
        return 'Anzahl (Aktive Jahre als Teamer:in)';
      default:
        return 'Wert';
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{isEditMode ? 'Badge bearbeiten' : 'Neues Badge'}</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={handleClose} disabled={loading} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              onClick={handleSave}
              disabled={loading || isSubmitting || !formData.name.trim()}
              className="app-modal-submit-btn app-modal-submit-btn--badges"
            >
              {loading ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {initialDataLoading && !isEditMode ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
        <>
        {/* SEKTION: Zielgruppe (nur bei neuem Badge) */}
        {!isEditMode && (
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--badges">
              <IonIcon icon={peopleOutline} />
            </div>
            <IonLabel>Zielgruppe</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div
                  className="app-list-item"
                  onClick={() => !loading && setFormData({ ...formData, target_role: 'konfi', criteria_type: 'total_points', criteria_value: 10, color: getCategoryColor('total_points') })}
                  style={{
                    cursor: loading ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    borderLeftColor: '#f59e0b',
                    background: formData.target_role === 'konfi' ? 'rgba(245, 158, 11, 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: '500', color: '#333' }}>Konfis</span>
                </div>
                <div
                  className="app-list-item"
                  onClick={() => !loading && setFormData({ ...formData, target_role: 'teamer', criteria_type: 'activity_count', criteria_value: 5, color: getCategoryColor('activity_count') })}
                  style={{
                    cursor: loading ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0',
                    borderLeftColor: '#f59e0b',
                    background: formData.target_role === 'teamer' ? 'rgba(245, 158, 11, 0.1)' : undefined
                  }}
                >
                  <span style={{ fontWeight: '500', color: '#333' }}>Teamer:innen</span>
                </div>
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>
        )}

        {/* SEKTION: Badge-Informationen */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--badges">
              <IonIcon icon={ribbon} />
            </div>
            <IonLabel>Badge-Informationen</IonLabel>
          </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent>
            <IonList>
              <IonItem lines="inset">
                <IonLabel position="stacked">Name *</IonLabel>
                <IonInput
                  value={formData.name}
                  onIonInput={(e) => setFormData({ ...formData, name: e.detail.value! })}
                  placeholder="Badge-Name eingeben"
                  required
                  clearInput={true}
                  disabled={loading}
                />
              </IonItem>

              <IonItem lines="inset">
                <IonLabel position="stacked">Beschreibung</IonLabel>
                <IonTextarea
                  value={formData.description}
                  onIonInput={(e) => setFormData({ ...formData, description: e.detail.value! })}
                  placeholder="Beschreibung des Badges..."
                  rows={3}
                  disabled={loading}
                />
              </IonItem>

              <div style={{ marginTop: '16px' }}>
                <IonAccordionGroup>
                  <IonAccordion value="icon-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                    <IonItem slot="header" lines="none">
                      <IonLabel>
                        <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                          Icon *
                        </h3>
                        {formData.icon && BADGE_ICONS[formData.icon as keyof typeof BADGE_ICONS] && (
                          <p style={{ fontSize: '0.85rem', color: '#333', margin: '0', fontWeight: '500' }}>
                            {BADGE_ICONS[formData.icon as keyof typeof BADGE_ICONS].name} ({BADGE_ICONS[formData.icon as keyof typeof BADGE_ICONS].category})
                          </p>
                        )}
                      </IonLabel>
                    </IonItem>
                    <div slot="content" style={{ padding: '16px' }}>
                      {Object.entries(BADGE_ICONS).reduce<{ category: string; icons: { key: string; data: typeof BADGE_ICONS[keyof typeof BADGE_ICONS] }[] }[]>((acc, [key, data]) => {
                        const categoryIndex = acc.findIndex((group) => group.category === data.category);
                        if (categoryIndex === -1) {
                          acc.push({ category: data.category, icons: [{ key, data }] });
                        } else {
                          acc[categoryIndex].icons.push({ key, data });
                        }
                        return acc;
                      }, []).map((group) => (
                        <div key={group.category} style={{ marginBottom: '16px' }}>
                          <IonText style={{ fontSize: '0.85rem', fontWeight: '600', color: '#666', marginBottom: '8px', display: 'block' }}>
                            {group.category}
                          </IonText>
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
                                  border: '1px solid #e0e0e0',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
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

              <IonItem lines="none">
                <IonLabel position="stacked">Badge-Farbe</IonLabel>
                <div style={{ marginTop: '8px', width: '100%' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      disabled={loading}
                      style={{
                        flex: 1,
                        height: '60px',
                        border: '2px solid #e0e0e0',
                        borderRadius: '12px',
                        cursor: 'pointer'
                      }}
                    />
                    {formData.color !== getCategoryColor(formData.criteria_type) && (
                      <button
                        onClick={() => setFormData({ ...formData, color: getCategoryColor(formData.criteria_type) })}
                        disabled={loading}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '12px',
                          border: `2px solid ${getCategoryColor(formData.criteria_type)}`,
                          backgroundColor: 'transparent',
                          color: getCategoryColor(formData.criteria_type),
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <div style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          backgroundColor: getCategoryColor(formData.criteria_type),
                          flexShrink: 0
                        }} />
                        Standard
                      </button>
                    )}
                  </div>
                </div>
              </IonItem>
            </IonList>
          </IonCardContent>
        </IonCard>
        </IonList>

        {/* SEKTION: Badge-Kriterien */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--badges">
              <IonIcon icon={settings} />
            </div>
            <IonLabel>Badge-Kriterien</IonLabel>
          </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent>
            <IonAccordionGroup>
              <IonAccordion value="criteria-types" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                      Kriterium-Typ
                    </h3>
                    {formData.criteria_type && criteriaTypes[formData.criteria_type] && (
                      <>
                        <p style={{ fontSize: '0.85rem', color: '#333', margin: '0 0 2px 0', fontWeight: '500' }}>
                          {criteriaTypes[formData.criteria_type].label.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim()}
                        </p>
                        <p style={{ fontSize: '0.75rem', color: '#999', margin: '0', whiteSpace: 'normal' }}>
                          {criteriaTypes[formData.criteria_type].description}
                        </p>
                      </>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: '8px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {Object.entries(criteriaTypes)
                      .filter(([value]) => {
                        // Bei Teamer: Punkte-basierte Kriterien ausblenden
                        if (formData.target_role === 'teamer' && TEAMER_HIDDEN_TYPES.includes(value)) return false;
                        // teamer_year NUR bei Teamer anzeigen
                        if (value === 'teamer_year' && formData.target_role !== 'teamer') return false;
                        return true;
                      })
                      .map(([value, type]: [string, any]) => {
                      const isSelected = formData.criteria_type === value;
                      // Remove emojis from label
                      const labelWithoutEmoji = type.label.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

                      return (
                        <div
                          key={value}
                          className="app-list-item app-list-item--warning"
                          onClick={() => {
                            if (!loading) {
                              let defaultValue = 10;
                              if (value === 'activity_count' || value === 'unique_activities' ||
                                  value === 'specific_activity' || value === 'category_activities' ||
                                  value === 'event_count') {
                                defaultValue = 5;
                              } else if (value === 'activity_combination') {
                                defaultValue = 3;
                              } else if (value === 'streak') {
                                defaultValue = 4;
                              }
                              const currentCategoryColor = getCategoryColor(formData.criteria_type);
                              const newColor = (formData.color === currentCategoryColor || formData.color === '#667eea')
                                ? getCategoryColor(value)
                                : formData.color;
                              setFormData({ ...formData, criteria_type: value, criteria_value: defaultValue, color: newColor });
                              setExtraCriteria({});
                            }
                          }}
                          style={{
                            cursor: loading ? 'default' : 'pointer',
                            opacity: loading ? 0.6 : 1,
                            marginBottom: '0',
                            background: isSelected ? 'rgba(245, 158, 11, 0.1)' : undefined
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="app-list-item__title">{labelWithoutEmoji}</div>
                            <div className="app-list-item__subtitle" style={{ whiteSpace: 'normal' }}>
                              {type.help}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: '12px', marginTop: '16px' }}>
                <IonLabel position="stacked" style={{ marginBottom: '8px' }}>{getValueLabel()}</IonLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                  <span style={{ fontSize: '0.75rem', color: '#8e8e93', minWidth: '24px', textAlign: 'center' }}>1</span>
                  <IonRange
                    min={1} max={20} step={1}
                    pin={true} pinFormatter={(value: number) => `${value}`}
                    value={formData.criteria_value}
                    onIonChange={(e) => setFormData({ ...formData, criteria_value: e.detail.value as number })}
                    disabled={loading}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ion-color-primary)', minWidth: '28px', textAlign: 'center' }}>{formData.criteria_value}</span>
                </div>
              </IonItem>

              {renderCriteriaSpecificFields()}
            </div>
          </IonCardContent>
        </IonCard>
        </IonList>

        {/* SEKTION: Badge-Status */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--badges">
              <IonIcon icon={ribbon} />
            </div>
            <IonLabel>Badge-Status</IonLabel>
          </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent>
            <IonList>
              <IonItem lines="inset">
                <IonLabel>
                  <h3 style={{ color: '#333', margin: '0 0 4px 0', fontWeight: '600' }}>Aktiv</h3>
                  <p style={{ color: '#666', margin: '0', fontSize: '0.85rem' }}>Badge kann verliehen werden</p>
                </IonLabel>
                <IonToggle
                  slot="end"
                  className="app-toggle--badges"
                  checked={formData.is_active}
                  onIonChange={(e) => setFormData({ ...formData, is_active: e.detail.checked })}
                />
              </IonItem>

              <IonItem lines="none">
                <IonLabel>
                  <h3 style={{ color: '#333', margin: '0 0 4px 0', fontWeight: '600' }}>Geheim</h3>
                  <p style={{ color: '#666', margin: '0', fontSize: '0.85rem' }}>Badge ist für Konfis nicht sichtbar bis sie es erhalten</p>
                </IonLabel>
                <IonToggle
                  slot="end"
                  className="app-toggle--badges"
                  checked={formData.is_hidden}
                  onIonChange={(e) => setFormData({ ...formData, is_hidden: e.detail.checked })}
                />
              </IonItem>
            </IonList>
          </IonCardContent>
        </IonCard>
        </IonList>

        </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default BadgeManagementModal;