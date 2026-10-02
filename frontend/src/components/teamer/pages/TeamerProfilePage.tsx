import {
  ICON_ABMELDEN,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_AKTENTASCHE,
  ICON_BUCH,
  ICON_EINSTELLUNGEN,
  ICON_GALERIE,
  ICON_JAHRGANG,
  ICON_KOMPASS,
  ICON_LOESCHEN,
  ICON_MAIL,
  ICON_SCHLUESSEL,
  ICON_STERN_GEFUELLT,
  ICON_TERMIN,
  ICON_UHRZEIT,
} from '../../shared/icons';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import { fehlerText } from '../../../utils/fehler';
import React, { useState, useCallback } from 'react';
import {
  IonPage,
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
  useIonModal,
  useIonAlert,
  useIonRouter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import { CACHE_TTL } from '../../../services/offlineCache';
import { setUser as setTokenStoreUser } from '../../../services/tokenStore';
import ChangeEmailModal from '../../shared/ChangeEmailModal';
import ChangePasswordModal from '../../shared/ChangePasswordModal';
import AppSperreSchalter from '../../shared/AppSperreSchalter';
import EinladungenKarte from '../../shared/EinladungenKarte';
import PushAuswahlEintrag from '../../shared/PushAuswahl';
import AbsturzberichteSchalter from '../../shared/AbsturzberichteSchalter';
import ChangeRoleTitleModal from '../../admin/modals/ChangeRoleTitleModal';
import DeleteAccountModal from '../../shared/DeleteAccountModal';
import SpiritFooter from '../../shared/SpiritFooter';
import TeamerOnboardingModal from '../modals/TeamerOnboardingModal';
import TeamerUpdate230WalkthroughModal from '../modals/TeamerUpdate230WalkthroughModal';
import WrappedModal from '../../wrapped/WrappedModal';
import type { WrappedHistoryEntry } from '../../../types/wrapped';
import LoadingSpinner from '../../common/LoadingSpinner';
import { useAppLocation } from '../../../navigation/useAppLocation';
import { RUECKBLICK_PARAMETER, waehleRueckblick } from '../../../utils/pushNavigation';
import { triggerPullHaptic } from '../../../utils/haptics';
import { useMediaCacheControl } from '../../../hooks/useMediaCacheControl';
import BibleTranslationModal, { getTranslationName } from '../../shared/BibleTranslationModal';
import { networkMonitor } from '../../../services/networkMonitor';
import { writeQueue } from '../../../services/writeQueue';
import { safeUUID } from '../../../utils/uuid';
import { sendenOderEinreihen } from '../../../utils/sendenOderEinreihen';
import NeuerungenBanner from '../../shared/NeuerungenBanner';
import MitmachenErklaerungModal from '../../shared/MitmachenErklaerungModal';
import { tastaturKlick } from '../../../utils/tastatur';
import { datumKurz } from '../../../utils/dateUtils';
import { selbstbezeichnung } from '../../../utils/rollenNamen';

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
    // Leer, wenn der Jahrgang der Konfizeit geloescht wurde — die Punkte und
    // Abzeichen daneben bleiben. Deshalb optional: Wer hierauf eine Anzeige
    // stuetzt, blendet sie fuer genau diese Leute aus.
    jahrgang_name?: string;
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
  const { pageRef } = useModalPage('profile');
  const { user, setUser, setError, signOut } = useApp();
  const [presentAlert] = useIonAlert();
  const { cacheLabel, clearMediaCache: handleClearMediaCache } = useMediaCacheControl();
  const router = useIonRouter();

  // Offline-Query: Profil
  const { data: profile, loading, refresh, refreshLive } = useOfflineQuery<TeamerProfile>(
    'teamer:profile:' + user?.id,
    async () => { const res = await api.get('/teamer/profile'); return res.data; },
    { ttl: CACHE_TTL.PROFILE }
  );

  // Eigene Punkte und Abzeichen im Profil aktuell halten.
  useLiveRefresh(['points', 'badges', 'dashboard'], useCallback(() => { refreshLive(); }, [refreshLive]));

  // Bibeluebersetzung (Tageslosung) — Auswahl + Speichern
  const [selectedTranslation, setSelectedTranslation] = useState<string>('LUT');
  React.useEffect(() => {
    if (profile?.user?.bible_translation) setSelectedTranslation(profile.user.bible_translation);
  }, [profile?.user?.bible_translation]);

  const handleTranslationChange = async (translation: string) => {
    // Auch ein Netzabbruch im Online-Zweig landet in der Warteschlange
    // PUT ist
    // wiederholbar.
    setSelectedTranslation(translation); // optimistisch
    try {
      const { weg } = await sendenOderEinreihen({
        online: networkMonitor.isOnline,
        methode: 'PUT',
        senden: () => api.put('/teamer/bible-translation', { translation }),
        einreihen: () => writeQueue.enqueue({
          method: 'PUT',
          url: '/teamer/bible-translation',
          body: { translation },
          maxRetries: 3,
          hasFileUpload: false,
          metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Bibelübersetzung' },
        }),
      });
      if (weg === 'gesendet') refresh();
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Ändern der Bibelübersetzung'));
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
    variante: 'teamer'
  });

  const [presentPasswordModal, dismissPasswordModal] = useIonModal(ChangePasswordModal, {
    onClose: () => dismissPasswordModal(),
    onSuccess: () => dismissPasswordModal(),
    variante: 'teamer'
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

  // Account-Löschung
  const [presentDeleteAccount, dismissDeleteAccount] = useIonModal(DeleteAccountModal, {
    onClose: () => dismissDeleteAccount()
  });

  // Wrapped-Historie
  const [wrappedHistory, setWrappedHistory] = useState<WrappedHistoryEntry[]>([]);
  // Tour und Update-Hinweis jederzeit erneut aufrufbar (Vollbild-Overlays).
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUpdateWalkthrough, setShowUpdateWalkthrough] = useState(false);
  const [showMitmachenErklaerung, setShowMitmachenErklaerung] = useState(false);

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

  // Rueckblick per Adresse oeffnen: Der Wrapped-Push fuehrt
  // Teamer:innen auf /teamer/profile?rueckblick=<ausgabe_id>, weil das
  // Modal keine eigene Route hat (pushNavigation, Kopfkommentar). Einmal je
  // Wert, wie ?eventId= in TeamerEventsPage; gleiche Logik wie im
  // Konfi-Profil (ProfileView).
  const { search } = useAppLocation();
  const rueckblickParameter = new URLSearchParams(search).get(RUECKBLICK_PARAMETER);
  const [rueckblickGeoeffnetFuer, setRueckblickGeoeffnetFuer] = useState<string | null>(null);

  React.useEffect(() => {
    if (!rueckblickParameter) {
      setRueckblickGeoeffnetFuer(null);
      return;
    }
    if (wrappedHistory.length === 0 || rueckblickParameter === rueckblickGeoeffnetFuer) return;
    const eintrag = waehleRueckblick(wrappedHistory, rueckblickParameter);
    if (!eintrag) return;
    setRueckblickGeoeffnetFuer(rueckblickParameter);
    setWrappedModalData(eintrag);
  }, [rueckblickParameter, rueckblickGeoeffnetFuer, wrappedHistory]);

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
            // signOut() ist failsafe -> garantiert zurück zur Login-Route.
            await signOut();
          }
        }
      ]
    });
  };

  if (loading) {
    return <LoadingSpinner message="Profil wird geladen..." />;
  }

  if (!profile) {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div style={{ textAlign: 'center', marginTop: 'var(--app-freiraum-kopf-m)' }}>
            <p>Fehler beim Laden des Profils</p>
            <IonButton
              expand="block"
              fill="outline"
              color="danger"
              className="app-gefahr-knopf"
              onClick={handleLogout}
              style={{ marginTop: 'var(--app-abstand-weit)' }}
            >
              <IonIcon icon={ICON_ABMELDEN} slot="start" />
              Abmelden
            </IonButton>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile titel="Profil" onZurueck={() => window.history.back()} gemeindeUmschalter={false} />

      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Profil" />

        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refresh().then(() => e.detail.complete());
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {/* A. Detail-Header mit Bubble-Effekt */}
        <div className="app-detail-header" style={{
          background: 'var(--app-gradient-teamer)',
          boxShadow: '0 20px 40px rgba(var(--app-color-teamer-rgb), 0.35)',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Floating Bubbles */}
          <div className="app-dashboard-header__circle" style={{ top: '-40px', right: '-40px', width: '140px', height: '140px', background: 'rgba(255, 255, 255, 0.08)' }} />
          <div className="app-dashboard-header__circle" style={{ top: '60px', right: '30px', width: '60px', height: '60px' }} />
          <div className="app-dashboard-header__circle" style={{ bottom: '-30px', left: '-30px', width: '100px', height: '100px' }} />
          <div className="app-dashboard-header__circle" style={{ bottom: '40px', left: '40px', width: '40px', height: '40px' }} />

          <div className="app-detail-header__content" style={{ padding: 'var(--app-freiraum-kopf-l) var(--app-abstand-weit) var(--app-abstand-weit) var(--app-abstand-weit)', alignItems: 'center', textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div className="app-icon-circle" style={{
              width: '80px', height: '80px',
              background: 'rgba(255, 255, 255, 0.2)',
              marginBottom: 'var(--app-abstand-basis)',
              color: 'white', fontSize: 'var(--app-anzeige-zahl)', fontWeight: 'var(--app-schrift-halbfett)',
              border: '3px solid rgba(255, 255, 255, 0.3)'
            }}>
              {profile.user.display_name?.charAt(0)?.toUpperCase() || 'T'}
            </div>
            <h1 className="app-detail-header__title">{profile.user.display_name}</h1>
            <p className="app-detail-header__subtitle">
              {/* Selbstbezeichnung (Funktionsbeschreibung unten), sonst
                  „Teamer:in" wie auf der Startseite. */}
              {selbstbezeichnung(profile.user.role_title, 'Teamer:in')}
            </p>
            <div className="app-detail-header__info-row" style={{ justifyContent: 'center' }}>
              {profile.user.email && (
                <div className="app-detail-header__info-chip">
                  <IonIcon icon={ICON_MAIL} style={{ fontSize: 'var(--app-text-sekundaer)' }} />
                  {profile.user.email}
                </div>
              )}
              {profile.user.teamer_since && (
                <div className="app-detail-header__info-chip">
                  <IonIcon icon={ICON_TERMIN} style={{ fontSize: 'var(--app-text-sekundaer)' }} />
                  Dabei seit {datumKurz(profile.user.teamer_since)}
                </div>
              )}
            </div>
          </div>
        </div>

      <NeuerungenBanner
        onUpdateOeffnen={() => setShowUpdateWalkthrough(true)}
        onMitmachenOeffnen={() => setShowMitmachenErklaerung(true)}
      />

        {wrappedHistory.length > 0 && (
          <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--teamer">
                <IonIcon icon={ICON_UHRZEIT} />
              </div>
              <IonLabel>Meine Rückblicke</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                {wrappedHistory.map((entry) => (
                  <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                    key={entry.id}
                    className="app-list-item"
                    style={{ width: '100%', cursor: 'pointer', marginBottom: 'var(--app-abstand-eng)', borderLeftColor: 'var(--app-color-teamer)' }}
                    onClick={() => {
                      setWrappedModalData(entry);
                    }}
                  >
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--teamer">
                          <IonIcon icon={ICON_UHRZEIT} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">
                            {entry.titel || `Jahresrückblick ${entry.year}`}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              {datumKurz(entry.computed_at)}
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

        {/* B. Konto-Einstellungen */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--teamer">
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
                  onClick={() => presentRoleTitleModal({ presentingElement: pageRef.current ?? undefined })}
                  detail={false}
                  lines="none"
                  className="app-list-wrapper"
                >
                  <div className="app-list-item app-list-item--teamer" style={{ width: '100%' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--teamer">
                          <IonIcon icon={ICON_AKTENTASCHE} />
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
                  className="app-list-wrapper"
                >
                  <div className="app-list-item app-list-item--teamer" style={{ width: '100%' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--teamer">
                          <IonIcon icon={ICON_MAIL} />
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
                  className="app-list-wrapper"
                >
                  <div className="app-list-item app-list-item--teamer" style={{ width: '100%' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--teamer">
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

                {/* Bibelübersetzung (Tageslosung) */}
                <IonItem
                  button
                  onClick={() => presentBibleModal({ presentingElement: pageRef.current ?? undefined })}
                  detail={false}
                  lines="none"
                  className="app-list-wrapper"
                >
                  <div className="app-list-item app-list-item--teamer" style={{ width: '100%' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--teamer">
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
                </IonItem>

                {/* Biometrische Anmeldung (blendet sich selbst aus, wenn das
                    Geraet keine eingerichtete Biometrie hat) */}

                {/* App-Tour: zwischen Bibeluebersetzung und Medien-Cache.
                    Stand vorher ausserhalb des
                    Flex-Containers und hing deshalb ohne Abstand am
                    vorherigen Eintrag. Den Abstand nach unten gibt
                    .app-list-item selbst -- von Hand gesetzt wuerde er auch
                    dann stehen bleiben, wenn der Eintrag einmal ans Ende der
                    Liste rutscht. */}
                <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                  className="app-list-item app-list-item--teamer"
                  onClick={() => setShowOnboarding(true)}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--teamer">
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

                {/* Medien-Cache leeren */}
                <IonItem
                  button
                  onClick={handleClearMediaCache}
                  detail={false}
                  lines="none"
                  className="app-list-wrapper"
                >
                  <div className="app-list-item app-list-item--teamer" style={{ width: '100%' }}>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--teamer">
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

                {/* App-Sperre: Face ID / Fingerabdruck vor der laufenden App */}
                <AppSperreSchalter variante="teamer" />
                {/* Absturzberichte an/aus (nur in der App, im Browser leer) */}
                <AbsturzberichteSchalter variante="teamer" />
                <EinladungenKarte variante="teamer" />
                <PushAuswahlEintrag variante="teamer" presentingRef={pageRef} />

              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* C. Inhalt */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--teamer">
              <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
            </div>
            <IonLabel>Inhalt</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {/* Abzeichen: Aus der Tab-Leiste ins
                  Profil geholt -- unter "Inhalt" steht danach nur noch das. */}
              <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                className="app-list-item app-list-item--badges"
                onClick={() => router.push('/teamer/badges')}
              >
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--badges">
                      <IonIcon icon={ICON_STERN_GEFUELLT} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">Badges</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">Was du gesammelt hast</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* An den DATEN, nicht am Jahrgangsnamen:
                  Wird der Jahrgang einer frueheren Konfizeit
                  geloescht, liefert das Backend konfi_data weiter — nur
                  jahrgang_name ist dann leer. Der Einstieg verschwand damit,
                  obwohl Punkte und Abzeichen dahinter unveraendert liegen.
                  Das Backend warnt an der Quelle ausdruecklich davor
                  (teamer.js). Reine Teamer:innen ohne Konfi-Vergangenheit
                  haben konfi_data=null und sehen den Einstieg weiterhin
                  nicht — er fuehrte fuer sie ins Leere. */}
              {profile.konfi_data && (
                <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                  className="app-list-item app-list-item--konfi"
                  onClick={() => router.push('/teamer/profile/konfi-stats')}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--konfi">
                        <IonIcon icon={ICON_JAHRGANG} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">Konfi-Historie</div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">Konfi-Punkte und Badges</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </IonCardContent>
          </IonCard>
        </IonList>

        {/* D. Logout-Button */}
        <div style={{ padding: '0 var(--app-abstand-basis)', marginTop: 'var(--app-abstand-basis)' }}>
          <IonButton
            expand="block"
            fill="outline"
            color="danger"
            className="app-gefahr-knopf"
            onClick={handleLogout}
          >
            <IonIcon icon={ICON_ABMELDEN} slot="start" />
            Abmelden
          </IonButton>

          <IonButton
            expand="block"
            fill="outline"
            color="danger"
            className="app-gefahr-knopf"
            onClick={() => presentDeleteAccount({ presentingElement: pageRef.current ?? undefined })}
          >
            <IonIcon icon={ICON_LOESCHEN} slot="start" />
            Account löschen
          </IonButton>
        </div>

        <SpiritFooter />

        <div style={{ height: '32px' }} />
      </IonContent>

      {showOnboarding && (
        <TeamerOnboardingModal
          onClose={() => setShowOnboarding(false)}
          displayName={(user?.display_name || '').split(' ')[0]}
        />
      )}

      {showUpdateWalkthrough && (
        <TeamerUpdate230WalkthroughModal onClose={() => setShowUpdateWalkthrough(false)} />
      )}

      {showMitmachenErklaerung && (
        <MitmachenErklaerungModal
          rolle="teamer"
          onClose={() => setShowMitmachenErklaerung(false)}
        />
      )}
    </IonPage>
  );
};

export default TeamerProfilePage;
