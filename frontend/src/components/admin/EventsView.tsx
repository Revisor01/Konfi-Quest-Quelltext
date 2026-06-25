import React, { useState, useRef } from 'react';
import {
  IonIcon,
  IonItem,
  IonLabel,
  IonInput,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonItemGroup,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  useIonModal
} from '@ionic/react';
import {
  people,
  peopleOutline,
  calendar,
  time,
  location,
  copy,
  ban,
  trash,
  trophy,
  listOutline,
  calendarOutline,
  shieldCheckmark,
  bagHandle,
  attachOutline,
  filterOutline,
  flame,
  search
} from 'ionicons/icons';
import { useApp } from '../../contexts/AppContext';
import { filterBySearchTerm } from '../../utils/helpers';
import { parseLocalTime, getLocalNow } from '../../utils/dateUtils';
import { SectionHeader, ListSection, StatusBadge, EventLegendModal } from '../shared';
import { getStatusIcon } from '../shared/StatusBadge';
import { Event } from '../../types/event';

interface EventsViewProps {
  events: Event[];
  onUpdate: () => void;
  onAddEventClick: () => void;
  onSelectEvent: (event: Event) => void;
  onDeleteEvent?: (event: Event) => void;
  onCopyEvent?: (event: Event) => void;
  onCancelEvent?: (event: Event) => void;
  activeTab?: 'aktuell' | 'verbuchen' | 'vergangen';
  onTabChange?: (tab: 'aktuell' | 'verbuchen' | 'vergangen') => void;
  eventCounts?: {
    aktuell: number;
    verbuchen: number;
    vergangen: number;
  };
  jahrgaenge?: Array<{id: number; name: string}>;
  selectedJahrgang?: number | null;
  onJahrgangChange?: (jahrgangId: number | null) => void;
  searchText?: string;
  onSearchChange?: (text: string) => void;
  // Fuer Card-Modal-Optik (Sheet ueber der Seite statt Vollbild).
  presentingElement?: HTMLElement | null;
}

