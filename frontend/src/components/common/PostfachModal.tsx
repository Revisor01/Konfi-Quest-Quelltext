import React, { useCallback, useEffect, useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonList,
  IonListHeader,
  IonLabel,
  IonSpinner,
  IonCard,
  IonCardContent,
  IonIcon,
} from '@ionic/react';
import api from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { useBadge } from '../../contexts/BadgeContext';
import { useWartendeVorgaenge } from '../../hooks/useWartendeVorgaenge';
import WartendeVorgaengeKarte from '../shared/WartendeVorgaengeKarte';
import EmptyState from '../shared/EmptyState';
import OfflinePlatzhalter from '../shared/OfflinePlatzhalter';
import {
  ICON_GLOCKE,
  ICON_BENACHRICHTIGUNG,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_WARTEND_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
  ICON_ABSAGE,
  ICON_TERMIN_GEFUELLT,
  ICON_CHATS_GEFUELLT,
  ICON_CHALLENGE_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_ORGANISATION_GEFUELLT,
  ICON_SCHLIESSEN,
} from '../shared/icons';
import { getIconFromIoniconsName, istEmojiIcon } from '../../utils/badgeIcons';
import {
  POSTFACH_OEFFNEN_EVENT,
  PostfachAntwort,
  PostfachBereich,
  PostfachEintrag,
  mitteilungsTitel,
  postfachBereich,
  postfachPraesentationsElement,
  zeitpunktText,
} from '../../utils/postfach';
import {
  buildPushTargetUrl,
  resolveOrgForPush,
  pushZielMelden,
  PushUserType,
} from '../../utils/pushNavigation';

/** Wie viele Mitteilungen je Seite geladen werden. */
export const POSTFACH_SEITENGROESSE = 30;

/** Was im Farbkreis steht: ein Ionicon -- oder ein Emoji als Text. */
type EintragSymbol = { icon: string; emoji?: undefined } | { emoji: string; icon?: undefined };

/**
 * Das Symbol im Farbkreis einer Mitteilung. Je Bereich eines; bei
 * Antraegen sagt es zusaetzlich, was Sache ist -- offen, verbucht oder
 * abgelehnt -- mit denselben Symbolen wie die Antragsliste der Leitung
 * (admin/ActivityRequestsView).
 */
const eintragSymbol = (eintrag: PostfachEintrag, bereich: PostfachBereich): EintragSymbol => {
  switch (bereich) {
    case 'badges': {
      const gespeichert = eintrag.data?.badge_icon;
      if (typeof gespeichert === 'string' && istEmojiIcon(gespeichert)) {
        return { emoji: gespeichert.trim() };
      }
      return { icon: getIconFromIoniconsName(typeof gespeichert === 'string' ? gespeichert : null, ICON_ABZEICHEN_GEFUELLT) };
    }
    case 'activities': {
      if (eintrag.type === 'activity_request_decision' || eintrag.type === 'activity_request_status') {
        return { icon: eintrag.data?.status === 'approved' ? ICON_ZUSAGE_GEFUELLT : ICON_ABSAGE };
      }
      return { icon: ICON_WARTEND_GEFUELLT };
    }
    case 'events':
      return { icon: ICON_TERMIN_GEFUELLT };
    case 'chat':
      return { icon: ICON_CHATS_GEFUELLT };
    case 'challenges':
      return { icon: ICON_CHALLENGE_GEFUELLT };
    default:
      return { icon: ICON_INFO_GEFUELLT };
  }
};

/**
 * Das Postfach: ein Ort fuer alles, was die App jemandem mitteilen will.
 *
 * ZWEI QUELLEN, EIN ORT:
 *
 * Antippen einer Mitteilung markiert sie als gelesen und fuehrt zum Ziel —
 * ueber denselben Weg wie ein angetippter Push (utils/pushNavigation):
 * bei Bedarf erst in die Gemeinde des Inhalts wechseln, dann navigieren.
 * Nichts davon ist hier neu erfunden.
 *
 * Haengt EINMAL auf App-Ebene (wie GlobalToasts) und hoert auf das Ereignis
 * aus utils/postfach. Die Glocke steht auf jeder Seite, das Modal nicht —
 * sonst laegen so viele Modale im Speicher, wie Seiten gemountet sind.
 */
