import { ICON_HINZUFUEGEN_GEFUELLT } from '../../shared/icons';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import { fehlerText } from '../../../utils/fehler';
import React, { useState, useCallback } from 'react';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButton,
  IonIcon,
  useIonModal,
  useIonAlert
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import OrganizationView from '../OrganizationView';
import WartungsHinweis from '../../shared/WartungsHinweis';
import LoadingSpinner from '../../common/LoadingSpinner';
import OrganizationManagementModal from '../modals/OrganizationManagementModal';
import { triggerPullHaptic } from '../../../utils/haptics';

interface Organization {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  contact_email?: string;
  website?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_count: number;
  konfi_count: number;
  activity_count: number;
  event_count: number;
  badge_count: number;
}

interface GemeindeGeloeschtAntwort {
  konten_geloescht?: number;
  konten_umgezogen?: number;
}

const konten = (anzahl: number) => `${anzahl} ${anzahl === 1 ? 'Konto' : 'Konten'}`;

/** Die Meldung nach dem Löschen: mit den Zahlen der Konten, wenn der Server sie schickt. */
const gemeindeGeloeschtMeldung = (name: string, antwort?: GemeindeGeloeschtAntwort | null): string => {
  const geloescht = antwort?.konten_geloescht;
  const umgezogen = antwort?.konten_umgezogen;
  if (typeof geloescht !== 'number' || typeof umgezogen !== 'number') return `Gemeinde "${name}" gelöscht`;
  return `Gemeinde "${name}" gelöscht: ${konten(geloescht)} gelöscht, ${konten(umgezogen)} in eine andere Gemeinde umgezogen`;
};

const AdminOrganizationsPage: React.FC = () => {
  const { setError, setSuccess, isOnline, refreshUser } = useApp();
  const { pageRef, presentingElement } = useModalPage('admin-organizations');
  
  // SWR-Cache für Organisationen
  const { data: organizationsData, loading, refresh: loadOrganizations } = useOfflineQuery<Organization[]>(
    'super-admin-organizations',
    useCallback(async () => {
      const response = await api.get('/organizations');
      return response.data;
    }, []),
    { ttl: CACHE_TTL.STAMMDATEN }
  );
  const organizations = organizationsData ?? [];

  // Modal state
  const [modalOrganizationId, setModalOrganizationId] = useState<number | null>(null);

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();
  // Modal mit useIonModal Hook
  const [presentOrganizationModalHook, dismissOrganizationModalHook] = useIonModal(OrganizationManagementModal, {
    organizationId: modalOrganizationId,
    onClose: () => {
      dismissOrganizationModalHook();
      setModalOrganizationId(null);
    },
    onSuccess: () => {
      dismissOrganizationModalHook();
      // User-State neu laden -> Trial-Banner erscheint/verschwindet sofort
      // (ohne Logout/Neustart). Bedingungslos: ein /me-Call ist guenstig, und
      // der Vergleich auf die eigene Org war fehleranfaellig (modalOrganizationId
      // wurde teils schon zurückgesetzt). super_admin ohne Org schadet es nicht.
      refreshUser();
      setModalOrganizationId(null);
      loadOrganizations();
    }
  });

  // Subscribe to live updates for organizations
  useLiveRefresh('organizations', loadOrganizations);

  const handleDeleteOrganization = async (organization: Organization) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Gemeinde löschen',
      message: `Gemeinde "${organization.display_name}" (${organization.name}) wirklich löschen?\n\n`
        + 'Alle Daten der Gemeinde werden gelöscht, dazu jedes Konto, das nur zu ihr gehört. '
        + 'Wer auch zu einer anderen Gemeinde gehört, behält sein Konto und bleibt dort.\n\n'
        + 'Das lässt sich nicht rückgängig machen.',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              const res = await api.delete(`/organizations/${organization.id}`);
              setSuccess(gemeindeGeloeschtMeldung(organization.display_name, res?.data));
              await loadOrganizations();
            } catch (err) {
              setError(fehlerText(err, 'Fehler beim Löschen der Gemeinde'));
            }
          }
        }
      ]
    });
  };

  const handleSelectOrganization = (organization: Organization) => {
    setModalOrganizationId(organization.id);
    presentOrganizationModalHook({
      presentingElement: presentingElement
    });
  };

  const presentOrganizationModal = () => {
    setModalOrganizationId(null);
    presentOrganizationModalHook({
      presentingElement: presentingElement
    });
  };

  return (
    <IonPage ref={pageRef}>
      {/* Kein Gemeinde-Umschalter: die Seite ist gemeindeuebergreifend (Betrieb). */}
      <AppKopfzeile
        titel="Gemeinden"
        onZurueck={() => window.history.back()}
        gemeindeUmschalter={false}
        rechts={(
          <IonButton aria-label="Neue Gemeinde anlegen" onClick={presentOrganizationModal}>
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
          </IonButton>
        )}
      />
      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Gemeinden" />
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          loadOrganizations();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        {/* Wartungshinweis des Betriebs -- auch hier, damit der
            Super-Admin sieht, was gerade bei allen Rollen steht. */}
        <WartungsHinweis />

        {loading ? (
          <LoadingSpinner message="Gemeinden werden geladen..." />
        ) : (
          <>
            <OrganizationView
              organizations={organizations}
              onUpdate={loadOrganizations}
              onSelectOrganization={handleSelectOrganization}
              onDeleteOrganization={handleDeleteOrganization}
            />

            <div style={{ height: '32px' }} />
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminOrganizationsPage;