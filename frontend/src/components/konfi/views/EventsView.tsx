import React, { useMemo, useState } from 'react';
import {
  IonIcon,
  IonItem,
  IonList,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonItemSliding,
  IonListHeader,
  IonItemGroup,
  IonInput,
  useIonModal
} from '@ionic/react';
import {
  calendar,
  time,
  location,
  people,
  checkmarkCircle,
  hourglass,
  close,
  trophy,
  listOutline,
  calendarOutline,
  lockOpenOutline,
  shieldCheckmark,
  bagHandle,
  closeCircle,
  search,
  flame,
  filterOutline,
  infinite
} from 'ionicons/icons';
import { SectionHeader, ListSection, StatusBadge, EventLegendModal } from '../../shared';
import { getStatusIcon } from '../../shared/StatusBadge';
import { Event } from '../../../types/event';

interface EventsViewProps {
  events: Event[];
  activeTab: 'meine' | 'alle' | 'konfirmation';
  onTabChange: (tab: 'meine' | 'alle' | 'konfirmation') => void;
  onSelectEvent: (event: Event) => void;
  onUpdate: () => void;
  // Fuer Card-Modal-Optik (Sheet ueber der Seite statt Vollbild).
  presentingElement?: HTMLElement | null;
}

const EventsView: React.FC<EventsViewProps> = ({
  events,
  activeTab,
  onTabChange,
  onSelectEvent,
  onUpdate,
  presentingElement
}) => {
  const [searchText, setSearchText] = useState('');

  const [presentLegend, dismissLegend] = useIonModal(EventLegendModal, {
    variant: 'konfi',
    onClose: () => dismissLegend(),
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

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

  const eventCounts = useMemo(() => ({
    all: events.length,
    meine: events.filter(e => e.is_registered || e.booking_status === 'opted_out').length,
    alle: nonKonfirmationEvents.filter(e => new Date(e.event_date) >= new Date()).length,
    meineUpcoming: events.filter(e => (e.is_registered || e.booking_status === 'opted_out') && new Date(e.event_date) >= new Date()).length,
    meinePast: events.filter(e => (e.is_registered || e.booking_status === 'opted_out') && new Date(e.event_date) < new Date()).length,
    konfirmation: konfirmationEvents.length,
    konfirmationUpcoming: konfirmationEvents.filter(e => new Date(e.event_date) >= new Date()).length,
    konfirmationRegistered: konfirmationEvents.filter(e => e.is_registered).length
  }), [events, konfirmationEvents, nonKonfirmationEvents]);

  const getStatLabelsAndCounts = () => {
    switch (activeTab) {
      case 'meine':
        return [
          { label: 'Gebucht', count: eventCounts.meine, icon: calendar },
          { label: 'Anstehend', count: eventCounts.meineUpcoming, icon: time },
          { label: 'Vergangen', count: eventCounts.meinePast, icon: checkmarkCircle }
        ];
      case 'alle':
        return [
          { label: 'Gesamt', count: eventCounts.alle, icon: calendar },
          { label: 'Anstehend', count: nonKonfirmationEvents.filter(e => new Date(e.event_date) >= new Date() && !e.is_registered).length, icon: time },
          { label: 'Gebucht', count: nonKonfirmationEvents.filter(e => e.is_registered).length, icon: checkmarkCircle }
        ];
      case 'konfirmation':
        return [
          { label: 'Gesamt', count: eventCounts.konfirmation, icon: calendar },
          { label: 'Anstehend', count: eventCounts.konfirmationUpcoming, icon: time },
          { label: 'Gebucht', count: eventCounts.konfirmationRegistered, icon: checkmarkCircle }
        ];
      default:
        return [
          { label: 'Gesamt', count: eventCounts.all, icon: calendar },
          { label: 'Anstehend', count: eventCounts.alle, icon: time },
          { label: 'Gebucht', count: eventCounts.meine, icon: checkmarkCircle }
        ];
    }
  };

  const statsData = getStatLabelsAndCounts();

  // Berechne Status-Infos für ein Event
  const getEventStatusInfo = (event: Event) => {
    // Mehrtaegige Events sind erst nach ihrem Ende (event_end_time) vorbei.
    const isPastEvent = new Date(event.event_end_time || event.event_date) < new Date();
    const isParticipated = isPastEvent && event.is_registered;
    const attendanceStatus = event.attendance_status;
    // Warteliste: booking_status kann 'waitlist' oder 'pending' sein (Backend sendet beides)
    const isOnWaitlist = event.booking_status === 'waitlist' || event.booking_status === 'pending';
    const isCancelled = event.cancelled;
    const isKonfirmationEvent = event.is_konfirmation;
    // Ausstehend: vergangen, angemeldet (confirmed), aber noch keine attendance
    const isAusstehend = isPastEvent && event.is_registered && !isOnWaitlist && !attendanceStatus;

    // Pflicht-Events: eigene Status-Logik
    const isMandatory = event.mandatory;
    const isOptedOut = event.is_opted_out || event.booking_status === 'opted_out';

    // Bestimme Farbe - Konfirmation IMMER Lila (auch wenn angemeldet)
    // Alle Status-Farben aus globalen Tokens — Aenderung im CSS wirkt hier automatisch
    const C = {
      bonus: 'var(--app-color-bonus)',       // orange (Warteliste/Ausstehend/Bald)
      danger: 'var(--app-color-danger)',     // rot
      events: 'var(--app-color-events)',     // rot (Pflicht-Abgemeldet)
      success: 'var(--app-color-success)',   // gruen (Anwesend/Offen/Verbucht)
      info: 'var(--app-color-info)',         // blau (Pflicht angemeldet, Angemeldet)
      konfis: 'var(--app-color-konfis)',     // lila (Konfirmation)
      past: '#6c757d',                       // grau (vergangen) — kein Token
    };
    let statusColor = C.bonus;
    if (isCancelled) statusColor = C.danger;
    else if (isMandatory && isOptedOut) statusColor = C.events;
    else if (isMandatory && isPastEvent && attendanceStatus === 'present') statusColor = C.success;
    else if (isMandatory && isPastEvent && attendanceStatus === 'absent') statusColor = C.danger;
    else if (isMandatory && isPastEvent) statusColor = C.bonus;
    // Pflicht-Event (Backend: registration_status='mandatory'): wer (auto-)
    // angemeldet ist, sieht BLAU (wie "angemeldet"); sonst nach Kapazitaet
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
    let statusText = 'Offen';
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
    const statusIcon = getStatusIcon(statusText) || calendar;

    const shouldGrayOut = isPastEvent && !isParticipated && !isAusstehend;

    return { statusColor, statusText, statusIcon, isPastEvent, shouldGrayOut, isParticipated, isKonfirmationEvent };
  };

  // Filtere Events basierend auf aktivem Tab
  const getFilteredEvents = () => {
    switch (activeTab) {
      case 'meine':
        return events.filter(e => e.is_registered || e.booking_status === 'opted_out');
      case 'alle':
        return nonKonfirmationEvents.filter(e => new Date(e.event_date) >= new Date());
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
        icon={calendar}
        preset="events"
        stats={statsData.map(s => ({ value: s.count, label: s.label }))}
        onInfo={() => presentLegend({ presentingElement: presentingElement || undefined })}
      />

      {/* Suche & Filter — wie Chat-Pattern */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--events">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={search} slot="start" className="app-icon-color--system" style={{ fontSize: '1rem' }} />
            <IonInput
              value={searchText}
              onIonInput={(e) => setSearchText(e.detail.value || '')}
              placeholder="Events durchsuchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      {/* Tab Navigation */}
      <div className="app-segment-wrapper">
        <IonSegment
          value={activeTab}
          onIonChange={(e) => onTabChange(e.detail.value as any)}
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

      {/* Events Liste */}
      <ListSection
        icon={calendarOutline}
        title="Events"
        count={filteredEvents.length}
        iconColorClass="events"
        isEmpty={filteredEvents.length === 0}
        emptyIcon={calendarOutline}
        emptyTitle="Keine Events gefunden"
        emptyMessage={
          activeTab === 'meine'
            ? 'Du bist noch für keine Events angemeldet'
            : activeTab === 'konfirmation'
            ? 'Keine Konfirmationstermine verfügbar'
            : 'Keine anstehenden Events'
        }
        emptyIconColor="#dc2626"
      >
        {filteredEvents.map((event, index) => {
          const statusInfo = getEventStatusInfo(event);
          const { statusColor, statusIcon, isPastEvent, shouldGrayOut, isParticipated, isKonfirmationEvent } = statusInfo;
          let statusText = statusInfo.statusText;
          const isCancelled = event.cancelled;
          const isOptedOut = event.is_opted_out || event.booking_status === 'opted_out';
          // Konfirmations-Sperre: anderer Konfirmationstermin schon gebucht -> dieses
          // (nicht gebuchte, zukuenftige) Konfirmations-Event ist gesperrt/ausgegraut.
          const isKonfirmationLocked = isKonfirmationEvent && hasKonfirmationBooked && !event.is_registered && !isPastEvent;
          if (isKonfirmationLocked) statusText = 'Anderer Termin';
          const showBadge = !isPastEvent || isParticipated || isCancelled || isOptedOut || isKonfirmationLocked;

          return (
            <IonItemSliding key={event.id}>
              <IonItem
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
                  '--min-height': 'auto'
                }}
              >
                <div
                  className="app-list-item app-list-item--events"
                  style={{
                    width: '100%',
                    borderLeftColor: statusColor,
                    opacity: (shouldGrayOut || isKonfirmationLocked) ? 0.6 : 1,
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  {/* Eselsohr-Style Corner Badges - Konfirmation/Pflicht, Status in der Ecke.
                      KEIN Team-Badge: Konfis geht "Teamer gesucht" nichts an. */}
                  {(showBadge || event.mandatory || isKonfirmationEvent) && (
                    <div className="app-corner-badges" style={{ opacity: shouldGrayOut ? 0.5 : 1 }}>
                      {isKonfirmationEvent && (
                        <>
                          <div
                            className="app-corner-badge"
                            style={{ backgroundColor: 'var(--app-color-konfis)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                            title="Konfirmation"
                          >
                            <IonIcon icon={flame} style={{ color: '#fff', fontSize: '0.85rem' }} />
                          </div>
                          {(event.mandatory || showBadge) && <div className="app-corner-badges__separator" />}
                        </>
                      )}
                      {event.mandatory && (
                        <>
                          <div
                            className="app-corner-badge"
                            style={{ backgroundColor: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                            title="Pflichtveranstaltung"
                          >
                            <IonIcon icon={shieldCheckmark} style={{ color: '#fff', fontSize: '0.85rem' }} />
                          </div>
                          {showBadge && <div className="app-corner-badges__separator" />}
                        </>
                      )}
                      {showBadge && <StatusBadge statusText={statusText} statusColor={statusColor} />}
                    </div>
                  )}

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
                            color: isCancelled || shouldGrayOut ? '#999' : undefined,
                            textDecoration: isCancelled ? 'line-through' : 'none',
                            paddingRight: showBadge ? '70px' : '0'
                          }}
                        >
                          {event.name}
                        </div>

                        {/* Zeile 2: Buchungen + Warteliste + Punkte */}
                        <div className="app-list-item__meta">
                          {!event.mandatory && (
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--participants'} />
                            {event.registered_count - (event.teamer_count || 0)}/{(event.max_participants || 0) > 0 ? event.max_participants : <IonIcon icon={infinite} style={{ verticalAlign: 'middle', fontSize: '0.9em' }} />}
                          </span>
                          )}
                          {event.waitlist_enabled && (event.waitlist_count ?? 0) > 0 && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={listOutline} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--waitlist'} />
                              {event.waitlist_count}/{event.max_waitlist_size || 10}
                            </span>
                          )}
                          {event.points > 0 && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={trophy} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--points'} />
                              {event.points}P
                            </span>
                          )}
                        </div>

                        {/* Zeile 3: Datum + Uhrzeit */}
                        <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={calendar} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--events'} />
                            {formatDate(event.event_date)}
                          </span>
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={time} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--time'} />
                            {formatTime(event.event_date)}
                          </span>
                        </div>

                        {/* Zeile 4: Ort (eigene Zeile) */}
                        {event.location && (
                          <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={location} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--location'} />
                              {event.location}
                            </span>
                          </div>
                        )}
                        {/* Zeile 5: Was mitbringen */}
                        {event.bring_items && (
                          <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                            <span className="app-list-item__meta-item app-list-item__meta-item--multiline">
                              <IonIcon icon={bagHandle} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--bring'} />
                              {event.bring_items}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </IonItem>
            </IonItemSliding>
          );
        })}
      </ListSection>

    </div>
  );
};

export default EventsView;
