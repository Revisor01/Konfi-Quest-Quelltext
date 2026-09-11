import { fehlerText } from '../../../utils/fehler';
import React, { useState } from 'react';
import { IonButton, IonCard, IonCardContent, IonIcon, IonLabel, IonList, IonListHeader, IonProgressBar, useIonModal, useIonAlert } from '@ionic/react';
import {
  ICON_ABMELDEN,
  ICON_AKTION_GEFUELLT,
  ICON_BUCH,
  ICON_GALERIE,
  ICON_HAKEN_GEFUELLT,
  ICON_KOMPASS,
  ICON_LOESCHEN,
  ICON_MAIL,
  ICON_ORT,
  ICON_PERSON,
  ICON_POKAL_GEFUELLT,
  ICON_RAKETE,
  ICON_SCHLUESSEL,
  ICON_STERN,
  ICON_TERMIN,
  ICON_UHRZEIT,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import type { BadgeUebersicht } from '../../../types/dashboard';
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
import KonfiUpdate211WalkthroughModal from '../modals/KonfiUpdate211WalkthroughModal';
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
        const response = await api.get('/konfi/badges/v2');
        const uebersicht = response.data as BadgeUebersicht;
        // GET /konfi/badges fuehrt den Status als `earned`; `is_earned` gibt es
        // nur in der Anzeige-Form der Abzeichen-Seite.
        const badges = [...(uebersicht.available || []), ...(uebersicht.earned || [])];
        const earnedCount = badges.filter((badge) => badge.earned).length;
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
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Ändern der Bibelübersetzung'));
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


  const getActivityIcon = (activity: RecentActivity) => {
    switch (activity.type) {
      case 'badge': return ICON_POKAL_GEFUELLT;
      case 'event': return ICON_TERMIN;
      case 'activity': return ICON_AKTION_GEFUELLT;
      case 'request': return ICON_HAKEN_GEFUELLT;
      default: return ICON_STERN;
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
        icon={ICON_PERSON}
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

      {/* Konfirmationstermin -- nur wenn wirklich einer gebucht ist.
          Ohne Termin stand hier eine graue Karte, die
          nichts sagte ausser "Noch kein Termin gebucht". */}
      {profile.confirmation_date && (
      <div style={{ 
        margin: 'var(--app-abstand-basis)', 
        borderRadius: 'var(--app-radius-modal)',
        background: profile.confirmation_date ? 'var(--app-gradient-konfi)' : 'var(--app-gradient-neutral)',
        border: 'none',
        boxShadow: profile.confirmation_date ? '0 10px 40px rgba(var(--app-color-konfis-rgb), 0.3)' : '0 10px 40px rgba(100, 116, 139, 0.3)',
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
            fontSize: 'var(--app-anzeige-hero)',
            fontWeight: 'var(--app-schrift-schwer)',
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
          padding: 'var(--app-freiraum-kopf-l) var(--app-abstand-weit) var(--app-abstand-weit) var(--app-abstand-weit)',
          flex: 1,
          display: 'flex',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-basis)', width: '100%' }}>
            <div style={{ 
              width: '48px', 
              height: '48px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: 'var(--app-radius-kreis)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              flexShrink: 0,
              border: '2px solid rgba(255, 255, 255, 0.3)'
            }}>
              <IonIcon
                icon={ICON_TERMIN}
                style={{
                  fontSize: 'var(--app-text-ueberschrift)',
                  color: 'white'
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              {profile.confirmation_date ? (
                <div>
                  <p style={{ 
                    margin: '0 0 var(--app-abstand-mini) 0', 
                    color: 'white', 
                    fontSize: 'var(--app-text-gross)', 
                    fontWeight: 'var(--app-schrift-halbfett)' 
                  }}>
                    {formatDate(profile.confirmation_date)}
                  </p>
                  <p style={{ 
                    margin: '0 0 var(--app-abstand-mini) 0', 
                    color: 'rgba(255, 255, 255, 0.8)', 
                    fontSize: 'var(--app-text-basis)' 
                  }}>
                    {new Date(profile.confirmation_date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                  </p>
                  {profile.confirmation_location && (
                    <p 
                      style={{ 
                        margin: '0', 
                        color: 'rgba(255, 255, 255, 0.9)', 
                        fontSize: 'var(--app-text-basis)',
                        cursor: 'pointer',
                        fontWeight: 'var(--app-schrift-mittel)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--app-abstand-mini)'
                      }}
                      onClick={() => {
                        if (profile.confirmation_location) {
                          window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.confirmation_location)}`, '_blank');
                        }
                      }}
                    >
                      <IonIcon icon={ICON_ORT} style={{ fontSize: 'var(--app-text-standard)' }} />
                      {profile.confirmation_location}
                    </p>
                  )}
                </div>
              ) : (
                <p style={{ margin: '0', color: 'rgba(255, 255, 255, 0.8)', fontSize: 'var(--app-text-basis)' }}>
                  Noch kein Termin gebucht
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Next Badge Progress */}
      {profile.progress_overview?.next_badge && (
        <IonCard style={{ margin: 'var(--app-abstand-basis)', borderRadius: 'var(--app-radius-klein)' }}>
          <IonCardContent>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--app-abstand-mittel)' }}>
              <IonIcon icon={ICON_RAKETE} style={{ fontSize: 'var(--app-text-untertitel)', color: 'var(--app-color-rakete)', marginRight: 'var(--app-abstand-eng)' }} />
              <h3 style={{ margin: '0', fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-halbfett)' }}>
                Nächstes Badge
              </h3>
            </div>
            <p style={{ margin: '0 0 var(--app-abstand-eng) 0', fontSize: 'var(--app-text-standard)', fontWeight: 'var(--app-schrift-mittel)' }}>
              {profile.progress_overview.next_badge.name}
            </p>
            <IonProgressBar 
              value={profile.progress_overview.next_badge.progress_percentage / 100}
              style={{ 
                height: '8px', 
                borderRadius: 'var(--app-radius-fein)',
                marginBottom: 'var(--app-abstand-eng)',
                '--progress-background': 'var(--app-gradient-rakete-quer)'
              }}
            />
            <p style={{ margin: '0', fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-secondary)' }}>
              Noch {profile.progress_overview.next_badge.points_needed} Punkte bis zum nächsten Badge
              ({Math.round(profile.progress_overview.next_badge.progress_percentage)}%)
            </p>
          </IonCardContent>
        </IonCard>
      )}

      {/* Recent Activities */}
      {profile.recent_activities && profile.recent_activities.length > 0 && (
        <IonCard style={{ margin: 'var(--app-abstand-basis)', borderRadius: 'var(--app-radius-klein)' }}>
          <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
            <h3 style={{ margin: '0 0 var(--app-abstand-mittel) 0', fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-halbfett)' }}>
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

      {wrappedHistory.length > 0 && (
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--purple">
              <IonIcon icon={ICON_UHRZEIT} />
            </div>
            <IonLabel>Meine Rückblicke</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
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
                        <IonIcon icon={ICON_UHRZEIT} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">
                          {entry.titel || `Jahresrückblick ${entry.year}`}
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

      {/* Konto-Einstellungen - iOS26 Pattern wie Admin */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--purple">
            <IonIcon icon={ICON_PERSON} />
          </div>
          <IonLabel>Konto-Einstellungen</IonLabel>
        </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
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
                      <IonIcon icon={ICON_STERN} />
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
                      <IonIcon icon={ICON_KOMPASS} />
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
                      <IonIcon icon={ICON_MAIL} />
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
                      <IonIcon icon={ICON_SCHLUESSEL} />
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
                      <IonIcon icon={ICON_BUCH} />
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
                      <IonIcon icon={ICON_GALERIE} />
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
      <div style={{ padding: '0 var(--app-abstand-basis)', marginTop: 'var(--app-abstand-basis)' }}>
        <IonButton
          expand="block"
          fill="outline"
          color="danger"
          onClick={handleLogout}
          style={{
            height: '48px',
            borderRadius: 'var(--app-radius-karte)',
            fontWeight: 'var(--app-schrift-halbfett)'
          }}
        >
          <IonIcon icon={ICON_ABMELDEN} slot="start" />
          Abmelden
        </IonButton>

        <IonButton
          expand="block"
          fill="outline"
          color="danger"
          onClick={() => presentDeleteAccount({ presentingElement: pageRef?.current || presentingElement || undefined })}
          style={{
            height: '48px',
            marginTop: 'var(--app-abstand-eng)',
            borderRadius: 'var(--app-radius-karte)',
            fontWeight: 'var(--app-schrift-halbfett)'
          }}
        >
          <IonIcon icon={ICON_LOESCHEN} slot="start" />
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
        <KonfiUpdate211WalkthroughModal
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