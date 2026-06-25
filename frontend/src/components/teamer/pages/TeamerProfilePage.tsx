import React, { useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonList,
  IonListHeader,
  IonItem,
  IonLabel,
  IonIcon,
  IonCard,
  IonCardContent,
  IonButton,
  IonButtons,
  useIonModal,
  useIonAlert,
  useIonRouter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import {
  mailOutline,
  keyOutline,
  briefcaseOutline,
  calendarOutline,
  settingsOutline,
  trophy,
  logOutOutline,
  trashOutline,
  ribbon,
  schoolOutline,
  timeOutline,
  arrowBack,
  imagesOutline,
  bookOutline,
  document as documentIcon
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { setUser as setTokenStoreUser } from '../../../services/tokenStore';
import ChangeEmailModal from '../../konfi/modals/ChangeEmailModal';
import ChangePasswordModal from '../../konfi/modals/ChangePasswordModal';
import ChangeRoleTitleModal from '../../admin/modals/ChangeRoleTitleModal';
import DeleteAccountModal from '../../shared/DeleteAccountModal';
import SpiritFooter from '../../shared/SpiritFooter';
import WrappedModal from '../../wrapped/WrappedModal';
import type { WrappedHistoryEntry } from '../../../types/wrapped';
import LoadingSpinner from '../../common/LoadingSpinner';
import { triggerPullHaptic } from '../../../utils/haptics';
import { useMediaCacheControl } from '../../../hooks/useMediaCacheControl';
import BibleTranslationModal, { getTranslationName } from '../../shared/BibleTranslationModal';
import { networkMonitor } from '../../../services/networkMonitor';

interface TeamerProfile {
  user: {
    display_name: string;
    username: string;
    email: string;
    role_title: string;
    teamer_since: string | null;
    organization_name: string;
    bible_translation?: string;
  };
  konfi_data: {
    gottesdienst_points: number;
    gemeinde_points: number;
    jahrgang_name: string;
    badges: Array<{
      badge_id: number;
      name: string;
      icon: string;
      color: string;
      awarded_date: string;
    }>;
  };
}

const TeamerProfilePage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('profile');
  const { user, setUser, setError, signOut } = useApp();
  const [presentAlert] = useIonAlert();
  const { cacheLabel, clearMediaCache: handleClearMediaCache } = useMediaCacheControl();
  const router = useIonRouter();

  // Offline-Query: Profil
  const { data: profile, loading, refresh } = useOfflineQuery<TeamerProfile>(
    'teamer:profile:' + user?.id,
    async () => { const res = await api.get('/teamer/profile'); return res.data; },
    { ttl: CACHE_TTL.PROFILE }
  );

  // Bibeluebersetzung (Tageslosung) — Auswahl + Speichern
  const [selectedTranslation, setSelectedTranslation] = useState<string>('LUT');
  React.useEffect(() => {
    if (profile?.user?.bible_translation) setSelectedTranslation(profile.user.bible_translation);
  }, [profile?.user?.bible_translation]);

  const handleTranslationChange = async (translation: string) => {
    setSelectedTranslation(translation); // optimistisch
    if (!networkMonitor.isOnline) return;
    try {
      await api.put('/teamer/bible-translation', { translation });
      refresh();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Ändern der Bibelübersetzung');
    }
  };

  const [presentBibleModal, dismissBibleModal] = useIonModal(BibleTranslationModal, {
    onClose: () => dismissBibleModal(),
    currentTranslation: selectedTranslation,
    accentColor: 'var(--app-color-teamer)',
    itemVariant: 'teamer',
    sectionIconVariant: 'teamer',
    onSelect: (code: string) => { handleTranslationChange(code); dismissBibleModal(); },
  });

  // Modals
  const [presentEmailModal, dismissEmailModal] = useIonModal(ChangeEmailModal, {
    onClose: () => dismissEmailModal(),
    onSuccess: async () => {
      dismissEmailModal();
      await refresh();
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
    sectionIconClass: 'app-section-icon--teamer',
    submitBtnClass: 'app-modal-submit-btn--teamer',
    infoBoxClass: 'app-info-box--teamer'
  });

  const [presentPasswordModal, dismissPasswordModal] = useIonModal(ChangePasswordModal, {
    onClose: () => dismissPasswordModal(),
    onSuccess: () => dismissPasswordModal(),
    sectionIconClass: 'app-section-icon--teamer',
    submitBtnClass: 'app-modal-submit-btn--teamer'
  });

  const [presentRoleTitleModal, dismissRoleTitleModal] = useIonModal(ChangeRoleTitleModal, {
    onClose: () => dismissRoleTitleModal(),
    onSuccess: () => {
      dismissRoleTitleModal();
      refresh();
    },
    initialRoleTitle: profile?.user.role_title || '',
    sectionIconClass: 'app-section-icon--teamer',
    submitBtnClass: 'app-modal-submit-btn--teamer',
    infoBoxClass: 'app-info-box--teamer'
  });

  // Account-Loeschung
  const [presentDeleteAccount, dismissDeleteAccount] = useIonModal(DeleteAccountModal, {
    onClose: () => dismissDeleteAccount()
  });

  // Wrapped-Historie
  const [wrappedHistory, setWrappedHistory] = useState<WrappedHistoryEntry[]>([]);

  React.useEffect(() => {
    if (!user?.id) return;
    api.get(`/wrapped/history/${user.id}`)
      .then(res => setWrappedHistory(res.data || []))
      .catch(() => {});
  }, [user?.id]);

  const [wrappedModalData, setWrappedModalData] = React.useState<WrappedHistoryEntry | null>(null);
  const [presentWrappedModal, dismissWrappedModal] = useIonModal(WrappedModal, {
    onClose: () => dismissWrappedModal(),
    displayName: profile?.user?.display_name || '',
    wrappedType: wrappedModalData?.wrapped_type || 'teamer',
    initialData: wrappedModalData?.data,
    initialYear: wrappedModalData?.year
  });

  React.useEffect(() => {
    if (wrappedModalData) {
      presentWrappedModal({ cssClass: 'wrapped-modal-fullscreen' });
    }
  }, [wrappedModalData]);

  // Logout
  const handleLogout = () => {
    presentAlert({
      header: 'Abmelden',
      message: 'Willst du dich wirklich abmelden?',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Abmelden',
          role: 'destructive',
          handler: async () => {
            // signOut() ist failsafe -> garantiert zurueck zur Login-Route.
            await signOut();
          }
        }
      ]
    });
  };

  const itemStyle: Record<string, string> = {
    '--background': 'transparent',
    '--padding-start': '0',
    '--padding-end': '0',
    '--inner-padding-end': '0',
    '--inner-border-width': '0',
    '--border-style': 'none',
    '--min-height': 'auto'
  };

  if (loading) {
    return <LoadingSpinner message="Profil wird geladen..." />;
  }

  if (!profile) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div style={{ textAlign: 'center', marginTop: '80px' }}>
            <p>Fehler beim Laden des Profils</p>
            <IonButton
              expand="block"
              fill="outline"
              color="danger"
              onClick={handleLogout}
              style={{ marginTop: '24px', height: '48px', borderRadius: '12px', fontWeight: '600' }}
            >
              <IonIcon icon={logOutOutline} slot="start" />
              Abmelden
            </IonButton>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Profil</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Profil</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refresh().then(() => e.detail.complete());
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {/* A. Detail-Header mit Bubble-Effekt */}
        <div className="app-detail-header" style={{
          background: 'linear-gradient(135deg, #ec4899 0%, #be185d 50%, #9d174d 100%)',
          boxShadow: '0 20px 40px rgba(190, 24, 93, 0.35)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Floating Bubbles */}
          <div className="app-dashboard-header__circle" style={{ top: '-40px', right: '-40px', width: '140px', height: '140px', background: 'rgba(255, 255, 255, 0.08)' }} />
          <div className="app-dashboard-header__circle" style={{ top: '60px', right: '30px', width: '60px', height: '60px' }} />
          <div className="app-dashboard-header__circle" style={{ bottom: '-30px', left: '-30px', width: '100px', height: '100px' }} />
          <div className="app-dashboard-header__circle" style={{ bottom: '40px', left: '40px', width: '40px', height: '40px' }} />

          <div className="app-detail-header__content" style={{ padding: '70px 24px 24px 24px', alignItems: 'center', textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div className="app-icon-circle" style={{
              width: '80px', height: '80px',
              background: 'rgba(255, 255, 255, 0.2)',
              marginBottom: '16px',
              color: 'white', fontSize: '2rem', fontWeight: '600',
              border: '3px solid rgba(255, 255, 255, 0.3)'
            }}>
              {profile.user.display_name?.charAt(0)?.toUpperCase() || 'T'}
            </div>
            <h1 className="app-detail-header__title">{profile.user.display_name}</h1>
            <p className="app-detail-header__subtitle">
              {profile.user.role_title || 'Teamer:in'}
            </p>
            <div className="app-detail-header__info-row" style={{ justifyContent: 'center' }}>
              {profile.user.email && (
                <div className="app-detail-header__info-chip">
                  <IonIcon icon={mailOutline} style={{ fontSize: '0.85rem' }} />
                  {profile.user.email}
                </div>
              )}
              {profile.user.teamer_since && (
                <div className="app-detail-header__info-chip">
                  <IonIcon icon={calendarOutline} style={{ fontSize: '0.85rem' }} />
                  Dabei seit {new Date(profile.user.teamer_since).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* B. Konto-Einstellungen */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
              <IonIcon icon={settingsOutline} />
            </div>
            <IonLabel>Konto-Einstellungen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Funktionsbeschreibung */}
                <IonItem
                  button
                  onClick={() => presentRoleTitleModal({ presentingElement: pageRef.current ?? undefined })}
                  detail={false}
                  lines="none"
                  style={{ ...itemStyle, marginBottom: '8px' } as any}
                >
                  <div className="app-list-item" style={{ width: '100%', borderLeftColor: 'var(--app-color-teamer)' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
                          <IonIcon icon={briefcaseOutline} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">Funktionsbeschreibung</div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              {profile.user.role_title ? `Aktuell: ${profile.user.role_title}` : 'z.B. Jugendleiter:in'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                {/* E-Mail ändern */}
                <IonItem
                  button
                  onClick={() => presentEmailModal({ presentingElement: pageRef.current ?? undefined })}
                  detail={false}
                  lines="none"
                  style={{ ...itemStyle, marginBottom: '8px' } as any}
                >
                  <div className="app-list-item" style={{ width: '100%', borderLeftColor: 'var(--app-color-teamer)' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
                          <IonIcon icon={mailOutline} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">E-Mail-Adresse ändern</div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              {profile.user.email ? `Aktuell: ${profile.user.email}` : 'E-Mail für Benachrichtigungen'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                {/* Passwort ändern */}
                <IonItem
                  button
                  onClick={() => presentPasswordModal({ presentingElement: pageRef.current ?? undefined })}
                  detail={false}
                  lines="none"
                  style={{ ...itemStyle, marginBottom: '8px' } as any}
                >
                  <div className="app-list-item" style={{ width: '100%', borderLeftColor: 'var(--app-color-teamer)' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
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
                </IonItem>

                {/* Bibelübersetzung (Tageslosung) */}
                <IonItem
                  button
                  onClick={() => presentBibleModal({ presentingElement: pageRef.current ?? undefined })}
                  detail={false}
                  lines="none"
                  style={{ ...itemStyle, marginBottom: '8px' } as any}
                >
                  <div className="app-list-item" style={{ width: '100%', borderLeftColor: 'var(--app-color-teamer)' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
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
                </IonItem>

                {/* Medien-Cache leeren */}
                <IonItem
                  button
                  onClick={handleClearMediaCache}
                  detail={false}
                  lines="none"
                  style={itemStyle as any}
                >
                  <div className="app-list-item" style={{ width: '100%', borderLeftColor: 'var(--app-color-teamer)' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
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
                </IonItem>
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* C. Inhalt */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
              <IonIcon icon={ribbon} />
            </div>
            <IonLabel>Inhalt</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <div
                className="app-list-item app-settings-item app-list-item--material"
                onClick={() => router.push('/teamer/profile/material')}
              >
                <div className="app-icon-circle app-icon-circle--lg app-icon-circle--material">
                  <IonIcon icon={documentIcon} />
                </div>
                <div className="app-flex-fill">
                  <h2 className="app-settings-item__title">Material</h2>
                  <p className="app-settings-item__subtitle">Materialien und Dateien</p>
                </div>
              </div>

              {profile.konfi_data?.jahrgang_name && (
                <div
                  className="app-list-item app-settings-item app-list-item--konfi"
                  onClick={() => router.push('/teamer/profile/konfi-stats')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--konfi">
                    <IonIcon icon={schoolOutline} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Konfi-Historie</h2>
                    <p className="app-settings-item__subtitle">Konfi-Punkte und Badges</p>
                  </div>
                </div>
              )}
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Meine Wrappeds */}
        {wrappedHistory.length > 0 && (
          <IonList inset={true} style={{ margin: '16px' }}>
            <IonListHeader>
              <div className="app-section-icon" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
                <IonIcon icon={timeOutline} />
              </div>
              <IonLabel>Meine Wrappeds</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '16px' }}>
                {wrappedHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="app-list-item"
                    style={{ width: '100%', cursor: 'pointer', marginBottom: '8px', borderLeftColor: 'var(--app-color-teamer)' }}
                    onClick={() => {
                      setWrappedModalData(entry);
                    }}
                  >
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
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

        {/* D. Logout-Button */}
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
            onClick={() => presentDeleteAccount({ presentingElement: pageRef.current ?? undefined })}
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

        <div style={{ height: '32px' }} />
      </IonContent>
    </IonPage>
  );
};

export default TeamerProfilePage;
