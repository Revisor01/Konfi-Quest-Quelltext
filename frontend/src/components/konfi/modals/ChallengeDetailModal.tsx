import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonLabel,
  IonSegmentButton,
  IonSegment,
  IonRefresher,
  IonRefresherContent,
  IonSpinner
} from '@ionic/react';
import {
  ICON_BILD,
  ICON_ENTFERNEN,
  ICON_GRUPPE,
  ICON_HAKEN,
  ICON_HINZUFUEGEN,
  ICON_LINK,
  ICON_MIKROFON,
  ICON_PERSON,
  ICON_SCHLIESSEN_GEFUELLT,
  ICON_SICHTBAR,
  ICON_VERBORGEN,
  ICON_SPERRE,
  ICON_TEXTDOKUMENT,
  ICON_UHRZEIT,
  ICON_VIDEO,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';

/** Reiter im Challenge-Detail: Gruppen-Feed oder eigene Beitraege. */
type KonfiReiter = 'feed' | 'meins';
import api from '../../../services/api';
import { EmptyState, AudioPlayer } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { istWebLink } from '../../../utils/linkDisplay';
import MusikLink from '../../shared/MusikLink';
import { getChallengeBadgeIcon, getAuthorLabel, formatRemaining } from '../views/ChallengesView';
import type {
  KonfiChallenge,
  KonfiChallengeDetail,
  ChallengeSubmission,
  ChallengeGalerieZeile,
  ChallengeMediaType
} from '../../../types/challenges';

// Detailansicht einer Challenge für Konfis: Beschreibung, oeffentliche Galerie
// (anonyme Beitraege OHNE Namen — das Backend liefert dort gar keinen Namen mit)
// und die eigenen Beitraege mit Status.

const MEDIA_ICON: Record<ChallengeMediaType, string> = {
  text: ICON_TEXTDOKUMENT,
  photo: ICON_BILD,
  audio: ICON_MIKROFON,
  video: ICON_VIDEO,
  link: ICON_LINK
};

/**
 * Status als Icon-Corner-Badge für eigene Beitraege (Muster wie das
 * Warteliste-Badge bei Events: kompaktes, farbiges Icon-only-Badge statt
 * Text). Ausgeblendet schlägt alles; danach entscheidet die Sichtbarkeit
 * der Challenge bzw. die eigene Einwilligung. Label dient nur als Titel
 * (Tooltip/Barrierefreiheit), nicht als sichtbarer Text.
 */
const getOwnStatus = (
  submission: ChallengeSubmission,
  challenge: KonfiChallenge
): { label: string; icon: string; color: string } => {
  if (submission.moderation_status === 'hidden') {
    return { label: 'Ausgeblendet', icon: ICON_ENTFERNEN, color: 'var(--app-color-danger)' };
  }
  if (submission.moderation_status === 'pending') {
    return { label: 'Wartet auf Freigabe', icon: ICON_UHRZEIT, color: 'var(--app-color-warning)' };
  }
  // approved
  if (challenge.visibility === 'private') {
    return { label: 'Nur Leitung', icon: ICON_SPERRE, color: 'var(--app-color-neutral)' };
  }
  if (submission.konfi_consent === 'anonymous') {
    return { label: 'Anonym', icon: ICON_VERBORGEN, color: 'var(--app-color-wrapped)' };
  }
  if (challenge.visibility === 'public') {
    return { label: 'Veröffentlicht', icon: ICON_HAKEN, color: 'var(--app-color-success-strong)' };
  }
  // konfi_choice -> eigene Entscheidung entscheidet
  if (submission.konfi_consent === 'publish') {
    return { label: 'Veröffentlicht', icon: ICON_HAKEN, color: 'var(--app-color-success-strong)' };
  }
  return { label: 'Nur Leitung', icon: ICON_SPERRE, color: 'var(--app-color-neutral)' };
};

const formatDateTime = (value?: string): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};

// Rollen-Kennzeichnung in der Galerie: Beitraege von Pastor:innen/Teamer:innen
// sollen als solche erkennbar sein, ohne sie hervorzuheben (gleichgewichtet).
const GALLERY_ROLE_LABEL: Record<string, string> = {
  org_admin: 'Leitung',
  admin: 'Leitung',
  teamer: 'Teamer:in'
};

// "Name · Teamer:in" bzw. "Name · Jahrgang 2026". Der Jahrgang hilft, wenn eine
// Challenge mehrere Jahrgänge umfasst (User-Entscheid 08.08.). Anonyme
// Beitraege liefert das Backend ohne Name/Rolle/Jahrgang -> nur "Anonym".
const buildGalleryAuthorLabel = (submission: ChallengeSubmission): string => {
  const name = submission.konfi_name?.trim();
  if (!name) return 'Anonym';
  const roleLabel = submission.role_name ? GALLERY_ROLE_LABEL[submission.role_name] : null;
  const suffix = roleLabel || submission.jahrgang_name?.trim();
  return suffix ? `${name} · ${suffix}` : name;
};

// Medienvorschau für Challenge-Dateien. Eigene, schlanke Ladefunktion statt des
// Chat-LazyImage: der mediaCache-Service ist fest auf /chat/files/ verdrahtet,
// Challenges liegen unter /challenges/files/. Der Abruf läuft über axios (also
// mit Auth-Header, kein ?token= nötig), die Object-URL wird beim Unmount wieder
// freigegeben.
const ChallengeMedia: React.FC<{
  filePath: string;
  fileName?: string | null;
  mediaType: ChallengeMediaType;
}> = ({ filePath, fileName, mediaType }) => {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    (async () => {
      try {
        const res = await api.get(`/challenges/files/${filePath}`, { responseType: 'blob' });
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
      <div style={{ marginTop: 'var(--app-abstand-eng)', color: 'var(--app-text-muted)', fontSize: 'var(--app-text-hinweis)' }}>
        Datei konnte nicht geladen werden
      </div>
    );
  }

  if (!src) {
    return (
      <div
        style={{
          marginTop: 'var(--app-abstand-eng)', minHeight: '80px', borderRadius: 'var(--app-radius-knopf)', background: 'var(--app-surface-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-sekundaer)', gap: 'var(--app-abstand-eng)'
        }}
      >
        <IonSpinner name="dots" /> wird geladen...
      </div>
    );
  }

  if (mediaType === 'photo') {
    return (
      <div style={{ marginTop: 'var(--app-abstand-eng)', borderRadius: 'var(--app-radius-knopf)', overflow: 'hidden' }}>
        <img
          src={src}
          alt={fileName || 'Beitrag'}
          style={{ width: '100%', maxHeight: '320px', objectFit: 'cover', display: 'block' }}
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
        style={{ width: '100%', maxHeight: '320px', marginTop: 'var(--app-abstand-eng)', borderRadius: 'var(--app-radius-knopf)', display: 'block' }}
      />
    );
  }

  if (mediaType === 'audio') {
    return <AudioPlayer src={src} />;
  }

  return null;
};

/** Eine Beitragskarte — in der Galerie ohne, bei eigenen Beitraegen mit Status. */
const SubmissionCard: React.FC<{
  submission: ChallengeSubmission;
  authorLabel: string;
  statusBadge?: { label: string; icon: string; color: string };
}> = ({ submission, authorLabel, statusBadge }) => (
  <div
    className="app-list-item app-list-item--challenges"
    style={{ position: 'relative', overflow: 'hidden', width: '100%' }}
  >
    {statusBadge && (
      <div className="app-corner-badges">
        <div
          className="app-corner-badge"
          style={{ backgroundColor: statusBadge.color, padding: 'var(--app-abstand-mini) var(--app-abstand-kompakt)' }}
          title={statusBadge.label}
        >
          <IonIcon icon={statusBadge.icon} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }} />
        </div>
      </div>
    )}
    <div className="app-list-item__row">
      <div className="app-list-item__main" style={{ alignItems: 'flex-start', width: '100%' }}>
        <div className="app-icon-circle app-icon-circle--challenges" style={{ flexShrink: 0 }}>
          <IonIcon icon={MEDIA_ICON[submission.media_type] || ICON_TEXTDOKUMENT} />
        </div>
        <div className="app-list-item__content" style={{ minWidth: 0, flex: 1, paddingRight: statusBadge ? 'var(--app-freiraum-aktion-xxs)' : 0 }}>
          <span className="app-list-item__title" style={{ margin: 0, display: 'block' }}>{authorLabel}</span>
          <div className="app-list-item__subtitle" style={{ marginBottom: 'var(--app-abstand-mini)' }}>
            {formatDateTime(submission.created_at)}
          </div>

          {submission.text_content && (
            <div
              style={{
                fontSize: 'var(--app-text-basis)', color: 'var(--app-text-ios)', lineHeight: 1.45,
                whiteSpace: 'pre-wrap', marginTop: 'var(--app-abstand-mini)'
              }}
            >
              {submission.text_content}
            </div>
          )}

          {/* Nur http/https rendern (istWebLink): die URL stammt aus einer fremden
              Einreichung, ein praepariertes javascript:-Schema wuerde sonst bei
              Mitkonfis landen. Beschriftet wird mit der Domain statt der vollen
              Adresse — die lief sonst ueber mehrere Zeilen. */}
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

          {submission.file_path && submission.media_type !== 'link' && submission.media_type !== 'text' && (
            <ChallengeMedia
              filePath={submission.file_path}
              fileName={submission.file_name}
              mediaType={submission.media_type}
            />
          )}
        </div>
      </div>
    </div>
  </div>
);

interface ChallengeDetailModalProps {
  // Kann im ersten Render-Frame null sein — siehe Hinweis im Einreich-Modal
  // (useIonModal reicht die Props des present()-Renders durch).
  challenge: KonfiChallenge | null;
  onClose: () => void;
  /** Oeffnet das Einreich-Modal (wird von der Seite gesteuert). */
  onSubmit?: (challenge: KonfiChallenge) => void;
}

interface ChallengeDetailContentProps {
  challenge: KonfiChallenge;
  onClose: () => void;
  onSubmit?: (challenge: KonfiChallenge) => void;
}

const ChallengeDetailContent: React.FC<ChallengeDetailContentProps> = ({
  challenge,
  onClose,
  onSubmit
}) => {
  const { setError } = useApp();
  const [detail, setDetail] = useState<KonfiChallengeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    try {
      const res = await api.get(`/challenges/konfi/${challenge.id}`);
      // Backend liefert { challenge, gallery, own_submissions } — Challenge-Felder
      // müssen auf die oberste Ebene, sonst ist starts_at/ends_at undefined und
      // die Challenge erscheint faelschlich als beendet.
      const data = res.data;
      // Die Galerie-Query liefert den Namen als display_name (bei anonymen
      // Beitraegen NULL), das UI liest konfi_name -> hier normalisieren, sonst
      // erscheint JEDER Galerie-Beitrag als "Anonym".
      const gallery = ((data?.gallery ?? []) as ChallengeGalerieZeile[]).map((row) => ({
        ...row,
        konfi_name: row.konfi_name ?? row.display_name ?? null
      }));
      setDetail(
        data?.challenge
          ? { ...data.challenge, gallery, own_submissions: data.own_submissions || [] }
          : null
      );
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Laden der Challenge'));
    } finally {
      setLoading(false);
    }
  }, [challenge.id, setError]);

  useEffect(() => {
    setLoading(true);
    loadDetail();
  }, [loadDetail]);

  // Basis für Kopf/Status: das Detail (frisch) hat Vorrang vor der Listenkarte.
  const current: KonfiChallenge = detail || challenge;
  const author = getAuthorLabel(current);
  const isActive = useMemo(() => {
    const start = new Date(current.starts_at).getTime();
    const end = new Date(current.ends_at).getTime();
    const now = Date.now();
    return !current.is_draft && now >= start && now <= end;
  }, [current]);

  const [reiter, setReiter] = useState<KonfiReiter>('feed');
  const gallery = detail?.gallery || [];
  const ownSubmissions = detail?.own_submissions || [];

  const canSubmitMore = isActive && (current.allow_multiple || ownSubmissions.length === 0);

  // Bei "nur Leitung" gibt es keine Gruppen-Galerie — dann steht immer der
  // eigene Reiter, unabhaengig davon, was zuletzt gewaehlt war.
  const effektiverReiter: KonfiReiter = current.visibility === 'private' ? 'meins' : reiter;
  const sichtbareBeitraege = effektiverReiter === 'meins' ? ownSubmissions : gallery;

  // Kurzform der Sichtbarkeit für den Kopf: EIN knapper Halbsatz neben der
  // Laufzeit, damit beim Mitmachen sofort klar ist, wer den Beitrag zu sehen
  // bekommt (User-Hinweis 10.08.). Dieselbe Angabe steht zusätzlich in der
  // Meta-Zeile unter "Worum geht es".
  // Rollenneutral formulieren: Dieses Modal gehört seit der Zusammenlegung
  // (11.08.) allein den Konfis — Teamer und Leitung nutzen
  // ChallengeLeitungModal. Der Text bleibt trotzdem neutral, weil hier früher
  // faelschlich "Nur für euch in der Leitung" stand.
  const visibilityShort = useMemo(() => {
    if (current.visibility === 'private') return 'Nur das Leitungsteam sieht die Beiträge';
    if (current.visibility === 'public') return 'Für die Gruppe sichtbar';
    return 'Du entscheidest je Beitrag';
  }, [current.visibility]);

  const moderationShort = useMemo(() => {
    if (current.visibility === 'private') return null; // sagt visibilityShort schon alles
    return current.moderated ? 'Sichtbar nach Freigabe' : 'Sofort sichtbar';
  }, [current.visibility, current.moderated]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Challenge</IonTitle>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN_GEFUELLT} />
            </IonButton>
          </IonButtons>
          {canSubmitMore && onSubmit && (
            <IonButtons slot="end">
              <IonButton onClick={() => onSubmit(current)} title="Beitrag einreichen" aria-label="Beitrag einreichen">
                <IonIcon icon={ICON_HINZUFUEGEN} slot="icon-only" />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <IonRefresher
          slot="fixed"
          onIonRefresh={async (e) => { await loadDetail(); e.detail.complete(); }}
          onIonPull={triggerPullHaptic}
        >
          <IonRefresherContent />
        </IonRefresher>

        {/* Kopf */}
        <div className="app-header-banner app-header-banner--challenges">
          <div className="app-header-banner__circle-top" />
          <div className="app-header-banner__circle-bottom" />
          <div className="app-header-banner__header">
            <div className="app-header-banner__icon">
              <IonIcon icon={getChallengeBadgeIcon(current.badge_icon)} />
            </div>
            <div>
              <h2 className="app-header-banner__title">{current.title}</h2>
              {/* Laufzeit UND Sichtbarkeit in einer Zeile: "noch 3 Tage · Nur
                  für euch in der Leitung". Bei beendeten Challenges faellt die
                  Laufzeit weg (sie steht dezent in der Meta-Zeile unten), die
                  Sichtbarkeit bleibt — wer die Beitraege sieht, gilt weiter. */}
              <p className="app-header-banner__subtitle">
                {isActive ? `${formatRemaining(current.ends_at)} · ${visibilityShort}` : visibilityShort}
              </p>
            </div>
          </div>
        </div>

        {/* Beschreibung */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--challenges">
              <IonIcon icon={ICON_TEXTDOKUMENT} />
            </div>
            {/* Bei beendeten Challenges in der Vergangenheit formulieren. */}
            <IonLabel>{isActive ? 'Worum geht es?' : 'Worum ging es?'}</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittelweit)' }}>
              <div style={{ fontSize: 'var(--app-text-basis)', lineHeight: 1.5, color: 'var(--app-text-ios)', whiteSpace: 'pre-wrap' }}>
                {current.description}
              </div>
              <div
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 'var(--app-abstand-eng) var(--app-abstand-mittelweit)',
                  marginTop: 'var(--app-abstand-mittel)', fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                  <IonIcon icon={ICON_UHRZEIT} className="app-icon-color--challenges" />
                  {isActive ? formatRemaining(current.ends_at) : 'Beendet'}
                </span>
                {/* Urheber deutlich sichtbar in derselben unauffaelligen Meta-Zeile. */}
                {author && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                    <IonIcon icon={ICON_PERSON} className="app-icon-color--challenges" />
                    Gestellt von {author}
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                  <IonIcon
                    // Durchgestrichenes Auge wie in der Leitungsansicht: Es geht
                    // um Sichtbarkeit, nicht um eine Sperre -- und ICON_SICHTBAR
                    // daneben ist ja auch ein Auge.
                    icon={current.visibility === 'private' ? ICON_VERBORGEN : ICON_SICHTBAR}
                    className="app-icon-color--challenges"
                  />
                  {visibilityShort}
                </span>
                {moderationShort && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                    <IonIcon icon={ICON_HAKEN} className="app-icon-color--challenges" />
                    {moderationShort}
                  </span>
                )}
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-extraweit)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            {current.visibility !== 'private' && (
              <div style={{ margin: 'var(--app-abstand-basis) var(--app-abstand-basis) var(--app-abstand-eng) var(--app-abstand-basis)' }}>
                <IonSegment value={reiter} onIonChange={(e) => setReiter(e.detail.value as KonfiReiter)}>
                  <IonSegmentButton value="feed"><IonLabel>Feed</IonLabel></IonSegmentButton>
                  <IonSegmentButton value="meins"><IonLabel>Meins</IonLabel></IonSegmentButton>
                </IonSegment>
              </div>
            )}

            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={effektiverReiter === 'meins' ? ICON_PERSON : ICON_GRUPPE} />
                </div>
                <IonLabel>
                  {effektiverReiter === 'meins'
                    ? (ownSubmissions.length === 1 ? 'Dein Beitrag' : 'Deine Beiträge')
                    : 'Aus deiner Gruppe'}
                </IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: sichtbareBeitraege.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                  {sichtbareBeitraege.length === 0 ? (
                    effektiverReiter === 'meins' ? (
                      <EmptyState
                        icon={ICON_TEXTDOKUMENT}
                        title="Noch kein Beitrag von dir"
                        // Bei beendeter Challenge gibt es das Plus nicht mehr
                        // (canSubmitMore verlangt isActive) — der Hinweis
                        // zeigte auf einen Knopf, der nicht existiert
                        // 
                        message={isActive
                          ? 'Tippe oben auf das Plus, um etwas einzureichen.'
                          : 'Diese Challenge ist beendet — du hattest nichts eingereicht.'}
                        iconColor="var(--app-color-challenges)"
                      />
                    ) : (
                      <EmptyState
                        icon={ICON_GRUPPE}
                        title="Noch keine geteilten Beiträge"
                        message={isActive
                          ? 'Sobald jemand aus deiner Gruppe etwas veröffentlicht, findest du es hier. Vielleicht machst du ja den Anfang.'
                          : 'Aus dieser Challenge hat niemand aus deiner Gruppe etwas veröffentlicht.'}
                        iconColor="var(--app-color-challenges)"
                      />
                    )
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {sichtbareBeitraege.map((submission) => (
                        <SubmissionCard
                          key={submission.id}
                          submission={submission}
                          // Im eigenen Reiter immer "Dein Beitrag"; in der
                          // Galerie Name + Herkunft, anonyme ohne Namen.
                          authorLabel={effektiverReiter === 'meins'
                            ? 'Dein Beitrag'
                            : buildGalleryAuthorLabel(submission)}
                          statusBadge={effektiverReiter === 'meins'
                            ? getOwnStatus(submission, current)
                            : undefined}
                        />
                      ))}
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>
          </>
        )}

      </IonContent>
    </IonPage>
  );
};

/** Huelle: wartet auf die durchgereichte Challenge und remountet pro Challenge. */
const ChallengeDetailModal: React.FC<ChallengeDetailModalProps> = ({
  challenge,
  onClose,
  onSubmit
}) => {
  if (!challenge) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Challenge</IonTitle>
            <IonButtons slot="start">
              <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose}>
                <IonIcon icon={ICON_SCHLIESSEN_GEFUELLT} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="app-gradient-background">
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-riesig)' }}>
            <IonSpinner name="crescent" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <ChallengeDetailContent
      key={challenge.id}
      challenge={challenge}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
};

export default ChallengeDetailModal;
