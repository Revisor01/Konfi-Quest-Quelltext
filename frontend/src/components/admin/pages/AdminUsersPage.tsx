import { ICON_PERSON_HINZUFUEGEN_GEFUELLT, ICON_HINZUFUEGEN_GEFUELLT } from '../../shared/icons';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import { fehlerText } from '../../../utils/fehler';
import React, { useCallback, useState } from 'react';
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
import { teamKontoLoeschHinweis } from '../../../utils/kontoLoeschen';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import UsersView from '../UsersView';
import OffeneEinladungen from '../OffeneEinladungen';
import LoadingSpinner from '../../common/LoadingSpinner';
import EinladungModal from '../modals/EinladungModal';
import UserManagementModal from '../modals/UserManagementModal';
import { AdminUser } from '../../../types/user';
import { triggerPullHaptic } from '../../../utils/haptics';

const AdminUsersPage: React.FC = () => {
  const { setError, setSuccess, user, isOnline } = useApp();
  const { pageRef, presentingElement } = useModalPage('admin-users');
  
  // Offline-Query: Users
  const { data: users, loading, refresh: refreshUsers, refreshLive: refreshUsersLive } = useOfflineQuery<AdminUser[]>(
    'admin:users:' + user?.organization_id,
    async () => { const res = await api.get('/users'); return res.data; },
    { ttl: CACHE_TTL.KONFIS }
  );
  
  // Offene Einladungen: Der Abschnitt laedt selbst; hochzaehlen
  // heisst "neu laden" -- nach einer neuen Einladung, beim Live-Signal
  // 'users' (eine Zusage verschiebt die Person in die Liste) und beim Ziehen
  // zum Aktualisieren.
  const [einladungenStand, setEinladungenStand] = useState(0);
  const einladungenNeuLaden = useCallback(() => setEinladungenStand((n) => n + 1), []);
  const allesNeuLaden = useCallback(() => {
    refreshUsers();
    einladungenNeuLaden();
  }, [refreshUsers, einladungenNeuLaden]);

  // Modal state
  const [modalUserId, setModalUserId] = useState<number | null>(null);

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  // Einladung einer BESTEHENDEN Person in diese Gemeinde --
  // getrennt vom Anlegen, weil es etwas anderes tut: Hier entsteht kein Konto,
  // sondern eine Anfrage an jemanden, der schon eins hat.
  const [presentEinladungHook, dismissEinladungHook] = useIonModal(EinladungModal, {
    onClose: () => dismissEinladungHook(),
    onSuccess: () => { dismissEinladungHook(); allesNeuLaden(); }
  });

  const [presentUserModalHook, dismissUserModalHook] = useIonModal(UserManagementModal, {
    userId: modalUserId,
    onClose: () => {
      dismissUserModalHook();
      setModalUserId(null);
    },
    onSuccess: () => {
      dismissUserModalHook();
      setModalUserId(null);
      refreshUsers();
    }
  });

  // Subscribe to live updates for users
  useLiveRefresh('users', useCallback(() => {
    refreshUsersLive();
    einladungenNeuLaden();
  }, [refreshUsersLive, einladungenNeuLaden]));

  const handleDeleteUser = async (userToDelete: AdminUser) => {
    if (offlineBlockiert(isOnline, setError)) return;
    const person = `"${userToDelete.display_name}" (@${userToDelete.username})`;
    // Die Sicherheitsabfrage sagt, was DELETE /users/:id wirklich tut -- drei
    // Faelle wie im Backend:
    //  - 'weitere': Die Person ist anderswo zuhause und arbeitet hier ueber eine
    //    Gemeinde-Einladung mit. Es endet nur die Mitgliedschaft hier.
    //  - 'stamm' mit weiteren Gemeinden: Sie ist hier zuhause, aber auch
    //    anderswo Mitglied. Sie wird nur aus dieser Gemeinde entfernt, ihr
    //    Konto bleibt in der anderen.
    //  - sonst: Das Konto wird geloescht.
    // In den ersten beiden Faellen bleibt das Konto -- der Knopf heisst dann
    // "Entfernen", sonst klaenge es nach Kontoloeschung.
    const weitere = userToDelete.mitgliedschaft === 'weitere';
    const kontoBleibt = weitere || (userToDelete.weitere_gemeinden ?? 0) > 0;
    const abfrage = weitere
      ? {
          header: 'Mitgliedschaft beenden',
          message: `${person} aus dieser Gemeinde entfernen? Das Konto und die Stamm-Gemeinde bleiben bestehen.`
        }
      : kontoBleibt
        ? {
            header: 'Aus der Gemeinde entfernen',
            message: `${person} ist auch in einer anderen Gemeinde Mitglied. Du entfernst die Person nur aus deiner Gemeinde; ihr Konto bleibt dort bestehen.`
          }
        : {
            header: 'Benutzer löschen',
            message: `Benutzer ${person} wirklich löschen?\n\n${teamKontoLoeschHinweis()}`
          };
    presentAlert({
      ...abfrage,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: kontoBleibt ? 'Entfernen' : 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              const res = await api.delete(`/users/${userToDelete.id}`);
              // Die Meldung kommt vom Server -- er weiss, ob das Konto blieb.
              if (res?.data?.message) setSuccess(res.data.message);
              await refreshUsers();
            } catch (err) {
              setError(fehlerText(err, kontoBleibt ? 'Fehler beim Entfernen aus der Gemeinde' : 'Fehler beim Löschen des Benutzers'));
            }
          }
        }
      ]
    });
  };

  const handleSelectUser = (user: AdminUser) => {
    setModalUserId(user.id);
    presentUserModalHook({
      presentingElement: presentingElement
    });
  };

  const presentUserModal = () => {
    setModalUserId(null);
    presentUserModalHook({
      presentingElement: presentingElement
    });
  };

  return (
    <IonPage ref={pageRef}>
      {/* Kein Gemeinde-Umschalter auf dieser Unterseite. */}
      <AppKopfzeile
        titel="Benutzer:innen"
        onZurueck={() => window.history.back()}
        gemeindeUmschalter={false}
        rechts={user?.role_name === 'org_admin' ? (
          <>
            {/* Eine Person, die schon ein Konto hat, in diese Gemeinde
                einladen. Sie entscheidet selbst. */}
            <IonButton aria-label="Person in diese Gemeinde einladen" onClick={() => presentEinladungHook({ presentingElement })}>
              <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} slot="icon-only" />
            </IonButton>
          <IonButton aria-label="Neue Benutzer:in anlegen" onClick={presentUserModal}>
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
          </IonButton>
          </>
        ) : undefined}
      />
      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Benutzer:innen" />
        
        <IonRefresher slot="fixed" onIonRefresh={(e) => {
          allesNeuLaden();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>
        
        {loading ? (
          <LoadingSpinner message="Benutzer werden geladen..." />
        ) : (
          <>
            <UsersView
              users={users || []}
              onUpdate={allesNeuLaden}
              onSelectUser={handleSelectUser}
              onDeleteUser={handleDeleteUser}
              darfVerwalten={user?.role_name === 'org_admin'}
            />
            {/* Offene Einladungen einsehen und zurueckziehen -- nur, wer auch
                einladen darf: dieselbe Bedingung wie beim Einladen-Knopf oben
                (requireOrgAdmin in routes/einladungen.js). Leer blendet sich
                der Abschnitt aus. */}
            {user?.role_name === 'org_admin' && <OffeneEinladungen aktualisierung={einladungenStand} />}
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminUsersPage;