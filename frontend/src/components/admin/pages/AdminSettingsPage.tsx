import React from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardContent,
  IonLabel,
  IonIcon,
  IonList,
  IonListHeader,
  IonButton,
  IonButtons,
  useIonAlert,
  useIonModal
} from '@ionic/react';
import AdminInvitePage from './AdminInvitePage';
import {
  people,
  shield,
  business,
  pricetag,
  school,
  person,
  trophy,
  ribbon,
  logOut,
  flash,
  notifications,
  qrCode,
  appsOutline,
  pulseOutline,
  informationCircleOutline,
  schoolOutline,
  document as documentIcon
} from 'ionicons/icons';
import InfoModal from '../../shared/InfoModal';
import { useApp } from '../../../contexts/AppContext';
// logout/clearAuth werden jetzt zentral ueber useApp().signOut() abgewickelt
import { useModalPage } from '../../../contexts/ModalContext';
import SpiritFooter from '../../shared/SpiritFooter';
import { useIonRouter } from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren

const AdminSettingsPage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('admin-settings');
  const { user, pushNotificationsPermission, requestPushPermissions, signOut } = useApp();
  const [presentAlert] = useIonAlert();
  const router = useIonRouter();

  const [presentInviteModal, dismissInviteModal] = useIonModal(AdminInvitePage, {
    onClose: () => dismissInviteModal(),
    dismiss: () => dismissInviteModal()
  });

  // Info-Modal (Erklaerung) — exemplarisch fuer Jahrgaenge. Inhalt wird per State
  // gesetzt, damit derselbe Hook spaeter fuer weitere Bereiche genutzt werden kann.
  const [infoContent, setInfoContent] = React.useState<{ title: string; icon: string; color: string; paragraphs: string[] } | null>(null);
  const [presentInfoModal, dismissInfoModal] = useIonModal(InfoModal, {
    onClose: () => dismissInfoModal(),
    title: infoContent?.title ?? '',
    icon: infoContent?.icon ?? informationCircleOutline,
    color: infoContent?.color,
    paragraphs: infoContent?.paragraphs ?? [],
  });

  const openInfo = (content: { title: string; icon: string; color: string; paragraphs: string[] }) => {
    setInfoContent(content);
    // im naechsten Tick praesentieren, damit der State sicher gesetzt ist
    setTimeout(() => presentInfoModal({ presentingElement: presentingElement || undefined }), 0);
  };

  // Erklaerungen je Bereich der "Mehr"-Seite. Fokus: WOFUER braucht man das +
  // wie haengt es mit anderen Bereichen zusammen.
  const INFOS: Record<string, { title: string; icon: string; color: string; paragraphs: string[] }> = {
    users: {
      title: 'Benutzer:innen', icon: people, color: 'var(--app-color-users)',
      paragraphs: [
        'Hier verwaltest du alle Personen in deiner Organisation: Admins, Teamer:innen und ihre Rollen.',
        'Die Rolle entscheidet, was jemand darf — z.B. ob jemand Punkte vergeben, Events anlegen oder die ganze Verwaltung sehen kann.',
        'Teamer:innen ordnest du außerdem Jahrgänge zu, damit sie genau ihre Gruppen sehen.',
      ],
    },
    invite: {
      title: 'Konfis einladen', icon: qrCode, color: 'var(--app-color-users)',
      paragraphs: [
        'Hier erzeugst du einen QR-Code bzw. Einladungslink, mit dem sich neue Konfis selbst registrieren können.',
        'Du legst fest, für welchen Jahrgang die Einladung gilt. Die Konfis scannen den Code und legen nur noch ihren Zugang an — sie landen automatisch im richtigen Jahrgang.',
        'So musst du niemanden einzeln von Hand anlegen.',
      ],
    },
    dashboard: {
      title: 'Dashboard', icon: appsOutline, color: 'var(--app-color-organizations)',
      paragraphs: [
        'Lege fest, welche Bereiche auf den Startseiten von Konfis und Teamer:innen angezeigt werden.',
        'So blendest du z.B. die Tageslosung, die Bestenliste oder einzelne Karten ein oder aus — passend zu deiner Gemeinde.',
      ],
    },
    activities: {
      title: 'Aktivitäten', icon: flash, color: 'var(--app-color-activities)',
      paragraphs: [
        'Aktivitäten sind die wiederkehrenden Dinge, für die es Punkte gibt — z.B. Gottesdienstbesuch oder eine Gemeinde-Aktion.',
        'Anders als Events stellen Konfis für eine Aktivität selbst einen Antrag auf Punkte. Du bestätigst den Antrag, dann werden die Punkte gutgeschrieben.',
        'Jede Aktivität hat eine Kategorie und einen Punktwert. Über die Kategorie steuerst du, ob die Punkte zu Gottesdienst oder Gemeinde zählen.',
      ],
    },
    badges: {
      title: 'Badges', icon: ribbon, color: 'var(--app-color-badges)',
      paragraphs: [
        'Badges sind Auszeichnungen, die deine Konfis automatisch erhalten, wenn sie ein Ziel erreichen.',
        'Du wählst die Logik selbst: nach Gesamtpunkten, nach der Anzahl bestimmter Aktivitäten, nach besuchten (Pflicht-)Events oder als Kombination mehrerer Bedingungen.',
        'So setzt du Anreize und machst Fortschritt sichtbar — Badges werden vergeben, sobald die Bedingung erfüllt ist.',
      ],
    },
    jahrgaenge: {
      title: 'Jahrgänge', icon: schoolOutline, color: 'var(--app-color-jahrgang)',
      paragraphs: [
        'Jeder Konfi gehört zu einem Jahrgang. Hier legst du neue Jahrgänge an und verwaltest die bestehenden.',
        'Pro Jahrgang legst du die Punkteziele für Gottesdienst und Gemeinde fest — also wie viele Punkte deine Konfis in jedem Bereich erreichen sollen.',
        'Außerdem gibst du hier frei, ab wann die Konfis ihren Konfispruch selbst auswählen dürfen.',
        'Am Jahrgangsende kannst du das Wrapped freigeben: einen persönlichen Jahresrückblick für jeden Konfi.',
      ],
    },
    categories: {
      title: 'Kategorien', icon: pricetag, color: 'var(--app-color-categories)',
      paragraphs: [
        'Kategorien ordnen Aktivitäten und Events thematisch ein und sind ein wichtiges Bindeglied im System.',
        'Bei Aktivitäten bestimmt die Kategorie, ob Punkte zu Gottesdienst oder Gemeinde zählen. Bei Events helfen Kategorien beim Sortieren und Filtern.',
        'Auch Badges können sich auf Kategorien beziehen. Lege deine Kategorien also sorgfältig an — sie wirken an vielen Stellen mit.',
      ],
    },
    levels: {
      title: 'Level', icon: trophy, color: 'var(--app-color-level)',
      paragraphs: [
        'Level machen den Fortschritt deiner Konfis sichtbar: Mit steigender Punktzahl erreichen sie das nächste Level.',
        'Du legst die Punkteschwellen und Namen der Level selbst fest und kannst Belohnungen daran knüpfen.',
        'So entsteht ein motivierender roter Faden über die ganze Konfi-Zeit.',
      ],
    },
    material: {
      title: 'Material', icon: documentIcon, color: 'var(--app-color-material)',
      paragraphs: [
        'Im Material-Bereich legst du Unterlagen und Dokumente fürs Team ab.',
        'Material kann allgemein sein oder direkt einem Event zugeordnet werden — so finden alle die passenden Dokumente zum richtigen Termin.',
        'Wichtig: Material ist nur für das Team sichtbar, nicht für die Konfis.',
      ],
    },
    certificates: {
      title: 'Zertifikate', icon: ribbon, color: 'var(--app-color-teamer)',
      paragraphs: [
        'Hier verwaltest du Zertifikate für deine Teamer:innen — etwa Schulungen oder Qualifikationen.',
        'Zertifikate können ein Ausstell- und ein Ablaufdatum haben. Deine Teamer:innen sehen ihre Zertifikate auf ihrer Startseite.',
        'So behältst du im Blick, wer welche Qualifikation hat und wann etwas erneuert werden muss.',
      ],
    },
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
            await signOut();
          }
        }
      ]
    });
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonTitle>Mehr</IonTitle>
          {user?.is_super_admin && (
            <IonButtons slot="end">
              <IonButton onClick={() => router.push('/admin/organizations')} title="Organisationen">
                <IonIcon slot="icon-only" icon={business} />
              </IonButton>
              <IonButton onClick={() => router.push('/admin/metrics')} title="Performance">
                <IonIcon slot="icon-only" icon={pulseOutline} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Mehr</IonTitle>
          </IonToolbar>
        </IonHeader>

        {/* Konto */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={person} />
            </div>
            <IonLabel>Konto</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                className="app-list-item app-list-item--users app-settings-item"
                onClick={() => router.push('/admin/profile')}
              >
                <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                  <IonIcon icon={person} />
                </div>
                <div className="app-flex-fill">
                  <h2 className="app-settings-item__title">Profil</h2>
                  <p className="app-settings-item__subtitle">Passwort und E-Mail ändern</p>
                </div>
              </div>

              <div
                className="app-list-item app-list-item--users app-settings-item"
                onClick={() => pushNotificationsPermission !== 'granted' && requestPushPermissions()}
                style={{
                  cursor: pushNotificationsPermission !== 'granted' ? 'pointer' : 'default',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {pushNotificationsPermission === 'granted' && (
                  <div className="app-corner-badges">
                    <div
                      className="app-corner-badge"
                      style={{ backgroundColor: '#059669' }}
                    >
                      Aktiviert
                    </div>
                  </div>
                )}
                <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                  <IonIcon icon={notifications} />
                </div>
                <div className="app-flex-fill">
                  <h2 className="app-settings-item__title">Benachrichtigungen</h2>
                  <p className="app-settings-item__subtitle">Chat-Nachrichten und Updates</p>
                </div>
              </div>
                </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* BLOCK 1: Verwaltung - für org_admin UND super_admin */}
        {(user?.role_name === 'org_admin' || user?.role_name === 'super_admin') && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--users">
                <IonIcon icon={shield} />
              </div>
              <IonLabel>Verwaltung</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  className="app-list-item app-list-item--users app-settings-item"
                  onClick={() => router.push('/admin/users')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                    <IonIcon icon={people} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Benutzer:innen</h2>
                    <p className="app-settings-item__subtitle">Admins, Teamer:innen und Rollen verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Benutzer:innen" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.users); }} style={{ '--color': 'var(--app-color-users)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>

                {user?.role_name === 'org_admin' && (
                  <div
                    className="app-list-item app-list-item--users app-settings-item"
                    onClick={() => router.push('/admin/settings/dashboard')}
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                      <IonIcon icon={appsOutline} />
                    </div>
                    <div className="app-flex-fill">
                      <h2 className="app-settings-item__title">Dashboard</h2>
                      <p className="app-settings-item__subtitle">Sichtbare Bereiche für Konfis und Teamer:innen</p>
                    </div>
                    <IonButton fill="clear" aria-label="Info zum Dashboard" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.dashboard); }} style={{ '--color': 'var(--app-color-organizations)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                      <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                    </IonButton>
                  </div>
                )}

                <div
                  className="app-list-item app-list-item--users app-settings-item"
                  onClick={() => presentInviteModal({ presentingElement: presentingElement })}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                    <IonIcon icon={qrCode} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Konfis einladen</h2>
                    <p className="app-settings-item__subtitle">QR-Code für Selbstregistrierung</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Konfis einladen" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.invite); }} style={{ '--color': 'var(--app-color-users)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* System-Administration (Organisationen + Performance) liegt fuer
            super_admins jetzt als Buttons oben rechts im Header — nicht mehr als
            Listen-Eintrag. */}

        {/* BLOCK 2: Inhalt -- nur für org_admin/teamer, NICHT für super_admin */}
        {user?.role_name !== 'super_admin' && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--users">
                <IonIcon icon={pricetag} />
              </div>
              <IonLabel>Inhalt</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  className="app-list-item app-list-item--activities app-settings-item"
                  onClick={() => router.push('/admin/activities')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--activities">
                    <IonIcon icon={flash} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Aktivitäten</h2>
                    <p className="app-settings-item__subtitle">Aktivitäten und Punkte verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Aktivitäten" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.activities); }} style={{ '--color': 'var(--app-color-activities)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--badges app-settings-item"
                  onClick={() => router.push('/admin/badges')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--badges">
                    <IonIcon icon={ribbon} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Badges</h2>
                    <p className="app-settings-item__subtitle">Auszeichnungen und Erfolge verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Badges" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.badges); }} style={{ '--color': 'var(--app-color-badges)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--jahrgang app-settings-item"
                  onClick={() => router.push('/admin/settings/jahrgaenge')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--jahrgang">
                    <IonIcon icon={school} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Jahrgänge</h2>
                    <p className="app-settings-item__subtitle">Jahrgänge anlegen, Punkteziele (Gottesdienst &amp; Gemeinde), Konfispruch-Freischaltung und Wrapped-Freigabe verwalten</p>
                  </div>
                  <IonButton
                    fill="clear"
                    onClick={(e) => { e.stopPropagation(); openInfo(INFOS.jahrgaenge); }}
                    style={{ '--color': 'var(--app-color-jahrgang)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}
                    aria-label="Info zu Jahrgängen"
                  >
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--categories app-settings-item"
                  onClick={() => router.push('/admin/settings/categories')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--categories">
                    <IonIcon icon={pricetag} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Kategorien</h2>
                    <p className="app-settings-item__subtitle">Kategorien für Aktivitäten und Events</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Kategorien" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.categories); }} style={{ '--color': 'var(--app-color-categories)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--level app-settings-item"
                  onClick={() => router.push('/admin/settings/levels')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--level">
                    <IonIcon icon={trophy} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Level</h2>
                    <p className="app-settings-item__subtitle">Punkte-Level und Belohnungen</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Level" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.levels); }} style={{ '--color': 'var(--app-color-level)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--material app-settings-item"
                  onClick={() => router.push('/admin/material')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--material">
                    <IonIcon icon={documentIcon} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Material</h2>
                    <p className="app-settings-item__subtitle">Materialien und Dokumente verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Material" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.material); }} style={{ '--color': 'var(--app-color-material)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--teamer app-settings-item"
                  onClick={() => router.push('/admin/settings/certificates')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--teamer">
                    <IonIcon icon={ribbon} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Zertifikate</h2>
                    <p className="app-settings-item__subtitle">Teamer:innen-Zertifikate verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Zertifikaten" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.certificates); }} style={{ '--color': 'var(--app-color-teamer)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={informationCircleOutline} slot="icon-only" style={{ fontSize: '1.4rem' }} />
                  </IonButton>
                </div>
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}


        <div className="app-segment-wrapper">
          <IonButton
            expand="block"
            fill="outline"
            color="danger"
            onClick={handleLogout}
            className="app-action-button"
          >
            <IonIcon icon={logOut} slot="start" />
            Abmelden
          </IonButton>
        </div>

        <SpiritFooter />

        <div className="ion-padding-bottom"></div>
      </IonContent>
    </IonPage>
  );
};

export default AdminSettingsPage;