const EventsView: React.FC<EventsViewProps> = ({
  events,
  onUpdate,
  onAddEventClick,
  onSelectEvent,
  onDeleteEvent,
  onCopyEvent,
  onCancelEvent,
  activeTab = 'aktuell',
  onTabChange,
  eventCounts,
  jahrgaenge,
  selectedJahrgang,
  onJahrgangChange,
  searchText,
  onSearchChange,
  presentingElement
}) => {
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());

  const [presentLegend, dismissLegend] = useIonModal(EventLegendModal, {
    variant: 'admin',
    onClose: () => dismissLegend(),
  });

  // Events werden bereits von der Page sortiert übergeben
  const filteredAndSortedEvents = events;

  // Mehrtaegige Events gelten erst nach ihrem ENDE (event_end_time) als vergangen.
  const eventEndDate = (event: Event) => new Date(event.event_end_time || event.event_date);

  const getUpcomingEvents = () => {
    const now = new Date();
    return events.filter(event => eventEndDate(event) > now);
  };

  const getPastEvents = () => {
    const now = new Date();
    return events.filter(event => eventEndDate(event) <= now);
  };

  const getOpenEvents = () => {
    return events.filter(event => calculateRegistrationStatus(event) === 'open');
  };

  const getTotalPoints = () => {
    return events.reduce((sum, event) => sum + event.points, 0);
  };

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

  const calculateRegistrationStatus = (event: Event): 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory' => {
    // Use the backend-calculated status directly
    return event.registration_status as 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory';
  };

  const getRegistrationStatusColor = (event: Event) => {
    const status = calculateRegistrationStatus(event);
    switch (status) {
      case 'upcoming': return 'medium';
      case 'open': return 'success';
      case 'closed': return 'danger';
      case 'cancelled': return 'danger';
      default: return 'medium';
    }
  };

  const getRegistrationStatusText = (event: Event) => {
    const status = calculateRegistrationStatus(event);
    switch (status) {
      case 'upcoming': return 'Bald verfügbar';
      case 'open': return 'Anmeldung offen';
      case 'closed': return 'Anmeldung geschlossen';
      case 'cancelled': return 'Abgesagt';
      default: return 'Unbekannt';
    }
  };

  const getTotalRegistrations = () => {
    return events.reduce((sum, event) => sum + event.registered_count, 0);
  };

  const getAverageParticipation = () => {
    // Nur Events mit echter Kapazitaet (max_participants > 0) zaehlen in die
    // Auslastungs-Statistik. Unbegrenzte Events (max_participants = 0) wuerden
    // sonst eine Division durch 0 (-> NaN) verursachen.
    const capped = events.filter(event => (event.max_participants || 0) > 0);
    if (capped.length === 0) return 0;
    const total = capped.reduce((sum, event) => sum + (event.registered_count / event.max_participants), 0);
    return Math.round((total / capped.length) * 100);
  };

  return (
    <>
      <SectionHeader
        title="Events"
        subtitle="Termine und Veranstaltungen"
        icon={calendar}
        preset="events"
        onInfo={() => presentLegend({ presentingElement: presentingElement || undefined })}
        stats={[
          // Stats GLOBAL ueber alle Events zaehlen (eventCounts von der Page),
          // NICHT nur ueber die Events des aktiven Tabs (`events`) — sonst waren
          // zwei der drei Werte je nach Tab faelschlich 0.
          { value: eventCounts?.aktuell ?? getUpcomingEvents().length, label: 'Anstehend' },
          {
            value: eventCounts?.verbuchen ?? events.filter(e =>
              new Date(e.event_date) < new Date() &&
              (e.pending_bookings_count ?? 0) > 0
            ).length,
            label: 'Verbuchen'
          },
          { value: eventCounts?.vergangen ?? getPastEvents().length, label: 'Vergangen' }
        ]}
      />


      {/* Suche & Filter */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--events">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          {onSearchChange && (
            <IonItem>
              <IonIcon icon={search} slot="start" className="app-icon-color--system" style={{ fontSize: '1rem' }} />
              <IonInput
                value={searchText}
                onIonInput={(e) => onSearchChange(e.detail.value || '')}
                placeholder="Event suchen..."
              />
            </IonItem>
          )}
          {jahrgaenge && jahrgaenge.length > 0 && onJahrgangChange && (
            <IonItem>
              <IonIcon icon={calendarOutline} slot="start" className="app-icon-color--system" style={{ fontSize: '1rem' }} />
              <IonSelect
                value={selectedJahrgang}
                onIonChange={(e) => onJahrgangChange(e.detail.value || null)}
                interface="popover"
                placeholder="Jahrgang"
                style={{ width: '100%' }}
              >
                <IonSelectOption value={null}>Alle Jahrgänge</IonSelectOption>
                {jahrgaenge.map(j => (
                  <IonSelectOption key={j.id} value={j.id}>{j.name}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
          )}
        </IonItemGroup>
      </IonList>

      {/* Tab Navigation - einfaches IonSegment */}
      {onTabChange && (
        <div className="app-segment-wrapper">
          <IonSegment
            value={activeTab}
            onIonChange={(e) => onTabChange(e.detail.value as any)}
          >
            <IonSegmentButton value="aktuell">
              <IonLabel>Aktuell</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="verbuchen">
              <IonLabel>Verbuchen</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="vergangen">
              <IonLabel>Vergangen</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </div>
      )}

      {/* Events Liste */}
      <ListSection
        icon={calendarOutline}
        title="Events"
        count={filteredAndSortedEvents.length}
        iconColorClass="events"
        isEmpty={filteredAndSortedEvents.length === 0}
        emptyIcon={calendarOutline}
        emptyTitle="Keine Events gefunden"
        emptyMessage={
          activeTab === 'verbuchen'
            ? 'Keine Events zum Verbuchen'
            : activeTab === 'vergangen'
            ? 'Keine vergangenen Events'
            : 'Keine anstehenden Events'
        }
        emptyIconColor="#dc2626"
      >
        {filteredAndSortedEvents.map((event, index) => {
              const isPastEvent = new Date(event.event_date) < new Date();
              const isCancelled = event.registration_status === 'cancelled';
              // Konfirmations-Event ueber das is_konfirmation-Flag (Phase 117, Migration 091).
              const isKonfirmationEvent = event.is_konfirmation === true;
              const hasUnprocessedBookings = isPastEvent && event.registered_count > 0 && event.pending_bookings_count && event.pending_bookings_count > 0;
              const isFullyProcessed = isPastEvent && event.registered_count > 0 && (!event.pending_bookings_count || event.pending_bookings_count === 0);
              const shouldGrayOut = isPastEvent && !hasUnprocessedBookings;

              // Farbe basierend auf Status - Konfirmation in Lila!
              const statusColor = (() => {
                if (isCancelled) return '#dc3545';
                if (event.mandatory && isPastEvent && hasUnprocessedBookings) return '#007aff';
                if (event.mandatory && isPastEvent) return '#6c757d';
                // KEIN pauschales Rot fuer Pflicht-Events: Pflicht ist ein eigenes
                // Badge. Die Farbe richtet sich nach dem Anmeldestatus (offen=gruen,
                // nur-Warteliste=orange, ausgebucht-ohne-Warteliste=rot) — wie im
                // Detail. Sonst war jedes offene Pflicht-Event faelschlich rot.
                if (isKonfirmationEvent && !isPastEvent) return '#5b21b6'; // Lila für Konfirmation
                if (isFullyProcessed) return '#6c757d';
                if (hasUnprocessedBookings) return '#007aff'; // Blau für Verbuchen
                if (isPastEvent) return '#6c757d';
                // Pflicht-Events haben registration_status='mandatory' (Backend) — sie
                // werden wie 'open' nach Kapazitaet gefaerbt (sonst fielen sie unten
                // auf Rot durch). Anmeldbar = open ODER mandatory.
                const regStatus = calculateRegistrationStatus(event);
                const isAnmeldbar = regStatus === 'open' || regStatus === 'mandatory';
                if (isAnmeldbar && event.max_participants > 0 && event.registered_count >= event.max_participants && event.waitlist_enabled) return '#fd7e14'; // Orange - Warteliste
                if (isAnmeldbar && event.max_participants > 0 && event.registered_count >= event.max_participants) return '#dc3545'; // Rot - Ausgebucht
                if (isAnmeldbar) return '#34c759'; // Grün - offen/anmeldbar
                if (regStatus === 'upcoming') return '#fd7e14'; // Orange für Bald
                return '#dc3545';
              })();

              // Status-Text (Pflicht und Konfirmation sind separate Badges)
              const statusText = (() => {
                if (isCancelled) return 'Abgesagt';
                if (hasUnprocessedBookings) return 'Verbuchen';
                if (isFullyProcessed) return 'Verbucht';
                const status = calculateRegistrationStatus(event);
                if (status === 'open' && event.max_participants > 0 && event.registered_count >= event.max_participants && event.waitlist_enabled) return 'Warteliste';
                if (status === 'open' && event.max_participants > 0 && event.registered_count >= event.max_participants) return 'Ausgebucht';
                if (status === 'open') return 'Offen';
                if (status === 'upcoming') return 'Bald';
                return 'Geschlossen';
              })();

              // Icon zentral aus der StatusBadge-Map -> Kreis-Icon == Corner-Badge-Icon.
              const statusIcon = getStatusIcon(statusText) || calendar;

              return (
              <IonItemSliding key={event.id} style={{ marginBottom: index < filteredAndSortedEvents.length - 1 ? '8px' : '0' }}>
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
                      opacity: shouldGrayOut ? 0.6 : 1,
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Eselsohr-Style Corner Badges - Team links innen, Konfirmation/Pflicht, Status in der Ecke */}
                    <div className="app-corner-badges" style={{ opacity: shouldGrayOut ? 0.5 : 1 }}>
                      {(event.teamer_only || event.teamer_needed) && (
                        <>
                          <div
                            className="app-corner-badge"
                            style={{ backgroundColor: 'var(--app-color-teamer)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                            title={event.teamer_only ? 'Nur Team' : 'Team gesucht'}
                          >
                            <IonIcon icon={people} style={{ color: '#fff', fontSize: '0.85rem' }} />
                          </div>
                          <div className="app-corner-badges__separator" />
                        </>
                      )}
                      {isKonfirmationEvent && (
                        <>
                          <div
                            className="app-corner-badge"
                            style={{ backgroundColor: 'var(--app-color-konfis)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                            title="Konfirmation"
                          >
                            <IonIcon icon={flame} style={{ color: '#fff', fontSize: '0.85rem' }} />
                          </div>
                          <div className="app-corner-badges__separator" />
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
                          <div className="app-corner-badges__separator" />
                        </>
                      )}
                      <StatusBadge statusText={statusText} statusColor={statusColor} />
                    </div>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        {/* Icon */}
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
                            className="app-list-item__title"
                            style={{
                              color: isCancelled || shouldGrayOut ? '#999' : undefined,
                              textDecoration: isCancelled ? 'line-through' : 'none',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              paddingRight: '70px'
                            }}
                          >
                            {event.name}
                            {event.is_series && (
                              <IonIcon icon={copy} className="app-icon-color--location" style={{ fontSize: '0.8rem', opacity: 0.7, flexShrink: 0 }} />
                            )}
                          </div>
                          {event.jahrgang_names && (
                            <div className="app-list-item__subtitle" style={{ color: shouldGrayOut ? '#999' : undefined }}>
                              {event.jahrgang_names.split(',').join(' \u00B7 ')}
                            </div>
                          )}

                          {/* Zeile 2: Buchungen + Teamer + Warteliste + Punkte */}
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--participants'} />
                              {event.mandatory
                                ? `${event.registered_count - (event.teamer_count || 0)} Konfis`
                                : `${event.registered_count - (event.teamer_count || 0)}/${(event.max_participants || 0) > 0 ? event.max_participants : '\u221E'}`
                              }
                            </span>
                            {(event.teamer_count || 0) > 0 && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={people} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--team'} />
                                {event.teamer_count} Team
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
                          {/* Zeile 6: Material */}
                          {(event.material_count || 0) > 0 && (
                            <div className="app-list-item__meta" style={{ marginTop: '4px' }}>
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={attachOutline} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--material'} />
                                {event.material_count} {event.material_count === 1 ? 'Material' : 'Materialien'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                {(onDeleteEvent || onCancelEvent) && (
                  <IonItemOptions side="end" className="app-swipe-actions">
                    {onCancelEvent && (
                      <IonItemOption
                        onClick={() => onCancelEvent(event)}
                        className="app-swipe-action"
                      >
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--warning">
                          <IonIcon icon={ban} />
                        </div>
                      </IonItemOption>
                    )}
                    {onDeleteEvent && (
                      <IonItemOption
                        onClick={() => onDeleteEvent(event)}
                        className="app-swipe-action"
                      >
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                          <IonIcon icon={trash} />
                        </div>
                      </IonItemOption>
                    )}
                  </IonItemOptions>
                )}
              </IonItemSliding>
              );
            })}
      </ListSection>
    </>
  );
};

export default EventsView;