import React, { useState, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
  useIonModal,
  useIonAlert,
  useIonRouter
} from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { add, checkboxOutline } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import KonfisView from '../KonfisView';
import LoadingSpinner from '../../common/LoadingSpinner';
import KonfiModal from '../modals/KonfiModal';
import AttendanceMatrixModal from '../modals/AttendanceMatrixModal';
import { triggerPullHaptic } from '../../../utils/haptics';
import { OrgSwitcherButton } from '../../shared';
import AdminOnboardingModal from '../modals/AdminOnboardingModal';
import { useOnboardingOnce } from '../../../hooks/useOnboardingOnce';

interface Konfi {
  id: number;
  name: string;
  username?: string;
  jahrgang?: string;
  jahrgang_name?: string; // Backend liefert jahrgang_name
  // Backend liefert diese Felder:
  gottesdienst_points?: number;
  gemeinde_points?: number;
  // Legacy support für alte Struktur:
  points?: {
    gottesdienst: number;
    gemeinde: number;
  };
  badgeCount?: number;
  activities_count?: number;
}

interface Jahrgang {
  id: number;
  name: string;
}

interface Settings {
  target_gottesdienst?: string;
  target_gemeinde?: string;
}


interface AdminKonfisPageProps {
  // Im iPad-Split-View setzt der Master die Auswahl als State (statt zu
  // navigieren). Fehlt der Callback (iPhone/Portrait), wird wie bisher
  // per Route auf die Detail-Seite navigiert.
  onSelectKonfi?: (konfiId: number) => void;
  // Aktuell ausgewaehlter Konfi (fuer Highlighting im Split-View).
  selectedKonfiId?: number | null;
}

