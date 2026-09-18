import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonPage,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner,
  IonList,
  IonListHeader,
  IonLabel,
  IonCard,
  IonCardContent,
  IonSegment,
  IonSegmentButton,
  IonRefresher,
  IonRefresherContent,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  useIonAlert,
  useIonActionSheet,
  useIonModal
} from '@ionic/react';
import {
  ICON_ALBEN,
  ICON_BEARBEITEN,
  ICON_BILD,
  ICON_CHALLENGE_GEFUELLT,
  ICON_ENTFERNEN,
  ICON_HAKEN,
  ICON_HINZUFUEGEN,
  ICON_LINK,
  ICON_LOESCHEN,
  ICON_MIKROFON,
  ICON_PERSON,
  ICON_SCHLIESSEN,
  ICON_SICHTBAR,
  ICON_SPERRE,
  ICON_TEILEN,
  ICON_TEXTDOKUMENT,
  ICON_UHRZEIT,
  ICON_VERBORGEN,
  ICON_VIDEO,
  ICON_ZUSAGE,
} from '../../shared/icons';
import { Capacitor } from '@capacitor/core';
import { teilen } from '../../../services/systemDialoge';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { useApp } from '../../../contexts/AppContext';
import api, { DATEI_TIMEOUT_MS } from '../../../services/api';
import { EmptyState, SectionHeader, AudioPlayer } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { istWebLink } from '../../../utils/linkDisplay';
import MusikLink from '../../shared/MusikLink';
import ChallengeSubmitModal from '../../konfi/modals/ChallengeSubmitModal';
import { getChallengeStatus } from '../views/ChallengesManageView';
import { anzahlBeitraege } from '../../../utils/challengeTexte';
import { trackHandlung } from '../../../services/analytics';
import type {
  AdminChallenge,
  KonfiChallenge,
  ChallengeSubmission
} from '../../../types/challenges';

// Die vier Moderations-Aktionen als grobe Messwerte. Fest verdrahtet, damit
// nie ein technischer Bezeichner aus dem Backend an die Messung durchrutscht.
const MODERATION_MESSWERT: Record<'approve' | 'hide' | 'unhide' | 'anonymize', string> = {
  approve: 'freigegeben',
  hide: 'ausgeblendet',
  unhide: 'wieder-sichtbar',
  anonymize: 'anonymisiert'
};

// VEREINTES Challenge-Detail für Leitung und Teamer:innen (11.08.): Verwalten
// UND Mitmachen in EINEM Modal, statt eines Segments, das die ganze Seite
// umschaltet. Enthaelt die Moderation aus ChallengeModerationModal und den
// Abschnitt "Dein Beitrag" aus der Konfi-Detailansicht.
//
// Die beiden Ursprungs-Modals bleiben unverändert bestehen:
// ChallengeDetailModal wird weiterhin von Konfis genutzt.

