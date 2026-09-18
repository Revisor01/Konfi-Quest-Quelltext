import React, { useMemo, useState } from 'react';
import {
  IonIcon,
  IonItem,
  IonList,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonListHeader,
  IonItemGroup,
  IonInput,
  useIonModal
} from '@ionic/react';
import {
  ICON_FILTER,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_KATEGORIE_GEFUELLT,
  ICON_LISTE,
  ICON_MATERIAL,
  ICON_ORT_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_UNENDLICH,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { SectionHeader, ListSection, EventLegendModal, EventCornerBadges, AbsageBlock, formatEventDate as formatDate, formatEventTime as formatTime, istVergangen, istAbgesagt, titelDekoration, zaehltAlsMeiner, kategorienText, zeigtPunkteart, punkteartText } from '../../shared';
import { getStatusIcon } from '../../shared/StatusBadge';
import { Event } from '../../../types/event';

interface EventsViewProps {
  events: Event[];
  activeTab: 'meine' | 'alle' | 'konfirmation';
  onTabChange: (tab: 'meine' | 'alle' | 'konfirmation') => void;
  onSelectEvent: (event: Event) => void;
  // Für Card-Modal-Optik (Sheet über der Seite statt Vollbild).
  presentingElement?: HTMLElement | null;
  // Im iPad-Split-View aktuell rechts geoeffnetes Event (für Highlighting).
  selectedEventId?: number | null;
  // Haupt-Segment der Page (Events | Anträge) - wird direkt unter dem
  // Grafik-Header gerendert, damit die Seitenstruktur zu den anderen Tabs passt.
  headerSlot?: React.ReactNode;
}

const EventsView: React.FC<EventsViewProps> = ({
  events,
  activeTab,
  onTabChange,
  onSelectEvent,
  presentingElement,
  selectedEventId,
  headerSlot
}) => {
  const [searchText, setSearchText] = useState('');

  const [presentLegend, dismissLegend] = useIonModal(EventLegendModal, {
    variant: 'konfi',
    onClose: () => dismissLegend(),
  });

  const konfirmationEvents = useMemo(() =>
    events.filter(e => e.is_konfirmation),
  [events]);

  const nonKonfirmationEvents = useMemo(() =>
    events.filter(e => !e.is_konfirmation),
  [events]);

  // Hat der Konfi bereits einen Konfirmationstermin gebucht? Dann sind die ANDEREN
  // Konfirmations-Events gesperrt (man kann nur einen buchen) -> ausgegraut.
  const hasKonfirmationBooked = useMemo(() =>
    konfirmationEvents.some(e => e.is_registered),
  [konfirmationEvents]);

  // istVergangen() statt eines Vergleichs auf event_date: Mehrtaegige Termine
  // sind erst nach event_end_time vorbei. Am 12. einer Freizeit vom 10.-14.
  // sagte das Abzeichen 'laeuft', die Liste zeigte sie aber nicht mehr an.
  const eventCounts = useMemo(() => ({
    all: events.length,
    meine: events.filter(zaehltAlsMeiner).length,
    alle: nonKonfirmationEvents.filter(e => !istVergangen(e)).length,
    meineUpcoming: events.filter(e => zaehltAlsMeiner(e) && !istVergangen(e)).length,
    meinePast: events.filter(e => zaehltAlsMeiner(e) && istVergangen(e)).length,
    konfirmation: konfirmationEvents.length,
    konfirmationUpcoming: konfirmationEvents.filter(e => !istVergangen(e)).length,
    konfirmationRegistered: konfirmationEvents.filter(e => e.is_registered).length
  }), [events, konfirmationEvents, nonKonfirmationEvents]);

  const getStatLabelsAndCounts = () => {
    switch (activeTab) {
      case 'meine':
        return [
          { label: 'Gebucht', count: eventCounts.meine, icon: ICON_TERMIN_GEFUELLT },
          { label: 'Anstehend', count: eventCounts.meineUpcoming, icon: ICON_UHRZEIT_GEFUELLT },
          { label: 'Vergangen', count: eventCounts.meinePast, icon: ICON_ZUSAGE_GEFUELLT }
        ];
      case 'alle':
        return [
          { label: 'Gesamt', count: eventCounts.alle, icon: ICON_TERMIN_GEFUELLT },
          { label: 'Anstehend', count: nonKonfirmationEvents.filter(e => !istVergangen(e) && !e.is_registered).length, icon: ICON_UHRZEIT_GEFUELLT },
          { label: 'Gebucht', count: nonKonfirmationEvents.filter(e => e.is_registered).length, icon: ICON_ZUSAGE_GEFUELLT }
        ];
      case 'konfirmation':
        return [
          { label: 'Gesamt', count: eventCounts.konfirmation, icon: ICON_TERMIN_GEFUELLT },
          { label: 'Anstehend', count: eventCounts.konfirmationUpcoming, icon: ICON_UHRZEIT_GEFUELLT },
          { label: 'Gebucht', count: eventCounts.konfirmationRegistered, icon: ICON_ZUSAGE_GEFUELLT }
        ];
      default:
        return [
          { label: 'Gesamt', count: eventCounts.all, icon: ICON_TERMIN_GEFUELLT },
          { label: 'Anstehend', count: eventCounts.alle, icon: ICON_UHRZEIT_GEFUELLT },
          { label: 'Gebucht', count: eventCounts.meine, icon: ICON_ZUSAGE_GEFUELLT }
        ];
    }
  };

  const statsData = getStatLabelsAndCounts();

  // Kacheln, die einem Reiter entsprechen, springen dorthin. Die Labels wechseln
  // je nach Reiter, deshalb wird über das Label zugeordnet statt über die
  // Position. "Anstehend" ist streng genommen ein Zeitfilter innerhalb des
  // Reiters und hat keinen eigenen — es fuehrt zu "Alle", weil das die
  // vollstaendigste Liste ist.
  const TAB_ZU_LABEL: Record<string, 'alle' | 'meine' | 'konfirmation'> = {
    'Gesamt': 'alle',
    'Anstehend': 'alle',
    'Gebucht': 'meine'
  };

  const statsMitSprung = statsData.map((s) => {
    const ziel = TAB_ZU_LABEL[s.label];
    // Im jeweils eigenen Reiter fuehrt der Klick ins Leere -> dort nicht verlinken.
    if (!ziel || ziel === activeTab || !onTabChange) return { value: s.count, label: s.label };
    return {
      value: s.count,
      label: s.label,
      onClick: () => onTabChange(ziel),
      active: false
    };
  });

  // Berechne Status-Infos für ein Event
  const getEventStatusInfo = (event: Event) => {
    const isPastEvent = istVergangen(event);
    const isParticipated = isPastEvent && event.is_registered;
    const attendanceStatus = event.attendance_status;
    // Warteliste: booking_status kann 'waitlist' oder 'pending' sein (Backend sendet beides)
    const isOnWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';
    // istAbgesagt() statt event.cancelled von Hand: Die Konfi-Liste kommt
    // aus GET /konfi/events und traegt beide Felder -- die Pruefung muss
    // dieselbe sein wie in Leitung und Team.
    const isCancelled = istAbgesagt(event);
    const isKonfirmationEvent = event.is_konfirmation;
    // Ausstehend: vergangen, angemeldet (confirmed), aber noch keine attendance
    const isAusstehend = isPastEvent && event.is_registered && !isOnWaitlist && !attendanceStatus;

    // Pflicht-Events: eigene Status-Logik
    const isMandatory = event.mandatory;
    const isOptedOut = event.is_opted_out || event.booking_status === 'opted_out';

    // Bestimme Farbe - Konfirmation IMMER Lila (auch wenn angemeldet)
    // Alle Status-Farben aus globalen Tokens — Änderung im CSS wirkt hier automatisch
    const C = {
      bonus: 'var(--app-color-bonus)',       // orange (Warteliste/Ausstehend/Bald)
      danger: 'var(--app-color-danger)',     // rot
      events: 'var(--app-color-events)',     // rot (Pflicht-Abgemeldet)
      success: 'var(--app-color-success)',   // gruen (Anwesend/Offen/Verbucht)
      info: 'var(--app-color-info)',         // blau (Pflicht angemeldet, Angemeldet)
      konfis: 'var(--app-color-konfis)',     // lila (Konfirmation)
      past: 'var(--app-color-neutral)',      // grau (vergangen)
    };
    let statusColor: string;
    if (isCancelled) statusColor = C.danger;
    else if (isMandatory && isOptedOut) statusColor = C.events;
    else if (isMandatory && isPastEvent && attendanceStatus === 'present') statusColor = C.success;
    else if (isMandatory && isPastEvent && attendanceStatus === 'absent') statusColor = C.danger;
    else if (isMandatory && isPastEvent) statusColor = C.bonus;
    // Pflicht-Event (Backend: registration_status='mandatory'): wer (auto-)
    // angemeldet ist, sieht BLAU (wie "angemeldet"); sonst nach Kapazität
    // gruen/orange/rot. Pflicht selbst ist zusaetzlich ein eigenes Badge.
    else if (isMandatory && !isPastEvent && (event.is_registered || isParticipated)) statusColor = C.info;
    else if (isMandatory && !isPastEvent && event.max_participants > 0 && event.registered_count >= event.max_participants && event.waitlist_enabled) statusColor = C.bonus;
    else if (isMandatory && !isPastEvent && event.max_participants > 0 && event.registered_count >= event.max_participants) statusColor = C.danger;
    else if (isMandatory && !isPastEvent) statusColor = C.success;
    else if (isKonfirmationEvent && !isPastEvent) statusColor = C.konfis; // Konfirmation = lila (analog Admin-Detail)
    else if (isParticipated && attendanceStatus === 'present') statusColor = C.success;
    else if (isParticipated && attendanceStatus === 'absent') statusColor = C.danger;
    else if (isAusstehend) statusColor = C.bonus;
    else if (isOnWaitlist) statusColor = C.bonus;
    else if (event.is_registered && !isPastEvent) statusColor = C.info;
    else if (isPastEvent) statusColor = C.past;
    else if (event.registration_status === 'open' && event.max_participants > 0 && event.registered_count >= event.max_participants && event.waitlist_enabled) statusColor = C.bonus;
    else if (event.registration_status === 'open' && event.max_participants > 0 && event.registered_count >= event.max_participants) statusColor = C.danger;
    else if (event.registration_status === 'open') statusColor = C.success;
    else if (event.registration_status === 'upcoming') statusColor = C.bonus;
    else statusColor = C.danger;

    // Bestimme Text (Pflicht ist separates Badge, nicht im Status-Text)
    let statusText: string;
    if (isCancelled) statusText = 'Abgesagt';
    else if (isMandatory && isOptedOut) statusText = 'Abgemeldet';
    else if (isMandatory && isPastEvent && attendanceStatus === 'present') statusText = 'Anwesend';
    else if (isMandatory && isPastEvent && attendanceStatus === 'absent') statusText = 'Gefehlt';
    else if (isMandatory && isPastEvent) statusText = 'Ausstehend';
    else if (isMandatory) statusText = 'Angemeldet'; // Pflicht-Event: Konfi ist automatisch angemeldet
    else if (isKonfirmationEvent && !isPastEvent && event.is_registered) statusText = 'Angemeldet';
    else if (isKonfirmationEvent && !isPastEvent) statusText = 'Offen';
    else if (isParticipated && attendanceStatus === 'present') statusText = 'Verbucht';
    else if (isParticipated && attendanceStatus === 'absent') statusText = 'Verpasst';
    else if (isAusstehend) statusText = 'Ausstehend';
    else if (isOnWaitlist) statusText = `Warteliste (${event.waitlist_position || '?'})`;
    else if (event.is_registered && !isPastEvent) statusText = 'Angemeldet';
    else if (event.registration_status === 'open' && event.max_participants > 0 && event.registered_count >= event.max_participants && event.waitlist_enabled) statusText = 'Warteliste';
    else if (event.registration_status === 'open' && event.max_participants > 0 && event.registered_count >= event.max_participants) statusText = 'Ausgebucht';
    else if (event.registration_status === 'open') statusText = 'Offen';
    else if (event.registration_status === 'upcoming') statusText = 'Bald';
    else if (isPastEvent) statusText = 'Vergangen';
    else statusText = 'Geschlossen';

    // Icon zentral aus der StatusBadge-Map -> Kreis-Icon == Corner-Badge-Icon.
    const statusIcon = getStatusIcon(statusText) || ICON_TERMIN_GEFUELLT;

    const shouldGrayOut = isPastEvent && !isParticipated && !isAusstehend;

    return { statusColor, statusText, statusIcon, isPastEvent, shouldGrayOut, isParticipated, isKonfirmationEvent };
  };

  // Filtere Events basierend auf aktivem Tab
  const getFilteredEvents = () => {
    switch (activeTab) {
      case 'meine':
        return events.filter(zaehltAlsMeiner);
      case 'alle':
        // ABGESAGTE BLEIBEN AN IHRER DATUMSPOSITION.
        // Der Server liefert nach event_date aufsteigend; hier wird bewusst
        // nicht umsortiert. Ausfuehrliche Begruendung in shared/eventFormatting.ts.
        return nonKonfirmationEvents.filter(e => !istVergangen(e));
      case 'konfirmation':
        return konfirmationEvents;
      default:
        return events;
    }
  };

  const filteredEvents = getFilteredEvents().filter(event => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (event.title || '').toLowerCase().includes(q) ||
           (event.location || '').toLowerCase().includes(q) ||
           (event.description || '').toLowerCase().includes(q);
  });

  return (
    <div>
      <SectionHeader
        title="Deine Events"
        subtitle="Termine und Veranstaltungen"
        icon={ICON_TERMIN_GEFUELLT}
        preset="events"
        stats={statsMitSprung}
        onInfo={() => presentLegend({ presentingElement: presentingElement || undefined })}
      />

      {headerSlot}

      {/* Reiter ZUERST, Suche darunter: erst
          eingrenzen, dann darin suchen -- wie im Chat. */}
      <div className="app-segment-wrapper">
        <IonSegment
          value={activeTab}
          onIonChange={(e) => onTabChange(e.detail.value as 'meine' | 'alle' | 'konfirmation')}
        >
          <IonSegmentButton value="alle">
            <IonLabel>Alle</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="meine">
            <IonLabel>Meine</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="konfirmation">
            <IonLabel>Konfi</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

      {/* Suche -- steht UNTER den Reitern, siehe Kommentar oben */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--events">
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" className="app-icon-color--system" style={{ fontSize: 'var(--app-text-standard)' }} />
            <IonInput
              value={searchText}
              onIonInput={(e) => setSearchText(e.detail.value || '')}
              placeholder="Events durchsuchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      {/* Events Liste */}
      <ListSection
        icon={ICON_TERMIN}
        title="Events"
        count={filteredEvents.length}
        iconColorClass="events"
        isEmpty={filteredEvents.length === 0}
        emptyIcon={ICON_TERMIN}
        emptyTitle="Keine Events gefunden"
        emptyMessage={
          activeTab === 'meine'
            ? 'Du bist noch für keine Events angemeldet'
            : activeTab === 'konfirmation'
            ? 'Keine Konfirmationstermine verfügbar'
            : 'Keine anstehenden Events'
        }
        emptyIconColor="var(--app-color-events)"
      >
        {filteredEvents.map((event, index) => {
          const statusInfo = getEventStatusInfo(event);
          const { statusColor, statusIcon, isPastEvent, shouldGrayOut, isParticipated, isKonfirmationEvent } = statusInfo;
          let statusText = statusInfo.statusText;
          const isCancelled = istAbgesagt(event);
          const isOptedOut = event.is_opted_out || event.booking_status === 'opted_out';
          // Konfirmations-Sperre: anderer Konfirmationstermin schon gebucht -> dieses
          // (nicht gebuchte, zukuenftige) Konfirmations-Event ist gesperrt/ausgegraut.
          const isKonfirmationLocked = isKonfirmationEvent && hasKonfirmationBooked && !event.is_registered && !isPastEvent;
          if (isKonfirmationLocked) statusText = 'Anderer Termin';
          const showBadge = !isPastEvent || isParticipated || isCancelled || isOptedOut || isKonfirmationLocked;

          // Kein IonItemSliding: es gab hier nie IonItemOptions, das Item liess
          // sich also anwischen und federte wirkungslos zurück — das wirkt
          // kaputt.
          return (
              <IonItem
                key={event.id}
                button
                onClick={() => onSelectEvent(event)}
                detail={false}
                lines="none"
                style={{
                  '--background': 'transparent',
                  '--padding-start': '0',
                  '--padding-end': '0',
                  '--inner-padding-end': '0',
                  '--inner-border-width': '0',
                  '--border-style': 'none',
                  '--min-height': 'auto',
                  display: 'block',
                  marginBottom: index < filteredEvents.length - 1 ? 'var(--app-abstand-eng)' : '0'
                }}
              >
                <div
                  className={`app-list-item app-list-item--events${selectedEventId === event.id ? ' app-list-item--selected' : ''}`}
                  style={{
                    width: '100%',
                    borderLeftColor: statusColor,
                    opacity: (shouldGrayOut || isKonfirmationLocked) ? 0.6 : 1,
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  {/* Eselsohr-Style Corner Badges (shared) - Konfirmation/Pflicht, Status.
                      KEIN Team-Badge: Konfis geht "Teamer gesucht" nichts an. */}
                  <EventCornerBadges
                    event={event}
                    statusText={statusText}
                    statusColor={statusColor}
                    showStatus={showBadge}
                    grayOut={shouldGrayOut}
                    hideTeam
                  />

                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      {/* Status Icon */}
                      <div
                        className="app-icon-circle app-icon-circle--lg"
                        style={{ backgroundColor: statusColor }}
                      >
                        <IonIcon icon={statusIcon} />
                      </div>

                      {/* Content */}
                      <div className="app-list-item__content">
                        {/* Zeile 1: Titel */}
                        <div
                          className="app-list-item__title app-list-item__title--events"
                          style={{
                            color: isCancelled || shouldGrayOut ? 'var(--app-text-muted)' : undefined,
                            textDecoration: titelDekoration('liste', event),
                            paddingRight: showBadge ? 'var(--app-freiraum-aktion-l)' : '0'
                          }}
                        >
                          {event.name}
                        </div>

                        <AbsageBlock event={event} variante="zeile" />

                        {/* Zeile 2: Buchungen + Warteliste + Punkte */}
                        <div className="app-list-item__meta">
                          {!event.mandatory && (
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ICON_GRUPPE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--participants'} />
                            {(event.registered_count || 0)}/{(event.max_participants || 0) > 0 ? event.max_participants : <IonIcon icon={ICON_UNENDLICH} style={{ verticalAlign: 'middle', fontSize: 'var(--app-icon-inline)' }} />}
                          </span>
                          )}
                          {event.waitlist_enabled && (event.waitlist_count ?? 0) > 0 && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_LISTE} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--waitlist'} />
                              {event.waitlist_count}/{event.max_waitlist_size || 10}
                            </span>
                          )}
                          {event.points > 0 && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_POKAL_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--points'} />
                              {event.points}P
                            </span>
                          )}
                          {/* Punkteart direkt hinter den Punkten. Gleiche Regel
                              wie im Detail: keine Konfi-Punkte, keine Art. */}
                          {zeigtPunkteart(event) && (
                            <span className="app-list-item__meta-item">
                              <IonIcon
                                icon={event.point_type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_GEMEINDE_GEFUELLT}
                                className={shouldGrayOut ? 'app-icon-color--muted' : (event.point_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde')}
                              />
                              {punkteartText(event)}
                            </span>
                          )}
                        </div>

                        {/* Zeile 3: Datum + Uhrzeit */}
                        <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ICON_TERMIN_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--events'} />
                            {formatDate(event.event_date)}
                          </span>
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ICON_UHRZEIT_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--time'} />
                            {formatTime(event.event_date)}
                          </span>
                        </div>

                        {/* Zeile 4: Ort (eigene Zeile) */}
                        {event.location && (
                          <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_ORT_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--location'} />
                              {event.location}
                            </span>
                          </div>
                        )}
                        {/* Zeile 5: Kategorien */}
                        {kategorienText(event) && (
                          <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                            <span className="app-list-item__meta-item app-list-item__meta-item--multiline">
                              <IonIcon icon={ICON_KATEGORIE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--category'} />
                              {kategorienText(event)}
                            </span>
                          </div>
                        )}
                        {/* Zeile 6: Was mitbringen */}
                        {event.bring_items && (
                          <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                            <span className="app-list-item__meta-item app-list-item__meta-item--multiline">
                              <IonIcon icon={ICON_MATERIAL} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--bring'} />
                              {event.bring_items}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </IonItem>
          );
        })}
      </ListSection>

    </div>
  );
};

export default EventsView;
