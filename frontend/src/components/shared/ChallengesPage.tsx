import React, { useState, useRef, useMemo, useEffect } from 'react';
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
import { ICON_HINZUFUEGEN_GEFUELLT } from './icons';
import AppKopfzeile, { AppKopfzeileGross } from './AppKopfzeile';
import { useBadge } from '../../contexts/BadgeContext';
import { useModalPage } from '../../contexts/ModalContext';
import { useLiveRefresh } from '../../contexts/LiveUpdateContext';
import api from '../../services/api';
import { useOfflineQuery } from '../../hooks/useOfflineQuery';
import { useChallengeDelete } from '../../hooks/useChallengeDelete';
import { CACHE_TTL } from '../../services/offlineCache';
import LoadingSpinner from '../common/LoadingSpinner';
import ChallengesManageView, { getChallengeStatus } from '../admin/views/ChallengesManageView';
import ChallengeManageModal from '../admin/modals/ChallengeManageModal';
import ChallengeLeitungModal from '../admin/modals/ChallengeLeitungModal';
import { triggerPullHaptic } from '../../utils/haptics';
import type { AdminChallenge, ChallengeMark } from '../../types/challenges';
import { mitBewahrtenStempeln } from '../../utils/bewahrteStempel';
import { useApp } from '../../contexts/AppContext';

// Die beiden Dateien bleiben als duenne Huellen bestehen, damit Routen und
// Importpfade unveraendert sind.
interface ChallengesPageProps {
  // Trennt die Zwischenspeicher der Rollen. Die Teamer-Sicht haengt zusaetzlich
  // an der Person, weil das Backend nach zugewiesenen Jahrgaengen filtert —
  // zwei Teamer:innen derselben Organisation sehen NICHT dasselbe.
  cacheKey: string;
  // Eigene Modal-Seiten-ID je Rolle (useModalPage verwaltet den Stapel).
  modalPageId: string;
}

/**
 * WIE DER FEHLER ENTSTAND: Die Ableitung darunter hat die Rechnung aus
 * GET /challenges/konfi uebernommen (`has_badge` -> erhalten, sonst mit
 * badge_name -> offen), aber nicht deren VORBEDINGUNG. Dort steht im SQL
 * `is_draft = false AND starts_at <= NOW()`; die Konfi-Ansicht bekommt also
 * nie einen Entwurf zu sehen. GET /challenges/admin liefert dagegen
 * absichtlich JEDE Challenge der Gemeinde -- die Verwaltung muss Entwuerfe
 * bearbeiten koennen. Dieselbe Datei zeigte eine Challenge damit oben
 * korrekt im Reiter "Geplant" und unten gleichzeitig als Stempel, den es zu
 * holen gaebe.
 *
 * 'active' | 'ended' ist genau das Gegenstueck zum SQL-WHERE: 'draft' und
 * 'scheduled' sind die einzigen anderen Werte (siehe deriveStatus im
 * Backend bzw. getChallengeStatus nebenan).
 */
export const gehoertInsStempelraster = (
  c: Pick<AdminChallenge, 'is_draft' | 'starts_at' | 'ends_at'>,
  jetzt: number = Date.now()
): boolean => {
  const status = getChallengeStatus(c as AdminChallenge, jetzt);
  return status === 'active' || status === 'ended';
};

