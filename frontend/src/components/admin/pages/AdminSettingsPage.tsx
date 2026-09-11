import React, { useState } from 'react';
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
  ICON_ABMELDEN_GEFUELLT,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_AKTION_GEFUELLT,
  ICON_APPS,
  ICON_BENACHRICHTIGUNG,
  ICON_DATEI_GEFUELLT,
  ICON_FUNKELN,
  ICON_GRUPPE_GEFUELLT,
  ICON_INFO,
  ICON_JAHRGANG,
  ICON_JAHRGANG_GEFUELLT,
  ICON_KATEGORIE_GEFUELLT,
  ICON_KOMPASS,
  ICON_ORGANISATION_GEFUELLT,
  ICON_PERSON_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_PULS,
  ICON_QRCODE_GEFUELLT,
  ICON_SCHILD_GEFUELLT,
} from '../../shared/icons';
import InfoModal from '../../shared/InfoModal';
import AdminOnboardingModal from '../modals/AdminOnboardingModal';
import AdminUpdate211WalkthroughModal from '../modals/AdminUpdate211WalkthroughModal';
import { useApp } from '../../../contexts/AppContext';
// logout/clearAuth werden jetzt zentral über useApp().signOut() abgewickelt
import { useModalPage } from '../../../contexts/ModalContext';
import SpiritFooter from '../../shared/SpiritFooter';
import { useIonRouter } from '@ionic/react';
import NeuerungenBanner from '../../shared/NeuerungenBanner';
import MitmachenErklaerungModal from '../../shared/MitmachenErklaerungModal';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren

