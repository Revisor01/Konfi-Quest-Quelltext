import React, { useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonPage,
  IonProgressBar,
  IonTitle,
  IonToolbar,
  useIonModal,
  useIonAlert
} from '@ionic/react';
import {
  personOutline,
  calendarOutline,
  starOutline,
  trophy,
  checkmark,
  flash,
  logOutOutline,
  trashOutline,
  rocket,
  keyOutline,
  bookOutline,
  locationOutline,
  mailOutline,
  timeOutline,
  compassOutline,
  imagesOutline,
  sparklesOutline,
  chevronForwardOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { setUser as setTokenStoreUser } from '../../../services/tokenStore';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { SectionHeader } from '../../shared';
import { useMediaCacheControl } from '../../../hooks/useMediaCacheControl';
import ChangePasswordModal from '../../shared/ChangePasswordModal';
import ChangeEmailModal from '../../shared/ChangeEmailModal';
import DeleteAccountModal from '../../shared/DeleteAccountModal';
import BibleTranslationModal, { getTranslationName } from '../../shared/BibleTranslationModal';
import SpiritFooter from '../../shared/SpiritFooter';
import PointsHistoryModal from '../modals/PointsHistoryModal';
import WrappedModal from '../../wrapped/WrappedModal';
import KonfiOnboardingModal from '../modals/KonfiOnboardingModal';
import KonfiUpdateWalkthroughModal from '../modals/KonfiUpdateWalkthroughModal';
import type { WrappedHistoryEntry } from '../../../types/wrapped';
import { safeUUID } from '../../../utils/uuid';
import NeuerungenBanner from '../../shared/NeuerungenBanner';
import MitmachenErklaerungModal from '../../shared/MitmachenErklaerungModal';

interface KonfiProfile {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  jahrgang_name: string;
  jahrgang_year: number;
  confirmation_date?: string;
  confirmation_location?: string;
  created_at: string;
  last_login_at?: string;
  bible_translation?: string;
  gottesdienst_enabled?: boolean;
  gemeinde_enabled?: boolean;
  // Statistics
  total_points: number;
  gottesdienst_points?: number;
  gemeinde_points?: number;
  bonus_points?: number;
  badge_count: number;
  activity_count: number;
  event_count: number;
  pending_requests: number;
  rank_in_jahrgang?: number;
  total_in_jahrgang?: number;
  recent_activities: RecentActivity[];
  progress_overview: ProgressOverview;
}

interface RecentActivity {
  id: number;
  title: string;
  type: 'activity' | 'event' | 'badge' | 'request';
  points: number;
  date: string;
  icon?: string;
}

interface ProgressOverview {
  next_badge?: {
    name: string;
    points_needed: number;
    progress_percentage: number;
  };
  monthly_points: {
    month: string;
    points: number;
  }[];
  achievements: {
    total_activities: number;
    total_events: number;
    total_badges: number;
    streak_days?: number;
  };
}

interface ProfileViewProps {
  profile: KonfiProfile;
  onReload: () => void;
  presentingElement: HTMLElement | null;
  pageRef?: React.RefObject<HTMLElement | null>;
}

const ProfileView: React.FC<ProfileViewProps> = ({ profile, onReload, presentingElement, pageRef }) => {
  const { user, setUser, setError, signOut } = useApp();
  const [presentAlert] = useIonAlert();

  const [selectedTranslation, setSelectedTranslation] = useState<string>(profile.bible_translation || 'LUT');
  const [earnedBadgesCount, setEarnedBadgesCount] = useState<number>(0);
  // Anzahl der eigenen Challenge-Stempel (marks). Schlanker Zusatzabruf —
  // fällt er aus, bleibt die Kachel bei 0 statt das Profil zu stoeren.
  const [challengeMarksCount, setChallengeMarksCount] = useState<number>(0);
  const { cacheLabel, clearMediaCache: handleClearMediaCache } = useMediaCacheControl();
  const [wrappedHistory, setWrappedHistory] = useState<WrappedHistoryEntry[]>([]);
  // Wrapped-Historie laden
  React.useEffect(() => {
    if (!profile?.id) return;
    api.get(`/wrapped/history/${profile.id}`)
      .then(res => setWrappedHistory(res.data || []))
      .catch(() => {}); // Stille Fehlerbehandlung -- optionales Feature
  }, [profile?.id]);

  // WrappedModal per useIonModal mit dynamischen Daten
  const [wrappedModalData, setWrappedModalData] = React.useState<WrappedHistoryEntry | null>(null);
  const [presentWrappedModal, dismissWrappedModal] = useIonModal(WrappedModal, {
    onClose: () => dismissWrappedModal(),
    displayName: profile.display_name,
    jahrgangName: profile.jahrgang_name || '',
    wrappedType: wrappedModalData?.wrapped_type || 'konfi',
    initialData: wrappedModalData?.data,
    initialYear: wrappedModalData?.year
  });

  const openWrapped = React.useCallback((entry: WrappedHistoryEntry) => {
    setWrappedModalData(entry);
  }, []);

  React.useEffect(() => {
    if (wrappedModalData) {
      presentWrappedModal({ cssClass: 'wrapped-modal-fullscreen' });
    }
  }, [wrappedModalData]);
  
  // Load badges for accurate count
  React.useEffect(() => {
    const loadBadges = async () => {
      try {
        const response = await api.get('/konfi/badges');
        const badges = [...(response.data.available || []), ...(response.data.earned || [])];
        const earnedCount = badges.filter((badge: any) => badge.earned || badge.is_earned).length;
        setEarnedBadgesCount(earnedCount);
      } catch (err) {
 console.warn('Could not load badges for count:', err);
      }
    };
    loadBadges();
  }, []);

  // Challenge-Stempel zählen. Fehler bewusst still: die Kachel zeigt dann 0.
  React.useEffect(() => {
    api.get('/challenges/konfi')
      .then(res => {
        const marks = Array.isArray(res.data?.marks) ? res.data.marks : [];
        setChallengeMarksCount(marks.length);
      })
      .catch(() => { /* optionale Kachel — stiller Fehler */ });
  }, []);

  const handleTranslationChange = async (translation: string) => {
    // Offline: Optimistic UI + Queue-Fallback (fire-and-forget)
    if (!networkMonitor.isOnline) {
      setSelectedTranslation(translation);
      writeQueue.enqueue({
        method: 'PUT',
        url: '/konfi/bible-translation',
        body: { translation },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Bibelübersetzung' },
      });
      return;
    }

    try {
      await api.put('/konfi/bible-translation', { translation });
      setSelectedTranslation(translation);
      // Update profile to reflect the change
      await onReload();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Ändern der Bibelübersetzung');
    }
  };

  const handleLogout = () => {
    presentAlert({
      header: 'Abmelden',
      message: 'Möchtest du dich wirklich abmelden?',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Abmelden',
          role: 'destructive',
          handler: async () => {
            // signOut() ist failsafe (kein throw, erzwingt intern clearAuth +
            // setUser(null) -> Login-Route). Kein window.location-Reload nötig.
            await signOut();
          }
        }
      ]
    });
  };

  // Modal with useIonModal Hook for Email Edit
  const [presentEmailModal, dismissEmailModal] = useIonModal(ChangeEmailModal, {
    onClose: () => dismissEmailModal(),
    onSuccess: async () => {
      dismissEmailModal();
      onReload();
      try {
        const response = await api.get('/auth/me');
        if (user) {
          const updatedUser = { ...user, email: response.data.email };
          await setTokenStoreUser(updatedUser);
          setUser(updatedUser);
        }
      } catch (err) {
        console.error('Error refreshing user:', err);
      }
    },
    // initialEmail wird nicht mehr benötigt - Modal lädt selbst vom Server
    variante: 'purple'
  });

  // Modal with useIonModal Hook for Password Change
  const [presentPasswordModal, dismissPasswordModal] = useIonModal(ChangePasswordModal, {
    onClose: () => dismissPasswordModal(),
    onSuccess: () => {
      dismissPasswordModal();
    },
    variante: 'purple'
  });

  // Modal with useIonModal Hook for Account Deletion
  const [presentDeleteAccount, dismissDeleteAccount] = useIonModal(DeleteAccountModal, {
    onClose: () => dismissDeleteAccount()
  });

  // App-Tour (Onboarding) erneut ansehen — Vollbild-Overlay (kein Modal)
  const [showOnboarding, setShowOnboarding] = useState(false);
  // "Was ist neu?" — derselbe Update-Walkthrough, den Bestandsnutzer einmalig
  // nach dem Update sehen. Hier jederzeit erneut aufrufbar.
  const [showUpdateWalkthrough, setShowUpdateWalkthrough] = useState(false);
  const [showMitmachenErklaerung, setShowMitmachenErklaerung] = useState(false);

  // Modal with useIonModal Hook for Bible Translation
  const [presentBibleModal, dismissBibleModal] = useIonModal(BibleTranslationModal, {
    onClose: () => dismissBibleModal(),
    currentTranslation: selectedTranslation,
    onSelect: (code: string) => {
      handleTranslationChange(code);
      dismissBibleModal();
    }
  });

  // Modal with useIonModal Hook for Points History
  const [presentPointsModal, dismissPointsModal] = useIonModal(PointsHistoryModal, {
    onClose: () => dismissPointsModal(),
    // Ohne pointConfig faellt das Modal auf "beide Arten aktiv" zurueck.
    pointConfig: profile
      ? {
          gottesdienst_enabled: profile.gottesdienst_enabled !== false,
          gemeinde_enabled: profile.gemeinde_enabled !== false,
        }
      : undefined,
    profileTotals: profile ? {
      total_points: profile.total_points || 0,
      gottesdienst_points: profile.gottesdienst_points || 0,
      gemeinde_points: profile.gemeinde_points || 0,
      bonus_points: profile.bonus_points || 0,
      event_count: profile.event_count || 0
    } : undefined
  });

  const getInitials = (name: string | undefined) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const getActivityIcon = (activity: RecentActivity) => {
    switch (activity.type) {
      case 'badge': return trophy;
      case 'event': return calendarOutline;
      case 'activity': return flash;
      case 'request': return checkmark;
      default: return starOutline;
    }
  };

  const getActivityColor = (activity: RecentActivity) => {
    switch (activity.type) {
      case 'badge': return '#ffd700';
      case 'event': return '#3880ff';
      case 'activity': return '#2dd36f';
      case 'request': return '#ffcc00';
      default: return '#667eea';
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'Unbekannt';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Ungültiges Datum';
    return date.toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatDateTime = (dateString: string | undefined) => {
    if (!dateString) return 'Unbekannt';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Ungültiges Datum';
    return date.toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div>
      <SectionHeader
        title={profile.display_name}
        subtitle={`@${profile.username}`}
        icon={personOutline}
        preset="konfis"
        // Bewusst nur DREI Kacheln: sechs Zahlen nebeneinander waren zu eng und
        // die Aufteilung (GD/Gemeinde/Bonus) steht ohnehin in der
        // Punkte-Übersicht weiter unten. Hier zählt der Ueberblick.
        stats={[
          { value: profile.total_points || 0, label: 'PUNKTE' },
          { value: earnedBadgesCount, label: 'BADGES' },
          { value: challengeMarksCount, label: 'CHALLENGES' }
        ]}
      />

      {/* Konfirmationstermin Card - Dashboard Blau Style mit Background Header */}
      <div style={{ 
        margin: '16px', 
        borderRadius: '24px',
        background: profile.confirmation_date ? 'linear-gradient(135deg, #5b21b6 0%, #4c1d95 100%)' : 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
        border: 'none',
        boxShadow: profile.confirmation_date ? '0 10px 40px rgba(91, 33, 182, 0.3)' : '0 10px 40px rgba(100, 116, 139, 0.3)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Überschrift - groß und überlappend */}
        <div style={{
          position: 'absolute',
          top: '-8px',
          left: '12px',
          zIndex: 1
        }}>
          <h2 style={{
            fontSize: '4rem',
            fontWeight: '900',
            color: 'rgba(255, 255, 255, 0.1)',
            margin: '0',
            lineHeight: '0.8',
            letterSpacing: '-1px'
          }}>
            KONFI
          </h2>
        </div>

        {/* Content */}
        <div style={{
          position: 'relative',
          zIndex: 2,
          padding: '50px 24px 24px 24px',
          flex: 1,
          display: 'flex',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
            <div style={{ 
              width: '48px', 
              height: '48px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              flexShrink: 0,
              border: '2px solid rgba(255, 255, 255, 0.3)'
            }}>
              <IonIcon
                icon={calendarOutline}
                style={{
                  fontSize: '1.5rem',
                  color: 'white'
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              {profile.confirmation_date ? (
                <div>
                  <p style={{ 
                    margin: '0 0 4px 0', 
                    color: 'white', 
                    fontSize: '1.1rem', 
                    fontWeight: '600' 
                  }}>
                    {formatDate(profile.confirmation_date)}
                  </p>
                  <p style={{ 
                    margin: '0 0 4px 0', 
                    color: 'rgba(255, 255, 255, 0.8)', 
                    fontSize: '0.9rem' 
                  }}>
                    {new Date(profile.confirmation_date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                  </p>
                  {profile.confirmation_location && (
                    <p 
                      style={{ 
                        margin: '0', 
                        color: 'rgba(255, 255, 255, 0.9)', 
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                      onClick={() => {
                        if (profile.confirmation_location) {
                          window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.confirmation_location)}`, '_blank');
                        }
                      }}
                    >
                      <IonIcon icon={locationOutline} style={{ fontSize: '1rem' }} />
                      {profile.confirmation_location}
                    </p>
                  )}
                </div>
              ) : (
                <p style={{ margin: '0', color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem' }}>
                  Noch kein Termin gebucht
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Meine Wrappeds */}
      {wrappedHistory.length > 0 && (
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--purple">
              <IonIcon icon={timeOutline} />
            </div>
            <IonLabel>Meine Wrappeds</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '12px' }}>
              {wrappedHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="app-list-item app-list-item--purple"
                  style={{ width: '100%', cursor: 'pointer' }}
                  onClick={() => openWrapped(entry)}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--purple">
                        <IonIcon icon={timeOutline} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">
                          {entry.wrapped_type === 'konfi' ? 'Konfi-Wrapped' : 'Teamer-Wrapped'} {entry.year}
                        </div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            {new Date(entry.computed_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </IonCardContent>
          </IonCard>
        </IonList>
      )}

      {/* Next Badge Progress */}
      {profile.progress_overview?.next_badge && (
        <IonCard style={{ margin: '16px', borderRadius: '8px' }}>
          <IonCardContent>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
              <IonIcon icon={rocket} style={{ fontSize: '1.2rem', color: '#ff6b35', marginRight: '8px' }} />
              <h3 style={{ margin: '0', fontSize: '1.1rem', fontWeight: '600' }}>
                Nächstes Badge
              </h3>
            </div>
            <p style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: '500' }}>
              {profile.progress_overview.next_badge.name}
            </p>
            <IonProgressBar 
              value={profile.progress_overview.next_badge.progress_percentage / 100}
              style={{ 
                height: '8px', 
                borderRadius: '4px',
                marginBottom: '8px',
                '--progress-background': 'linear-gradient(90deg, #ff6b35, #f7931e)'
              }}
            />
            <p style={{ margin: '0', fontSize: '0.85rem', color: '#666' }}>
              Noch {profile.progress_overview.next_badge.points_needed} Punkte bis zum nächsten Badge
              ({Math.round(profile.progress_overview.next_badge.progress_percentage)}%)
            </p>
          </IonCardContent>
        </IonCard>
      )}

      {/* Recent Activities */}
      {profile.recent_activities && profile.recent_activities.length > 0 && (
        <IonCard style={{ margin: '16px', borderRadius: '8px' }}>
          <IonCardContent style={{ padding: '12px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', fontWeight: '600' }}>
              Letzte Aktivitäten
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {profile.recent_activities.slice(0, 5).map((activity, index) => {
                const colorVariant = activity.type === 'badge' ? 'warning' : activity.type === 'event' ? 'info' : activity.type === 'activity' ? 'success' : 'warning';
                return (
                  <div key={index} className={`app-list-item app-list-item--${colorVariant}`}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className={`app-icon-circle app-icon-circle--${colorVariant}`}>
                          <IonIcon icon={getActivityIcon(activity)} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">
                            {activity.title}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              {formatDateTime(activity.date)} -- {activity.points} {activity.points === 1 ? 'Punkt' : 'Punkte'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </IonCardContent>
        </IonCard>
      )}

      <NeuerungenBanner
        onUpdateOeffnen={() => setShowUpdateWalkthrough(true)}
        onMitmachenOeffnen={() => setShowMitmachenErklaerung(true)}
      />

      {/* Konto-Einstellungen - iOS26 Pattern wie Admin */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--purple">
            <IonIcon icon={personOutline} />
          </div>
          <IonLabel>Konto-Einstellungen</IonLabel>
        </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent style={{ padding: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Punkte-Übersicht */}
              <div
                className="app-list-item app-list-item--purple"
                style={{ width: '100%', cursor: 'pointer' }}
                onClick={() => {
                  presentPointsModal({
                    presentingElement: pageRef?.current || presentingElement || undefined
                  });
                }}
              >
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--purple">
                      <IonIcon icon={starOutline} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">Punkte-Übersicht</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">{profile.total_points || 0} Punkte gesamt</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* App-Tour erneut ansehen */}
              <div
                className="app-list-item app-list-item--purple"
                style={{ width: '100%', cursor: 'pointer' }}
                onClick={() => setShowOnboarding(true)}
              >
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--purple">
                      <IonIcon icon={compassOutline} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">App-Tour ansehen</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">Kurze Einführung durch die App</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* E-Mail ändern */}
              <div
                className="app-list-item app-list-item--purple"
                style={{ width: '100%', cursor: 'pointer' }}
                onClick={() => {
                  presentEmailModal({
                    presentingElement: pageRef?.current || presentingElement || undefined
                  });
                }}
              >
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--purple">
                      <IonIcon icon={mailOutline} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">E-Mail-Adresse ändern</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">
                          {(profile.email || user?.email) ? `Aktuell: ${profile.email || user?.email}` : 'E-Mail für Benachrichtigungen'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Passwort ändern */}
              <div
                className="app-list-item app-list-item--purple"
                style={{ width: '100%', cursor: 'pointer' }}
                onClick={() => {
                  presentPasswordModal({
                    presentingElement: pageRef?.current || presentingElement || undefined
                  });
                }}
              >
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--purple">
                      <IonIcon icon={keyOutline} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">Passwort ändern</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">Sicherheitseinstellungen</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bibelübersetzung */}
              <div
                className="app-list-item app-list-item--purple"
                style={{ width: '100%', cursor: 'pointer' }}
                onClick={() => {
                  presentBibleModal({
                    presentingElement: pageRef?.current || presentingElement || undefined
                  });
                }}
              >
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--purple">
                      <IonIcon icon={bookOutline} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">Bibelübersetzung</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">{getTranslationName(selectedTranslation)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Biometrische Anmeldung (blendet sich selbst aus, wenn das
                  Geraet keine eingerichtete Biometrie hat) */}

              {/* Medien-Cache leeren */}
              <div
                className="app-list-item app-list-item--purple"
                style={{ width: '100%', cursor: 'pointer' }}
                onClick={handleClearMediaCache}
              >
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--purple">
                      <IonIcon icon={imagesOutline} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">Medien-Cache leeren</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">{cacheLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </IonCardContent>
        </IonCard>
      </IonList>

      {/* Logout */}
      <div style={{ padding: '0 16px', marginTop: '16px' }}>
        <IonButton
          expand="block"
          fill="outline"
          color="danger"
          onClick={handleLogout}
          style={{
            height: '48px',
            borderRadius: '12px',
            fontWeight: '600'
          }}
        >
          <IonIcon icon={logOutOutline} slot="start" />
          Abmelden
        </IonButton>

        <IonButton
          expand="block"
          fill="outline"
          color="danger"
          onClick={() => presentDeleteAccount({ presentingElement: pageRef?.current || presentingElement || undefined })}
          style={{
            height: '48px',
            marginTop: '8px',
            borderRadius: '12px',
            fontWeight: '600'
          }}
        >
          <IonIcon icon={trashOutline} slot="start" />
          Account löschen
        </IonButton>
      </div>

      <SpiritFooter />

      <div style={{ height: '32px' }}></div>

      {/* App-Tour als Vollbild-Overlay (kein Modal) */}
      {showOnboarding && (
        <KonfiOnboardingModal
          onClose={() => setShowOnboarding(false)}
          displayName={(user?.display_name || profile.display_name || '').split(' ')[0]}
        />
      )}

      {/* "Was ist neu?" — derselbe Walkthrough wie nach dem Update */}
      {showUpdateWalkthrough && (
        <KonfiUpdateWalkthroughModal
          onClose={() => setShowUpdateWalkthrough(false)}
          displayName={(user?.display_name || profile.display_name || '').split(' ')[0]}
        />
      )}

      {showMitmachenErklaerung && (
        <MitmachenErklaerungModal
          rolle="konfi"
          onClose={() => setShowMitmachenErklaerung(false)}
        />
      )}
    </div>
  );
};

export default ProfileView;