import React, { useMemo, useState } from 'react';
import {
  IonIcon,
  IonList,
  IonListHeader,
  IonLabel,
  IonCard,
  IonCardContent,
  IonSegment,
  IonSegmentButton
} from '@ionic/react';
import {
  ICON_ABZEICHEN,
  ICON_ARCHIV,
  ICON_CHALLENGE,
  ICON_CHALLENGE_GEFUELLT,
  ICON_PERSON,
  ICON_SENDEN,
  ICON_UHRZEIT,
} from '../../shared/icons';
import { EmptyState, SectionHeader } from '../../shared';
import type { KonfiChallenge, ChallengeMark } from '../../../types/challenges';
import { getIconFromString } from '../../../utils/badgeIcons';

/**
 * Loest den gespeicherten Icon-Namen einer Challenge auf (Rueckfall: Flagge).
 * Vorrat kommt aus utils/badgeIcons — dasselbe Modul, aus dem der
 * Admin-Auswahldialog schoepft, damit beide Seiten nicht auseinanderlaufen.
 */
export const getChallengeBadgeIcon = (iconName?: string | null): string =>
  getIconFromString(iconName, ICON_CHALLENGE_GEFUELLT);

// Konfi-Sicht der Challenges. Bewusst OHNE Zähler/Fortschritt/Rangliste — der
// Kern des Features ist die eigene Deutung, nicht die Menge (siehe Konzept).
// Aufbau immer: (1) aktive Challenges als grosse Karten, (2) eigene Stempel
// als Icon-Reihe, (3) Archiv.

interface ChallengesViewProps {
  active: KonfiChallenge[];
  archive: KonfiChallenge[];
  marks: ChallengeMark[];
  onSelectChallenge: (challenge: KonfiChallenge) => void;
  // Zusaetzlicher Inhalt DIREKT UNTER dem SectionHeader (Leitungs-Sicht:
  // Verwalten|Mitmachen). Gleiches Muster wie EventsView/RequestsView.
  headerSlot?: React.ReactNode;
}

/** Urheber-Zeile: Freitext hat Vorrang, sonst der aufgeloeste Benutzername. */
export const getAuthorLabel = (challenge: KonfiChallenge): string | null => {
  const freetext = challenge.author_freetext?.trim();
  if (freetext) return freetext;
  const name = challenge.author_display_name?.trim();
  if (name) return name;
  return null;
};

/** Verbleibende Zeit bis ends_at, kindgerecht formuliert. */
export const formatRemaining = (endsAt: string): string => {
  const end = new Date(endsAt).getTime();
  if (isNaN(end)) return '';
  const diff = end - Date.now();
  if (diff <= 0) return 'Zeit abgelaufen';

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return days === 1 ? '1 Tag' : `${days} Tage`;
  if (hours >= 1) return hours === 1 ? '1 Stunde' : `${hours} Stunden`;
  if (minutes >= 1) return minutes === 1 ? '1 Minute' : `${minutes} Minuten`;
  return 'endet gleich';
};

const formatDate = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateRange = (startValue?: string | null, endValue?: string | null): string => {
  const end = formatDate(endValue);
  if (!startValue) return end;
  const start = new Date(startValue);
  const endDate = endValue ? new Date(endValue) : null;
  if (isNaN(start.getTime()) || !endDate || isNaN(endDate.getTime())) return end;

  const sameYear = start.getFullYear() === endDate.getFullYear();
  const startFormatted = start.toLocaleDateString(
    'de-DE',
    sameYear ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: 'numeric' }
  );
  return `${startFormatted} – ${end}`;
};