const AdminKonfisPage: React.FC<AdminKonfisPageProps> = ({ onSelectKonfi, selectedKonfiId }) => {
  const { setSuccess, setError, user, isOnline } = useApp();
  const router = useIonRouter();
  const { pageRef, presentingElement, cleanupModals } = useModalPage('admin-konfis');
  // Onboarding-Tour einmal pro Admin-Account (beim ersten Betreten der Konfis-Seite,
  // der Landing-Page fuer Admins/Org-Admins).
  const [showOnboarding, closeOnboarding] = useOnboardingOnce('admin_onboarding_seen', user?.id);
  
  // Offline-Query: Konfis
  const { data: konfis, loading: konfisLoading, refresh: refreshKonfis } = useOfflineQuery<Konfi[]>(
    'admin:konfis:' + user?.organization_id,
    async () => { const res = await api.get('/admin/konfis'); return res.data; },
    { ttl: CACHE_TTL.KONFIS }
  );

  // Offline-Query: Jahrgaenge
  const { data: jahrgaenge, refresh: refreshJahrgaenge } = useOfflineQuery<Jahrgang[]>(
    'admin:jahrgaenge:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  // Offline-Query: Settings
  const { data: settings, refresh: refreshSettings } = useOfflineQuery<Settings>(
    'admin:settings:' + user?.organization_id,
    async () => { const res = await api.get('/settings'); return res.data; },
    { ttl: CACHE_TTL.SETTINGS }
  );

  const loading = konfisLoading;

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook - löst Tab-Navigation Problem
  const [presentKonfiModalHook, dismissKonfiModalHook] = useIonModal(KonfiModal, {
    jahrgaenge: jahrgaenge || [],
    onClose: () => dismissKonfiModalHook(),
    onSave: (konfiData: any) => {
      handleAddKonfi(konfiData);
      dismissKonfiModalHook();
    },
    dismiss: () => dismissKonfiModalHook()
  });

  // Anwesenheits-Matrix Modal
  const [presentMatrixModal, dismissMatrixModal] = useIonModal(AttendanceMatrixModal, {
    jahrgaenge: jahrgaenge || [],
    onClose: () => dismissMatrixModal()
  });

  // Memoized refresh function for live updates
  const refreshAll = useCallback(() => {
    refreshKonfis();
    refreshJahrgaenge();
    refreshSettings();
  }, [refreshKonfis, refreshJahrgaenge, refreshSettings]);

  // Subscribe to live updates for konfis
  useLiveRefresh('konfis', refreshAll);

  const handleDeleteKonfi = async (konfi: Konfi) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Konfi wirklich löschen?',
      message: `"${konfi.name}" wird unwiderruflich gelöscht.\n\nDabei gehen alle Punkte, Abzeichen, Anträge und Chat-Nachrichten dieses Konfis dauerhaft verloren. Das lässt sich nicht rückgängig machen.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Endgültig löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/admin/konfis/${konfi.id}`);
              await refreshKonfis();
            } catch (err) {
              setError('Fehler beim Löschen');
            }
          }
        }
      ]
    });
  };

  // Gibt ein Promise zurueck, das erst nach abgeschlossenem Delete (oder Abbruch)
  // resolved — so kann KonfisView danach die lokale Teamer-Liste neu laden.
  const handleDeleteTeamer = (teamer: any): Promise<void> => {
    if (!isOnline) return Promise.resolve();
    return new Promise<void>((resolve) => {
      presentAlert({
        header: 'Teamer:in löschen',
        message: `Teamer:in "${teamer.display_name || teamer.name}" wirklich löschen?\n\nDas Konto wird mit allen zugehörigen Daten entfernt. Punkte und Abzeichen aus einer früheren Konfi-Zeit gehen dabei verloren.`,
        buttons: [
          { text: 'Abbrechen', role: 'cancel', handler: () => resolve() },
          {
            text: 'Löschen',
            role: 'destructive',
            handler: async () => {
              try {
                await api.delete(`/users/${teamer.id}`);
                await refreshKonfis();
                setSuccess(`Teamer:in "${teamer.display_name || teamer.name}" gelöscht`);
              } catch (err: any) {
                setError(err.response?.data?.error || 'Fehler beim Löschen');
              } finally {
                resolve();
              }
            }
          }
        ]
      });
    });
  };

  const handleSelectKonfi = (konfi: Konfi) => {
    // Split-View (iPad): Auswahl an den Wrapper melden, KEINE Navigation.
    // Sonst (iPhone/Portrait): wie bisher zur Detail-Route navigieren.
    if (onSelectKonfi) {
      onSelectKonfi(konfi.id);
    } else {
      router.push(`/admin/konfis/${konfi.id}`);
    }
  };

  const presentKonfiModal = () => {
    presentKonfiModalHook({
      presentingElement: presentingElement
    });
  };

  // Erfolgsbehandlung nach erfolgreichem Anlegen (auch nach Grace-Bestätigung wiederverwendet)
  const handleKonfiCreated = async (response: any, konfiData: any) => {
    // Automatisch Jahrgangschat erstellen/zuweisen
    if (konfiData.jahrgang_id) {
      await createOrJoinJahrgangChat(konfiData.jahrgang_id, response.data.id);
    }

    const tempPassword = response.data.temporaryPassword;
    if (tempPassword) {
      presentAlert({
        header: 'Einmalpasswort',
        subHeader: tempPassword,
        message: `Konfi "${konfiData.display_name}" erstellt. Kopiere das Passwort und gib es dem Konfi weiter.`,
        buttons: [
          {
            text: 'Kopieren',
            handler: () => {
              navigator.clipboard.writeText(tempPassword);
              setSuccess('Passwort kopiert');
              return false;
            }
          },
          { text: 'Fertig', role: 'cancel' }
        ]
      });
    }

    // Sofortige Aktualisierung
    await refreshKonfis();
  };

  // Grace-Bestätigungsdialog: legt den Konfi nach "Trotzdem anlegen" mit confirm-Flag erneut an
  const presentGraceDialog = (konfiData: any, data: any) => {
    const count = data?.count;
    const limit = data?.limit;
    const nextTier = data?.next_tier;
    const standText =
      count !== undefined && limit !== undefined ? `${count} von ${limit} Konfis` : 'das Konfi-Limit';
    const tarifHinweis = nextTier
      ? `Der nächste Tarif gibt dir Platz für bis zu ${nextTier} Konfis.`
      : 'Eine höhere Tarif-Stufe ist nicht verfügbar.';

    presentAlert({
      header: 'Konfi-Limit erreicht',
      message: `Du hast ${standText} angelegt. Du kannst noch bis zu 5 weitere Konfis anlegen, danach ist ein Tarif-Upgrade nötig. ${tarifHinweis}`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Trotzdem anlegen',
          handler: async () => {
            try {
              const response = await api.post('/admin/konfis', { ...konfiData, confirm: true });
              await handleKonfiCreated(response, konfiData);
            } catch (err: any) {
              setError(err.response?.data?.error || 'Fehler beim Hinzufügen des Konfis');
            }
          }
        }
      ]
    });
  };

  const handleAddKonfi = async (konfiData: any) => {
    try {
      const response = await api.post('/admin/konfis', konfiData);
      await handleKonfiCreated(response, konfiData);
    } catch (err: any) {
      const errorCode = err.response?.data?.error_code;

      if (errorCode === 'limit_grace') {
        // 409 Grace: Bestätigungsdialog mit Tarif-Hinweis und "Trotzdem anlegen"
        presentGraceDialog(konfiData, err.response?.data);
      } else if (errorCode === 'limit_exceeded') {
        // 403 Hard-Block: nur Hinweis, kein Override
        const nextTier = err.response?.data?.next_tier;
        const tarifHinweis = nextTier
          ? `Der nächste Tarif gibt dir Platz für bis zu ${nextTier} Konfis.`
          : 'Bitte wende dich an den Support für ein passendes Angebot.';
        presentAlert({
          header: 'Tarif-Upgrade nötig',
          message: `Das Konfi-Limit ist ausgeschöpft. Um weitere Konfis anzulegen, ist ein Tarif-Upgrade nötig. ${tarifHinweis}`,
          buttons: [{ text: 'Verstanden', role: 'cancel' }]
        });
      } else if (err.response?.status === 409) {
        // Username-Kollision (unverändert)
        setError('Ein Konfi mit diesem Namen existiert bereits.');
      } else {
        setError(err.response?.data?.error || 'Fehler beim Hinzufügen des Konfis');
      }
    }
  };

  const createOrJoinJahrgangChat = async (jahrgangId: number, konfiId: number) => {
    try {
      // Finde den Jahrgang-Namen
      const jahrgangResponse = await api.get(`/admin/jahrgaenge/${jahrgangId}`);
      const jahrgangName = jahrgangResponse.data.name;
      
      // Erstelle oder finde existierenden Jahrgangschat
      await api.post('/chat/rooms', {
        type: 'jahrgang',
        name: `Jahrgang ${jahrgangName}`,
        jahrgang_id: jahrgangId
      });
      
    } catch (err) {
 console.error('Fehler beim Jahrgangschat:', err);
      // Nicht als kritischer Fehler behandeln, da der Konfi bereits erstellt wurde
    }
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <OrgSwitcherButton />
          <IonTitle>Konfirmand:innen</IonTitle>
          <IonButtons slot="end">
            {['org_admin', 'admin'].includes(user?.role_name || '') && (
              <>
                <IonButton onClick={() => presentMatrixModal({ presentingElement: presentingElement })}>
                  <IonIcon icon={checkboxOutline} />
                </IonButton>
                <IonButton onClick={presentKonfiModal}>
                  <IonIcon icon={add} />
                </IonButton>
              </>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Konfirmand:innen</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          refreshAll();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>
        
        {loading ? (
          <LoadingSpinner message="Konfis werden geladen..." />
        ) : (
          <KonfisView 
            konfis={konfis || []}
            jahrgaenge={jahrgaenge || []}
            settings={settings || {}}
            onUpdate={refreshAll}
            onAddKonfiClick={presentKonfiModal}
            onSelectKonfi={handleSelectKonfi}
            onDeleteKonfi={handleDeleteKonfi}
            onDeleteTeamer={handleDeleteTeamer}
            selectedKonfiId={selectedKonfiId}
          />
        )}
      </IonContent>

      {showOnboarding && (
        <AdminOnboardingModal
          onClose={closeOnboarding}
          displayName={(user?.display_name || '').split(' ')[0]}
        />
      )}
    </IonPage>
  );
};

export default AdminKonfisPage;