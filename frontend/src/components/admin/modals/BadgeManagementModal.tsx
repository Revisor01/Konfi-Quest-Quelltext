import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useRef } from 'react';
import { useActionGuard } from '../../../hooks/useActionGuard';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonPage, IonButtons, IonButton, IonItem, IonLabel, IonInput, IonTextarea, IonToggle, IonCard, IonCardContent, IonIcon, IonText, IonSpinner, IonList, IonListHeader, IonAccordion, IonAccordionGroup, IonRange } from '@ionic/react';
import {
  ICON_ABZEICHEN_GEFUELLT,
  ICON_AKTUALISIEREN,
  ICON_AUFKLAPPEN,
  ICON_EINSTELLUNGEN_GEFUELLT,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN,
  ICON_KATEGORIE_GEFUELLT,
  ICON_SCHLIESSEN,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
import { ICON_CHOICES as BADGE_ICONS } from '../../../utils/badgeIcons';
import { getCriteriaColor as getCategoryColor, getCriteriaIcon, CRITERIA_FALLBACK_COLOR } from '../../../utils/badgeCriteria';
import type { BadgeKriteriumExtra } from '../../../utils/badgeCriteria';



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

/**
 * Ein waehlbarer Kriterientyp aus GET /admin/badges/criteria-types
 * (CRITERIA_TYPES in backend/routes/badges.js): kurze Bezeichnung, ein Satz
 * dazu und der ausfuehrliche Hilfetext mit Beispiel.
 */
interface KriteriumTyp {
  label: string;
  description: string;
  help: string;
}

/**
 * Die Zusatzangaben, WIE SIE IM FORMULAR stehen.
 *
 * Bewusst nicht BadgeKriteriumExtra: Das Formular arbeitet mit `weeks`,
 * gespeichert wird daraus `days` (weeks * 7, siehe handleSubmit).
 */
interface ExtraKriteriumFormular {
  activity_id?: number;
  activity_ids?: number[];
  required_category?: string;
  /** category_combination: mehrere Kategorienamen (die Auswahl arbeitet hier
   *  direkt mit Namen — die Wertung im Backend liest ebenfalls Namen). */
  required_categories?: string[];
  weeks?: number;
}

interface BadgeManagementModalProps {
  badgeId?: number | null;
  targetRole?: 'konfi' | 'teamer';
  onClose: () => void;
  onSuccess: () => void;
  // Meldet den "ungespeicherte Änderungen"-Stand nach aussen, damit die
  // praesentierende Seite über canDismiss auch Swipe/Backdrop-Schliessen abfangen kann.
  onDirtyChange?: (dirty: boolean) => void;
  // Laedt nur die Badge-Liste neu, OHNE das Modal zu schliessen (anders als
  // onSuccess). Gebraucht nach "Abzeichen neu pruefen", damit earned_count
  // stimmt, waehrend der Admin im Modal bleibt.
  onRefreshList?: () => void;
}

const BadgeManagementModal: React.FC<BadgeManagementModalProps> = ({
  badgeId,
  targetRole = 'konfi',
  onClose,
  onSuccess,
  onDirtyChange,
  onRefreshList
}) => {
  const { user, setSuccess, setError } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Nur admin/org_admin duerfen den Knopf "Abzeichen neu pruefen" sehen bzw.
  // druecken (Route POST /admin/badges/:id/pruefen: requireAdmin).
  const darfPruefen = user?.role_name === 'admin' || user?.role_name === 'org_admin';
  const [pruefLoading, setPruefLoading] = useState(false);
  const initializedRef = useRef(false);

  const doClose = () => onClose();

  // Schliessen anstossen. Die "ungespeicherte Änderungen"-Nachfrage läuft zentral
  // über canDismiss der praesentierenden Seite (faengt X-Button, Swipe UND Backdrop
  // einheitlich ab) -> hier keine zweite Abfrage.
  const handleClose = () => { doClose(); };

  // isDirty-Stand nach aussen melden (für canDismiss der praesentierenden Seite).
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
  const [criteriaTypes, setCriteriaTypes] = useState<Record<string, KriteriumTyp>>({});

  // Additional form fields for complex criteria
  const [extraCriteria, setExtraCriteria] = useState<ExtraKriteriumFormular>({});

  const isEditMode = !!badgeId;

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

      // Aktivitäten NUR aus der Zielgruppe des Badges: ein Teamer-Badge darf
      // nicht auf Konfi-Aktivitäten verweisen (und umgekehrt) — die Wertung in
      // badges.js zählt ohnehin nur die passende target_role.
      const activitiesResponse = await api.get(`/admin/activities?target_role=${targetRole}`);
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
        let extra: BadgeKriteriumExtra = {};
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

        // Aktivitäten: DB speichert NAMEN, die Auswahl arbeitet mit IDs.
        // Ohne diese Rueckuebersetzung stünde die Auswahl beim Bearbeiten
        // leer da und ein Speichern wuerde die Angabe löschen.
        // activity_id/activity_ids werden weiter gelesen: Badges aus der Zeit
        // vor dem Fix tragen noch die alten Schlüssel.
        if (badge.criteria_type === 'specific_activity' && !extra.activity_id) {
          const treffer = activities.find(a => a.name === extra.required_activity_name);
          if (treffer) extra.activity_id = treffer.id;
        }
        if (badge.criteria_type === 'activity_combination' && !extra.activity_ids) {
          const ids = (extra.required_activities || [])
            .map((name: string) => activities.find(a => a.name === name)?.id)
            .filter((id: number | undefined): id is number => id !== undefined);
          if (ids.length > 0) extra.activity_ids = ids;
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
          // MUSS ein Hex-Wert bleiben: der Wert landet in <input type="color">
          // und wird so in der Datenbank gespeichert. Eine CSS-Variable ist
          // dort ungueltig (Regression vom 11.08., wieder zurückgenommen).
          color: badge.color || CRITERIA_FALLBACK_COLOR,
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

    // guard() wirft, wenn bereits ein Speichern läuft ("Aktion läuft
    // bereits"). Ohne dieses catch flog der Fehler ungefangen nach oben —
    // und weil setLoading(true) INNERHALB des Guards steht, blieb loading
    // dann auf true hängen. Der X-Button ist mit disabled={loading}
    // verknuepft und liess sich danach nicht mehr druecken, während der
    // Swipe weiter ging (User-Hinweis 12.08.).
    try {
      await guard(async () => {
    setLoading(true);
    try {
      // Prepare criteria_extra based on criteria_type
      let criteriaExtra = {};
      
      // Die Auswahl arbeitet intern mit IDs, gespeichert werden aber NAMEN:
      // Das Backend wertet `required_activity_name` bzw. `required_activities`
      // über activities.name aus (badges.js:216,227). Vorher schrieb das
      // Formular activity_id/activity_ids — diese Badges wurden nie vergeben,
      // weil der Schlüssel serverseitig gar nicht gelesen wird
      // 
      switch (formData.criteria_type) {
        case 'specific_activity': {
          const gewaehlt = activities.find(a => a.id === extraCriteria.activity_id);
          if (gewaehlt) {
            criteriaExtra = { required_activity_name: gewaehlt.name };
          }
          break;
        }
        case 'category_activities':
          if (extraCriteria.required_category) {
            criteriaExtra = { required_category: extraCriteria.required_category };
          }
          break;
        case 'category_combination': {
          // Anders als bei den Aktivitaeten wird hier KEIN ID-Umweg gegangen:
          // Die Wertung liest Kategorienamen (categories.name), und die
          // Auswahl haelt sie schon als Namen.
          const kategorien = [...new Set(extraCriteria.required_categories || [])];
          if (kategorien.length > 0) {
            criteriaExtra = { required_categories: kategorien };
          }
          break;
        }
        case 'time_based':
          if (extraCriteria.weeks) {
            criteriaExtra = { days: extraCriteria.weeks * 7 };
          }
          break;
        case 'activity_combination': {
          const namen = (extraCriteria.activity_ids || [])
            .map((id: number) => activities.find(a => a.id === id)?.name)
            .filter(Boolean);
          if (namen.length > 0) {
            criteriaExtra = { required_activities: namen };
          }
          break;
        }
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
      // über dismiss()/canDismiss schließt. Sonst sieht canDismiss noch isDirty=true,
      // blockiert das programmatische Schliessen -> Modal bleibt offen, erneutes
      // Speichern legt das Badge mehrfach an.
      onDirtyChange?.(false);
      onSuccess();
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Speichern des Badges'));
    } finally {
      setLoading(false);
    }
      });
    } catch {
      // Doppelklick auf Speichern — der zweite Aufruf wird verworfen.
      // Nichts anzeigen, aber den Ladezustand sicher zuruecknehmen.
      setLoading(false);
    }
  };

  // "Abzeichen neu pruefen": holt die Vergabe fuer alle Personen der
  // Zielrolle in der eigenen Organisation nach (POST /admin/badges/:id/pruefen).
  // Fuer Sonderfaelle gedacht (Datenlage hat sich geaendert) — Speichern loest
  // die Pruefung inzwischen ohnehin automatisch aus.
  const handlePruefen = async () => {
    if (!badgeId) return;
    setPruefLoading(true);
    try {
      const res = await api.post(`/admin/badges/${badgeId}/pruefen`);
      const neuVergeben = res.data?.neu_vergeben ?? 0;
      if (neuVergeben > 0) {
        setSuccess(neuVergeben === 1 ? '1 Abzeichen neu vergeben' : `${neuVergeben} Abzeichen neu vergeben`);
        onRefreshList?.();
      } else {
        setSuccess('Alle Abzeichen sind aktuell');
      }
    } catch (err) {
      setError(fehlerText(err, 'Fehler bei der Pruefung des Abzeichens'));
    } finally {
      setPruefLoading(false);
    }
  };

  // Gottesdienst/Gemeinde gibt es NUR bei Konfis — bei Teamer-Aktivitäten ist
  // `type` bedeutungslos und wuerde als Untertitel nur in die Irre fuehren
  // (User-Hinweis 11.08.). Deshalb dort neutral in der Teamer-Farbe.
  const isTeamerBadge = targetRole === 'teamer';
  // Dieselben Farben wie der linke Balken der Zeile (app-list-item--gottesdienst
  // / --gemeinde). Vorher standen hier #007aff (das ist die JAHRGANGS-Farbe) und
  // #2dd36f — dadurch hatten Balken und Icon-Kreis zwei verschiedene Toene.
  const activityColor = (activity: Activity) =>
    isTeamerBadge ? 'var(--app-color-teamer)'
      : activity.type === 'gottesdienst'
        ? 'var(--app-color-gottesdienst)'
        : 'var(--app-color-gemeinde)';
  const activityIcon = (activity: Activity) =>
    isTeamerBadge ? ICON_GRUPPE_GEFUELLT : activity.type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_GEMEINDE_GEFUELLT;
  const activitySubtitle = (activity: Activity): string | null =>
    isTeamerBadge ? null : activity.type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde';

  // Auswahl wird wie ueberall sonst über die Bereichsklasse dargestellt
  // (eingefaerbter Hintergrund), NICHT über ein Haekchen — siehe die
  // Kategorie- und Jahrgangs-Auswahl im Event-Formular (User-Hinweis 11.08.).
  const activityItemClass = (activity: Activity, isSelected: boolean): string => {
    const bereich = isTeamerBadge
      ? 'app-list-item--teamer'
      : activity.type === 'gottesdienst'
        ? 'app-list-item--gottesdienst'
        : 'app-list-item--gemeinde';
    return `app-list-item ${bereich}${isSelected ? ' app-list-item--selected' : ''}`;
  };

  const renderCriteriaSpecificFields = () => {
    switch (formData.criteria_type) {
      case 'specific_activity': {
        const selectedActivity = activities.find(a => a.id === extraCriteria.activity_id);
        return (
          <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
            <IonAccordionGroup>
              <IonAccordion value="activity-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                      Aktivität auswählen
                    </h3>
                    {selectedActivity && (
                      <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0', fontWeight: 'var(--app-schrift-mittel)' }}>
                        {selectedActivity.name}
                        {activitySubtitle(selectedActivity) && ` (${activitySubtitle(selectedActivity)})`}
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: 'var(--app-abstand-eng) 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {activities.map(activity => {
                      const isSelected = extraCriteria.activity_id === activity.id;
                      return (
                        <div
                          key={activity.id}
                          className={activityItemClass(activity, isSelected)}
                          onClick={() => !loading && setExtraCriteria({ ...extraCriteria, activity_id: activity.id })}
                          style={{
                            cursor: loading ? 'default' : 'pointer',
                            opacity: loading ? 0.6 : 1,
                            marginBottom: '0'
                          }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle" style={{ backgroundColor: activityColor(activity) }}>
                                <IonIcon icon={activityIcon(activity)} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{activity.name}</div>
                                {activitySubtitle(activity) && (
                                  <div className="app-list-item__subtitle">
                                    {activitySubtitle(activity)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
          </div>
        );
      }

      case 'category_activities': {
        const selectedCategory = categories.find(c => c.name === extraCriteria.required_category);
        return (
          <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
            <IonAccordionGroup>
              <IonAccordion value="category-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                      Kategorie auswählen
                    </h3>
                    {selectedCategory && (
                      <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0', fontWeight: 'var(--app-schrift-mittel)' }}>
                        {selectedCategory.name}
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: 'var(--app-abstand-eng) 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {categories.map(category => {
                      const isSelected = extraCriteria.required_category === category.name;
                      return (
                        <div
                          key={category.id}
                          className={`app-list-item app-list-item--categories${isSelected ? ' app-list-item--selected' : ''}`}
                          onClick={() => !loading && setExtraCriteria({ ...extraCriteria, required_category: category.name })}
                          style={{
                            cursor: loading ? 'default' : 'pointer',
                            opacity: loading ? 0.6 : 1,
                            marginBottom: '0'
                          }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle app-icon-circle--categories">
                                <IonIcon icon={ICON_KATEGORIE_GEFUELLT} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{category.name}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
          </div>
        );
      }

      case 'category_combination': {
        // Mehrfachauswahl von Kategorien. Bewusst dieselbe Machart wie die
        // Aktivitaets-Kombination darunter, nur mit Kategorien: Das Kriterium
        // fragt "aus wie vielen VERSCHIEDENEN Kategorien war jemand dabei" —
        // dreimal dieselbe zaehlt nur einmal.
        const gewaehlteKategorien = extraCriteria.required_categories || [];
        return (
          <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
            <IonAccordionGroup>
              <IonAccordion value="category-combination-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                      Kategorien kombinieren (mehrere auswählbar)
                    </h3>
                    {gewaehlteKategorien.length > 0 && (
                      <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0', fontWeight: 'var(--app-schrift-mittel)' }}>
                        {gewaehlteKategorien.join(', ')}
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: 'var(--app-abstand-eng) 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {categories.map(category => {
                      const isSelected = gewaehlteKategorien.includes(category.name);
                      return (
                        <div
                          key={category.id}
                          className={`app-list-item app-list-item--categories${isSelected ? ' app-list-item--selected' : ''}`}
                          onClick={() => {
                            if (loading) return;
                            const neueAuswahl = isSelected
                              ? gewaehlteKategorien.filter((n: string) => n !== category.name)
                              : [...gewaehlteKategorien, category.name];
                            setExtraCriteria({ ...extraCriteria, required_categories: neueAuswahl });
                            // "4 aus 3" kann niemand erreichen — das Backend
                            // lehnt es ab. Statt die Speichern-Meldung
                            // abzuwarten, zieht der Wert beim Abwaehlen mit.
                            if (neueAuswahl.length > 0 && formData.criteria_value > neueAuswahl.length) {
                              setFormData({ ...formData, criteria_value: neueAuswahl.length });
                            }
                          }}
                          style={{
                            cursor: loading ? 'default' : 'pointer',
                            opacity: loading ? 0.6 : 1,
                            marginBottom: '0'
                          }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle app-icon-circle--categories">
                                <IonIcon icon={ICON_KATEGORIE_GEFUELLT} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{category.name}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
          </div>
        );
      }

      case 'time_based':
        return (
          <IonItem lines="none" style={{ '--background': 'transparent', marginTop: 'var(--app-abstand-basis)' }}>
            <IonLabel position="stacked" style={{ marginBottom: 'var(--app-abstand-eng)' }}>Zeitraum (Wochen) <span style={{ fontWeight: 'var(--app-schrift-fett)', color: 'var(--ion-color-primary)' }}>{extraCriteria.weeks || 4}</span></IonLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', width: '100%' }}>
              <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>1</span>
              <IonRange
                min={1} max={26} step={1}
                pin={true} pinFormatter={(value: number) => `${value}`}
                value={extraCriteria.weeks || 4}
                onIonChange={(e) => setExtraCriteria({ ...extraCriteria, weeks: e.detail.value as number })}
                disabled={loading}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>26</span>
            </div>
          </IonItem>
        );

      case 'activity_combination': {
        const selectedActivities = activities.filter(a => (extraCriteria.activity_ids || []).includes(a.id));
        return (
          <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
            <IonAccordionGroup>
              <IonAccordion value="activity-combination-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                      Aktivitäten kombinieren (mehrere auswählbar)
                    </h3>
                    {selectedActivities.length > 0 && (
                      <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0', fontWeight: 'var(--app-schrift-mittel)' }}>
                        {selectedActivities.map(a => a.name).join(', ')}
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: 'var(--app-abstand-eng) 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {activities.map(activity => {
                      const activityIds = extraCriteria.activity_ids || [];
                      const isSelected = activityIds.includes(activity.id);

                      return (
                        <div
                          key={activity.id}
                          className={activityItemClass(activity, isSelected)}
                          onClick={() => {
                            const currentIds = extraCriteria.activity_ids || [];
                            const newIds = isSelected
                              ? currentIds.filter((id: number) => id !== activity.id)
                              : [...currentIds, activity.id];
                            setExtraCriteria({ ...extraCriteria, activity_ids: newIds });
                          }}
                          style={{
                            cursor: loading ? 'default' : 'pointer',
                            opacity: loading ? 0.6 : 1,
                            marginBottom: '0'
                          }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle" style={{ backgroundColor: activityColor(activity) }}>
                                <IonIcon icon={activityIcon(activity)} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{activity.name}</div>
                                {activitySubtitle(activity) && (
                                  <div className="app-list-item__subtitle">
                                    {activitySubtitle(activity)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </IonAccordion>
            </IonAccordionGroup>
          </div>
        );
      }

      default:
        return null;
    }
  };

  const reglerMax = Math.max(20, formData.criteria_value || 0);

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
      case 'category_combination':
        return 'Aus wie vielen der angekreuzten Kategorien?';
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
            {/* NICHT an loading haengen: Schliessen muss immer moeglich sein.
                Bleibt loading haengen, waere das Modal sonst nur noch per
                Swipe zu verlassen. Die Rueckfrage bei ungespeicherten
                Aenderungen laeuft ohnehin ueber canDismiss der Seite. */}
            <IonButton aria-label="Schließen" onClick={handleClose} className="app-modal-close-btn">
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Badge speichern"
              onClick={handleSave}
              disabled={loading || isSubmitting || !formData.name.trim()}
              className="app-modal-submit-btn app-modal-submit-btn--badges"
            >
              {loading ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {initialDataLoading && !isEditMode ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-block)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-block)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
        <>
        {/* SEKTION: Zielgruppe (nur bei neuem Badge) */}
        {!isEditMode && (
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--badges">
              <IonIcon icon={ICON_GRUPPE} />
            </div>
            <IonLabel>Zielgruppe</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                {/* Jede Zielgruppe in IHRER Farbe (Konfi-Lila, Teamer-Pink)
                    statt beide in Orange — wie ueberall sonst in der App. */}
                <div
                  className={`app-list-item app-list-item--purple${formData.target_role === 'konfi' ? ' app-list-item--selected' : ''}`}
                  onClick={() => !loading && setFormData({ ...formData, target_role: 'konfi', criteria_type: 'total_points', criteria_value: 10, color: getCategoryColor('total_points') })}
                  style={{
                    cursor: loading ? 'default' : 'pointer',
                    marginBottom: '0'
                  }}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--purple">
                        <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">Konfis</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className={`app-list-item app-list-item--teamer${formData.target_role === 'teamer' ? ' app-list-item--selected' : ''}`}
                  onClick={() => !loading && setFormData({ ...formData, target_role: 'teamer', criteria_type: 'activity_count', criteria_value: 5, color: getCategoryColor('activity_count') })}
                  style={{
                    cursor: loading ? 'default' : 'pointer',
                    marginBottom: '0'
                  }}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--teamer">
                        <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">Team</div>
                      </div>
                    </div>
                  </div>
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
              <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
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

              <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
                <IonAccordionGroup>
                  <IonAccordion value="icon-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                    <IonItem slot="header" lines="none">
                      <IonLabel>
                        <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                          Icon *
                        </h3>
                        {formData.icon && BADGE_ICONS[formData.icon as keyof typeof BADGE_ICONS] && (
                          <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0', fontWeight: 'var(--app-schrift-mittel)' }}>
                            {BADGE_ICONS[formData.icon as keyof typeof BADGE_ICONS].name} ({BADGE_ICONS[formData.icon as keyof typeof BADGE_ICONS].category})
                          </p>
                        )}
                      </IonLabel>
                    </IonItem>
                    <div slot="content" style={{ padding: 'var(--app-abstand-basis)' }}>
                      {Object.entries(BADGE_ICONS).reduce<{ category: string; icons: { key: string; data: typeof BADGE_ICONS[keyof typeof BADGE_ICONS] }[] }[]>((acc, [key, data]) => {
                        const categoryIndex = acc.findIndex((group) => group.category === data.category);
                        if (categoryIndex === -1) {
                          acc.push({ category: data.category, icons: [{ key, data }] });
                        } else {
                          acc[categoryIndex].icons.push({ key, data });
                        }
                        return acc;
                      }, []).map((group) => (
                        <div key={group.category} style={{ marginBottom: 'var(--app-abstand-basis)' }}>
                          <IonText style={{ fontSize: 'var(--app-text-sekundaer)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-secondary)', marginBottom: 'var(--app-abstand-eng)', display: 'block' }}>
                            {group.category}
                          </IonText>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 'var(--app-abstand-eng)' }}>
                            {group.icons.map(({ key, data }) => (
                              <div
                                key={key}
                                onClick={() => setFormData({ ...formData, icon: key })}
                                style={{
                                  width: '100%',
                                  aspectRatio: '1',
                                  backgroundColor: formData.icon === key ? formData.color : 'var(--app-surface-soft)',
                                  borderRadius: 'var(--app-radius-karte)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  border: '1px solid rgba(0,0,0,0.06)',
                                  boxShadow: 'var(--app-schatten-flach)',
                                  transition: 'all 0.2s'
                                }}
                              >
                                <IonIcon
                                  icon={data.icon}
                                  style={{
                                    fontSize: 'var(--app-text-ueberschrift)',
                                    color: formData.icon === key ? 'white' : 'var(--app-text-secondary)'
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
                <div style={{ marginTop: 'var(--app-abstand-eng)', width: '100%' }}>
                  <div style={{ display: 'flex', gap: 'var(--app-abstand-eng)', alignItems: 'stretch' }}>
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      disabled={loading}
                      style={{
                        flex: 1,
                        height: '60px',
                        border: '2px solid rgba(0,0,0,0.12)',
                        borderRadius: 'var(--app-radius-karte)',
                        cursor: 'pointer'
                      }}
                    />
                    {formData.color !== getCategoryColor(formData.criteria_type) && (
                      <button
                        onClick={() => setFormData({ ...formData, color: getCategoryColor(formData.criteria_type) })}
                        disabled={loading}
                        style={{
                          padding: 'var(--app-abstand-eng) var(--app-abstand-mittel)',
                          borderRadius: 'var(--app-radius-karte)',
                          border: `2px solid ${getCategoryColor(formData.criteria_type)}`,
                          backgroundColor: 'transparent',
                          color: getCategoryColor(formData.criteria_type),
                          fontSize: 'var(--app-text-klein)',
                          fontWeight: 'var(--app-schrift-halbfett)',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--app-abstand-kompakt)'
                        }}
                      >
                        <div style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: 'var(--app-radius-kreis)',
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
              <IonIcon icon={ICON_EINSTELLUNGEN_GEFUELLT} />
            </div>
            <IonLabel>Badge-Kriterien</IonLabel>
          </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent>
            <IonAccordionGroup>
              <IonAccordion value="criteria-types" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                <IonItem slot="header" lines="none">
                  <IonLabel>
                    <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                      Kriterium-Typ
                    </h3>
                    {formData.criteria_type && criteriaTypes[formData.criteria_type] && (
                      <>
                        <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-winzig) 0', fontWeight: 'var(--app-schrift-mittel)' }}>
                          {criteriaTypes[formData.criteria_type].label.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim()}
                        </p>
                        <p style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-muted)', margin: '0', whiteSpace: 'normal' }}>
                          {criteriaTypes[formData.criteria_type].description}
                        </p>
                      </>
                    )}
                  </IonLabel>
                </IonItem>
                <div slot="content" style={{ padding: 'var(--app-abstand-eng) 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {Object.entries(criteriaTypes)
                      .filter(([value]) => {
                        // Bei Teamer: Punkte-basierte Kriterien ausblenden
                        if (formData.target_role === 'teamer' && TEAMER_HIDDEN_TYPES.includes(value)) return false;
                        // teamer_year NUR bei Teamer anzeigen
                        if (value === 'teamer_year' && formData.target_role !== 'teamer') return false;
                        return true;
                      })
                      .map(([value, type]) => {
                      const isSelected = formData.criteria_type === value;
                      const typColor = getCategoryColor(value);
                      // Remove emojis from label
                      const labelWithoutEmoji = type.label.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

                      return (
                        <div
                          key={value}
                          className="app-list-item"
                          onClick={() => {
                            if (!loading) {
                              let defaultValue = 10;
                              if (value === 'activity_count' || value === 'unique_activities' ||
                                  value === 'specific_activity' || value === 'category_activities' ||
                                  value === 'event_count') {
                                defaultValue = 5;
                              } else if (value === 'activity_combination' || value === 'category_combination') {
                                defaultValue = 3;
                              } else if (value === 'streak') {
                                defaultValue = 4;
                              }
                              const currentCategoryColor = getCategoryColor(formData.criteria_type);
                              const newColor = (formData.color === currentCategoryColor || formData.color === CRITERIA_FALLBACK_COLOR)
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
                            // Jeder Kriterientyp hat seine eigene Farbe (dieselbe,
                            // die das fertige Badge trägt) — vorher war die
                            // ganze Liste pauschal orange.
                            borderLeftColor: typColor,
                            background: isSelected ? `${typColor}14` : undefined
                          }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle" style={{ backgroundColor: typColor }}>
                                <IonIcon icon={getCriteriaIcon(value)} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{labelWithoutEmoji}</div>
                                <div className="app-list-item__subtitle" style={{ whiteSpace: 'normal' }}>
                                  {type.help}
                                </div>
                              </div>
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
              <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: 'var(--app-abstand-mittel)', marginTop: 'var(--app-abstand-basis)' }}>
                <IonLabel position="stacked" style={{ marginBottom: 'var(--app-abstand-eng)' }}>
                  {getValueLabel()} <span style={{ fontWeight: 'var(--app-schrift-fett)', color: 'var(--ion-color-primary)' }}>{formData.criteria_value}</span>
                </IonLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', width: '100%' }}>
                  <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>1</span>
                  <IonRange
                    min={1} max={reglerMax} step={1}
                    pin={true} pinFormatter={(value: number) => `${value}`}
                    value={formData.criteria_value}
                    onIonChange={(e) => setFormData({ ...formData, criteria_value: e.detail.value as number })}
                    disabled={loading}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>{reglerMax}</span>
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
              <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
            </div>
            <IonLabel>Badge-Status</IonLabel>
          </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent>
            <IonList>
              <IonItem lines="inset">
                <IonLabel>
                  <h3 style={{ color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-mini) 0', fontWeight: 'var(--app-schrift-halbfett)' }}>Aktiv</h3>
                  <p style={{ color: 'var(--app-text-secondary)', margin: '0', fontSize: 'var(--app-text-sekundaer)' }}>Badge kann verliehen werden</p>
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
                  <h3 style={{ color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-mini) 0', fontWeight: 'var(--app-schrift-halbfett)' }}>Geheim</h3>
                  <p style={{ color: 'var(--app-text-secondary)', margin: '0', fontSize: 'var(--app-text-sekundaer)' }}>Badge ist für Konfis nicht sichtbar bis sie es erhalten</p>
                </IonLabel>
                <IonToggle
                  slot="end"
                  className="app-toggle--badges"
                  checked={formData.is_hidden}
                  onIonChange={(e) => setFormData({ ...formData, is_hidden: e.detail.checked })}
                />
              </IonItem>
            </IonList>

            {/* Nur bei bestehendem Badge (Route ist je Abzeichen) und nur fuer
                admin/org_admin (POST /admin/badges/:id/pruefen: requireAdmin).
                Fuer Sonderfaelle gedacht — Speichern loest die Pruefung
                inzwischen automatisch aus. */}
            {isEditMode && darfPruefen && (
              <IonButton
                expand="block"
                fill="outline"
                onClick={handlePruefen}
                disabled={pruefLoading || loading}
                style={{ marginTop: 'var(--app-abstand-mittel)' }}
              >
                {pruefLoading ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_AKTUALISIEREN} slot="start" />}
                Abzeichen neu prüfen
              </IonButton>
            )}
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