const PostfachModal: React.FC = () => {
  const { user, activeOrgId, organizations, switchOrg } = useApp();
  const { refreshAllCounts, postfachGelesen } = useBadge();
  const { wartend, gescheitert, vergessen, alleVergessen } = useWartendeVorgaenge();

  const [offen, setOffen] = useState(false);
  // Das Element, das auf iOS hinter die Karte zuruecktritt (utils/postfach).
  const [praesentiertVon, setPraesentiertVon] = useState<HTMLElement | undefined>(undefined);
  const [eintraege, setEintraege] = useState<PostfachEintrag[]>([]);
  const [ungelesen, setUngelesen] = useState(0);
  const [weitere, setWeitere] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [ladefehler, setLadefehler] = useState(false);

  // Gemeindename nur zeigen, wenn es etwas zu unterscheiden gibt.
  const mehrereGemeinden = (organizations?.length ?? 0) > 1;

  useEffect(() => {
    const auf = () => {
      setPraesentiertVon(postfachPraesentationsElement());
      setOffen(true);
    };
    window.addEventListener(POSTFACH_OEFFNEN_EVENT, auf);
    return () => window.removeEventListener(POSTFACH_OEFFNEN_EVENT, auf);
  }, []);

  const laden = useCallback(async (vor?: number) => {
    setLaedt(true);
    setLadefehler(false);
    try {
      const { data } = await api.get<PostfachAntwort>('/notifications/postfach', {
        params: { limit: POSTFACH_SEITENGROESSE, ...(vor ? { vor } : {}) },
      });
      const neue = Array.isArray(data?.eintraege) ? data.eintraege : [];
      setEintraege(prev => (vor ? [...prev, ...neue] : neue));
      setUngelesen(Number(data?.ungelesen) || 0);
      setWeitere(Boolean(data?.weitere));
    } catch {
      // Offline oder Server nicht erreichbar: Die Warteschlange oben ist
      // trotzdem da, die Mitteilungen bekommen eine Zeile, die sagt, was fehlt.
      setLadefehler(true);
    } finally {
      setLaedt(false);
    }
  }, []);

  // Beim Oeffnen frisch laden — nicht beim Montieren: Das Modal haengt ab dem
  // Start im Baum, die Liste braucht aber erst jemand, der die Glocke tippt.
  useEffect(() => {
    if (offen) laden();
  }, [offen, laden]);

  const schliessen = () => setOffen(false);

  const alsGelesenMerken = (id: number) => {
    setEintraege(prev => prev.map(e => (e.id === id && !e.read_at ? { ...e, read_at: new Date().toISOString() } : e)));
  };

  const antippen = async (eintrag: PostfachEintrag) => {
    if (!eintrag.read_at) {
      // Optimistisch: sofort als gelesen zeigen, der Server zieht nach. Geht
      // der PUT schief (offline), steht die Mitteilung beim naechsten Laden
      // wieder als ungelesen da — das ist der richtige Stand.
      alsGelesenMerken(eintrag.id);
      setUngelesen(n => Math.max(0, n - 1));
      postfachGelesen(1);
      api.put(`/notifications/postfach/${eintrag.id}/gelesen`)
        .then(() => refreshAllCounts())
        .catch(() => { /* siehe oben */ });
    }

    // Ziel wie beim Push-Tap (AppContext, pushNotificationActionPerformed):
    // erst die Gemeinde des Inhalts, dann die Route mit der Rolle DORT.
    const aktuellerTyp = (user?.type || 'konfi') as PushUserType;
    const zielTyp = await resolveOrgForPush(
      { organization_id: eintrag.organization_id ?? undefined },
      aktuellerTyp,
      {
        getActiveOrgId: () => activeOrgId,
        getUserOrgId: () => user?.organization_id ?? null,
        switchOrg,
      }
    );
    const ziel = buildPushTargetUrl(eintrag.type, eintrag.data, zielTyp);

    schliessen();
    // 'inApp': Die App laeuft schon, und man kommt von einer Seite, zu der man
    // zurueckwill -- der Seiten-Stack bleibt deshalb stehen.
    if (ziel) pushZielMelden(ziel, 'inApp');
  };

  const alleGelesen = async () => {
    setEintraege(prev => prev.map(e => (e.read_at ? e : { ...e, read_at: new Date().toISOString() })));
    setUngelesen(0);
    postfachGelesen('alle');
    try {
      await api.put('/notifications/postfach/gelesen');
      await refreshAllCounts();
    } catch {
      // Offline: Der Server hat es nicht — beim naechsten Laden steht der
      // echte Stand wieder da.
    }
  };

  const hatWarteschlange = wartend.length > 0 || gescheitert.length > 0;
  const aeltesteId = eintraege.length > 0 ? eintraege[eintraege.length - 1].id : undefined;
  const listeLeer = eintraege.length === 0;

  return (
    // presentingElement: Auf iOS die Karte mit Abdunklung, wie jedes andere
    // Modal der App (Begruendung bei postfachPraesentationsElement).
    <IonModal aria-labelledby="postfach-modal-titel" isOpen={offen} onDidDismiss={schliessen} presentingElement={praesentiertVon}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={schliessen} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle id="postfach-modal-titel">Postfach</IonTitle>
        </IonToolbar>
      </IonHeader>
      {/* Der Verlauf-Hintergrund aller Seiten und Modale; die Inhalte stehen
          darauf in Karten (app-card), wie ueberall sonst. */}
      <IonContent className="app-gradient-background">
        {hatWarteschlange && (
          <section aria-label="Warteschlange" data-testid="postfach-warteschlange">
            <WartendeVorgaengeKarte
              wartend={wartend}
              gescheitert={gescheitert}
              onVergessen={vergessen}
            />
            {gescheitert.length > 1 && (
              <div style={{ padding: '0 var(--app-abstand-basis) var(--app-abstand-basis)' }}>
                <IonButton expand="block" fill="clear" onClick={alleVergessen}>
                  Alle Fehlschläge wegwischen
                </IonButton>
              </div>
            )}
          </section>
        )}

        <section aria-label="Mitteilungen" data-testid="postfach-mitteilungen">
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--info">
                <IonIcon icon={ICON_BENACHRICHTIGUNG} />
              </div>
              <IonLabel>Mitteilungen</IonLabel>
              {ungelesen > 0 && (
                <IonButton size="small" fill="clear" onClick={alleGelesen}>
                  Alle gelesen
                </IonButton>
              )}
            </IonListHeader>
            <IonCard className="app-card" data-testid="postfach-karte">
              <IonCardContent style={{ padding: listeLeer ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                {laedt && listeLeer && (
                  <div className="app-postfach__laedt">
                    <IonSpinner name="crescent" />
                  </div>
                )}

                {ladefehler && listeLeer && (
                  <OfflinePlatzhalter was="Deine Mitteilungen" />
                )}

                {!laedt && !ladefehler && listeLeer && (
                  <EmptyState
                    icon={ICON_GLOCKE}
                    title="Nichts Neues"
                    message="Hier landen Punkte, Badges, Events, Anträge und Entscheidungen — auch die, deren Push du verpasst hast."
                  />
                )}

                {eintraege.map(eintrag => {
                  const ungelesenerEintrag = !eintrag.read_at;
                  const bereich = postfachBereich(eintrag.type);
                  const symbol = eintragSymbol(eintrag, bereich);
                  const zeitpunkt = zeitpunktText(eintrag.created_at);
                  const gemeinde = mehrereGemeinden && eintrag.organization_name ? eintrag.organization_name : null;
                  const klassen = [
                    'app-list-item',
                    `app-list-item--${bereich}`,
                    'app-postfach-eintrag',
                    ungelesenerEintrag ? 'app-postfach-eintrag--ungelesen' : null,
                  ].filter(Boolean).join(' ');
                  return (
                    <div
                      key={eintrag.id}
                      role="button"
                      tabIndex={0}
                      className={klassen}
                      data-ungelesen={ungelesenerEintrag ? 'true' : 'false'}
                      data-bereich={bereich}
                      onClick={() => antippen(eintrag)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          antippen(eintrag);
                        }
                      }}
                    >
                      {ungelesenerEintrag && (
                        <span
                          className="app-ungelesen-punkt app-postfach-eintrag__punkt"
                          title="Neu — ungelesen"
                          role="img"
                          aria-label="Neu — ungelesen"
                        />
                      )}
                      <div className="app-list-item__row">
                        <div className="app-list-item__main">
                          <div className={`app-icon-circle app-icon-circle--${bereich}`}>
                            {symbol.emoji !== undefined
                              ? <span data-testid="postfach-emoji" style={{ fontSize: 'var(--app-text-untertitel)', lineHeight: 1 }}>{symbol.emoji}</span>
                              : <IonIcon icon={symbol.icon} />}
                          </div>
                          <div className="app-list-item__content">
                            <div
                              className="app-list-item__title"
                              style={ungelesenerEintrag ? { paddingRight: 'var(--app-abstand-weit)' } : undefined}
                            >
                              {mitteilungsTitel(eintrag)}
                            </div>
                            <div className="app-list-item__subtitle">{eintrag.message}</div>
                            {/* Datum und Gemeinde mit Symbol, wie Datum und Ort in
                                den Terminlisten (konfi/views/EventsView). */}
                            <div className="app-list-item__meta">
                              <span className="app-list-item__meta-item" data-testid="postfach-zeitpunkt">
                                <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-icon-color--events" />
                                {zeitpunkt}
                              </span>
                              {gemeinde && (
                                <span className="app-list-item__meta-item" data-testid="postfach-gemeinde">
                                  <IonIcon icon={ICON_ORGANISATION_GEFUELLT} className="app-icon-color--organizations" />
                                  {gemeinde}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </IonCardContent>
            </IonCard>
          </IonList>

          {weitere && !ladefehler && (
            <div style={{ padding: '0 var(--app-abstand-basis) var(--app-abstand-basis)' }}>
              <IonButton expand="block" fill="clear" disabled={laedt} onClick={() => laden(aeltesteId)}>
                Ältere Mitteilungen laden
              </IonButton>
            </div>
          )}
        </section>
      </IonContent>
    </IonModal>
  );
};

export default PostfachModal;