const ChallengesPage: React.FC<ChallengesPageProps> = ({ cacheKey, modalPageId }) => {
  // pendingChallengesByChallenge: offene Freigaben je Challenge fuer das
  // orange Eck-Badge am Listeneintrag -- dieselbe Quelle wie
  // der Reiter, statt pending_count aus der nur bei Aktion neu geladenen Liste.
  // challengeNeueBeitraegeByChallenge: neue Beitraege seit dem letzten
  // Oeffnen, wartende eingeschlossen -- die rote Kugel am
  // Symbol; markChallengeAsRead setzt sie beim Oeffnen und Schliessen der
  // Challenge zurueck. challengeUpdatesByChallenge (neue freigegebene) nur
  // noch fuer den Rueckfall, wenn der Server das neue Feld nicht liefert.
  const {
    refreshAllCounts,
    pendingChallengesByChallenge,
    challengeUpdatesByChallenge,
    challengeNeueBeitraegeByChallenge,
    challengeNeueWartendByChallenge,
    markChallengeAsRead
  } = useBadge();
  const { pageRef, presentingElement } = useModalPage(modalPageId);
  const { user } = useApp();

  const [ohneJahrgang, setOhneJahrgang] = useState(false);

  const { data: challenges, loading, refresh: refreshChallenges, refreshLive: refreshChallengesLive } = useOfflineQuery<AdminChallenge[]>(
    cacheKey,
    async () => {
      const res = await api.get('/challenges/admin');
      setOhneJahrgang(res.headers?.['x-kein-jahrgang-zugewiesen'] === 'true');
      return res.data;
    },
    { ttl: CACHE_TTL.REQUESTS }
  );

  const [presentAlert] = useIonAlert();

  // Stempel aus Challenges, die es nicht mehr gibt: Loescht die
  // Leitung einen Jahrgang, gehen seine Challenges mit -- die Stempel des
  // Teams daraus bewahrt der Server auf. In GET /challenges/admin stehen sie
  // nicht mehr (die Challenge ist weg), deshalb eine eigene, kleine Abfrage.
  // Ein aelterer Server kennt die Route nicht: dann bleibt es bei den
  // abgeleiteten Stempeln (mitBewahrtenStempeln nimmt alles Nicht-Array als
  // leer).
  const { data: bewahrteStempel, refreshLive: refreshBewahrteLive } = useOfflineQuery<ChallengeMark[]>(
    `challenges:bewahrte-stempel:${user?.organization_id}:${user?.id}`,
    async () => (await api.get('/challenges/bewahrte-stempel')).data,
    { ttl: CACHE_TTL.REQUESTS }
  );

  // Eigene Stempel aus der EINEN Liste ableiten: has_badge liefert
  // GET /challenges/admin seit der Zusammenlegung mit (11.08.) — dadurch
  // braucht es keinen zweiten Endpunkt für die Teilnehmer-Sicht.
  const abgeleiteteMarks = useMemo(
    () => (Array.isArray(challenges) ? challenges : [])
      .filter((c) => c.has_badge && gehoertInsStempelraster(c))
      .map((c) => ({
        challenge_id: c.id,
        badge_icon: c.badge_icon,
        badge_name: c.badge_name,
        title: c.title,
        // earned_at und description gehoeren zum Stempel, nicht nur zur
        // Kachel: Das Popover zeigt daraus "Erhalten am ..." und den Text.
        // Ohne sie stand dort eine leere Karte.
        earned_at: c.earned_at ?? null,
        description: c.description ?? null
      })),
    [challenges]
  );
  const marks = useMemo(
    () => mitBewahrtenStempeln(abgeleiteteMarks, bewahrteStempel),
    [abgeleiteteMarks, bewahrteStempel]
  );

  // Die NOCH NICHT erhaltenen Stempel — dieselbe Rechnung wie in der
  // Konfi-Liste (backend/routes/challenges.js, GET /challenges/konfi:
  // `if (has_badge) marks.push(...) else if (badge_name) offene.push(...)`).
  //
  // Angezeigt wird das Ergebnis von ChallengeStempelSektion — DERSELBEN
  // Komponente, aus der auch Konfi-Ansicht (konfi/views/ChallengesView.tsx)
  // und Leitungs-Detailansicht (admin/views/KonfiDetailView.tsx) lesen.
  const offeneStempel = useMemo(
    () => (Array.isArray(challenges) ? challenges : [])
      .filter((c) => !c.has_badge && !!c.badge_name && gehoertInsStempelraster(c))
      .map((c) => ({
        challenge_id: c.id,
        badge_icon: c.badge_icon,
        badge_name: c.badge_name,
        title: c.title,
        description: c.description ?? null,
        status: c.status,
        ends_at: c.ends_at ?? null
      })),
    [challenges]
  );

  // Aktuell im Modal bearbeitete/moderierte Challenge
  const [editChallenge, setEditChallenge] = useState<AdminChallenge | null>(null);
  const [moderationChallenge, setModerationChallenge] = useState<AdminChallenge | null>(null);

  // "Ungespeicherte Änderungen"-Stand des Formular-Modals, damit canDismiss
  // auch Swipe-/Backdrop-Schliessen abfangen kann.
  const manageDirtyRef = useRef(false);

  // WICHTIG: Beim Schliessen wird der Challenge-State NICHT auf null gesetzt.
  // useIonModal rendert das Modal während der Dismiss-Animation weiter — ein
  // null-Render liefe dort in die ErrorBoundary (clearAuth => "Rauswurf zur
  // Anmeldung"). Der State wird beim nächsten Oeffnen ohnehin neu gesetzt.
  const [presentManageModal, dismissManageModal] = useIonModal(ChallengeManageModal, {
    challenge: editChallenge,
    onDirtyChange: (dirty: boolean) => { manageDirtyRef.current = dirty; },
    onClose: () => { dismissManageModal(); },
    onSuccess: () => {
      dismissManageModal();
      refreshChallenges();
    }
  });

  const [presentModerationModal, dismissModerationModal] = useIonModal(ChallengeLeitungModal, {
    challenge: moderationChallenge,
    onEdit: (challenge: AdminChallenge) => openEdit(challenge),
    // Für die Card-Optik des Einreichen-Modals (schiebt die Seite nach hinten).
    get presentingElement() { return pageRef.current || presentingElement; },
    onClose: () => {
      dismissModerationModal();
      // Was waehrend des Ansehens hereinkam, hat man gesehen -- wie im Chat
      // beim Verlassen des Raums.
      if (moderationChallenge) void gesehen(moderationChallenge);
    },
    onChanged: () => {
      refreshChallenges();
      // Tab-Badge (offene Freigaben) direkt nachziehen.
      refreshAllCounts();
    }
  });

  const manageCanDismiss = async (): Promise<boolean> => {
    if (!manageDirtyRef.current) return true;
    return new Promise<boolean>((resolve) => {
      let decided = false;
      const decide = (v: boolean) => { decided = true; resolve(v); };
      presentAlert({
        header: 'Ungespeicherte Änderungen',
        message: 'Möchtest du die Änderungen verwerfen?',
        backdropDismiss: false,
        buttons: [
          { text: 'Abbrechen', role: 'cancel', handler: () => decide(false) },
          { text: 'Verwerfen', role: 'destructive', handler: () => decide(true) }
        ],
        onDidDismiss: () => { if (!decided) resolve(false); }
      });
    });
  };

  useLiveRefresh('challenges', refreshChallengesLive);
  useLiveRefresh('challenges', refreshBewahrteLive);

  // Die geöffnete Beitrags-Ansicht hält ihre Challenge als eigenen State.
  // Nach einem Bearbeiten (oder Live-Refresh) käme sonst weiter der alte
  // Stand (Titel, Beschreibung, Sperr-Urteil) zur Anzeige — deshalb hier mit
  // der frisch geladenen Liste abgleichen.
  useEffect(() => {
    if (!moderationChallenge || !Array.isArray(challenges)) return;
    const fresh = challenges.find((c) => c.id === moderationChallenge.id);
    if (fresh && fresh !== moderationChallenge) setModerationChallenge(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenges]);

  const openCreate = () => {
    setEditChallenge(null);
    presentManageModal({
      presentingElement: presentingElement,
      canDismiss: manageCanDismiss,
      backdropDismiss: false
    });
  };

  const openEdit = (challenge: AdminChallenge) => {
    setEditChallenge(challenge);
    presentManageModal({
      presentingElement: presentingElement,
      canDismiss: manageCanDismiss,
      backdropDismiss: false
    });
  };

  // Eine gestartete Challenge als gesehen melden und die Zaehler nachziehen.
  // Entwuerfe und geplante haben keine Beitraege; dort gibt es nichts zu melden.
  const gesehen = async (challenge: AdminChallenge) => {
    const status = getChallengeStatus(challenge);
    if (status !== 'active' && status !== 'ended') return;
    await markChallengeAsRead(challenge.id);
    refreshAllCounts();
  };

  const openModeration = (challenge: AdminChallenge) => {
    setModerationChallenge(challenge);
    presentModerationModal({ presentingElement: presentingElement });
    void gesehen(challenge);
  };

  const { handleDelete } = useChallengeDelete({ onDeleted: refreshChallenges });

  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile
        titel="Challenges"
        rechts={(
          <IonButton aria-label="Neue Challenge anlegen" onClick={openCreate} title="Neue Challenge">
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
          </IonButton>
        )}
      />
      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Challenges" />

        <IonRefresher
          slot="fixed"
          onIonRefresh={(e) => { refreshChallenges(); e.detail.complete(); }}
          onIonPull={triggerPullHaptic}
        >
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Challenges werden geladen..." />
        ) : (
          <ChallengesManageView
            challenges={challenges || []}
            ohneJahrgang={ohneJahrgang}
            marks={marks}
            offeneStempel={offeneStempel}
            offeneFreigaben={pendingChallengesByChallenge}
            neuigkeiten={challengeUpdatesByChallenge}
            neueBeitraege={challengeNeueBeitraegeByChallenge ?? undefined}
            neueWartend={challengeNeueWartendByChallenge}
            onSelectChallenge={openModeration}
            onEditChallenge={openEdit}
            onDeleteChallenge={handleDelete}
            presentingElement={pageRef.current || presentingElement}
          />
        )}
      </IonContent>
    </IonPage>
  );
};

export default ChallengesPage;