// Medienvorschau für Challenge-Beitraege (Foto/Audio/Video). Bewusst eine
// eigene, schlanke Variante statt des Chat-LazyImage: der mediaCache-Service
// ist fest auf /chat/files/ verdrahtet, Challenges liegen unter
// /challenges/files/. Geladen wird per axios (Auth-Header) in eine
// Object-URL, freigegeben beim Unmount.
const ChallengeMedia: React.FC<{
  filePath: string;
  fileName?: string | null;
  mediaType: 'photo' | 'audio' | 'video';
}> = ({ filePath, fileName, mediaType }) => {
  const [src, setSrc] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    (async () => {
      try {
        const res = await api.get(`/challenges/files/${filePath}`, { responseType: 'blob', timeout: DATEI_TIMEOUT_MS });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath]);

  if (failed) {
    return (
      <div style={{ padding: 'var(--app-abstand-mittel)', color: 'var(--app-text-muted)', fontSize: 'var(--app-text-hinweis)' }}>
        Datei konnte nicht geladen werden
      </div>
    );
  }

  if (!src) {
    return (
      <div
        style={{
          marginTop: 'var(--app-abstand-eng)',
          borderRadius: 'var(--app-radius-knopf)',
          background: 'var(--app-surface-dim)',
          minHeight: '80px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <span style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-sekundaer)' }}>Wird geladen...</span>
      </div>
    );
  }

  if (mediaType === 'photo') {
    return (
      <div style={{ marginTop: 'var(--app-abstand-eng)', borderRadius: 'var(--app-radius-knopf)', overflow: 'hidden' }}>
        <img
          src={src}
          alt={fileName || 'Beitrag'}
          style={{ width: '100%', maxHeight: '260px', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }

  if (mediaType === 'video') {
    return (
      <video
        src={src}
        controls
        playsInline
        style={{ width: '100%', maxHeight: '260px', marginTop: 'var(--app-abstand-eng)', borderRadius: 'var(--app-radius-knopf)', display: 'block' }}
      />
    );
  }

  // audio
  return <AudioPlayer src={src} />;
};

const MEDIA_ICON: Record<string, string> = {
  text: ICON_TEXTDOKUMENT,
  photo: ICON_BILD,
  audio: ICON_MIKROFON,
  video: ICON_VIDEO,
  link: ICON_LINK
};

// Icon/Farb-Zuordnung für Corner-Badges — dieselbe Zuordnung wie in
// ChallengeModerationModal und getOwnStatus (Konfi-Seite), damit Status
// ueberall gleich aussieht.
const STATUS_BADGE: Record<string, { label: string; icon: string; color: string }> = {
  pending: { label: 'Wartet auf Freigabe', icon: ICON_UHRZEIT, color: 'var(--app-color-warning)' },
  approved: { label: 'Freigegeben', icon: ICON_HAKEN, color: 'var(--app-color-success-strong)' },
  hidden: { label: 'Ausgeblendet', icon: ICON_ENTFERNEN, color: 'var(--app-color-danger)' }
};

// Konsens NIE mit einem Haken darstellen: der Haken gehört allein dem
// Freigabe-STATUS; der Konsens spricht in Augen-Metaphorik.
const CONSENT_BADGE: Record<string, { label: string; icon: string; color: string }> = {
  publish: { label: 'Mit Namen sichtbar', icon: ICON_SICHTBAR, color: 'var(--app-color-success-strong)' },
  private: { label: 'Nur Leitung', icon: ICON_SPERRE, color: 'var(--app-color-neutral)' },
  anonymous: { label: 'Anonym sichtbar', icon: ICON_VERBORGEN, color: 'var(--app-color-wrapped)' }
};

/**
 * Status-Badge unter Berücksichtigung der Sichtbarkeit.
 *
 * "Freigegeben" mit gruenem Haken hiess bisher nur: die Leitung hat den Beitrag
 * durchgewinkt. Ob ihn danach überhaupt jemand außer der Leitung sieht, stand
 * allein im zweiten Badge — ein freigegebener Beitrag mit consent='private' trug
 * also einen gruenen Haken, obwohl er nirgends erscheint (User-Hinweis 11.08.).
 * Jetzt schlägt die Sichtbarkeit den Haken: bleibt der Beitrag bei der Leitung,
 * zeigt das Badge das Schloss.
 */
const getStatusBadge = (
  submission: ChallengeSubmission,
  challenge: AdminChallenge
): { label: string; icon: string; color: string } => {
  const basis = STATUS_BADGE[submission.moderation_status] || STATUS_BADGE.pending;
  if (submission.moderation_status !== 'approved') return basis;
  // Freigegeben, aber nicht oeffentlich: Challenge ist 'private' ODER der Konfi
  // hat sich beim Einreichen gegen die Galerie entschieden.
  const bleibtBeiDerLeitung =
    challenge.visibility === 'private' || submission.konfi_consent === 'private';
  if (bleibtBeiDerLeitung) {
    return { label: 'Freigegeben, nur Leitung', icon: ICON_SPERRE, color: 'var(--app-color-neutral)' };
  }
  return basis;
};

const buildVisibilitySubtitle = (challenge: AdminChallenge): string => {
  const sichtbarkeit = challenge.visibility === 'public'
    ? 'sofort sichtbar'
    : challenge.visibility === 'private'
      ? 'nur Leitung'
      : 'Konfi entscheidet';
  // Bei 'private' ist die Freigabe für die Gruppe bedeutungslos — dort gibt es
  // keine Galerie, in der etwas erscheinen könnte.
  if (challenge.visibility === 'private') return `Sichtbarkeit: ${sichtbarkeit}`;
  return `Sichtbarkeit: ${sichtbarkeit} · Moderiert: ${challenge.moderated ? 'ja' : 'nein'}`;
};

const formatDateTime = (value?: string) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};

export interface ChallengeLeitungModalProps {
  // NULL-SICHER: Die Seite dahinter fuehrt die Challenge als State und rendert
  // dieses Modal über useIonModal auch während der Dismiss-Animation weiter.
  // Wuerde der State dort auf null gesetzt (oder ein kaputter Cache ein
  // undefined liefern), darf das hier NICHT werfen — ein Render-Fehler landet
  // sonst in der ErrorBoundary, die Auth + Cache leert ("Rauswurf zur Anmeldung").
  challenge?: AdminChallenge | null;
  onClose: () => void;
  onEdit?: (challenge: AdminChallenge) => void;
  // Wird nach jeder Moderations-Aktion und nach eigenem Einreichen gerufen,
  // damit die Liste dahinter (Pending-Zähler) aktuell bleibt.
  onChanged?: () => void;
  /**
   * Element für die Card-Optik des Einreichen-Modals. Ohne dieses schiebt die
   * Ansicht darunter nicht nach hinten, das Sheet legt sich hart darueber
   * (User-Hinweis 11.08.).
   */
  presentingElement?: HTMLElement | null;
}

type StatusFilter = 'feed' | 'pending' | 'hidden' | 'meins';

const ChallengeLeitungModal: React.FC<ChallengeLeitungModalProps> = ({
  challenge,
  onClose,
  onEdit,
  onChanged,
  presentingElement
}) => {
  const { user, setError, setSuccess } = useApp();
  const [presentAlert] = useIonAlert();
  const [presentActionSheet] = useIonActionSheet();
  const [submissions, setSubmissions] = useState<ChallengeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('feed');

  const challengeId = challenge?.id;

  const loadSubmissions = useCallback(async () => {
    if (!challengeId) return;
    try {
      const res = await api.get(`/challenges/admin/${challengeId}/submissions`);
      // Backend liefert { challenge, submissions } — die Liste daraus ziehen und
      // den Konfi-Namen aus display_name normalisieren.
      const raw = Array.isArray(res.data) ? res.data : (res.data?.submissions || []);
      setSubmissions(
        // display_name ist die Altform des Namensfeldes — deshalb hier
        // zusaetzlich zum Typ des Beitrags aufgefuehrt.
        raw.map((row: ChallengeSubmission & { display_name?: string | null }) => ({
          ...row,
          konfi_name: row.konfi_name ?? row.display_name ?? null
        }))
      );
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Laden der Beiträge'));
    } finally {
      setLoading(false);
    }
  }, [challengeId, setError]);

  useEffect(() => {
    setLoading(true);
    loadSubmissions();
  }, [loadSubmissions]);

  // Einreich-Modal: erwartet eine KonfiChallenge. Die AdminChallenge erweitert
  // dieselbe Basis (ChallengeBase) und trägt alle vom Formular gelesenen
  // Felder (allowed_media, visibility, moderated) — deshalb genuegt die
  // Zuweisung ohne Nachbau.
  const submitChallenge: KonfiChallenge | null = challenge ?? null;

  const [presentSubmitModal, dismissSubmitModal] = useIonModal(ChallengeSubmitModal, {
    challenge: submitChallenge,
    onClose: () => { dismissSubmitModal(); },
    onSuccess: () => {
      dismissSubmitModal();
      loadSubmissions();
      onChanged?.();
    }
  });

  const counts = useMemo(() => ({
    total: submissions.length,
    pending: submissions.filter((s) => s.moderation_status === 'pending').length,
    approved: submissions.filter((s) => s.moderation_status === 'approved').length,
    hidden: submissions.filter((s) => s.moderation_status === 'hidden').length
  }), [submissions]);

  // GENAU DREI Kacheln — nie mehr (harte Gestaltungsregel).
  // "Freigegeben" steht immer. Die beiden anderen Plaetze gehen an das, was
  // gerade etwas aussagt:
  //   - "Wartet" nur bei Freigabe-Pflicht (sonst wartet nie etwas)
  //   - "Ausgeblendet" nur wenn es ausgeblendete Beitraege gibt
  // Sind beide relevant, weicht "Gesamt" — die Gesamtzahl steht ohnehin in der
  // Listenueberschrift ("Beiträge (8)") und ist die schwaechste der Angaben.
  const headerStats = useMemo(() => {
    // Labels müssen KURZ sein: die Kachel ist auf 100px gedeckelt und das
    // Label steht in Grossbuchstaben mit Sperrung und ohne Umbruch
    // (.app-stats-row__label).
    const stats: Array<{ value: number; label: string }> = [
      { value: counts.approved, label: 'Sichtbar' }
    ];
    if (challenge?.moderated) stats.push({ value: counts.pending, label: 'Wartet' });
    if (challenge?.visibility !== 'private') {
      stats.push({ value: counts.hidden, label: 'Abgelehnt' });
    }

    // Ohne Freigabe-Pflicht bleiben nur zwei Kacheln — die Gesamtzahl fuellt
    // auf und beantwortet zugleich "wie viele Beitraege sind es insgesamt".
    // Einzahl korrekt: bei genau einem Beitrag hiess die Kachel "1 Beiträge"
    // (User-Hinweis). Der Helfer entscheidet, das Label traegt nur das Wort —
    // die Zahl steht schon als Kachelwert darueber.
    if (stats.length < 3) {
      stats.splice(1, 0, {
        value: counts.total,
        label: anzahlBeitraege(counts.total).replace(`${counts.total} `, '')
      });
    }

    // Kacheln, die einem Reiter entsprechen, schalten dorthin. "Gesamt" hat
    // keinen eigenen Reiter (die Reiter sind disjunkt) und bleibt reine Anzeige.
    const filterZuLabel: Record<string, StatusFilter> = {
      'Sichtbar': 'feed',
      'Wartet': 'pending',
      'Abgelehnt': 'hidden'
    };

    // effectiveFilter wird erst weiter unten deklariert — hier dieselbe
    // Ableitung, damit die aktive Kachel zum tatsaechlich wirksamen Reiter passt.
    const aktiverFilter: StatusFilter =
      (statusFilter === 'pending' && !challenge?.moderated) ||
      (statusFilter === 'hidden' && challenge?.visibility === 'private')
        ? 'feed' : statusFilter;

    return stats.slice(0, 3).map((s) => {
      const ziel = filterZuLabel[s.label];
      if (!ziel) return s;
      return { ...s, onClick: () => setStatusFilter(ziel), active: aktiverFilter === ziel };
    });
    // challenge?.visibility gehoert in die Abhaengigkeiten: Die Sichtbarkeit
    // ist im OFFENEN Modal aenderbar (Bearbeiten-Knopf; die ChallengesPage
    // spiegelt die frische Challenge zurueck). Ohne sie blieb die
    // "Abgelehnt"-Kachel nach dem Umstellen auf "nur Leitung" stehen,
    // solange sich counts und Filter nicht aenderten.
  }, [challenge?.moderated, challenge?.visibility, counts, statusFilter]);

  // Abgeleiteter Status — dieselbe Quelle wie die Liste. Vorher wurde hier nur
  // aktiv/inaktiv unterschieden, wodurch Entwürfe und Geplante fälschlich
  // als "Beendet" beschriftet waren; seit dem Bearbeiten-Knopf
  // ist das Modal für Entwürfe ein normaler Arbeitsweg.
  const status = challenge ? getChallengeStatus(challenge) : 'draft';
  // Laeuft die Challenge gerade? Nur dann darf man selbst einreichen.
  const isActive = status === 'active';

  // Eigene Beitraege aus derselben Liste ziehen — das Backend liefert user_id
  // in GET /challenges/admin/:id/submissions mit.
  const ownSubmissions = useMemo(() => {
    if (!user?.id) return [];
    return submissions
      .filter((s) => s.user_id === user.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [submissions, user?.id]);

  const canSubmitMore = isActive && (challenge?.allow_multiple || ownSubmissions.length === 0);

  // Ohne Freigabe-Pflicht gibt es das "Wartet"-Segment nicht — ein von einer
  // anderen Challenge uebernommener Filterstand wuerde sonst eine leere Liste
  // zeigen, ohne dass man den Grund sieht.
  const effectiveFilter: StatusFilter =
    (statusFilter === 'pending' && !challenge?.moderated) ||
    (statusFilter === 'hidden' && challenge?.visibility === 'private')
      ? 'feed' : statusFilter;

  // Die Leiste steht immer: "Feed" und "Meins" gibt es in jeder Challenge.
  // "Wartet" kommt nur mit Freigabe-Pflicht dazu, "Abgelehnt" nur, wenn es
  // eine Gruppen-Galerie gibt, aus der etwas herausgenommen werden koennte.

  const filtered = useMemo(() => {
    const active = effectiveFilter;
    const list = active === 'feed'
      ? submissions.filter((s) => s.moderation_status === 'approved')
      : active === 'meins'
        ? submissions.filter((s) => Boolean(user?.id) && s.user_id === user?.id)
        : submissions.filter((s) => s.moderation_status === active);
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [submissions, effectiveFilter, user?.id]);

  const moderate = async (
    submission: ChallengeSubmission,
    action: 'approve' | 'hide' | 'unhide' | 'anonymize',
    reason?: string
  ) => {
    setBusyId(submission.id);
    try {
      await api.put(`/challenges/admin/submissions/${submission.id}/moderate`, {
        action,
        // Begruendung nur beim Ausblenden und nur, wenn eine eingetragen wurde
        // — das Ausblenden scheitert NIE am fehlenden Grund.
        ...(reason ? { reason } : {})
      });
      // Anonyme Messung NACH der erfolgreichen Antwort: der Beitrag wurde
      // wirklich durchgesehen. Nur die Entscheidung — kein Beitrag, keine
      // Person, keine Begruendung.
      trackHandlung('beitrag-moderiert', { entscheidung: MODERATION_MESSWERT[action] });
      await loadSubmissions();
      onChanged?.();
    } catch (err) {
      setError(fehlerText(err, 'Fehler bei der Moderation'));
    } finally {
      setBusyId(null);
    }
  };

  // Anonymisieren ist endgueltig -> Rueckfrage, damit das niemand versehentlich
  // ausloest (das Backend lehnt jede Ruecknahme mit 409 ab).
  const confirmAnonymize = (submission: ChallengeSubmission) => {
    presentAlert({
      header: 'Beitrag anonym stellen',
      message: `Der Beitrag von ${submission.konfi_name || 'dieser Person'} erscheint dann ohne Namen — in der Galerie wie im Export. Das lässt sich nicht rückgängig machen; ihr in der Leitung seht weiterhin, von wem er stammt.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        { text: 'Anonym stellen', handler: () => { moderate(submission, 'anonymize'); } }
      ]
    });
  };

  const deleteSubmission = async (submission: ChallengeSubmission) => {
    setBusyId(submission.id);
    try {
      await api.delete(`/challenges/admin/submissions/${submission.id}`);
      await loadSubmissions();
      onChanged?.();
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Löschen des Beitrags'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (submission: ChallengeSubmission) => {
    presentAlert({
      header: 'Beitrag wirklich löschen?',
      message: `Der Beitrag von ${submission.konfi_name || 'dieser Person'} wird endgültig gelöscht — eine hochgeladene Datei wird mit entfernt. Das lässt sich nicht rückgängig machen. Soll der Beitrag nur aus der Gruppe verschwinden, nutze stattdessen "Ausblenden".`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Endgültig löschen',
          role: 'destructive',
          handler: () => { deleteSubmission(submission); }
        }
      ]
    });
  };

  const confirmHide = (submission: ChallengeSubmission) => {
    presentAlert({
      header: 'Beitrag ausblenden',
      message: `Der Beitrag von ${submission.konfi_name || 'dieser Person'} wird für die Gruppe nicht mehr sichtbar sein. Die einreichende Person sieht ihren Beitrag weiterhin — und die Begründung, falls du eine einträgst.`,
      inputs: [
        {
          name: 'reason',
          type: 'textarea',
          placeholder: 'Begründung (optional)',
          attributes: { maxlength: 500 }
        }
      ],
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Ausblenden',
          role: 'destructive',
          handler: (data) => {
            const reason = typeof data?.reason === 'string' ? data.reason.trim() : '';
            moderate(submission, 'hide', reason || undefined);
          }
        }
      ]
    });
  };

  // Welche Aktionen ein Beitrag gerade zulaesst — EINE Quelle für Tippen
  // (ActionSheet) und Wischen (Swipe-Icons), damit beide Wege nie auseinander
  // laufen. Reihenfolge = Reihenfolge im ActionSheet.
  const availableActions = (submission: ChallengeSubmission) => {
    const actions: Array<{
      key: 'approve' | 'anonymize' | 'hide' | 'unhide' | 'delete';
      text: string;
      icon: string;
      color: string;
      role?: 'destructive';
      run: () => void;
    }> = [];

    if (submission.moderation_status === 'pending') {
      actions.push({
        key: 'approve', text: 'Freigeben', icon: ICON_ZUSAGE,
        color: 'var(--app-color-success-strong)',
        run: () => moderate(submission, 'approve')
      });
    }
    if (submission.konfi_consent !== 'anonymous' && submission.konfi_consent !== 'private') {
      actions.push({
        key: 'anonymize', text: 'Anonym stellen', icon: ICON_VERBORGEN,
        color: 'var(--app-color-wrapped)',
        run: () => confirmAnonymize(submission)
      });
    }
    const isOwn = submission.user_id != null && submission.user_id === user?.id;
    const kannAusblenden = challenge?.visibility !== 'private';
    if (submission.moderation_status !== 'hidden') {
      if (!isOwn && kannAusblenden) {
        actions.push({
          // NICHT eyeOffOutline: das gehört dem Anonymisieren (durchgestrichenes
          // Auge = "ohne Namen"). Ausblenden nimmt dasselbe Symbol wie sein
          // Status-Badge, damit Aktion und Zustand zusammenpassen und die beiden
          // Aktionen im Menue unterscheidbar sind (User-Hinweis 11.08.).
          key: 'hide', text: 'Ausblenden', icon: ICON_ENTFERNEN,
          color: 'var(--app-color-danger)', role: 'destructive',
          run: () => confirmHide(submission)
        });
      }
    } else {
      actions.push({
        key: 'unhide', text: 'Wieder einblenden', icon: ICON_SICHTBAR,
        color: 'var(--app-color-challenges)',
        run: () => moderate(submission, 'unhide')
      });
    }
    // Endgültig löschen: Datenbank-Eintrag UND Datei. Auch für den eigenen
    // Beitrag — anders als beim Ausblenden gibt es hier nichts zu
    // verheimlichen, es ist schlicht weg.
    if (user?.type === 'admin') {
      actions.push({
        key: 'delete', text: 'Endgültig löschen', icon: ICON_LOESCHEN,
        color: 'var(--app-color-danger)', role: 'destructive',
        run: () => confirmDelete(submission)
      });
    }
    return actions;
  };

  // Tippen auf einen Beitrag oeffnet die Aktionen — dasselbe Muster wie in den
  // uebrigen Listen (Events, Konfis).
  const openActions = (submission: ChallengeSubmission) => {
    const actions = availableActions(submission);
    presentActionSheet({
      header: submission.konfi_name || 'Beitrag',
      buttons: [
        ...actions.map((a) => ({
          text: a.text,
          role: a.role,
          handler: () => { a.run(); }
        })),
        { text: 'Abbrechen', role: 'cancel' }
      ]
    });
  };

  const handleExport = async () => {
    if (!challenge) return;
    try {
      const res = await api.get(`/challenges/admin/${challenge.id}/export`, { responseType: 'text' });
      const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      if (!text.trim()) {
        setError('Es gibt noch keine Texte oder Links zum Exportieren.');
        return;
      }

      const fileName = `challenge-${challenge.id}-beitraege.txt`;

      if (Capacitor.isNativePlatform()) {
        await Filesystem.writeFile({
          path: fileName,
          data: text,
          directory: Directory.Cache,
          encoding: Encoding.UTF8
        });
        const uri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
        await teilen({ title: challenge.title, files: [uri.uri] });
      } else {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setSuccess('Export heruntergeladen');
      }
    } catch (err) {
      // Abgebrochenes Share-Sheet ist kein Fehler
      if (err instanceof Error && err.message && /cancel/i.test(err.message)) return;
      setError(fehlerText(err, 'Export fehlgeschlagen'));
    }
  };

  // Nach den Hooks (Hook-Reihenfolge!): ohne Challenge nichts rendern statt werfen.
  if (!challenge) {
    return null;
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Challenge</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={onClose} className="app-modal-close-btn" aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            {onEdit && (
              <IonButton
                onClick={() => onEdit(challenge)}
                title="Challenge bearbeiten"
                aria-label="Challenge bearbeiten"
              >
                <IonIcon icon={ICON_BEARBEITEN} slot="icon-only" />
              </IonButton>
            )}
            {/* Selbst mitmachen — nur solange die Challenge laeuft */}
            {canSubmitMore && (
              <IonButton
                onClick={() => presentSubmitModal({ presentingElement: presentingElement || undefined })}
                title="Beitrag einreichen"
                aria-label="Beitrag einreichen"
              >
                <IonIcon icon={ICON_HINZUFUEGEN} slot="icon-only" />
              </IonButton>
            )}
            <IonButton onClick={handleExport} title="Beiträge exportieren" aria-label="Beiträge exportieren">
              <IonIcon icon={ICON_TEILEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e) => { await loadSubmissions(); e.detail.complete(); }}
          onIonPull={triggerPullHaptic}
        >
          <IonRefresherContent />
        </IonRefresher>

        {/* Kopf: Challenge-Info — IMMER GENAU DREI Kacheln (harte Regel). */}
        <SectionHeader
          title={challenge.title}
          subtitle={buildVisibilitySubtitle(challenge)}
          icon={ICON_CHALLENGE_GEFUELLT}
          preset="challenges"
          stats={headerStats}
        />

        {/* Aufgabentext als CARD wie in der Konfi-Sicht (User-Entscheid
            11.08.): der rote Infokasten war fuer den Haupttext zu laut, die
            Karte mit Meta-Zeile liest sich ruhiger. Aufbau bewusst identisch
            zu ChallengeDetailModal. */}
        {challenge.description && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--challenges">
                <IonIcon icon={ICON_TEXTDOKUMENT} />
              </div>
              <IonLabel>{status === 'ended' ? 'Worum ging es?' : 'Worum geht es?'}</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-mittelweit)' }}>
                <div style={{ fontSize: 'var(--app-text-basis)', lineHeight: 1.5, color: 'var(--app-text-ios)', whiteSpace: 'pre-wrap' }}>
                  {challenge.description}
                </div>
                <div
                  style={{
                    display: 'flex', flexWrap: 'wrap', gap: 'var(--app-abstand-eng) var(--app-abstand-mittelweit)',
                    marginTop: 'var(--app-abstand-mittel)', fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                    <IonIcon icon={ICON_UHRZEIT} className="app-icon-color--challenges" />
                    {status === 'draft' && 'Entwurf — noch nicht veröffentlicht'}
                    {status === 'scheduled' && 'Startet erst noch'}
                    {status === 'active' && 'Läuft gerade'}
                    {status === 'ended' && 'Beendet'}
                  </span>
                  {(challenge.author_name || challenge.author_freetext) && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                      <IonIcon icon={ICON_PERSON} className="app-icon-color--challenges" />
                      Gestellt von {challenge.author_name || challenge.author_freetext}
                    </span>
                  )}
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        <div style={{ margin: 'var(--app-abstand-basis) var(--app-abstand-basis) var(--app-abstand-eng) var(--app-abstand-basis)' }}>
          <IonSegment value={effectiveFilter} onIonChange={(e) => setStatusFilter(e.detail.value as StatusFilter)}>
            {/* "Feed" zeigt nur Freigegebenes — denselben Blick, den die
                Konfis auf die Galerie haben. Wartendes/Ausgeblendetes steht
                ausschliesslich in den eigenen Reitern. */}
            <IonSegmentButton value="feed"><IonLabel>Feed</IonLabel></IonSegmentButton>
            {/* "Wartet" nur bei Challenges MIT Freigabe-Pflicht — ohne
                Moderation ist jeder Beitrag sofort freigegeben, der Filter
                waere immer leer. */}
            {challenge.moderated && (
              <IonSegmentButton value="pending"><IonLabel>Wartet</IonLabel></IonSegmentButton>
            )}
            {challenge.visibility !== 'private' && (
              <IonSegmentButton value="hidden"><IonLabel>Abgelehnt</IonLabel></IonSegmentButton>
            )}
            {/* Eigene Beitraege: eigener Reiter statt eines Blocks darueber. */}
            <IonSegmentButton value="meins"><IonLabel>Meins</IonLabel></IonSegmentButton>
          </IonSegment>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-block)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--challenges">
                <IonIcon icon={ICON_ALBEN} />
              </div>
              <IonLabel>{anzahlBeitraege(filtered.length)}</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: filtered.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                {filtered.length === 0 ? (
                  <EmptyState
                    icon={ICON_ALBEN}
                    title="Keine Beiträge"
                    message={
                      effectiveFilter === 'feed' && counts.pending > 0
                        ? 'Im Feed steht nur, was freigegeben ist. Beiträge, die noch warten, findest du unter "Wartet".'
                        : effectiveFilter === 'feed'
                          ? 'Sobald Beiträge freigegeben sind, erscheinen sie hier — wie bei den Konfis.'
                          : 'Hier ist gerade nichts.'
                    }
                    iconColor="var(--app-color-challenges)"
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-schmal)' }}>
                    {filtered.map((submission) => {
                      const status = getStatusBadge(submission, challenge);
                      const consent = submission.konfi_consent ? CONSENT_BADGE[submission.konfi_consent] : null;
                      const isBusy = busyId === submission.id;
                      const istEigener = Boolean(user?.id) && submission.user_id === user?.id;

                      const actions = availableActions(submission);

                      return (
                        <IonItemSliding key={submission.id} disabled={isBusy}>
                          <IonItem
                            button
                            onClick={() => !isBusy && openActions(submission)}
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
                              className="app-list-item app-list-item--challenges"
                              style={{
                                width: '100%',
                                borderLeftColor: status.color,
                                marginBottom: '0',
                                display: 'block',
                                position: 'relative',
                                overflow: 'hidden',
                                opacity: submission.moderation_status === 'hidden' ? 0.75 : 1,
                                ...(istEigener ? {
                                  background: 'rgba(var(--app-color-challenges-rgb), 0.06)'
                                } : {})
                              }}
                            >
                              {/* Corner-Badges: Konsens + Status (max. 2) */}
                              <div className="app-corner-badges">
                                {consent && (
                                  <>
                                    <div
                                      className="app-corner-badge"
                                      style={{ backgroundColor: consent.color, padding: 'var(--app-abstand-mini) var(--app-abstand-kompakt)' }}
                                      title={consent.label}
                                    >
                                      <IonIcon icon={consent.icon} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }} />
                                    </div>
                                    <div className="app-corner-badges__separator" />
                                  </>
                                )}
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: status.color, padding: 'var(--app-abstand-mini) var(--app-abstand-kompakt)' }}
                                  title={status.label}
                                >
                                  <IonIcon icon={status.icon} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }} />
                                </div>
                              </div>

                              {/* Kopfzeile: Konfi + Zeit */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-schmal)', marginBottom: 'var(--app-abstand-eng)', paddingRight: 'var(--app-freiraum-aktion-m)' }}>
                                <div className="app-icon-circle app-icon-circle--lg" style={{ backgroundColor: status.color }}>
                                  <IonIcon icon={MEDIA_ICON[submission.media_type] || ICON_TEXTDOKUMENT} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div className="app-list-item__title">
                                    {submission.konfi_name || 'Unbekannt'}
                                  </div>
                                  {/* Eigener Beitrag: eigene Zeile statt an den
                                      Namen gehaengt — bei langen Namen wurde
                                      der Zusatz sonst abgeschnitten
                                      ("Pastorin Kathrin Moeller · D..."). */}
                                  {istEigener && (
                                    <div style={{
                                      fontSize: 'var(--app-text-hinweis)', fontWeight: 'var(--app-schrift-fett)',
                                      color: 'var(--app-color-challenges)',
                                      textTransform: 'uppercase', letterSpacing: '0.03em'
                                    }}>
                                      Dein Beitrag
                                    </div>
                                  )}
                                  <div className="app-list-item__subtitle">
                                    {submission.jahrgang_name ? `${submission.jahrgang_name} · ` : ''}
                                    {formatDateTime(submission.created_at)}
                                  </div>
                                </div>
                              </div>

                              {/* Inhalt */}
                              {submission.text_content && (
                                <div style={{ fontSize: 'var(--app-text-basis)', color: 'var(--app-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                                  {submission.text_content}
                                </div>
                              )}

                              {submission.media_type === 'link' && istWebLink(submission.link_url) && (
                                <MusikLink submission={submission} />
                              )}

                              {submission.moderation_status === 'hidden' && submission.moderation_note && (
                                <div className="app-reason-box app-reason-box--danger">
                                  <span className="app-reason-box__label" style={{ fontSize: 'var(--app-text-meta)' }}>
                                    Grund der Ablehnung
                                  </span>
                                  <p style={{ margin: 'var(--app-abstand-winzig) 0 0 0', fontSize: 'var(--app-text-hinweis)', lineHeight: 1.4 }}>
                                    {submission.moderation_note}
                                  </p>
                                </div>
                              )}

                              {submission.file_path && (submission.media_type === 'photo' || submission.media_type === 'audio' || submission.media_type === 'video') && (
                                // Audio-/Video-Steuerung braucht ihre eigenen Klicks
                                // (Play, Scrubben) — ohne diesen Stopper landet jeder
                                // Griff zum Player im Aktions-Menue des Items.
                                <div onClick={(e) => e.stopPropagation()}>
                                  <ChallengeMedia
                                    filePath={submission.file_path}
                                    fileName={submission.file_name}
                                    mediaType={submission.media_type}
                                  />
                                </div>
                              )}

                              {isBusy && (
                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--app-abstand-schmal)' }}>
                                  <IonSpinner name="crescent" />
                                </div>
                              )}
                            </div>
                          </IonItem>

                          <IonItemOptions side="end" className="app-swipe-actions">
                            {actions.map((action) => (
                              <IonItemOption
                                key={action.key}
                                // Zuerst das aufgewischte Element schliessen,
                                // sonst bleibt die Zeile offen stehen, während
                                // die Aktion läuft (User-Hinweis 11.08.).
                                onClick={() => { closeOpenSlidingItems(); action.run(); }}
                                className="app-swipe-action"
                                aria-label={action.text}
                              >
                                <div
                                  className="app-icon-circle app-icon-circle--lg"
                                  style={{ backgroundColor: action.color }}
                                  title={action.text}
                                >
                                  <IonIcon icon={action.icon} />
                                </div>
                              </IonItemOption>
                            ))}
                          </IonItemOptions>
                        </IonItemSliding>
                      );
                    })}
                  </div>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        <div className="ion-padding-bottom" />
      </IonContent>
    </IonPage>
  );
};

export default ChallengeLeitungModal;