const ChallengesView: React.FC<ChallengesViewProps> = ({
  active,
  archive,
  marks,
  onSelectChallenge,
  headerSlot
}) => {
  // Aktive Challenges: die knappste Frist zuerst — was zuerst endet, steht oben.
  const sortedActive = useMemo(
    () => [...active].sort(
      (a, b) => new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime()
    ),
    [active]
  );

  // Archiv: zuletzt beendete zuerst.
  const sortedArchive = useMemo(
    () => [...archive].sort(
      (a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime()
    ),
    [archive]
  );

  // Aktuell oder Archiv. Die Stempel stehen unter beiden Reitern.
  const [reiter, setReiter] = useState<'aktuell' | 'archiv'>('aktuell');

  return (
    <div style={{ paddingBottom: 'var(--app-abstand-weit)' }}>

      <SectionHeader
        title="Challenges"
        subtitle="Mach mit, sei dabei"
        icon={ICON_CHALLENGE}
        preset="challenges"
        stats={[
          // Aktiv und Archiv springen zum jeweiligen Reiter; Stempel haben
          // keinen eigenen Reiter und bleiben reine Anzeige.
          { value: active.length, label: 'AKTIV', onClick: () => setReiter('aktuell'), active: reiter === 'aktuell' },
          { value: marks.length, label: 'STEMPEL' },
          { value: archive.length, label: 'ARCHIV', onClick: () => setReiter('archiv'), active: reiter === 'archiv' }
        ]}
      />

      {headerSlot}

      <div className="app-segment-wrapper">
        <IonSegment
          value={reiter}
          onIonChange={(e) => setReiter(e.detail.value as 'aktuell' | 'archiv')}
        >
          <IonSegmentButton value="aktuell">
            <IonLabel>Aktuell</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="archiv">
            <IonLabel>Archiv</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

      {reiter === 'aktuell' && (
      <>
      {/* --- 1. Aktive Challenges --- */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--challenges">
            <IonIcon icon={ICON_CHALLENGE} />
          </div>
          <IonLabel>Aktuelle Challenges</IonLabel>
        </IonListHeader>

        {sortedActive.length === 0 ? (
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
              <EmptyState
                icon={ICON_CHALLENGE}
                title="Gerade läuft keine Challenge"
                message="Sobald eine neue Challenge startet, findest du sie hier — und bekommst eine Nachricht."
                iconColor="var(--app-color-challenges)"
              />
            </IonCardContent>
          </IonCard>
        ) : (
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
              {/* Alle laufenden Challenges gleichwertig, einheitliches
                  Listen-Item wie bei Events/Badges — keine Leitkarte mehr. */}
              {sortedActive.map((challenge) => {
                const author = getAuthorLabel(challenge);
                return (
                  <div
                    key={challenge.id}
                    className="app-list-item app-list-item--challenges"
                    onClick={() => onSelectChallenge(challenge)}
                    style={{ cursor: 'pointer', position: 'relative' }}
                  >
                    {challenge.has_submission && (
                      <div className="app-corner-badges">
                        <div
                          className="app-corner-badge app-corner-badge--queue"
                          style={{ backgroundColor: 'var(--app-color-challenges)' }}
                          title="Du hast bereits eingereicht"
                        >
                          <IonIcon icon={ICON_SENDEN} />
                        </div>
                      </div>
                    )}
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--challenges">
                          <IonIcon icon={getChallengeBadgeIcon(challenge.badge_icon)} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title" style={{ paddingRight: challenge.has_submission ? 'var(--app-freiraum-aktion-xs)' : '0' }}>
                            {challenge.title}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_UHRZEIT} className="app-icon-color--challenges" />
                              {formatRemaining(challenge.ends_at)}
                            </span>
                            {author && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_PERSON} className="app-icon-color--challenges" />
                                {author}
                              </span>
                            )}
                          </div>
                          {/* Beschreibungs-Anriss: 2 Zeilen, Rest im Detail */}
                          {challenge.description && (
                            <div
                              style={{
                                fontSize: 'var(--app-text-hinweis)', lineHeight: 1.4, color: 'var(--app-text-secondary)',
                                marginTop: 'var(--app-abstand-kompakt)', whiteSpace: 'pre-wrap',
                                display: '-webkit-box', WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical', overflow: 'hidden'
                              }}
                            >
                              {challenge.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </IonCardContent>
          </IonCard>
        )}
      </IonList>

      </>
      )}

      {reiter === 'archiv' && (
      <>
      {/* --- 3. Archiv --- */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--challenges">
            <IonIcon icon={ICON_ARCHIV} />
          </div>
          <IonLabel>Vorbei</IonLabel>
        </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent style={{ padding: sortedArchive.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
            {sortedArchive.length === 0 ? (
              <EmptyState
                icon={ICON_ARCHIV}
                title="Noch nichts im Archiv"
                message="Beendete Challenges kannst du hier später in Ruhe nachlesen."
                iconColor="var(--app-color-challenges)"
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {sortedArchive.map((challenge) => {
                  // Ohne eigenen Beitrag dezent ausgrauen — weiterhin lesbar
                  // und tappbar, aber sichtbar von "erledigt" unterschieden.
                  const participated = !!challenge.has_submission;
                  return (
                    <div
                      key={challenge.id}
                      className="app-list-item app-list-item--challenges"
                      onClick={() => onSelectChallenge(challenge)}
                      style={{ cursor: 'pointer', position: 'relative', opacity: participated ? 1 : 0.55 }}
                    >
                      {challenge.has_submission && (
                        <div className="app-corner-badges">
                          <div
                            className="app-corner-badge app-corner-badge--queue"
                            style={{ backgroundColor: 'var(--app-color-challenges)' }}
                            title="Du hast bereits eingereicht"
                          >
                            <IonIcon icon={ICON_SENDEN} />
                          </div>
                        </div>
                      )}
                      <div className="app-list-item__row">
                        <div className="app-list-item__main">
                          <div className="app-icon-circle app-icon-circle--challenges">
                            <IonIcon icon={getChallengeBadgeIcon(challenge.badge_icon)} />
                          </div>
                          <div className="app-list-item__content">
                            <div className="app-list-item__title" style={{ paddingRight: challenge.has_submission ? 'var(--app-freiraum-aktion-xs)' : '0' }}>
                              {challenge.title}
                            </div>
                            <div className="app-list-item__meta">
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_UHRZEIT} className="app-icon-color--challenges" />
                                {formatDateRange(challenge.starts_at, challenge.ends_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </IonCardContent>
        </IonCard>
      </IonList>
      </>
      )}

      {/* --- 2. Deine Stempel (bewusst OHNE Zaehler) --- */}
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
                message="Für jede Challenge, bei der du mitmachst, bekommst du einen eigenen Stempel."
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


    </div>
  );
};

export default ChallengesView;
