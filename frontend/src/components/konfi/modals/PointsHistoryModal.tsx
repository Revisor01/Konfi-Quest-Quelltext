import React, { useState, useEffect, useMemo } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonIcon,
  IonButton,
  IonButtons,
  IonSpinner,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonLabel
} from '@ionic/react';
import {
  ICON_BONUS,
  ICON_POKAL,
  ICON_SCHLIESSEN,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_STERN,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT,
} from '../../shared/icons';
import api from '../../../services/api';
import { SectionHeader } from '../../shared';
import EmptyState from '../../shared/EmptyState';

interface PointsHistoryModalProps {
  onClose: () => void;
  pointConfig?: {
    gottesdienst_enabled: boolean;
    gemeinde_enabled: boolean;
  };
  apiEndpoint?: string;
  profileTotals?: {
    total_points: number;
    gottesdienst_points: number;
    gemeinde_points: number;
    bonus_points: number;
    event_count: number;
  };
}

interface PointEntry {
  id: number;
  title: string;
  points: number;
  category: string;
  date: string;
  comment?: string;
  source_type: 'activity' | 'bonus' | 'event';
}

const PointsHistoryModal: React.FC<PointsHistoryModalProps> = ({ onClose, pointConfig, apiEndpoint, profileTotals }) => {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<PointEntry[]>([]);

  // Enabled-Flags mit Fallback (Abwaertskompatibilitaet)
  const gottesdienstEnabled = pointConfig?.gottesdienst_enabled !== false;
  const gemeindeEnabled = pointConfig?.gemeinde_enabled !== false;

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const response = await api.get(apiEndpoint || '/konfi/points-history');
      setHistory(response.data.history || []);
    } catch (err) {
 console.error('Error loading points history:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unbekannt';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Ungültig';
    return date.toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  // Gefilterte Historie: deaktivierte Typen ausblenden
  const filteredHistory = useMemo(() => {
    return history.filter(entry => {
      if (entry.category === 'gottesdienst' && !gottesdienstEnabled) return false;
      if (entry.category === 'gemeinde' && !gemeindeEnabled) return false;
      return true;
    });
  }, [history, gottesdienstEnabled, gemeindeEnabled]);

  // Totals: profileTotals (gleiche Quelle wie Profil-Seite) oder Fallback aus History
  const filteredTotals = useMemo(() => {
    if (profileTotals) {
      const godi = gottesdienstEnabled ? (profileTotals.gottesdienst_points || 0) : 0;
      const gem = gemeindeEnabled ? (profileTotals.gemeinde_points || 0) : 0;
      return { gottesdienst: godi, gemeinde: gem, total: godi + gem };
    }
    const godi = filteredHistory.filter(h => h.category === 'gottesdienst').reduce((sum, h) => sum + h.points, 0);
    const gem = filteredHistory.filter(h => h.category === 'gemeinde').reduce((sum, h) => sum + h.points, 0);
    return { gottesdienst: godi, gemeinde: gem, total: godi + gem };
  }, [profileTotals, filteredHistory, gottesdienstEnabled, gemeindeEnabled]);

  // Farbe basierend auf category (gottesdienst=blau, gemeinde=grün)
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'gottesdienst': return 'var(--app-color-gottesdienst)';
      case 'gemeinde': return 'var(--app-color-gemeinde)';
      default: return 'var(--app-color-konfis)';
    }
  };

  // Icon basierend auf category und source_type
  const getCategoryIcon = (category: string, sourceType?: string) => {
    if (sourceType === 'bonus') return ICON_BONUS;
    if (sourceType === 'event') return ICON_TERMIN;
    switch (category) {
      // Haus wie in allen Terminlisten: Die Kategorie
      // trug drei Zeichen -- Haus in den Listen, Stern hier, Schulhut in
      // der Admin-Aktivitaetenliste. Das Haus ist die Mehrheit.
      case 'gottesdienst': return ICON_GOTTESDIENST_GEFUELLT;
      // Gruppe wie in der Leitungsansicht: Hier stand als
      // einziger Stelle der Blitz, direkt neben dem Gottesdienst-Haus.
      case 'gemeinde': return ICON_GEMEINDE_GEFUELLT;
      default: return ICON_STERN;
    }
  };

  // Typ-Badge Farbe (orange für Bonus, rot für Event)
  const getTypeBadgeColor = (sourceType: string) => {
    switch (sourceType) {
      case 'bonus': return 'var(--app-color-badges)';
      case 'event': return 'var(--app-color-events)';
      default: return null;
    }
  };

  // Typ-Badge Icon (Event/Bonus zeigen nur Icon, kein Text)
  const getTypeBadgeIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'bonus': return ICON_BONUS;
      case 'event': return ICON_TERMIN;
      default: return null;
    }
  };

  // Punkte-Summen nach Quelle aus gefilterter History berechnen
  const eventPoints = filteredHistory.filter(h => h.source_type === 'event').reduce((sum, h) => sum + h.points, 0);
  const activityPoints = filteredHistory.filter(h => h.source_type === 'activity').reduce((sum, h) => sum + h.points, 0);
  const bonusPoints = filteredHistory.filter(h => h.source_type === 'bonus').reduce((sum, h) => sum + h.points, 0);
  const showBothTypes = gottesdienstEnabled && gemeindeEnabled;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Punkte-Übersicht</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {loading ? (
          <div className="app-settings-item" style={{ justifyContent: 'center', padding: 'var(--app-abstand-riesig)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            <SectionHeader
              title="Deine Punkte"
              subtitle="Übersicht aller gesammelten Punkte"
              icon={ICON_POKAL}
              preset="konfis"
              stats={[
                ...(showBothTypes ? [{ value: filteredTotals.total, label: 'GESAMT' }] : []),
                ...(gottesdienstEnabled ? [{ value: filteredTotals.gottesdienst, label: 'GD' }] : []),
                ...(gemeindeEnabled ? [{ value: filteredTotals.gemeinde, label: 'GEMEINDE' }] : []),
                { value: eventPoints, label: 'EVENTS' },
                { value: activityPoints, label: 'AKTIONEN' },
                { value: bonusPoints, label: 'BONUS' }
              ]}
            />

            {/* Verlauf Sektion - iOS26 Pattern */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--purple">
                  <IonIcon icon={ICON_UHRZEIT} />
                </div>
                <IonLabel>Verlauf ({filteredHistory.length} {filteredHistory.length === 1 ? 'Eintrag' : 'Einträge'})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: filteredHistory.length === 0 ? 'var(--app-abstand-eng)' : 'var(--app-abstand-mittel)' }}>
                  {filteredHistory.length === 0 ? (
                    <EmptyState
                      icon={ICON_UHRZEIT}
                      title="Noch keine Einträge"
                      message="Hier erscheinen deine Punkte, sobald du welche erhalten hast."
                      iconColor="var(--app-color-konfis)"
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {filteredHistory.map((entry) => {
                        const categoryColor = getCategoryColor(entry.category);
                        const typeBadgeColor = getTypeBadgeColor(entry.source_type);

                        // Farbe basiert auf category (blau/gruen)
                        const listItemClass = entry.category === 'gottesdienst' ? 'app-list-item--gottesdienst' : 'app-list-item--activities';
                        const iconCircleClass = entry.category === 'gottesdienst' ? 'app-icon-circle--gottesdienst' : 'app-icon-circle--activities';

                        return (
                          <div
                            key={`${entry.source_type}-${entry.id}`}
                            className={`app-list-item ${listItemClass}`}
                            style={{ position: 'relative', overflow: 'hidden' }}
                          >
                            {/* Corner Badges Container - oben rechts */}
                            <div className="app-corner-badges">
                              {/* Typ-Badge (Bonus/Event) */}
                              {typeBadgeColor && getTypeBadgeIcon(entry.source_type) && (
                                <>
                                  <div className="app-corner-badge" style={{ backgroundColor: typeBadgeColor }}>
                                    <IonIcon icon={getTypeBadgeIcon(entry.source_type)!} />
                                  </div>
                                  <div className="app-corner-badges__separator" />
                                </>
                              )}
                              {/* Punkte-Badge */}
                              <div className="app-corner-badge" style={{ backgroundColor: categoryColor }}>
                                +{entry.points}P
                              </div>
                            </div>

                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                <div className={`app-icon-circle ${iconCircleClass}`}>
                                  <IonIcon icon={getCategoryIcon(entry.category, entry.source_type)} />
                                </div>
                                <div className="app-list-item__content">
                                  <div className="app-list-item__title" style={{ paddingRight: typeBadgeColor ? 'var(--app-freiraum-aktion-xxxl)' : 'var(--app-freiraum-aktion-l)' }}>{entry.title}</div>
                                  <div className="app-list-item__meta">
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ color: 'var(--app-color-events)' }} />
                                      {formatDate(entry.date)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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

export default PointsHistoryModal;