const AdminSettingsPage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('admin-settings');
  const { user, pushNotificationsPermission, requestPushPermissions, signOut } = useApp();
  const [presentAlert] = useIonAlert();
  const router = useIonRouter();

  // Tour und Update-Hinweis jederzeit erneut aufrufbar (Vollbild-Overlays,
  // keine Modals — identisch zum automatischen Ablauf beim ersten Start).
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUpdateWalkthrough, setShowUpdateWalkthrough] = useState(false);
  const [showMitmachenErklaerung, setShowMitmachenErklaerung] = useState(false);

  const [presentInviteModal, dismissInviteModal] = useIonModal(AdminInvitePage, {
    onClose: () => dismissInviteModal(),
    dismiss: () => dismissInviteModal()
  });

  // Info-Modal (Erklaerung) — exemplarisch für Jahrgänge. Inhalt wird per State
  // gesetzt, damit derselbe Hook später für weitere Bereiche genutzt werden kann.
  const [infoContent, setInfoContent] = React.useState<{ title: string; icon: string; color: string; paragraphs: string[] } | null>(null);
  const [presentInfoModal, dismissInfoModal] = useIonModal(InfoModal, {
    onClose: () => dismissInfoModal(),
    title: infoContent?.title ?? '',
    icon: infoContent?.icon ?? ICON_INFO,
    color: infoContent?.color,
    paragraphs: infoContent?.paragraphs ?? [],
  });

  const openInfo = (content: { title: string; icon: string; color: string; paragraphs: string[] }) => {
    setInfoContent(content);
    // im nächsten Tick praesentieren, damit der State sicher gesetzt ist
    setTimeout(() => presentInfoModal({ presentingElement: presentingElement || undefined }), 0);
  };

  // Erklaerungen je Bereich der "Mehr"-Seite. Fokus: WOFUER braucht man das +
  // wie hängt es mit anderen Bereichen zusammen.
  const INFOS: Record<string, { title: string; icon: string; color: string; paragraphs: string[] }> = {
    users: {
      title: 'Benutzer:innen', icon: ICON_GRUPPE_GEFUELLT, color: 'var(--app-color-users)',
      paragraphs: [
        'Hier verwaltest du alle Personen in deiner Organisation: Admins, Team und ihre Rollen.',
        'Die Rolle entscheidet, was jemand darf — z.B. ob jemand Punkte vergeben, Events anlegen oder die ganze Verwaltung sehen kann.',
        'Dem Team ordnest du außerdem Jahrgänge zu, damit alle genau ihre Gruppen sehen.',
      ],
    },
    invite: {
      title: 'Konfis einladen', icon: ICON_QRCODE_GEFUELLT, color: 'var(--app-color-users)',
      paragraphs: [
        'Hier erzeugst du einen QR-Code bzw. Einladungslink, mit dem sich neue Konfis selbst registrieren können.',
        'Du legst fest, für welchen Jahrgang die Einladung gilt. Die Konfis scannen den Code und legen nur noch ihren Zugang an — sie landen automatisch im richtigen Jahrgang.',
        'So musst du niemanden einzeln von Hand anlegen.',
      ],
    },
    dashboard: {
      title: 'Dashboard', icon: ICON_APPS, color: 'var(--app-color-organizations)',
      paragraphs: [
        'Lege fest, welche Bereiche auf den Startseiten von Konfis und Team angezeigt werden.',
        'So blendest du z.B. die Tageslosung, die Bestenliste oder einzelne Karten ein oder aus — passend zu deiner Gemeinde.',
      ],
    },
    activities: {
      title: 'Aktivitäten', icon: ICON_AKTION_GEFUELLT, color: 'var(--app-color-activities)',
      paragraphs: [
        'Aktivitäten sind die wiederkehrenden Dinge, für die es Punkte gibt — z.B. Gottesdienstbesuch oder eine Gemeinde-Aktion.',
        'Anders als bei Events melden Konfis eine Aktivität selbst, wenn sie sie erledigt haben. Du bestätigst die Meldung, dann werden die Punkte gutgeschrieben.',
        'Jede Aktivität hat eine Kategorie und einen Punktwert. Über die Kategorie steuerst du, ob die Punkte zu Gottesdienst oder Gemeinde zählen.',
      ],
    },
    badges: {
      title: 'Badges', icon: ICON_ABZEICHEN_GEFUELLT, color: 'var(--app-color-badges)',
      paragraphs: [
        'Badges sind Auszeichnungen, die deine Konfis automatisch erhalten, wenn sie ein Ziel erreichen.',
        'Du wählst die Logik selbst: nach Gesamtpunkten, nach der Anzahl bestimmter Aktivitäten, nach besuchten (Pflicht-)Events oder als Kombination mehrerer Bedingungen.',
        'So setzt du Anreize und machst Fortschritt sichtbar — Badges werden vergeben, sobald die Bedingung erfüllt ist.',
      ],
    },
    jahrgaenge: {
      title: 'Jahrgänge', icon: ICON_JAHRGANG, color: 'var(--app-color-jahrgang)',
      paragraphs: [
        'Jeder Konfi gehört zu einem Jahrgang. Hier legst du neue Jahrgänge an und verwaltest die bestehenden.',
        'Pro Jahrgang legst du die Punkteziele für Gottesdienst und Gemeinde fest — also wie viele Punkte deine Konfis in jedem Bereich erreichen sollen.',
        'Außerdem gibst du hier frei, ab wann die Konfis ihren Konfispruch selbst auswählen dürfen.',
        'Am Jahrgangsende kannst du das Wrapped freigeben: einen persönlichen Jahresrückblick für jeden Konfi.',
      ],
    },
    categories: {
      title: 'Kategorien', icon: ICON_KATEGORIE_GEFUELLT, color: 'var(--app-color-categories)',
      paragraphs: [
        'Kategorien ordnen Aktivitäten und Events thematisch ein und sind ein wichtiges Bindeglied im System.',
        'Bei Aktivitäten bestimmt die Kategorie, ob Punkte zu Gottesdienst oder Gemeinde zählen. Bei Events helfen Kategorien beim Sortieren und Filtern.',
        'Auch Badges können sich auf Kategorien beziehen. Lege deine Kategorien also sorgfältig an — sie wirken an vielen Stellen mit.',
      ],
    },
    levels: {
      title: 'Level', icon: ICON_POKAL_GEFUELLT, color: 'var(--app-color-level)',
      paragraphs: [
        'Level machen den Fortschritt deiner Konfis sichtbar: Mit steigender Punktzahl erreichen sie das nächste Level.',
        'Du legst die Punkteschwellen und Namen der Level selbst fest und kannst Belohnungen daran knüpfen.',
        'So entsteht ein motivierender roter Faden über die ganze Konfi-Zeit.',
      ],
    },
    material: {
      title: 'Material', icon: ICON_DATEI_GEFUELLT, color: 'var(--app-color-material)',
      paragraphs: [
        'Im Material-Bereich legst du Unterlagen und Dokumente fürs Team ab.',
        'Material kann allgemein sein oder direkt einem Event zugeordnet werden — so finden alle die passenden Dokumente zum richtigen Termin.',
        'Unter Sichtbarkeit legst du fest, für wen es gedacht ist: nach Jahrgang — dann sieht es nur das Team dieses Jahrgangs — oder ausdrücklich für alle, dann sieht es das ganze Team der Gemeinde. Freigeben und zurückziehen kann nur der Org-Admin.',
        'Wichtig: Material ist nur für das Team sichtbar, nicht für die Konfis. Für alle heißt also immer: das ganze Team.',
      ],
    },
    wrapped: {
      title: 'Jahresrückblick', icon: ICON_FUNKELN, color: 'var(--app-color-wrapped)',
      paragraphs: [
        'Der Jahresrückblick zeigt jeder Konfi und jeder Teamer:in am Ende eines Abschnitts, was sie erlebt hat — Termine, Punkte, Abzeichen, ihre Schwerpunkte und die Momente aus den Challenges.',
        'Ein Jahrgang läuft über mehrere Jahre. Deshalb kannst du mehrere Ausgaben anlegen und jeder einen eigenen Namen geben: „Dein erstes Jahr", „Zwischenstand", „Dein Abschluss". Frühere Ausgaben bleiben erhalten, wenn eine neue dazukommt.',
        'Jede Ausgabe wird beim Erstellen sofort freigegeben, und alle Betroffenen bekommen eine Mitteilung. Einzelne Ausgaben lassen sich gezielt löschen, ohne die anderen anzurühren.',
        'Als Admin verwaltest du die Rückblicke deiner eigenen Jahrgänge. Die Leitung sieht alle Jahrgänge und verwaltet zusätzlich die Rückblicke des Teams.',
      ],
    },
    certificates: {
      title: 'Zertifikate', icon: ICON_ABZEICHEN_GEFUELLT, color: 'var(--app-color-teamer)',
      paragraphs: [
        'Hier verwaltest du Zertifikate für dein Team — etwa Schulungen oder Qualifikationen.',
        'Zertifikate können ein Ausstell- und ein Ablaufdatum haben. Dein Team sieht seine Zertifikate auf der eigenen Startseite.',
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
              <IonButton onClick={() => router.push('/admin/organizations')} title="Organisationen" aria-label="Organisationen verwalten">
                <IonIcon slot="icon-only" icon={ICON_ORGANISATION_GEFUELLT} />
              </IonButton>
              <IonButton onClick={() => router.push('/admin/metrics')} title="Performance" aria-label="Performance anzeigen">
                <IonIcon slot="icon-only" icon={ICON_PULS} />
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

        <NeuerungenBanner
          onUpdateOeffnen={() => setShowUpdateWalkthrough(true)}
          onMitmachenOeffnen={() => setShowMitmachenErklaerung(true)}
        />

        {/* Konto */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--users">
              <IonIcon icon={ICON_PERSON_GEFUELLT} />
            </div>
            <IonLabel>Konto</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                className="app-list-item app-list-item--users app-settings-item"
                onClick={() => router.push('/admin/profile')}
              >
                <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                  <IonIcon icon={ICON_PERSON_GEFUELLT} />
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
                      style={{ backgroundColor: 'var(--app-color-success-strong)' }}
                    >
                      Aktiviert
                    </div>
                  </div>
                )}
                <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                  <IonIcon icon={ICON_BENACHRICHTIGUNG} />
                </div>
                <div className="app-flex-fill">
                  <h2 className="app-settings-item__title">Benachrichtigungen</h2>
                  <p className="app-settings-item__subtitle">Chat-Nachrichten und Updates</p>
                </div>
              </div>

              {/* App-Tour und Neuerungen jederzeit erneut ansehen */}
              <div
                className="app-list-item app-list-item--users app-settings-item"
                onClick={() => setShowOnboarding(true)}
              >
                <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                  <IonIcon icon={ICON_KOMPASS} />
                </div>
                <div className="app-flex-fill">
                  <h2 className="app-settings-item__title">App-Tour ansehen</h2>
                  <p className="app-settings-item__subtitle">Kurze Einführung durch die App</p>
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
                <IonIcon icon={ICON_SCHILD_GEFUELLT} />
              </div>
              <IonLabel>Verwaltung</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  className="app-list-item app-list-item--users app-settings-item"
                  onClick={() => router.push('/admin/users')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Benutzer:innen</h2>
                    <p className="app-settings-item__subtitle">Admins, Team und Rollen verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Benutzer:innen" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.users); }} style={{ '--color': 'var(--app-color-users)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                {user?.role_name === 'org_admin' && (
                  <div
                    className="app-list-item app-list-item--users app-settings-item"
                    onClick={() => router.push('/admin/settings/dashboard')}
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                      <IonIcon icon={ICON_APPS} />
                    </div>
                    <div className="app-flex-fill">
                      <h2 className="app-settings-item__title">Dashboard</h2>
                      <p className="app-settings-item__subtitle">Sichtbare Bereiche für Konfis und Team</p>
                    </div>
                    <IonButton fill="clear" aria-label="Info zum Dashboard" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.dashboard); }} style={{ '--color': 'var(--app-color-organizations)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                      <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                    </IonButton>
                  </div>
                )}

                <div
                  className="app-list-item app-list-item--users app-settings-item"
                  onClick={() => presentInviteModal({ presentingElement: presentingElement })}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                    <IonIcon icon={ICON_QRCODE_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Konfis einladen</h2>
                    <p className="app-settings-item__subtitle">QR-Code für Selbstregistrierung</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Konfis einladen" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.invite); }} style={{ '--color': 'var(--app-color-users)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
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
                <IonIcon icon={ICON_KATEGORIE_GEFUELLT} />
              </div>
              <IonLabel>Inhalt</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  className="app-list-item app-list-item--activities app-settings-item"
                  onClick={() => router.push('/admin/activities')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--activities">
                    <IonIcon icon={ICON_AKTION_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Aktivitäten</h2>
                    <p className="app-settings-item__subtitle">Aktivitäten und Punkte verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Aktivitäten" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.activities); }} style={{ '--color': 'var(--app-color-activities)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--badges app-settings-item"
                  onClick={() => router.push('/admin/badges')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--badges">
                    <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Badges</h2>
                    <p className="app-settings-item__subtitle">Auszeichnungen und Erfolge verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Badges" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.badges); }} style={{ '--color': 'var(--app-color-badges)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--jahrgang app-settings-item"
                  onClick={() => router.push('/admin/settings/jahrgaenge')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--jahrgang">
                    <IonIcon icon={ICON_JAHRGANG_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Jahrgänge</h2>
                    <p className="app-settings-item__subtitle">Punkteziele und Konfisprüche verwalten</p>
                  </div>
                  <IonButton
                    fill="clear"
                    onClick={(e) => { e.stopPropagation(); openInfo(INFOS.jahrgaenge); }}
                    style={{ '--color': 'var(--app-color-jahrgang)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}
                    aria-label="Info zu Jahrgängen"
                  >
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--categories app-settings-item"
                  onClick={() => router.push('/admin/settings/categories')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--categories">
                    <IonIcon icon={ICON_KATEGORIE_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Kategorien</h2>
                    <p className="app-settings-item__subtitle">Kategorien für Aktivitäten und Events</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Kategorien" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.categories); }} style={{ '--color': 'var(--app-color-categories)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--level app-settings-item"
                  onClick={() => router.push('/admin/settings/levels')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--level">
                    <IonIcon icon={ICON_POKAL_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Level</h2>
                    <p className="app-settings-item__subtitle">Punkte-Level und Belohnungen</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Level" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.levels); }} style={{ '--color': 'var(--app-color-level)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--material app-settings-item"
                  onClick={() => router.push('/admin/material')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--material">
                    <IonIcon icon={ICON_DATEI_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Material</h2>
                    <p className="app-settings-item__subtitle">Materialien und Dokumente verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Material" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.material); }} style={{ '--color': 'var(--app-color-material)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--wrapped app-settings-item"
                  onClick={() => router.push('/admin/wrapped')}
                >
                  <div className="app-icon-circle app-icon-circle--lg" style={{ background: 'var(--app-color-wrapped)' }}>
                    <IonIcon icon={ICON_FUNKELN} style={{ color: 'white' }} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Jahresrückblick</h2>
                    <p className="app-settings-item__subtitle">Ausgaben anlegen, benennen und freigeben</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zum Jahresrückblick" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.wrapped); }} style={{ '--color': 'var(--app-color-wrapped)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
                  </IonButton>
                </div>

                <div
                  className="app-list-item app-list-item--teamer app-settings-item"
                  onClick={() => router.push('/admin/settings/certificates')}
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--teamer">
                    <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
                  </div>
                  <div className="app-flex-fill">
                    <h2 className="app-settings-item__title">Zertifikate</h2>
                    <p className="app-settings-item__subtitle">Zertifikate fürs Team verwalten</p>
                  </div>
                  <IonButton fill="clear" aria-label="Info zu Zertifikaten" onClick={(e) => { e.stopPropagation(); openInfo(INFOS.certificates); }} style={{ '--color': 'var(--app-color-teamer)', '--padding-start': '6px', '--padding-end': '6px', margin: 0 }}>
                    <IonIcon icon={ICON_INFO} slot="icon-only" style={{ fontSize: 'var(--app-text-titel-gross)' }} />
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
            <IonIcon icon={ICON_ABMELDEN_GEFUELLT} slot="start" />
            Abmelden
          </IonButton>
        </div>

        <SpiritFooter />

        <div className="ion-padding-bottom"></div>
      </IonContent>

      {showOnboarding && (
        <AdminOnboardingModal
          onClose={() => setShowOnboarding(false)}
          displayName={(user?.display_name || '').split(' ')[0]}
        />
      )}

      {showUpdateWalkthrough && (
        <AdminUpdate211WalkthroughModal onClose={() => setShowUpdateWalkthrough(false)} />
      )}

      {showMitmachenErklaerung && (
        <MitmachenErklaerungModal
          rolle="admin"
          onClose={() => setShowMitmachenErklaerung(false)}
        />
      )}
    </IonPage>
  );
};

export default AdminSettingsPage;
