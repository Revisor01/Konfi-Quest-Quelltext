import {
  ICON_AKTENTASCHE,
  ICON_EINSTELLUNGEN,
  ICON_GALERIE,
  ICON_LOESCHEN,
  ICON_MAIL,
  ICON_SCHLUESSEL,
  ICON_TERMIN,
  ICON_ZURUECK,
} from '../../shared/icons';
import React from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonIcon,
  IonButton,
  IonButtons,
  IonList,
  IonListHeader,
  IonRefresher,
  IonRefresherContent,
  useIonModal
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { setUser as setTokenStoreUser } from '../../../services/tokenStore';
import { triggerPullHaptic } from '../../../utils/haptics';
import ChangeEmailModal from '../../shared/ChangeEmailModal';
import ChangePasswordModal from '../../shared/ChangePasswordModal';
import ChangeRoleTitleModal from '../modals/ChangeRoleTitleModal';
import DeleteAccountModal from '../../shared/DeleteAccountModal';
import { useMediaCacheControl } from '../../../hooks/useMediaCacheControl';

const AdminProfilePage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('admin-profile');
  const { user, setUser } = useApp();
  const { cacheLabel, clearMediaCache: handleClearMediaCache } = useMediaCacheControl();

  // Offline-Query: Profile (user-spezifisch)
  const { data: profileData, refresh: refreshProfile } = useOfflineQuery<{ role_title?: string; email?: string; created_at?: string }>(
    'user:me:' + user?.id,
    async () => { const res = await api.get('/auth/me'); return res.data; },
    { ttl: CACHE_TTL.SETTINGS }
  );

  // Email Modal mit useIonModal Hook
  const [presentEmailModalHook, dismissEmailModalHook] = useIonModal(ChangeEmailModal, {
    onClose: () => dismissEmailModalHook(),
    onSuccess: async () => {
      dismissEmailModalHook();
      // User-Daten im Context aktualisieren
      await refreshProfile();
      try {
        const response = await api.get('/auth/me');
        if (user) {
          const updatedUser = { ...user, email: response.data.email };
          await setTokenStoreUser(updatedUser);
          setUser(updatedUser);
        }
      } catch {
        // Profile bereits via refreshProfile aktualisiert
      }
    },
    variante: 'users'
  });

  // Password Modal mit useIonModal Hook
  const [presentPasswordModalHook, dismissPasswordModalHook] = useIonModal(ChangePasswordModal, {
    onClose: () => dismissPasswordModalHook(),
    onSuccess: () => dismissPasswordModalHook(),
    variante: 'users'
  });

  // RoleTitle Modal mit useIonModal Hook
  const [presentRoleTitleModalHook, dismissRoleTitleModalHook] = useIonModal(ChangeRoleTitleModal, {
    onClose: () => dismissRoleTitleModalHook(),
    onSuccess: () => {
      dismissRoleTitleModalHook();
      refreshProfile();
    },
    initialRoleTitle: profileData?.role_title || ''
  });

  const handleOpenEmailModal = () => {
    presentEmailModalHook({
      presentingElement: presentingElement || undefined
    });
  };

  const handleOpenPasswordModal = () => {
    presentPasswordModalHook({
      presentingElement: presentingElement || undefined
    });
  };

  const handleOpenRoleTitleModal = () => {
    presentRoleTitleModalHook({
      presentingElement: presentingElement || undefined
    });
  };

  // Account-Löschung
  const [presentDeleteAccount, dismissDeleteAccount] = useIonModal(DeleteAccountModal, {
    onClose: () => dismissDeleteAccount()
  });

  const handleOpenDeleteAccount = () => {
    presentDeleteAccount({
      presentingElement: presentingElement || undefined
    });
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
        <IonButtons slot="start">
          <IonButton aria-label="Zurück" onClick={() => window.history.back()}>
            <IonIcon icon={ICON_ZURUECK} />
          </IonButton>
        </IonButtons>
          <IonTitle>Admin-Profil</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Admin-Profil</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refreshProfile().then(() => e.detail.complete());
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {/* Header - Dashboard-Style mit Blasen-Effekt */}
        <div className="app-detail-header" style={{
          background: 'var(--app-gradient-admin)',
          boxShadow: '0 20px 40px rgba(var(--app-color-users-rgb), 0.35)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Floating Bubbles */}
          <div className="app-dashboard-header__circle" style={{ top: '-40px', right: '-40px', width: '140px', height: '140px', background: 'rgba(255, 255, 255, 0.08)' }} />
          <div className="app-dashboard-header__circle" style={{ top: '60px', right: '30px', width: '60px', height: '60px' }} />
          <div className="app-dashboard-header__circle" style={{ bottom: '-30px', left: '-30px', width: '100px', height: '100px' }} />
          <div className="app-dashboard-header__circle" style={{ bottom: '40px', left: '40px', width: '40px', height: '40px' }} />

          <div className="app-detail-header__content" style={{ padding: 'var(--app-freiraum-kopf-l) var(--app-abstand-weit) var(--app-abstand-weit) var(--app-abstand-weit)', alignItems: 'center', textAlign: 'center', position: 'relative', zIndex: 1 }}>
            {/* Avatar */}
            <div className="app-icon-circle" style={{
              width: '80px', height: '80px',
              background: 'rgba(255, 255, 255, 0.2)',
              marginBottom: 'var(--app-abstand-basis)',
              color: 'white', fontSize: 'var(--app-anzeige-zahl)', fontWeight: 'var(--app-schrift-halbfett)',
              border: '3px solid rgba(255, 255, 255, 0.3)'
            }}>
              {user?.display_name?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <h1 className="app-detail-header__title">{user?.display_name || 'Administrator'}</h1>
            <p className="app-detail-header__subtitle">
              {profileData?.role_title
                ? `Administrator - ${profileData.role_title}`
                : 'Administrator'}
            </p>
            <div className="app-detail-header__info-row" style={{ justifyContent: 'center' }}>
              {(profileData?.email || user?.email) && (
                <div className="app-detail-header__info-chip">
                  <IonIcon icon={ICON_MAIL} style={{ fontSize: 'var(--app-text-sekundaer)' }} />
                  {profileData?.email || user?.email}
                </div>
              )}
              {profileData?.created_at && (
                <div className="app-detail-header__info-chip">
                  <IonIcon icon={ICON_TERMIN} style={{ fontSize: 'var(--app-text-sekundaer)' }} />
                  Seit {new Date(profileData?.created_at || '').toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Konto-Einstellungen - iOS26 Pattern */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={ICON_EINSTELLUNGEN} />
            </div>
            <IonLabel>Konto-Einstellungen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Funktionsbeschreibung */}
                <IonItem
                  button
                  onClick={handleOpenRoleTitleModal}
                  detail={false}
                  lines="none"
                  style={{
                    '--background': 'transparent',
                    '--padding-start': '0',
                    '--padding-end': '0',
                    '--inner-padding-end': '0',
                    '--inner-border-width': '0',
                    '--border-style': 'none',
                    '--min-height': 'auto',
                    marginBottom: 'var(--app-abstand-eng)'
                  }}
                >
                  <div
                    className="app-list-item app-list-item--users"
                    style={{ width: '100%' }}
                  >
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--users">
                          <IonIcon icon={ICON_AKTENTASCHE} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">Funktionsbeschreibung</div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              {profileData?.role_title ? `Aktuell: ${profileData.role_title}` : 'z.B. Pastor, Diakonin'}
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
                  onClick={handleOpenEmailModal}
                  detail={false}
                  lines="none"
                  style={{
                    '--background': 'transparent',
                    '--padding-start': '0',
                    '--padding-end': '0',
                    '--inner-padding-end': '0',
                    '--inner-border-width': '0',
                    '--border-style': 'none',
                    '--min-height': 'auto',
                    marginBottom: 'var(--app-abstand-eng)'
                  }}
                >
                  <div
                    className="app-list-item app-list-item--users"
                    style={{ width: '100%' }}
                  >
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--users">
                          <IonIcon icon={ICON_MAIL} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">E-Mail-Adresse ändern</div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              {(profileData?.email || user?.email) ? `Aktuell: ${profileData?.email || user?.email}` : 'E-Mail für Benachrichtigungen'}
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
                  onClick={handleOpenPasswordModal}
                  detail={false}
                  lines="none"
                  style={{
                    '--background': 'transparent',
                    '--padding-start': '0',
                    '--padding-end': '0',
                    '--inner-padding-end': '0',
                    '--inner-border-width': '0',
                    '--border-style': 'none',
                    '--min-height': 'auto',
                    marginBottom: 'var(--app-abstand-eng)'
                  }}
                >
                  <div
                    className="app-list-item app-list-item--users"
                    style={{ width: '100%' }}
                  >
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--users">
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
                </IonItem>

                {/* Biometrische Anmeldung (blendet sich selbst aus, wenn das
                    Geraet keine eingerichtete Biometrie hat) */}

                {/* Medien-Cache leeren */}
                <IonItem
                  button
                  onClick={handleClearMediaCache}
                  detail={false}
                  lines="none"
                  style={{
                    '--background': 'transparent',
                    '--padding-start': '0',
                    '--padding-end': '0',
                    '--inner-padding-end': '0',
                    '--inner-border-width': '0',
                    '--border-style': 'none',
                    '--min-height': 'auto'
                  }}
                >
                  <div
                    className="app-list-item app-list-item--users"
                    style={{ width: '100%' }}
                  >
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--users">
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
                </IonItem>
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        <div style={{ padding: '0 var(--app-abstand-basis)', marginTop: 'var(--app-abstand-basis)' }}>
          <IonButton
            expand="block"
            fill="outline"
            color="danger"
            onClick={handleOpenDeleteAccount}
            style={{
              height: '48px',
              borderRadius: 'var(--app-radius-karte)',
              fontWeight: 'var(--app-schrift-halbfett)'
            }}
          >
            <IonIcon icon={ICON_LOESCHEN} slot="start" />
            Account löschen
          </IonButton>
        </div>

        <div style={{ height: '32px' }} />
      </IonContent>
    </IonPage>
  );
};

export default AdminProfilePage;
