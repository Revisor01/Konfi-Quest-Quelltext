import React from 'react';
import { IonIcon, IonItem, IonLabel, IonInput, IonItemSliding, IonItemOptions, IonItemOption, IonItemGroup, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonList, IonListHeader, useIonModal } from '@ionic/react';
import {
  ICON_ANHANG,
  ICON_BEARBEITEN,
  ICON_FILTER,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GESPERRT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_KATEGORIE_GEFUELLT,
  ICON_KOPIEREN_GEFUELLT,
  ICON_LISTE,
  ICON_LOESCHEN_GEFUELLT,
  ICON_MATERIAL,
  ICON_ORT_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_RUECKGAENGIG,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
} from '../shared/icons';
import { SectionHeader, ListSection, EventLegendModal, EventCornerBadges, AbsageBlock, formatEventDate as formatDate, formatEventTime as formatTime, istVergangen, istAbgesagt, titelDekoration, eventEnde, kategorienText, zeigtPunkteart, punkteartText } from '../shared';
import { getStatusIcon } from '../shared/StatusBadge';
import { Event } from '../../types/event';
import { closeOpenSlidingItems } from '../../utils/slidingItems';

interface EventsViewProps {
  events: Event[];
  onSelectEvent: (event: Event) => void;
  onDeleteEvent?: (event: Event) => void;
  onCancelEvent?: (event: Event) => void;
  // Absage zuruecknehmen -- nur an abgesagten Terminen sichtbar.
  onZuruecknehmen?: (event: Event) => void;
  // Termin kopieren. Oeffnet das Anlege-Formular vorbefuellt;
  // angelegt wird erst beim Speichern.
  onKopieren?: (event: Event) => void;
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
  // Für Card-Modal-Optik (Sheet über der Seite statt Vollbild).
  presentingElement?: HTMLElement | null;
  // Im iPad-Split-View aktuell rechts geoeffnetes Event (für Highlighting).
  selectedEventId?: number | null;
  // Zusaetzlicher Inhalt DIREKT UNTER dem SectionHeader (z.B. das Events|Aktivitäten-
  // Hauptsegment der Page, analog zum Konfi-Pattern in KonfiEventsPage).
  headerSlot?: React.ReactNode;
}

