import React, { useMemo, useState } from 'react';
import { useApp } from '../../../contexts/AppContext';
import {
  IonIcon,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonLabel,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonSegment,
  IonSegmentButton,
  useIonModal
} from '@ionic/react';
import {
  ICON_ABZEICHEN,
  ICON_ALBEN,
  ICON_ARCHIV,
  ICON_BEARBEITEN,
  ICON_CHALLENGE_GEFUELLT,
  ICON_GRUPPE,
  ICON_LOESCHEN,
  ICON_SENDEN,
  ICON_SICHTBAR,
  ICON_TERMIN,
  ICON_UHRZEIT,
  ICON_VERBORGEN,
} from '../../shared/icons';
import { SectionHeader, ListSection, ChallengeLegendModal, EmptyState } from '../../shared';
import { getChallengeBadgeIcon } from '../../konfi/views/ChallengesView';
import type { AdminChallenge, ChallengeStatus, ChallengeMark } from '../../../types/challenges';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { anzahlBeitraege, wartenAufFreigabe } from '../../../utils/challengeTexte';

// Gemeinsame Verwaltungs-Ansicht für Admin UND Teamer. Bewusst ohne eigenen
// Datenzugriff: Laden/Modale liegen in der jeweiligen Seite, hier nur Darstellung
// und Filter — so teilen sich AdminChallengesPage und TeamerChallengesPage
// exakt dieselbe UI (keine Kopie).

interface ChallengesManageViewProps {
  challenges: AdminChallenge[];
  onSelectChallenge: (challenge: AdminChallenge) => void;
  onEditChallenge: (challenge: AdminChallenge) => void;
  onDeleteChallenge: (challenge: AdminChallenge) => void;
  // Für Card-Modal-Optik der Legende (Sheet über der Seite statt Vollbild).
  presentingElement?: HTMLElement | null;
  // Zusaetzlicher Inhalt DIREKT UNTER dem SectionHeader (Verwalten|Mitmachen der
  // Page) — gleiches Muster wie EventsView/RequestsView, damit der Switcher das
  // Design nicht zerreisst (User-Feedback 09.08.).
  headerSlot?: React.ReactNode;
  /**
   * Eigene Stempel der angemeldeten Person. Seit der Zusammenlegung von
   * "Verwalten" und "Mitmachen" (11.08.) zeigt diese Liste auch die eigene
   * Teilnahme — Leitung und Team machen selbst mit.
   */
  marks?: ChallengeMark[];
  ohneJahrgang?: boolean;
}

// Status wird NICHT gespeichert, sondern aus is_draft/starts_at/ends_at abgeleitet
// (siehe Datenmodell). Dieselbe Logik nutzt auch das Backend.
// `now` ist nur für Tests injizierbar — im Betrieb gilt die echte Uhr.
export const getChallengeStatus = (challenge: AdminChallenge, now: number = Date.now()): ChallengeStatus => {
  if (challenge.is_draft) return 'draft';
  const start = new Date(challenge.starts_at).getTime();
  const end = new Date(challenge.ends_at).getTime();
  if (now < start) return 'scheduled';
  if (now > end) return 'ended';
  return 'active';
};

