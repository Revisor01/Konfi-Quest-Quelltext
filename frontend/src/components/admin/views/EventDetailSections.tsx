import React from 'react';
import {
  IonCard,
  IonCardContent,
  IonLabel,
  IonList,
  IonListHeader,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonIcon,
  IonButton
} from '@ionic/react';
import {
  ICON_ABSAGE,
  ICON_ANHANG,
  ICON_ANTWORTEN,
  ICON_DATEI_GEFUELLT,
  ICON_ENTSPERRT,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GESPERRT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_KATEGORIE_GEFUELLT,
  ICON_LINK,
  ICON_LISTE,
  ICON_LOESCHEN_GEFUELLT,
  ICON_MATERIAL,
  ICON_OFFLINE,
  ICON_ORT_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_QRCODE,
  ICON_SCHUTZ_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { getStatusIcon } from '../../shared/StatusBadge';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import type { Participant, Unregistration, EventMaterial } from '../../../types/event';

// ---- Shared Types (re-export from main file's interfaces) ----

export interface Category {
  id: number;
  name: string;
}

export interface Jahrgang {
  id: number;
  name: string;
}

export interface EventData {
  id: number;
  name: string;
  description?: string;
  event_date: string;
  event_end_time?: string;
  location?: string;
  location_maps_url?: string;
  points: number;
  point_type?: 'gottesdienst' | 'gemeinde';
  categories?: Category[];
  jahrgaenge?: Jahrgang[];
  type: string;
  max_participants: number;
  registration_opens_at?: string;
  registration_closes_at?: string;
  registered_count: number;
  registration_status?: 'upcoming' | 'open' | 'closed' | 'cancelled' | 'mandatory';
  // Eigener Status fuer das TEAMER-Kontingent (Migration 120):
  // registration_status daruber rechnet ausschliesslich mit Konfi-Zahlen.
  teamer_registration_status?: 'none' | 'upcoming' | 'open' | 'waitlist' | 'closed' | 'cancelled';
  available_spots: number;
  participants: Participant[];
  timeslots?: Array<{ id: number; start_time: string; end_time: string; max_participants: number; registered_count: number }>;
  has_timeslots?: boolean;
  mandatory?: boolean;
  is_konfirmation?: boolean;
  bring_items?: string;
  checkin_window?: number;
  teamer_needed?: boolean;
  teamer_only?: boolean;
  teamer_max_participants?: number;
  teamer_waitlist_enabled?: boolean;
  teamer_max_waitlist_size?: number;
  teamer_waitlist_count?: number;
  is_series?: boolean;
  series_id?: number;
  series_events?: EventData[];
  created_at: string;
  chat_room_id?: number | null;
  cancelled?: boolean;
  waitlist_enabled?: boolean;
  max_waitlist_size?: number;
}

export type { Participant, Unregistration } from '../../../types/event';

// ---- EventInfoCard ----

interface EventInfoCardProps {
  eventData: EventData;
  participants: Participant[];
  formatDate: (dateString: string) => string;
  formatTime: (dateString: string) => string;
  eventMaterials?: EventMaterial[];
  onMaterialHinweisClick?: () => void;
}

export const EventInfoCard = React.memo<EventInfoCardProps>(({
  eventData,
  participants,
  formatDate,
  formatTime,
  eventMaterials,
  onMaterialHinweisClick
}) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={ICON_TERMIN_GEFUELLT} />
      </div>
      <IonLabel>Details</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent className="app-card-content">
        {/* Datum */}
        <div className="app-info-row">
          <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-info-row__icon app-icon-color--events" />
          <div>
            <div className="app-info-row__label">Datum</div>
            <div className="app-info-row__value">
              {formatDate(eventData.event_date || '')}
              {' · '}
              {formatTime(eventData.event_date || '')}
              {eventData.event_end_time && ` – ${formatTime(eventData.event_end_time)}`}
            </div>
          </div>
        </div>

        {/* Zeitslots anzeigen wenn vorhanden */}
        {eventData.has_timeslots && eventData.timeslots && eventData.timeslots.length > 0 && (
          <div className="app-info-row app-info-row--top">
            <IonIcon icon={ICON_UHRZEIT_GEFUELLT} className="app-info-row__icon app-icon-color--time app-event-detail__icon--align-top" />
            <div className="app-event-detail__timeslot-list">
              <div className="app-info-row__label">Zeitfenster</div>
              {eventData.timeslots.map((slot, idx) => (
                <div key={slot.id || idx} className="app-info-row__value app-event-detail__timeslot-entry">
                  {formatTime(slot.start_time)} – {formatTime(slot.end_time)} ({slot.registered_count || 0}/{slot.max_participants} TN)
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Anmeldezeitraum — wie Zeitfenster aufgebaut, nicht bei Pflicht-Events */}
        {!eventData.mandatory && (
          <div className="app-info-row app-info-row--top">
            <IonIcon icon={ICON_ENTSPERRT} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
            <div>
              <div className="app-info-row__label">Anmeldung</div>
              {eventData.registration_opens_at ? (
                <>
                  <div className="app-info-row__value">
                    von {new Date(eventData.registration_opens_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} – {formatTime(eventData.registration_opens_at)}
                  </div>
                  {eventData.registration_closes_at && (
                    <div className="app-info-row__value">
                      bis {new Date(eventData.registration_closes_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} – {formatTime(eventData.registration_closes_at)}
                    </div>
                  )}
                </>
              ) : (
                <div className="app-info-row__value">Sofort möglich</div>
              )}
              {/* Die Abmeldefrist war bisher NUR fuer Konfis sichtbar -- und
                  auch erst, wenn sie schon abgelaufen war ("Abmelden geht nur
                  bis 2 Tage vorher", konfi/views/EventDetailView.tsx:915).
                  Die Leitung erfuhr nie, dass es die Regel gibt, und wunderte
                  sich, warum sich jemand nicht mehr austragen kann
                  (Handbuch 70-termine.md fuehrt genau diese Frage auf).
                  Der Wert ist fest verdrahtet (konfi.js:1812) -- er steht
                  hier deshalb als Text, nicht als Einstellung. */}
              {/* NICHT bei "Nur Team": Dort nehmen gar keine Konfis teil, der
                  Satz sprach also von Leuten, die es beim Termin nicht gibt.
                  Und er stimmt fuers Team auch nicht in
                  eigener Formulierung: Die Frist steckt allein in der
                  Konfi-Abmeldung (konfi.js, DELETE /konfi/events/:id/register);
                  der Weg des Teams (events/buchung.js, DELETE /:id/book) hat
                  keine — Teamer:innen koennen sich jederzeit austragen. Eine
                  auf das Team umgeschriebene Fassung desselben Satzes waere
                  deshalb eine zweite Falschaussage statt einer Korrektur. */}
              {!eventData.teamer_only && (
                <div className="app-info-row__value" style={{ color: 'var(--app-text-secondary)', marginTop: 'var(--app-abstand-mini)' }}>
                  Konfis können sich bis 2 Tage vorher selbst abmelden
                </div>
              )}
            </div>
          </div>
        )}

        {/* TN gesamt - Konfis und Teamer getrennt */}
        {(() => {
          // Team-Seite: Teamer:innen UND zugeordnete Leitung —
          // sonst zaehlt zugeordnete Leitung als Konfi mit.
          const konfiOnly = participants.filter(p => p.role_name === 'konfi');
          const teamerOnly = participants.filter(p => p.role_name !== 'konfi');
          const teamerConfirmed = teamerOnly.filter(p => p.status === 'confirmed');
          const teamerWaitlistCount = eventData.teamer_waitlist_count !== undefined
            ? eventData.teamer_waitlist_count
            : teamerOnly.filter(p => p.status === 'waitlist').length;
          const konfiPresent = konfiOnly.filter(p => p.attendance_status === 'present').length;
          const konfiConfirmed = konfiOnly.filter(p => p.status === 'confirmed').length;
          const konfiOptedOut = konfiOnly.filter(p => p.status === 'opted_out').length;
          const teamerMax = eventData.teamer_max_participants || 0;
          // Anzeige hängt an der EINSTELLUNG des Events, nicht daran, ob sich
          // schon jemand angemeldet hat \u2014 sonst fehlen bei einem frischen Event
          // genau die Zeilen, die man braucht (Bugreport 09.08.).
          const teamerErlaubt = !!(eventData.teamer_needed || eventData.teamer_only);
          const nurTeamer = !!eventData.teamer_only;
          return (
            <>
              {/* Bei "Nur Teamer:innen" gibt es keine Konfi-Teilnahme */}
              {!nurTeamer && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--participants" />
                  <div>
                    <div className="app-info-row__label">Teilnehmer:innen</div>
                    <div className="app-info-row__value">
                      {eventData.mandatory
                        ? `${konfiConfirmed} / ${konfiConfirmed + konfiOptedOut}`
                        : `${konfiConfirmed} / ${(eventData.max_participants || 0) > 0 ? eventData.max_participants : '\u221E'}`
                      }
                    </div>
                  </div>
                </div>
              )}
              {/* Anwesenheit als EIGENE Zeile: sie ist eine andere Angabe als
                  die Anmeldung und darf sie nicht ueberschreiben. Erst sichtbar,
                  wenn tatsaechlich jemand erfasst wurde. */}
              {!nurTeamer && konfiPresent > 0 && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--participants" />
                  <div>
                    <div className="app-info-row__label">Anwesend</div>
                    <div className="app-info-row__value">
                      {konfiPresent} / {konfiConfirmed}
                    </div>
                  </div>
                </div>
              )}
              {teamerErlaubt && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--team" />
                  <div>
                    <div className="app-info-row__label">Team</div>
                    <div className="app-info-row__value">
                      {teamerConfirmed.length} / {teamerMax > 0 ? teamerMax : '\u221E'}
                    </div>
                  </div>
                </div>
              )}
              {/* Teamer-Warteliste: nur sinnvoll bei BEGRENZTEN Teamer-Plaetzen */}
              {teamerErlaubt && eventData.teamer_waitlist_enabled && teamerMax > 0 && (
                <div className="app-info-row">
                  <IonIcon icon={ICON_LISTE} className="app-info-row__icon app-icon-color--waitlist" />
                  <div>
                    <div className="app-info-row__label">Team-Warteliste</div>
                    <div className="app-info-row__value">
                      {teamerWaitlistCount} / {eventData.teamer_max_waitlist_size || 10}
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* Warteliste (Konfis) \u2014 entfaellt bei "Nur Teamer:innen" und bei
            unbegrenzten Plaetzen (dann kann niemand warten) */}
        {eventData.waitlist_enabled && !eventData.teamer_only && (eventData.max_participants || 0) > 0 && (
          <div className="app-info-row">
            <IonIcon icon={ICON_LISTE} className="app-info-row__icon app-icon-color--waitlist" />
            <div>
              <div className="app-info-row__label">Warteliste</div>
              <div className="app-info-row__value">
                {participants.filter(p => p.role_name === 'konfi' && p.status === 'waitlist').length} / {eventData.max_waitlist_size || 10}
              </div>
            </div>
          </div>
        )}

        {/* Punkte und Typ entfallen bei Pflicht-Events UND bei reinen
            Teamer-Events: dort gibt es keine Konfi-Punkte zu vergeben, die
            Zeilen zeigten nur "0 / Gemeinde" (User-Hinweis 09.08.).
            Der Guard auf points > 0 fehlte hier als einziger der drei
            Ansichten — nur die Leitung sah bei einem Termin ohne Punkte die
            Zeile "Punkte 0". Konfi- und Teamer-Ansicht blenden sie aus. */}
        {!eventData.mandatory && !eventData.teamer_only && !eventData.is_konfirmation && (eventData.points || 0) > 0 && (
          <div className="app-info-row">
            <IonIcon icon={ICON_POKAL_GEFUELLT} className="app-info-row__icon app-icon-color--points" />
            <div>
              <div className="app-info-row__label">Punkte</div>
              <div className="app-info-row__value">{eventData.points || 0}</div>
            </div>
          </div>
        )}

        {!eventData.mandatory && !eventData.teamer_only && !eventData.is_konfirmation && (eventData.points || 0) > 0 && (
          <div className="app-info-row">
            <IonIcon
              icon={eventData.point_type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_GEMEINDE_GEFUELLT}
              className={`app-info-row__icon ${eventData.point_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde'}`}
            />
            <div>
              <div className="app-info-row__label">Typ</div>
              <div className="app-info-row__value">{eventData.point_type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'}</div>
            </div>
          </div>
        )}

        {/* Kategorien */}
        {eventData.categories && eventData.categories.length > 0 && (
          <div className="app-info-row">
            <IonIcon icon={ICON_KATEGORIE_GEFUELLT} className="app-info-row__icon app-icon-color--category" />
            <div>
              <div className="app-info-row__label">Kategorien</div>
              <div className="app-info-row__value">{eventData.categories.map(c => c.name).join(', ')}</div>
            </div>
          </div>
        )}

        {/* Ort */}
        {eventData.location && (
          <div className="app-info-row">
            <IonIcon icon={ICON_ORT_GEFUELLT} className="app-info-row__icon app-icon-color--location" />
            <div
              onClick={() => {
                if (eventData.location_maps_url) {
                  window.open(eventData.location_maps_url, '_blank');
                } else if (eventData.location) {
                  const mapsUrl = `https://maps.apple.com/?q=${encodeURIComponent(eventData.location)}`;
                  window.open(mapsUrl, '_blank');
                }
              }}
            >
              <div className="app-info-row__label">Ort</div>
              <div className="app-info-row__value app-event-detail__location-link">{eventData.location}</div>
            </div>
          </div>
        )}

        {/* Pflicht-Badge */}
        {eventData.mandatory && (
          <div className="app-info-row">
            <IonIcon icon={ICON_SCHUTZ_GEFUELLT} className="app-info-row__icon app-icon-color--events" />
            <div>
              <div className="app-info-row__label">Pflicht-Event</div>
              <div className="app-info-row__value">Teilnahme erforderlich</div>
            </div>
          </div>
        )}

        {/* Teamer-Zugang Badge */}
        {(eventData.teamer_only || (eventData.teamer_needed && participants.filter(p => p.role_name === 'teamer' && p.status === 'confirmed').length === 0)) && (
          <div className="app-info-row">
            <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--team" />
            <div>
              <div className="app-info-row__label">Team-Zugang</div>
              <div className="app-info-row__value">{eventData.teamer_only ? 'Nur Team' : 'Team gesucht'}</div>
            </div>
          </div>
        )}

        {/* Check-in-Fenster — das Zeitfenster fuer den QR-Code. Es wird im
            Formular gesetzt, war aber in keiner Detailansicht zu sehen: wer es
            aendert, konnte nicht nachsehen, ob es wirkt. Formulierung wie im
            Formular (`EventFormSections.tsx:223`). NICHT die Abmeldefrist —
            die sind zwei Tage und stehen im Anmelde-Abschnitt. */}
        {eventData.checkin_window && (
          <div className="app-info-row app-info-row--top">
            <IonIcon icon={ICON_QRCODE} className="app-info-row__icon app-icon-color--events app-event-detail__icon--align-top" />
            <div>
              <div className="app-info-row__label">Check-in-Fenster</div>
              <div className="app-info-row__value">
                QR-Code {eventData.checkin_window} Min. (vor/nach Beginn)
              </div>
            </div>
          </div>
        )}

        {/* Was mitbringen */}
        {eventData.bring_items && (
          <div className="app-info-row app-info-row--top">
            <IonIcon icon={ICON_MATERIAL} className="app-info-row__icon app-icon-color--bring app-event-detail__icon--align-top" />
            <div>
              <div className="app-info-row__label">Mitbringen</div>
              <div className="app-info-row__value">{eventData.bring_items}</div>
            </div>
          </div>
        )}

        {/* Material-Hinweis: klickbar wie der Ort. Bei genau
            einem Material steht dessen Titel und der Tipp oeffnet direkt das
            Detail-Modal; bei mehreren steht die Anzahl und der Tipp springt
            zum Material-Abschnitt unten -- dort ist jeder Eintrag einzeln
            waehlbar, ein "erstes Material raten" waere Willkuer. Die
            Entscheidung faellt im Handler der Detailansicht, nicht hier.
            Offline ist eventMaterials leer (die Detailansicht laedt Material
            nur online) -- die Zeile kann also nie ins Leere klicken. */}
        {eventMaterials && eventMaterials.length > 0 && onMaterialHinweisClick && (
          <div className="app-info-row">
            <IonIcon icon={ICON_DATEI_GEFUELLT} className="app-info-row__icon app-icon-color--material" />
            <div onClick={onMaterialHinweisClick}>
              <div className="app-info-row__label">Material</div>
              <div className="app-info-row__value app-event-detail__material-link">
                {eventMaterials.length === 1
                  ? eventMaterials[0].title
                  : `${eventMaterials.length} Materialien`}
              </div>
            </div>
          </div>
        )}

        {/* Jahrgang */}
        {eventData.jahrgaenge && eventData.jahrgaenge.length > 0 && (
          <div className="app-info-row">
            <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon app-icon-color--jahrgang" />
            <div>
              <div className="app-info-row__label">Jahrgänge</div>
              <div className="app-info-row__value">{eventData.jahrgaenge.map(j => j.name).join(', ')}</div>
            </div>
          </div>
        )}

      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- DescriptionSection ----

interface DescriptionSectionProps {
  description: string;
}

export const DescriptionSection = React.memo<DescriptionSectionProps>(({ description }) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={ICON_INFO_GEFUELLT} />
      </div>
      <IonLabel>Beschreibung</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent className="app-card-content">
        <div className="app-description-text">
          {description}
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- SeriesEventsSection ----

interface SeriesEventsSectionProps {
  seriesEvents: EventData[];
  formatDate: (dateString: string) => string;
  formatTime: (dateString: string) => string;
  onNavigate: (eventId: number) => void;
}

export const SeriesEventsSection = React.memo<SeriesEventsSectionProps>(({
  seriesEvents,
  formatDate,
  formatTime,
  onNavigate
}) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--info">
        <IonIcon icon={ICON_TERMIN_GEFUELLT} />
      </div>
      <IonLabel>Weitere Termine dieser Serie</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
        {seriesEvents.map((seriesEvent) => {
          // max_participants = 0 bedeutet unbegrenzt -> nie "voll".
          const seriesUnlimited = (seriesEvent.max_participants || 0) === 0;
          const isFull = !seriesUnlimited && (seriesEvent.registered_count || 0) >= seriesEvent.max_participants;
          return (
            <div
              key={seriesEvent.id}
              className={`app-list-item ${isFull ? 'app-list-item--danger' : 'app-list-item--success'} app-event-detail__series-link`}
              onClick={() => onNavigate(seriesEvent.id)}
            >
              <div className="app-corner-badges">
                <div className={`app-corner-badge ${isFull ? 'app-corner-badge--danger' : 'app-corner-badge--success'}`}>
                  {isFull ? 'Voll' : 'Frei'}
                </div>
              </div>
              <div className="app-list-item__row">
                <div className="app-list-item__main">
                  <div className={`app-icon-circle ${isFull ? 'app-icon-circle--danger' : 'app-icon-circle--success'}`}>
                    <IonIcon icon={ICON_TERMIN_GEFUELLT} />
                  </div>
                  <div className="app-list-item__content">
                    <div className="app-list-item__title app-list-item__title--badge-space-md">
                      {seriesEvent.name}
                    </div>
                    <div className="app-list-item__subtitle">
                      {formatDate(seriesEvent.event_date)} {formatTime(seriesEvent.event_date)} | {seriesEvent.registered_count || 0}/{seriesUnlimited ? '∞' : seriesEvent.max_participants} TN
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- UnregistrationsSection ----

interface UnregistrationsSectionProps {
  unregistrations: Unregistration[];
}

export const UnregistrationsSection = React.memo<UnregistrationsSectionProps>(({ unregistrations }) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--danger">
        <IonIcon icon={ICON_ABSAGE} />
      </div>
      <IonLabel>Abmeldungen ({unregistrations.length})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
        {unregistrations.map((unreg) => (
          <div key={unreg.id} className="app-list-item app-list-item--danger">
            <div className="app-list-item__row">
              <div className="app-list-item__main">
                <IonIcon icon={ICON_ABSAGE} className="app-icon-color--danger app-event-detail__icon-lg" />
                <div className="app-list-item__content">
                  <div className="app-list-item__title">
                    {unreg.konfi_name}
                  </div>
                  <div className="app-list-item__subtitle">
                    Abgemeldet am {new Date(unreg.unregistered_at).toLocaleString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
            </div>
            {unreg.reason && (
              <div className="app-reason-box app-reason-box--danger app-event-detail__reason-indent">
                <span className="app-reason-box__label">Grund:</span> {unreg.reason}
              </div>
            )}
          </div>
        ))}
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- EventMaterialSection ----

interface EventMaterialSectionProps {
  eventMaterials: EventMaterial[];
  onMaterialClick: (materialId: number) => void;
}

export const EventMaterialSection = React.memo<EventMaterialSectionProps>(({
  eventMaterials,
  onMaterialClick
}) => (
  <IonList id="event-material-abschnitt" className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={ICON_DATEI_GEFUELLT} />
      </div>
      <IonLabel>Material ({eventMaterials.length})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
        {eventMaterials.map((mat) => (
          <div
            key={mat.id}
            className="app-list-item app-list-item--material"
            style={{ cursor: 'pointer' }}
            onClick={() => onMaterialClick(mat.id)}
          >
            <div className="app-list-item__row">
              <div className="app-list-item__main">
                <div className="app-icon-circle app-icon-circle--material">
                  <IonIcon icon={mat.link_url ? ICON_LINK : ICON_DATEI_GEFUELLT} />
                </div>
                <div className="app-list-item__content">
                  <div className="app-list-item__title">{mat.title}</div>
                  <div className="app-list-item__meta">
                    {mat.link_url ? (
                      <span className="app-list-item__meta-item">
                        <IonIcon icon={ICON_LINK} className="app-icon-color--material" />
                        Link
                      </span>
                    ) : (
                      <span className="app-list-item__meta-item">
                        <IonIcon icon={ICON_ANHANG} className="app-icon-color--material" />
                        {mat.file_count || 0} {(mat.file_count || 0) === 1 ? 'Datei' : 'Dateien'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- EventActionsSection ----

interface EventActionsSectionProps {
  eventData: EventData;
  isCancelled: boolean;
  isOnline: boolean;
  handleCancelEvent: () => void;
}

// Chat-Zugriff läuft über den Button im Header (EventDetailView), hier nur noch Absage
export const EventActionsSection = React.memo<EventActionsSectionProps>(({
  eventData,
  isCancelled,
  isOnline,
  handleCancelEvent
}) => {
  if (!eventData || isCancelled) return null;
  return (
    <>
      {/* Event absagen */}
      <IonList className="app-section-inset" inset={true}>
        <IonCard className="app-card">
          <IonCardContent className="app-card-content">
            <div className="app-event-detail__add-button-wrapper">
              <IonButton
                expand="block"
                fill="outline"
                color="danger"
                disabled={!isOnline}
                onClick={handleCancelEvent}
              >
                <IonIcon icon={ICON_GESPERRT} className="app-event-detail__icon-gap" />
                {!isOnline ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</> : 'Event absagen'}
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>
      </IonList>
    </>
  );
});

// ---- TimeslotsSection ----

interface TimeslotsSectionProps {
  timeslots: Array<{ id: number; start_time: string; end_time: string; max_participants: number; registered_count: number; waitlist_count?: number }>;
  participants: Participant[];
  eventMandatory?: boolean;
  formatTime: (dateString: string) => string;
  showAttendanceActionSheet: (participant: Participant) => void;
  handleDemoteParticipant: (participant: Participant) => void;
  handleRemoveParticipant: (participant: Participant) => void;
  showWaitlistActionSheet?: (participant: Participant) => void;
}

export const TimeslotsSection = React.memo<TimeslotsSectionProps>(({
  timeslots,
  participants,
  eventMandatory,
  formatTime,
  showAttendanceActionSheet,
  handleDemoteParticipant,
  handleRemoveParticipant,
  showWaitlistActionSheet
}) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={ICON_UHRZEIT_GEFUELLT} />
      </div>
      <IonLabel>Zeitslots ({timeslots.length})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
        {timeslots.map((timeslot) => {
          const slotStartFormatted = formatTime(timeslot.start_time);
          const slotEndFormatted = formatTime(timeslot.end_time);
          // Teilnehmer diesem Slot zuordnen (per timeslot_id, Fallback über Zeit).
          const matchesSlot = (p: Participant) => {
            if (p.timeslot_id && timeslot.id) return p.timeslot_id === timeslot.id;
            if (p.timeslot_start_time && p.timeslot_end_time) {
              return formatTime(p.timeslot_start_time) === slotStartFormatted &&
                     formatTime(p.timeslot_end_time) === slotEndFormatted;
            }
            return false;
          };
          const slotParticipants = participants.filter(p => p.status === 'confirmed' && matchesSlot(p));
          const slotWaitlist = participants.filter(p => p.status === 'waitlist' && matchesSlot(p));
          const isFull = (timeslot.registered_count || 0) >= timeslot.max_participants;
          const waitlistCount = timeslot.waitlist_count || 0;

          return (
            <div key={timeslot.id} className="app-event-detail__slot-group">
              <div className={`app-list-item ${isFull ? 'app-list-item--danger' : 'app-list-item--success'}`}>
                <div className="app-corner-badges">
                  <div className={`app-corner-badge ${isFull ? 'app-corner-badge--danger' : 'app-corner-badge--success'}`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                    title={isFull ? 'Voll' : 'Frei'}>
                    <IonIcon icon={isFull ? ICON_ABSAGE : ICON_ZUSAGE_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                  </div>
                </div>
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className={`app-icon-circle ${isFull ? 'app-icon-circle--danger' : 'app-icon-circle--success'}`}>
                      <IonIcon icon={ICON_UHRZEIT_GEFUELLT} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title app-list-item__title--badge-space">
                        {slotStartFormatted} - {slotEndFormatted}
                      </div>
                      <div className="app-list-item__subtitle">
                        {timeslot.registered_count || 0}/{timeslot.max_participants} Teilnehmer:innen
                        {waitlistCount > 0 && ` · ${waitlistCount} Warteliste`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {slotParticipants.length > 0 && (
                <div className="app-event-detail__slot-participants">
                  {slotParticipants.map((participant) => {
                    const statusText = participant.attendance_status === 'present' ? 'Anwesend' :
                                       participant.attendance_status === 'absent' ? 'Abwesend' : 'Gebucht';
                    const cornerBadgeClass = participant.attendance_status === 'present' ? 'app-corner-badge--success' :
                                             participant.attendance_status === 'absent' ? 'app-corner-badge--danger' : 'app-corner-badge--info';
                    const listItemClass = participant.attendance_status === 'present' ? 'app-list-item--success' :
                                          participant.attendance_status === 'absent' ? 'app-list-item--danger' : 'app-list-item--booked';
                    return (
                      <IonItemSliding key={participant.id} className="app-event-detail__sliding-item">
                        <IonItem className="app-item-transparent" button detail={false} lines="none"
                          onClick={() => showAttendanceActionSheet(participant)}>
                          <div className={`app-list-item ${listItemClass} app-event-detail__list-item-flush`}>
                            <div className="app-corner-badges">
                              <div
                                className={`app-corner-badge ${cornerBadgeClass}`}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                                title={statusText}
                              >
                                <IonIcon icon={getStatusIcon(statusText) || ICON_GRUPPE_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                              </div>
                            </div>
                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                <div className={`app-icon-circle ${
                                  participant.attendance_status === 'present' ? 'app-icon-circle--success' :
                                  participant.attendance_status === 'absent' ? 'app-icon-circle--danger' : 'app-icon-circle--info'
                                }`}>
                                  <IonIcon icon={participant.attendance_status === 'present' ? ICON_ZUSAGE_GEFUELLT :
                                        participant.attendance_status === 'absent' ? ICON_ABSAGE : ICON_GRUPPE_GEFUELLT} />
                                </div>
                                <div className="app-list-item__content">
                                  <div className="app-list-item__title app-list-item__title--badge-space-lg">{participant.participant_name}</div>
                                  <div className="app-list-item__subtitle">{participant.jahrgang_name || ''}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </IonItem>
                        {!eventMandatory && (
                        <IonItemOptions className="app-swipe-actions" side="end">
                          <IonItemOption className="app-swipe-action" onClick={() => { closeOpenSlidingItems(); handleDemoteParticipant(participant); }} aria-label="Auf Warteliste setzen">
                            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--warning">
                              <IonIcon icon={ICON_ANTWORTEN} />
                            </div>
                          </IonItemOption>
                          <IonItemOption className="app-swipe-action" onClick={() => { closeOpenSlidingItems(); handleRemoveParticipant(participant); }} aria-label="Teilnahme entfernen">
                            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                              <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                            </div>
                          </IonItemOption>
                        </IonItemOptions>
                        )}
                      </IonItemSliding>
                    );
                  })}
                </div>
              )}
              {slotWaitlist.length > 0 && (
                <div className="app-event-detail__slot-participants">
                  <div className="app-list-item__subtitle" style={{ padding: 'var(--app-abstand-mini) var(--app-abstand-eng)', opacity: 0.7 }}>
                    Warteliste
                  </div>
                  {slotWaitlist.map((participant, wIndex) => (
                    <IonItem key={participant.id} className="app-item-transparent" button={!!showWaitlistActionSheet} detail={false} lines="none"
                      style={{ display: 'block', marginBottom: wIndex < slotWaitlist.length - 1 ? 'var(--app-abstand-eng)' : '0' }}
                      onClick={() => showWaitlistActionSheet && showWaitlistActionSheet(participant)}>
                      <div className="app-list-item app-list-item--warning app-event-detail__list-item-flush">
                        <div className="app-corner-badges">
                          <div className="app-corner-badge app-corner-badge--warning"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                            title="Warteliste">
                            <IonIcon icon={ICON_UHRZEIT_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                          </div>
                        </div>
                        <div className="app-list-item__row">
                          <div className="app-list-item__main">
                            <div className="app-icon-circle app-icon-circle--warning">
                              <IonIcon icon={ICON_UHRZEIT_GEFUELLT} />
                            </div>
                            <div className="app-list-item__content">
                              <div className="app-list-item__title app-list-item__title--badge-space-lg">{participant.participant_name}</div>
                              <div className="app-list-item__subtitle">{participant.jahrgang_name || ''}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </IonItem>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));