const EventsView: React.FC<EventsViewProps> = ({
  events,
  onSelectEvent,
  onDeleteEvent,
  onCancelEvent,
  onZuruecknehmen,
  onKopieren,
  activeTab = 'aktuell',
  onTabChange,
  eventCounts,
  jahrgaenge,
  selectedJahrgang,
  onJahrgangChange,
  searchText,
  onSearchChange,
  presentingElement,
  selectedEventId,
  headerSlot
}) => {

  const [presentLegend, dismissLegend] = useIonModal(EventLegendModal, {
    variant: 'admin',
    onClose: () => dismissLegend(),
  });

  // Events werden bereits von der Page sortiert übergeben
  const filteredAndSortedEvents = events;

  const eventEndDate = eventEnde;

  const getUpcomingEvents = () => {
    const now = new Date();
    return events.filter(event => eventEndDate(event) > now);
  };

  const getPastEvents = () => {
    const now = new Date();
    return events.filter(event => eventEndDate(event) <= now);
  };



  const calculateRegistrationStatus = (event: Event): 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory' => {
    // Use the backend-calculated status directly
    return event.registration_status as 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory';
  };





  return (
    <>
      <SectionHeader
        title="Events"
        subtitle="Termine und Veranstaltungen"
        icon={ICON_TERMIN_GEFUELLT}
        preset="events"
        onInfo={() => presentLegend({ presentingElement: presentingElement || undefined })}
        stats={[
          // Stats GLOBAL über alle Events zählen (eventCounts von der Page),
          // NICHT nur über die Events des aktiven Tabs (`events`) — sonst waren
          // zwei der drei Werte je nach Tab faelschlich 0.
          // Die drei Kacheln entsprechen genau den drei Reitern und schalten
          // beim Antippen dorthin.
          {
            value: eventCounts?.aktuell ?? getUpcomingEvents().length,
            label: 'Anstehend',
            onClick: onTabChange ? () => onTabChange('aktuell') : undefined,
            active: activeTab === 'aktuell'
          },
          {
            // istVergangen statt event_date: Ein mehrtaegiger Termin ist erst
            // nach seinem letzten Tag vorbei. Der Fallback wich damit von der
            // Liste ab, die er zaehlt (AdminEventsPage.getVerbuchenEvents
            // rechnet ueber das Terminende) -- bei einer laufenden Freizeit
            // haette die Kachel sie schon als verbuchbar gefuehrt.
            value: eventCounts?.verbuchen ?? events.filter(e =>
              istVergangen(e) &&
              (e.pending_bookings_count ?? 0) > 0
            ).length,
            label: 'Verbuchen',
            onClick: onTabChange ? () => onTabChange('verbuchen') : undefined,
            active: activeTab === 'verbuchen'
          },
          {
            value: eventCounts?.vergangen ?? getPastEvents().length,
            label: 'Vergangen',
            onClick: onTabChange ? () => onTabChange('vergangen') : undefined,
            active: activeTab === 'vergangen'
          }
        ]}
      />

      {headerSlot}

      {/* Reiter ZUERST, Suche darunter: Erst grenzt
          man die Menge ein, dann sucht man darin -- wie im Chat. Vorher
          stand die Suche oben und man tippte einen Namen, bevor klar war,
          in welchem Zeitraum ueberhaupt gesucht wird. */}
      {onTabChange && (
        <div className="app-segment-wrapper">
          <IonSegment
            value={activeTab}
            onIonChange={(e) => onTabChange(e.detail.value as 'aktuell' | 'verbuchen' | 'vergangen')}
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

      {/* Suche -- steht UNTER den Reitern, siehe Kommentar oben */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--events">
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          {onSearchChange && (
            <IonItem>
              <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" className="app-icon-color--system" style={{ fontSize: 'var(--app-text-standard)' }} />
              <IonInput
                value={searchText}
                onIonInput={(e) => onSearchChange(e.detail.value || '')}
                placeholder="Event suchen..."
              />
            </IonItem>
          )}
          {jahrgaenge && jahrgaenge.length > 0 && onJahrgangChange && (
            <IonItem>
              <IonIcon icon={ICON_TERMIN} slot="start" className="app-icon-color--system" style={{ fontSize: 'var(--app-text-standard)' }} />
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

      {/* Events Liste */}
      <ListSection
        icon={ICON_TERMIN}
        title="Events"
        count={filteredAndSortedEvents.length}
        iconColorClass="events"
        isEmpty={filteredAndSortedEvents.length === 0}
        emptyIcon={ICON_TERMIN}
        emptyTitle="Keine Events gefunden"
        emptyMessage={
          activeTab === 'verbuchen'
            ? 'Keine Events zum Verbuchen'
            : activeTab === 'vergangen'
            ? 'Keine vergangenen Events'
            : 'Keine anstehenden Events'
        }
        emptyIconColor="var(--app-color-events)"
      >
        {filteredAndSortedEvents.map((event, index) => {
              const isPastEvent = istVergangen(event);
              // istAbgesagt() prueft BEIDE Felder: GET /events liefert
              // registration_status, GET /events/cancelled zusaetzlich
              // cancelled. Beide Listen laufen durch diese Ansicht.
              const isCancelled = istAbgesagt(event);
              // Konfirmations-Event über das is_konfirmation-Flag (Phase 117, Migration 091).
              const isKonfirmationEvent = event.is_konfirmation === true;
              const hatBuchungen = (event.registered_count || 0) > 0 || (event.teamer_count || 0) > 0;
              const hasUnprocessedBookings = isPastEvent && hatBuchungen && !!event.pending_bookings_count && event.pending_bookings_count > 0;
              const isFullyProcessed = isPastEvent && hatBuchungen && (!event.pending_bookings_count || event.pending_bookings_count === 0);
              const shouldGrayOut = isPastEvent && !hasUnprocessedBookings;

              // Farbe basierend auf Status - Konfirmation in Lila!
              const statusColor = (() => {
                if (isCancelled) return 'var(--app-color-danger)';
                if (event.mandatory && isPastEvent && hasUnprocessedBookings) return 'var(--app-color-info)';
                if (event.mandatory && isPastEvent) return 'var(--app-color-neutral)';
                // KEIN pauschales Rot für Pflicht-Events: Pflicht ist ein eigenes
                // Badge. Die Farbe richtet sich nach dem Anmeldestatus (offen=gruen,
                // nur-Warteliste=orange, ausgebucht-ohne-Warteliste=rot) — wie im
                // Detail. Sonst war jedes offene Pflicht-Event faelschlich rot.
                if (isKonfirmationEvent && !isPastEvent) return 'var(--app-color-konfis)'; // Lila für Konfirmation
                if (isFullyProcessed) return 'var(--app-color-neutral)';
                if (hasUnprocessedBookings) return 'var(--app-color-info)'; // Blau für Verbuchen
                if (isPastEvent) return 'var(--app-color-neutral)';
                // Pflicht-Events haben registration_status='mandatory' (Backend) — sie
                // werden wie 'open' nach Kapazität gefaerbt (sonst fielen sie unten
                // auf Rot durch). Anmeldbar = open ODER mandatory.
                const regStatus = calculateRegistrationStatus(event);
                const isAnmeldbar = regStatus === 'open' || regStatus === 'mandatory';
                if (isAnmeldbar && event.max_participants > 0 && event.registered_count >= event.max_participants && event.waitlist_enabled) return 'var(--app-color-bonus)'; // Orange - Warteliste
                if (isAnmeldbar && event.max_participants > 0 && event.registered_count >= event.max_participants) return 'var(--app-color-danger)'; // Rot - Ausgebucht
                if (isAnmeldbar) return 'var(--app-color-success)'; // Grün - offen/anmeldbar
                if (regStatus === 'upcoming') return 'var(--app-color-bonus)'; // Orange für Bald
                return 'var(--app-color-danger)';
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
              const statusIcon = getStatusIcon(statusText) || ICON_TERMIN_GEFUELLT;

              return (
              <IonItemSliding key={event.id} style={{ marginBottom: index < filteredAndSortedEvents.length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
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
                    className={`app-list-item app-list-item--events${selectedEventId === event.id ? ' app-list-item--selected' : ''}`}
                    style={{
                      width: '100%',
                      borderLeftColor: statusColor,
                      opacity: shouldGrayOut ? 0.6 : 1,
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Eselsohr-Style Corner Badges (shared) - Team, Konfirmation, Pflicht, Status */}
                    <EventCornerBadges
                      event={event}
                      statusText={statusText}
                      statusColor={statusColor}
                      grayOut={shouldGrayOut}
                    />
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
                              color: isCancelled || shouldGrayOut ? 'var(--app-text-muted)' : undefined,
                              textDecoration: titelDekoration('liste', event),
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--app-abstand-kompakt)',
                              paddingRight: 'var(--app-freiraum-aktion-l)'
                            }}
                          >
                            {event.name}
                            {event.is_series && (
                              <IonIcon icon={ICON_KOPIEREN_GEFUELLT} className="app-icon-color--location" style={{ fontSize: 'var(--app-text-hinweis)', opacity: 0.7, flexShrink: 0 }} />
                            )}
                          </div>
                          {event.jahrgang_names && (
                            <div className="app-list-item__subtitle" style={{ color: shouldGrayOut ? 'var(--app-text-muted)' : undefined }}>
                              {event.jahrgang_names.split(',').join(' \u00B7 ')}
                            </div>
                          )}

                          <AbsageBlock event={event} variante="zeile" />

                          {/* Zeile 2: Buchungen + Teamer + Warteliste + Punkte.
                              Bei "Nur Teamer:innen" gibt es keine Konfi-Teilnahme \u2014
                              dann waere "0/\u221E" irrefuehrend, es zaehlt nur das Team. */}
                          <div className="app-list-item__meta">
                            {!event.teamer_only && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_GRUPPE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--participants'} />
                                {event.mandatory
                                  ? `${(event.registered_count || 0)} Konfis`
                                  : `${(event.registered_count || 0)}/${(event.max_participants || 0) > 0 ? event.max_participants : '\u221E'}`
                                }
                              </span>
                            )}
                            {(event.teamer_only || event.teamer_needed) && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_GRUPPE_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--team'} />
                                {(event.teamer_count || 0)}/{(event.teamer_max_participants || 0) > 0 ? event.teamer_max_participants : '\u221E'} Team
                              </span>
                            )}
                            {event.waitlist_enabled && (event.waitlist_count ?? 0) > 0 && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_LISTE} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--waitlist'} />
                                {event.waitlist_count}/{event.max_waitlist_size || 10}
                              </span>
                            )}
                            {/* Bei reinen Teamer-Events gibt es keine Punkte */}
                            {event.points > 0 && !event.teamer_only && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_POKAL_GEFUELLT} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--points'} />
                                {event.points}P
                              </span>
                            )}
                            {/* Punkteart direkt hinter den Punkten — die beiden
                                gehoeren zusammen. Gleiche Regel wie im Detail:
                                bei Pflicht-, Konfirmations- und Team-Terminen
                                gibt es keine Konfi-Punkte, dann auch keine Art. */}
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
                          {/* Zeile 7: Material */}
                          {(event.material_count || 0) > 0 && (
                            <div className="app-list-item__meta" style={{ marginTop: 'var(--app-abstand-mini)' }}>
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_ANHANG} className={shouldGrayOut ? 'app-icon-color--muted' : 'app-icon-color--material'} />
                                {event.material_count} {event.material_count === 1 ? 'Material' : 'Materialien'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                {(onDeleteEvent || onCancelEvent || onZuruecknehmen || onKopieren) && (
                  <IonItemOptions side="end" className="app-swipe-actions">
                    {/* ABSAGE ZURUECKNEHMEN: nur an abgesagten
                        Terminen, und dort als ERSTE Aktion — sie ist die
                        aufbauende, waehrend die beiden daneben abbauen. Gruen
                        statt rot, damit sie sich nicht wie "noch
                        endgueltiger absagen" liest. Die Rueckfrage mit der
                        Zahl der Betroffenen stellt der Aufrufer. */}
                    {onZuruecknehmen && isCancelled && (
                      <IonItemOption
                        onClick={() => { closeOpenSlidingItems(); onZuruecknehmen(event); }}
                        aria-label="Absage zurücknehmen"
                        className="app-swipe-action"
                      >
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--success">
                          <IonIcon icon={ICON_RUECKGAENGIG} />
                        </div>
                      </IonItemOption>
                    )}
                    {/* KOPIEREN: Oeffnet das Anlege-Formular mit
                        den Werten dieses Termins. Es wird nichts angelegt --
                        deshalb steht die Aktion neutral zwischen den
                        abbauenden und braucht keine Rueckfrage. Auch an
                        abgesagten Terminen sinnvoll: Die Kopie ist nicht
                        abgesagt, so laesst sich ein ausgefallener Termin
                        nachholen. */}
                    {onKopieren && (
                      <IonItemOption
                        onClick={() => { closeOpenSlidingItems(); onKopieren(event); }}
                        aria-label="Termin kopieren"
                        className="app-swipe-action"
                      >
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--primary">
                          <IonIcon icon={ICON_KOPIEREN_GEFUELLT} />
                        </div>
                      </IonItemOption>
                    )}
                    {onCancelEvent && (
                      <IonItemOption
                        onClick={() => { closeOpenSlidingItems(); onCancelEvent(event); }}
                        aria-label={isCancelled ? 'Absagegrund bearbeiten' : 'Event absagen'}
                        className="app-swipe-action"
                      >
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--warning">
                          <IonIcon icon={isCancelled ? ICON_BEARBEITEN : ICON_GESPERRT} />
                        </div>
                      </IonItemOption>
                    )}
                    {onDeleteEvent && (
                      <IonItemOption
                        onClick={() => { closeOpenSlidingItems(); onDeleteEvent(event); }}
                        aria-label="Event löschen"
                        className="app-swipe-action"
                      >
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                          <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
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