// Aufteilung auf die drei Reiter — als pure Funktion exportiert, damit die
// Zuordnung testbar ist, ohne die Ionic-Ansicht zu rendern.
export const teileChallengesAuf = (
  challenges: AdminChallenge[],
  now: number = Date.now()
): { current: AdminChallenge[]; planned: AdminChallenge[]; archived: AdminChallenge[] } => {
  // Geplant: Entwürfe ZUERST (daran wird noch gearbeitet, ein fester Termin
  // steht noch nicht), danach die eingeplanten mit dem nächsten Start oben.
  // Entwürfe untereinander nach Anlage (jüngste zuerst) — NICHT nach
  // starts_at, denn ein Entwurf hat noch keinen verbindlichen Zeitraum,
  // das Datum dahinter ist nur ein technischer Platzhalter.
  const draftsFirstThenStart = (a: AdminChallenge, b: AdminChallenge) => {
    const aDraft = getChallengeStatus(a, now) === 'draft';
    const bDraft = getChallengeStatus(b, now) === 'draft';
    if (aDraft !== bDraft) return aDraft ? -1 : 1;
    if (aDraft && bDraft) {
      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (aCreated !== bCreated) return bCreated - aCreated;
      return b.id - a.id;
    }
    return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
  };

  return {
    current: challenges
      .filter((c) => getChallengeStatus(c, now) === 'active')
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
    planned: challenges
      .filter((c) => ['scheduled', 'draft'].includes(getChallengeStatus(c, now)))
      .sort(draftsFirstThenStart),
    // Archiv: zuletzt beendete zuerst — wie in der Konfi-Sicht.
    archived: challenges
      .filter((c) => getChallengeStatus(c, now) === 'ended')
      .sort((a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime())
  };
};

const STATUS_LABEL: Record<ChallengeStatus, string> = {
  draft: 'Entwurf',
  scheduled: 'Geplant',
  active: 'Aktiv',
  ended: 'Beendet'
};

const STATUS_COLOR: Record<ChallengeStatus, string> = {
  draft: 'var(--app-text-system)',
  scheduled: 'var(--app-color-info)',
  active: 'var(--app-color-success-strong)',
  ended: 'var(--app-color-neutral)'
};

// Jeder Status hat sein EIGENES Icon (User-Feedback 07.08.: vier Mal Flagge
// hilft niemandem). Muss mit ChallengeLegendModal uebereinstimmen.
const STATUS_ICON: Record<ChallengeStatus, string> = {
  draft: ICON_BEARBEITEN,
  scheduled: ICON_TERMIN,
  active: ICON_CHALLENGE_GEFUELLT,
  ended: ICON_ARCHIV
};

const VISIBILITY_LABEL: Record<string, string> = {
  public: 'Öffentlich',
  konfi_choice: 'Selbst entscheiden',
  // Meta-Zeile der Liste: knapp halten, dieselbe Aussage wie in der Anlage —
  // nicht "nicht öffentlich", das sagte nur, was es NICHT ist
  // (User-Hinweis 10.08.).
  private: 'Nur Leitung'
};

// Teilnahme-Kreis (Migration 121). 'konfis' ist der Normalfall und wird in der
// Meta-Zeile NICHT angezeigt — nur die Abweichungen sind erwaehnenswert.
const AUDIENCE_LABEL: Record<string, string> = {
  konfis_und_team: 'Konfis und Team',
  nur_team: 'Nur Team'
};

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const ChallengesManageView: React.FC<ChallengesManageViewProps> = ({
  challenges: challengesRaw,
  onSelectChallenge,
  onEditChallenge,
  onDeleteChallenge,
  presentingElement,
  headerSlot,
  marks: marksRaw = [],
  ohneJahrgang = false
}) => {
  // Fehlt die Jahrgangs-Zuweisung, ist JEDER Reiter aus demselben Grund
  // leer — deshalb bekommen alle drei denselben erklaerenden Text.
  const ohneJahrgangLeerText = {
    emptyTitle: 'Kein Jahrgang zugewiesen',
    emptyMessage: 'Dir ist noch kein Jahrgang zugewiesen, deshalb siehst du hier keine Challenges. Die Leitung deiner Gemeinde kann das in den Einstellungen ändern.'
  };
  const { user } = useApp();
  const darfLoeschen = user?.type === 'admin';

  const marks: ChallengeMark[] = Array.isArray(marksRaw) ? marksRaw : [];
  // Defensive: bei kaputten/gecachten Responses (Object statt Array) auf [] fallen
  const challenges: AdminChallenge[] = Array.isArray(challengesRaw) ? challengesRaw : [];

  const [presentLegend, dismissLegend] = useIonModal(ChallengeLegendModal, {
    onClose: () => dismissLegend(),
  });

  const [reiter, setReiter] = useState<'aktuell' | 'geplant' | 'archiv'>('aktuell');

  // Drei Reiter: Aktuell = was läuft, Geplant = was kommt (eingeplant UND
  // Entwurf), Archiv = was vorbei ist. Die Zuordnung selbst liegt in
  // teileChallengesAuf (pure Funktion, testbar).
  const { current, planned, archived } = useMemo(() => teileChallengesAuf(challenges), [challenges]);

  // Ein Listeneintrag — identisch in "Aktuelle Challenges" und "Archiv",
  // deshalb einmal hier statt zweimal im JSX.
  const renderChallenge = (challenge: AdminChallenge, index: number, total: number) => {
          const status = getChallengeStatus(challenge);
          const statusColor = STATUS_COLOR[status];
          const isArchived = status === 'ended';
          const pending = challenge.pending_count || 0;

          return (
            <IonItemSliding
              key={challenge.id}
              style={{ marginBottom: index < total - 1 ? 'var(--app-abstand-eng)' : '0' }}
            >
              <IonItem
                button
                onClick={() => onSelectChallenge(challenge)}
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
                    borderLeftColor: statusColor,
                    opacity: isArchived ? 0.7 : 1,
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  <div className="app-corner-badges">
                    {pending > 0 && (
                      <>
                        <div
                          className="app-corner-badge"
                          style={{ backgroundColor: 'var(--app-color-warning)', display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}
                          title={wartenAufFreigabe(pending)}
                          role="img"
                          aria-label={wartenAufFreigabe(pending)}
                        >
                          {pending}
                          <IonIcon icon={ICON_UHRZEIT} aria-hidden="true" style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }} />
                        </div>
                        <div className="app-corner-badges__separator" />
                      </>
                    )}
                    {(challenge.own_submission_count ?? 0) > 0 && (
                      <>
                        <div
                          className="app-corner-badge app-corner-badge--queue"
                          style={{ backgroundColor: 'var(--app-color-challenges)' }}
                          title="Du hast bereits eingereicht"
                        >
                          <IonIcon icon={ICON_SENDEN} />
                        </div>
                        <div className="app-corner-badges__separator" />
                      </>
                    )}
                    {/* Status als Symbol-Badge (wie in der Moderation), Legende erklaert */}
                    <div
                      className="app-corner-badge"
                      style={{ backgroundColor: statusColor, padding: 'var(--app-abstand-mini) var(--app-abstand-kompakt)' }}
                      title={STATUS_LABEL[status]}
                    >
                      <IonIcon icon={STATUS_ICON[status]} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }} />
                    </div>
                  </div>

                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div
                        className="app-icon-circle app-icon-circle--lg"
                        style={{ backgroundColor: statusColor }}
                      >
                        <IonIcon icon={STATUS_ICON[status]} />
                      </div>

                      <div className="app-list-item__content">
                        <div
                          className="app-list-item__title"
                          style={{
                            color: isArchived ? 'var(--app-text-muted)' : undefined,
                            // Das Zähler-Badge ist seit dem Umbau auf Zahl+Uhr
                            // schmaler als das alte "{n} offen".
                            paddingRight: pending > 0 ? 'var(--app-freiraum-aktion-xxl-plus)' : 'var(--app-freiraum-aktion-xl)'
                          }}
                        >
                          {challenge.title}
                        </div>

                        <div
                          className="app-list-item__subtitle"
                          style={{
                            color: isArchived ? 'var(--app-text-muted)' : 'var(--app-text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {challenge.description}
                        </div>

                        <div className="app-list-item__meta">
                          {status === 'draft' ? (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_TERMIN} className="app-icon-color--muted" />
                              Zeitraum noch offen
                            </span>
                          ) : (
                            <>
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_TERMIN} className="app-icon-color--challenges" />
                                {formatDate(challenge.starts_at)}
                              </span>
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_UHRZEIT} className="app-icon-color--muted" />
                                bis {formatDate(challenge.ends_at)}
                              </span>
                            </>
                          )}
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ICON_ALBEN} className="app-icon-color--challenges" />
                            {anzahlBeitraege(challenge.submission_count || 0)}
                          </span>
                          <span className="app-list-item__meta-item">
                            <IonIcon
                              icon={challenge.visibility === 'private' ? ICON_VERBORGEN : ICON_SICHTBAR}
                              className="app-icon-color--muted"
                            />
                            {VISIBILITY_LABEL[challenge.visibility] || challenge.visibility}
                          </span>
                          {challenge.audience && AUDIENCE_LABEL[challenge.audience] && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_GRUPPE} className="app-icon-color--teamer" />
                              {AUDIENCE_LABEL[challenge.audience]}
                            </span>
                          )}
                          {challenge.jahrgaenge && challenge.jahrgaenge.length > 0 && (
                            <span
                              className="app-list-item__meta-item"
                              style={{ maxWidth: '100%' }}
                              title={challenge.jahrgaenge.map((j) => j.name).join(', ')}
                            >
                              <IonIcon icon={ICON_GRUPPE} className="app-icon-color--jahrgang" />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {challenge.jahrgaenge.length > 2
                                  ? `${challenge.jahrgaenge.length} Jahrgänge`
                                  : challenge.jahrgaenge.map((j) => j.name).join(', ')}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </IonItem>

              {/* BEWUSSTE AUSNAHME von "Tippen = bearbeiten": Tippen oeffnet
                  hier die Beitraege (Moderation) — das ist die taegliche
                  Arbeit an einer Challenge, das Aendern der Stammdaten die
                  Ausnahme. Deshalb liegt Bearbeiten hier auf dem Wisch.
                  Ueberall sonst gilt: Tippen = bearbeiten, Wischen = loeschen. */}
              <IonItemOptions side="end" className="app-swipe-actions">
                <IonItemOption
                  onClick={() => { closeOpenSlidingItems(); onEditChallenge(challenge); }}
                  aria-label="Challenge bearbeiten"
                  className="app-swipe-action"
                >
                  <div className="app-icon-circle app-icon-circle--lg app-icon-circle--challenges">
                    <IonIcon icon={ICON_BEARBEITEN} />
                  </div>
                </IonItemOption>
                {darfLoeschen && (
                  <IonItemOption
                    onClick={() => { closeOpenSlidingItems(); onDeleteChallenge(challenge); }}
                    aria-label="Challenge löschen"
                    className="app-swipe-action"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={ICON_LOESCHEN} />
                    </div>
                  </IonItemOption>
                )}
              </IonItemOptions>
            </IonItemSliding>
          );
  };

  return (
    <>
      <SectionHeader
        title="Challenges"
        subtitle="Anlegen, begleiten, mitmachen"
        icon={ICON_CHALLENGE_GEFUELLT}
        preset="challenges"
        stats={[
          { value: current.length, label: 'Aktuell', onClick: () => setReiter('aktuell'), active: reiter === 'aktuell' },
          { value: planned.length, label: 'Geplant', onClick: () => setReiter('geplant'), active: reiter === 'geplant' },
          { value: archived.length, label: 'Archiv', onClick: () => setReiter('archiv'), active: reiter === 'archiv' }
        ]}
        onInfo={() => presentLegend({ presentingElement: presentingElement || undefined })}
      />

      {headerSlot}

      <div className="app-segment-wrapper">
        <IonSegment
          value={reiter}
          onIonChange={(e) => setReiter(e.detail.value as 'aktuell' | 'geplant' | 'archiv')}
        >
          <IonSegmentButton value="aktuell">
            <IonLabel>Aktuell</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="geplant">
            <IonLabel>Geplant</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="archiv">
            <IonLabel>Archiv</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

      {reiter === 'aktuell' && (
      <>
      <ListSection
        icon={ICON_CHALLENGE_GEFUELLT}
        title="Aktuelle Challenges"
        count={current.length}
        iconColorClass="challenges"
        isEmpty={current.length === 0}
        emptyIcon={ICON_CHALLENGE_GEFUELLT}
        emptyTitle={ohneJahrgang ? ohneJahrgangLeerText.emptyTitle : 'Gerade läuft keine Challenge'}
        emptyMessage={ohneJahrgang ? ohneJahrgangLeerText.emptyMessage : 'Lege eine Challenge an, damit deine Konfis eigene Beiträge einreichen können'}
        emptyIconColor="var(--app-color-challenges)"
      >
        {current.map((challenge, index) => renderChallenge(challenge, index, current.length))}
      </ListSection>
      </>
      )}

      {reiter === 'geplant' && (
      <ListSection
        icon={ICON_UHRZEIT}
        title="Geplant und Entwürfe"
        count={planned.length}
        iconColorClass="challenges"
        isEmpty={planned.length === 0}
        emptyIcon={ICON_UHRZEIT}
        emptyTitle={ohneJahrgang ? ohneJahrgangLeerText.emptyTitle : 'Nichts in Planung'}
        emptyMessage={ohneJahrgang ? ohneJahrgangLeerText.emptyMessage : 'Entwürfe und Challenges mit einem Startdatum in der Zukunft erscheinen hier'}
        emptyIconColor="var(--app-color-challenges)"
      >
        {planned.map((challenge, index) => renderChallenge(challenge, index, planned.length))}
      </ListSection>
      )}

      {reiter === 'archiv' && (
      <ListSection
        icon={ICON_ARCHIV}
        title="Archiv"
        count={archived.length}
        iconColorClass="challenges"
        isEmpty={archived.length === 0}
        emptyIcon={ICON_ARCHIV}
        emptyTitle={ohneJahrgang ? ohneJahrgangLeerText.emptyTitle : 'Noch nichts im Archiv'}
        emptyMessage={ohneJahrgang ? ohneJahrgangLeerText.emptyMessage : 'Beendete Challenges sammeln sich hier — mit allen Beiträgen zum Nachlesen'}
        emptyIconColor="var(--app-color-challenges)"
      >
        {archived.map((challenge, index) => renderChallenge(challenge, index, archived.length))}
      </ListSection>
      )}

      {/* --- 2. Eigene Stempel — dieselbe Reihe wie in der Konfi-Sicht. Seit der
          Zusammenlegung von "Verwalten" und "Mitmachen" (11.08.) ist das Team
          hier nicht mehr nur Verwaltung, sondern nimmt selbst teil.
          IMMER anzeigen, auch leer: war der Abschnitt bei 0 Stempeln
          ausgeblendet, sah man nie, dass es ihn ueberhaupt gibt — und damit
          auch nicht, dass Mitmachen vorgesehen ist (User-Hinweis 11.08.). */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--challenges">
              <IonIcon icon={ICON_ABZEICHEN} />
            </div>
            <IonLabel>Deine Stempel</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: marks.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-basis) var(--app-abstand-mittel)' }}>
              {marks.length === 0 ? (
                <EmptyState
                  icon={ICON_ABZEICHEN}
                  title="Noch keine Stempel"
                  message="Mach selbst bei einer Challenge mit — tippe sie an und reiche oben über das Plus deinen Beitrag ein."
                  iconColor="var(--app-color-challenges)"
                />
              ) : (
              <div
                style={{
                  display: 'flex', gap: 'var(--app-abstand-mittelweit)', overflowX: 'auto',
                  paddingBottom: 'var(--app-abstand-mini)', WebkitOverflowScrolling: 'touch'
                }}
              >
                {marks.map((mark) => (
                  <div
                    key={mark.challenge_id}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: 'var(--app-abstand-kompakt)', minWidth: '74px', maxWidth: '92px', flexShrink: 0
                    }}
                  >
                    <div
                      style={{
                        width: '52px', height: '52px', borderRadius: 'var(--app-radius-kreis)',
                        background: 'linear-gradient(135deg, var(--app-color-challenges) 0%, var(--app-color-challenges-dunkel) 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: 'var(--app-schatten-glow-challenges)'
                      }}
                    >
                      <IonIcon
                        icon={getChallengeBadgeIcon(mark.badge_icon)}
                        style={{ fontSize: 'var(--app-text-ueberschrift)', color: 'white' }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--app-text-meta)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-ios)',
                        textAlign: 'center', lineHeight: 1.2
                      }}
                    >
                      {mark.badge_name}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </IonCardContent>
          </IonCard>
      </IonList>

      {/* --- 3. Archiv — heisst in der Konfi-Sicht "Vorbei"; hier bleibt es
              "Archiv", weil die Leitung dort weiter bearbeitet und loescht. --- */}
    </>
  );
};

export default ChallengesManageView;
export { STATUS_LABEL, STATUS_COLOR, STATUS_ICON, VISIBILITY_LABEL };
