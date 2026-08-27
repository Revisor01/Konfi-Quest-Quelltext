import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton,
  IonItem, IonLabel, IonInput, IonDatetime, IonIcon, IonSpinner,
  IonList, IonListHeader, IonToggle, IonCard, IonCardContent, IonModal,
  IonDatetimeButton, IonRange
} from '@ionic/react';
import { checkmarkOutline, closeOutline, add, trash, time, calendar } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { Event, Category, Timeslot, Jahrgang } from '../../../types/event';
import {
  BasicInfoSection, CheckinSection,
  PointsParticipantsSection, CategoriesTargetSection,
  TeamerSection, SeriesSection
} from './EventFormSections';
import type { EventFormData } from './EventFormSections';
import { safeUUID } from '../../../utils/uuid';

interface EventModalProps {
  event?: Event | null;
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
  // Meldet den "ungespeicherte Änderungen"-Stand nach aussen, damit die
  // praesentierende Seite über canDismiss auch Swipe/Backdrop-Schliessen abfangen kann.
  onDirtyChange?: (dirty: boolean) => void;
}

const EventModal: React.FC<EventModalProps> = ({ event, onClose, onSuccess, dismiss, onDirtyChange }) => {
  const { setSuccess, setError, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [jahrgaenge, setJahrgaenge] = useState<Jahrgang[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  const doClose = () => { if (dismiss) dismiss(); else onClose(); };

  // Datumspicker-Obergrenze: 2 Jahre in der Zukunft, damit Termine weit im
  // Voraus (z.B. Konfis 12 Monate vorher eintragen) waehlbar sind. Ohne max
  // zeigt das IonDatetime-Wheel nur einen schmalen Bereich des laufenden Jahres.
  const datePickerMax = `${new Date().getFullYear() + 2}-12-31T23:59:59`;

  // Schliessen anstossen. Die "ungespeicherte Änderungen"-Nachfrage läuft
  // zentral über canDismiss der praesentierenden Seite (faengt X-Button, Swipe
  // UND Backdrop einheitlich ab) — daher hier keine zweite Abfrage.
  const handleClose = () => { doClose(); };

  // isDirty-Stand nach aussen melden (für canDismiss der praesentierenden Seite).
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const [formData, setFormData] = useState<EventFormData>({
    name: '', description: '', event_date: new Date().toISOString(), event_end_time: '',
    location: '', points: 1, point_type: 'gemeinde', category_ids: [], jahrgang_ids: [],
    type: 'event', max_participants: 5, registration_opens_at: '', registration_closes_at: '',
    has_timeslots: false, waitlist_enabled: true, max_waitlist_size: 3,
    is_series: false, series_count: 1, series_interval: 'week',
    mandatory: false, is_konfirmation: false, bring_items: '', checkin_window: 30,
    teamer_max_participants: 0, teamer_waitlist_enabled: true, teamer_max_waitlist_size: 3
  });

  const [timeslots, setTimeslots] = useState<Timeslot[]>([]);
  const [teamerAccess, setTeamerAccess] = useState<'normal' | 'teamer_needed' | 'teamer_only'>('normal');
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) setIsDirty(true);
  }, [formData]);

  const formatTime = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };

  useEffect(() => {
    loadCategories();
    loadJahrgaenge();
    if (event) {
      const utcToLocalISO = (utcString: string) => {
        if (!utcString) return '';
        const date = new Date(utcString);
        const pad = (num: number) => num.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
      };
      setFormData({
        name: event.name, description: event.description || '',
        event_date: utcToLocalISO(event.event_date),
        event_end_time: utcToLocalISO(event.event_end_time || ''),
        location: event.location || '', points: event.points,
        point_type: event.point_type || 'gemeinde',
        category_ids: event.categories?.map(c => c.id) || [],
        jahrgang_ids: event.jahrgaenge?.map(j => j.id) || [],
        type: event.type, max_participants: event.max_participants,
        registration_opens_at: utcToLocalISO(event.registration_opens_at || ''),
        registration_closes_at: utcToLocalISO(event.registration_closes_at || ''),
        has_timeslots: event.has_timeslots || false,
        waitlist_enabled: event.waitlist_enabled !== undefined ? event.waitlist_enabled : true,
        max_waitlist_size: event.max_waitlist_size || 3,
        is_series: event.is_series || false, series_count: 1, series_interval: 'week',
        mandatory: event.mandatory || false,
        is_konfirmation: event.is_konfirmation || false,
        bring_items: event.bring_items || '',
        checkin_window: event.checkin_window || 30,
        teamer_max_participants: event.teamer_max_participants ?? 0,
        teamer_waitlist_enabled: event.teamer_waitlist_enabled !== undefined ? event.teamer_waitlist_enabled : true,
        teamer_max_waitlist_size: event.teamer_max_waitlist_size ?? 3
      });
      if (event.teamer_only) setTeamerAccess('teamer_only');
      else if (event.teamer_needed) setTeamerAccess('teamer_needed');
      else setTeamerAccess('normal');
      if (event.has_timeslots) loadTimeslots(event.id);
    } else {
      const now = new Date();
      const roundToHalfHour = (date: Date) => {
        const rounded = new Date(date);
        const minutes = rounded.getMinutes();
        if (minutes < 30) rounded.setMinutes(0, 0, 0);
        else rounded.setMinutes(30, 0, 0);
        return rounded;
      };
      const eventStart = new Date();
      eventStart.setMinutes(eventStart.getMinutes() + 30);
      const roundedEventStart = roundToHalfHour(eventStart);
      const eventEnd = new Date(roundedEventStart);
      eventEnd.setHours(eventEnd.getHours() + 2);
      const regCloses = new Date(roundedEventStart);
      regCloses.setHours(regCloses.getHours() - 1);
      const toIonDatetimeISO = (date: Date) => {
        const pad = (num: number) => num.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
      };
      setFormData({
        name: '', description: '', event_date: toIonDatetimeISO(roundedEventStart),
        event_end_time: toIonDatetimeISO(eventEnd), location: '', points: 1,
        point_type: 'gemeinde', category_ids: [], jahrgang_ids: [], type: 'event',
        // Anmeldung standardmaessig AB SOFORT (leer = kein Startzeitpunkt) —
        // der Normalfall ist "Event steht, Anmeldung läuft"; ein Startdatum in
        // der Zukunft ist die Ausnahme und lässt sich per Schalter setzen.
        max_participants: 5, registration_opens_at: '',
        registration_closes_at: toIonDatetimeISO(regCloses), has_timeslots: false,
        waitlist_enabled: true, max_waitlist_size: 3, is_series: false,
        series_count: 1, series_interval: 'week', mandatory: false, is_konfirmation: false, bring_items: '',
        checkin_window: 30,
        teamer_max_participants: 0, teamer_waitlist_enabled: true, teamer_max_waitlist_size: 3
      });
      setTimeslots([]);
      setTeamerAccess('normal');
    }
    setTimeout(() => { initializedRef.current = true; }, 100);
  }, [event]);

  const loadCategories = async () => {
    try { const response = await api.get('/admin/categories'); setCategories(response.data); }
    catch (error) { console.error('Error loading categories:', error); }
  };

  const loadJahrgaenge = async () => {
    try { const response = await api.get('/admin/jahrgaenge'); setJahrgaenge(response.data); }
    catch (error) { console.error('Error loading jahrgaenge:', error); }
  };

  const loadTimeslots = async (eventId: number) => {
    try { const response = await api.get(`/events/${eventId}/timeslots`); setTimeslots(response.data); }
    catch (error) { console.error('Error loading timeslots:', error); }
  };

  const addTimeslot = () => {
    const eventDate = new Date(formData.event_date);
    let startTime: Date;
    let participants: number;
    if (timeslots.length === 0) {
      startTime = new Date(eventDate);
      participants = Math.max(1, Math.floor(formData.max_participants / 2));
    } else {
      const lastTimeslot = timeslots[timeslots.length - 1];
      startTime = new Date(lastTimeslot.end_time);
      participants = timeslots[0].max_participants;
    }
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
    const toIonDatetimeISO = (date: Date) => {
      const pad = (num: number) => num.toString().padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
    };
    setTimeslots([...timeslots, { start_time: toIonDatetimeISO(startTime), end_time: toIonDatetimeISO(endTime), max_participants: participants }]);
  };

  const removeTimeslot = (index: number) => { setTimeslots(timeslots.filter((_, i) => i !== index)); };
  const updateTimeslot = (index: number, field: keyof Timeslot, value: any) => {
    const updated = [...timeslots]; updated[index] = { ...updated[index], [field]: value }; setTimeslots(updated);
  };

  const handleSubmit = async () => {
    // Pflichtfelder prüfen und SAGEN, was fehlt. Vorher brach die Funktion
    // hier stumm ab (return ohne Meldung) — man tippte auf Speichern und es
    // passierte sichtbar nichts (User-Hinweis 10.08.).
    if (!formData.name.trim()) { setError('Bitte gib dem Event einen Namen'); return; }
    if (!formData.event_date) { setError('Bitte lege Datum und Uhrzeit fest'); return; }
    if (teamerAccess !== 'teamer_only' && formData.mandatory && formData.jahrgang_ids.length === 0) {
      setError('Pflicht-Events brauchen mindestens einen Jahrgang');
      return;
    }
    // guard() wirft, wenn schon eine Speicherung läuft (Doppel-Tap). Dieser
    // Wurf lag bisher außerhalb jedes catch -> unbehandelte Rejection, kein
    // Hinweis an die Nutzerin. Hier abfangen statt durchschlagen lassen.
    try {
      await guard(async () => {
    setLoading(true);
    try {
      const toBackendTimestamp = (localTimeString: string) => {
        if (!localTimeString) return null;
        return new Date(localTimeString).toISOString();
      };
      const isTeamerOnly = teamerAccess === 'teamer_only';
      const payload = {
        name: formData.name.trim(), description: formData.description.trim() || null,
        event_date: toBackendTimestamp(formData.event_date),
        event_end_time: toBackendTimestamp(formData.event_end_time),
        location: formData.location.trim() || null,
        // Reine Teamer-Events vergeben keine Konfi-Punkte (das Formular zeigt
        // die Konfis-Karte dort gar nicht) — sonst bliebe ein alter Punktwert
        // an einem umgestellten Event hängen.
        points: (formData.mandatory || formData.is_konfirmation || isTeamerOnly) ? 0 : formData.points,
        point_type: isTeamerOnly ? 'gemeinde' : formData.point_type,
        category_ids: formData.category_ids,
        jahrgang_ids: isTeamerOnly ? [] : formData.jahrgang_ids,
        type: formData.type,
        max_participants: (formData.mandatory || isTeamerOnly) ? 0 : formData.max_participants,
        // Kein Anmeldefenster bei Pflicht-Events (alle sind gesetzt) und bei
        // reinen Teamer-Events (dort gilt es nicht) — sonst bliebe an einem
        // umgestellten Event ein wirkungsloses Fenster stehen, das die
        // Statusanzeige faelschlich auf "geschlossen" setzt.
        registration_opens_at: (formData.mandatory || isTeamerOnly) ? null : toBackendTimestamp(formData.registration_opens_at),
        registration_closes_at: (formData.mandatory || isTeamerOnly) ? null : toBackendTimestamp(formData.registration_closes_at),
        has_timeslots: (formData.mandatory || formData.is_konfirmation) ? false : formData.has_timeslots,
        // Unbegrenzte Plaetze => keine Warteliste (das Formular zeigt den
        // Schalter dann gar nicht, der Payload muss dazu passen).
        waitlist_enabled: (formData.mandatory || isTeamerOnly || formData.max_participants === 0)
          ? false : formData.waitlist_enabled,
        max_waitlist_size: (formData.mandatory || isTeamerOnly || formData.max_participants === 0)
          ? 0 : formData.max_waitlist_size,
        timeslots: (!formData.mandatory && !formData.is_konfirmation && formData.has_timeslots) ? timeslots.map(ts => ({
          ...ts, start_time: toBackendTimestamp(ts.start_time), end_time: toBackendTimestamp(ts.end_time)
        })) : [],
        is_series: formData.is_series,
        series_count: formData.is_series ? formData.series_count : undefined,
        series_interval: formData.is_series ? formData.series_interval : undefined,
        // "Nur Teamer:innen" schließt Pflicht-Event und Konfirmation aus
        // (beides sind Konfi-Kategorien) — das Formular blendet sie dort aus,
        // der Payload haelt es konsistent, auch bei umgestellten Bestands-Events.
        mandatory: isTeamerOnly ? false : formData.mandatory,
        is_konfirmation: isTeamerOnly ? false : formData.is_konfirmation,
        bring_items: formData.bring_items.trim() || null,
        checkin_window: formData.checkin_window,
        teamer_needed: teamerAccess === 'teamer_needed', teamer_only: teamerAccess === 'teamer_only',
        teamer_max_participants: teamerAccess === 'normal' ? 0 : formData.teamer_max_participants,
        // Auch hier: unbegrenzte Teamer-Plaetze => keine Warteliste.
        teamer_waitlist_enabled: (teamerAccess === 'normal' || formData.teamer_max_participants === 0)
          ? false : formData.teamer_waitlist_enabled,
        teamer_max_waitlist_size: (teamerAccess === 'normal' || formData.teamer_max_participants === 0)
          ? 0 : formData.teamer_max_waitlist_size
      };

      if (networkMonitor.isOnline) {
        if (event && event.id && event.id > 0) {
          const { is_series, series_count, series_interval, ...updatePayload } = payload;
          await api.put(`/events/${event.id}`, updatePayload);
        } else {
          if (formData.is_series) {
            await api.post('/events/series', payload);
            setSuccess(`Event-Serie mit ${formData.series_count} Events erstellt`);
          } else {
            await api.post('/events', payload);
          }
        }
      } else {
        if (event && event.id && event.id > 0) {
          const { is_series, series_count, series_interval, ...updatePayload } = payload;
          await writeQueue.enqueue({ method: 'PUT', url: `/events/${event.id}`, body: updatePayload, maxRetries: 5, hasFileUpload: false, metadata: { type: 'admin', clientId: safeUUID(), label: 'Event bearbeiten' } });
          setSuccess('Event wird aktualisiert sobald du wieder online bist');
        } else if (formData.is_series) {
          await writeQueue.enqueue({ method: 'POST', url: '/events/series', body: payload, maxRetries: 5, hasFileUpload: false, metadata: { type: 'admin', clientId: safeUUID(), label: 'Event-Serie erstellen' } });
          setSuccess('Event-Serie wird erstellt sobald du wieder online bist');
        } else {
          await writeQueue.enqueue({ method: 'POST', url: '/events', body: payload, maxRetries: 5, hasFileUpload: false, metadata: { type: 'admin', clientId: safeUUID(), label: 'Event erstellen' } });
          setSuccess('Event wird erstellt sobald du wieder online bist');
        }
      }
      // Dirty-Stand SYNCHRON nach aussen melden, bevor onSuccess/doClose über
      // canDismiss schließt (sonst blockiert canDismiss -> Modal bleibt offen).
      setIsDirty(false); onDirtyChange?.(false); onSuccess(); doClose();
    } catch (error: any) {
      // Validierungsfehler des Backends kommen als { error, details: [...] } —
      // ohne die details liest man nur "Validierungsfehler" und weiß nicht,
      // welches Feld gemeint ist.
      const data = error.response?.data;
      const details = Array.isArray(data?.details)
        ? data.details.map((d: any) => d.message).filter(Boolean).join(', ')
        : '';
      if (details) setError(details);
      else if (data?.error) setError(data.error);
      else setError('Fehler beim Speichern des Events');
    } finally { setLoading(false); }
      });
    } catch {
      // guard() hat abgelehnt: es läuft bereits eine Speicherung. Nichts tun —
      // der Button ist ohnehin disabled, das ist kein Fehler für die Nutzerin.
    }
  };

  const isFormValid = formData.name.trim().length > 0 && formData.event_date && (teamerAccess === 'teamer_only' || !formData.mandatory || formData.jahrgang_ids.length > 0);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{event ? 'Event bearbeiten' : 'Neues Event'}</IonTitle>
          <IonButtons slot="start">
            {/* NICHT an loading haengen: Bleibt der Ladezustand haengen,
                waere das Modal sonst nur noch per Swipe zu verlassen.
                Die Rueckfrage bei ungespeicherten Aenderungen laeuft
                ueber canDismiss der Seite. */}
            <IonButton aria-label="Schließen" onClick={handleClose} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Event speichern" onClick={handleSubmit} disabled={!isFormValid || loading || isSubmitting}
              className="app-modal-submit-btn app-modal-submit-btn--events">
              {loading ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Reihenfolge (User-Entscheid 08.08.): Grunddaten -> Kategorien &
            Zielgruppe -> Datum & Zeit (+ Serie) -> Zeitfenster -> Konfis
            (Plaetze + Warteliste + Punkte) -> Teamer:innen (Zugang +
            Kontingent) -> QR-Check-in. */}

        {/* EVENT GRUNDDATEN — inkl. "Fuer wen ist das Event?": diese Auswahl
            steuert, welche Abschnitte weiter unten erscheinen. */}
        <BasicInfoSection formData={formData} setFormData={setFormData}
          teamerAccess={teamerAccess} setTeamerAccess={setTeamerAccess} loading={loading} />

        {/* KATEGORIEN & ZIELGRUPPE */}
        <CategoriesTargetSection formData={formData} setFormData={setFormData}
          categories={categories} jahrgaenge={jahrgaenge} teamerAccess={teamerAccess} loading={loading} />

        {/* DATUM & ZEIT */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events"><IonIcon icon={calendar} /></div>
            <IonLabel>Datum & Zeit</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
          <IonCardContent>
            <IonList>
              <IonItem lines="none">
                <IonLabel position="stacked">Event Datum & Uhrzeit *</IonLabel>
                <IonDatetimeButton datetime="event-date-picker" />
              </IonItem>
              <IonItem lines="none">
                <IonLabel position="stacked">Endzeit (optional)</IonLabel>
                <IonDatetimeButton datetime="end-time-picker" />
              </IonItem>
              {/* Anmeldefenster gilt NUR fuer Konfis: Teamer:innen duerfen sich
                  jederzeit anmelden, sie begrenzt allein ihr Kontingent. Bei
                  reinen Teamer-Events waeren die Felder daher wirkungslos —
                  sie zu zeigen hat vorgegaukelt, sie wuerden greifen. */}
              {!formData.mandatory && teamerAccess !== 'teamer_only' && (
                <>
                  {/* Eigener, sichtbar abgesetzter Block: die Anmeldung ist eine
                      andere Sache als der Termin selbst. Vorher stand der
                      "ab sofort"-Schalter beziehungslos zwischen den
                      Datums-Buttons (User-Hinweis 10.08.). Trennlinie +
                      Ueberschrift wie im UserManagementModal. */}
                  <div
                    style={{
                      marginTop: '8px',
                      paddingTop: '14px',
                      borderTop: '1px solid rgba(0,0,0,0.06)'
                    }}
                  >
                    <h3
                      style={{
                        fontWeight: 600, margin: '0 0 2px 16px',
                        fontSize: '0.95rem', color: '#3c3c43'
                      }}
                    >
                      Anmeldung
                    </h3>
                    <p style={{ color: '#8e8e93', margin: '0 16px 4px 16px', fontSize: '0.8rem', lineHeight: 1.4 }}>
                      {formData.registration_opens_at
                        ? 'Konfis können sich ab dem gewählten Zeitpunkt anmelden.'
                        : 'Konfis können sich sofort anmelden.'}
                    </p>

                    {/* "Ab sofort" = registration_opens_at NULL. Beide Detail-
                        Ansichten zeigen dafuer "Sofort möglich". */}
                    <IonItem lines="none">
                      <IonLabel>Anmeldung ab sofort</IonLabel>
                      <IonToggle
                        slot="end"
                        className="app-toggle--events"
                        checked={!formData.registration_opens_at}
                        disabled={loading}
                        onIonChange={(e) => {
                          if (e.detail.checked) {
                            setFormData({ ...formData, registration_opens_at: '' });
                          } else {
                            // Zurück auf einen sinnvollen Startwert: jetzt.
                            const now = new Date();
                            const pad = (n: number) => n.toString().padStart(2, '0');
                            setFormData({
                              ...formData,
                              registration_opens_at: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00`
                            });
                          }
                        }}
                      />
                    </IonItem>
                    {!!formData.registration_opens_at && (
                      <IonItem lines="none">
                        <IonLabel position="stacked">Anmeldung ab</IonLabel>
                        <IonDatetimeButton datetime="registration-opens-picker" />
                      </IonItem>
                    )}
                    <IonItem lines="none">
                      <IonLabel position="stacked">Anmeldeschluss</IonLabel>
                      <IonDatetimeButton datetime="registration-closes-picker" />
                    </IonItem>
                  </div>
                </>
              )}
            </IonList>
          </IonCardContent>
          </IonCard>
        </IonList>

        {/* SERIEN-EVENT — direkt bei Datum & Zeit (nur beim Anlegen) */}
        {!event && (
          <SeriesSection formData={formData} setFormData={setFormData} loading={loading} />
        )}

        {/* ZEITFENSTER — nicht bei Pflicht-Events und nicht bei Konfirmationen
            (beide haben feste Termine fuer den ganzen Jahrgang) */}
        {!formData.mandatory && !formData.is_konfirmation && teamerAccess !== 'teamer_only' && (<>
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events"><IonIcon icon={time} /></div>
            <IonLabel>Zeitfenster (optional)</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
          <IonCardContent>
            <IonList>
              <IonItem lines="none">
                <IonLabel>Zeitfenster aktivieren</IonLabel>
                <IonToggle slot="end" className="app-toggle--events" checked={formData.has_timeslots}
                  onIonChange={(e) => {
                    const hasTimeslots = e.detail.checked;
                    setFormData({ ...formData, has_timeslots: hasTimeslots });
                    if (!hasTimeslots) setTimeslots([]);
                  }} disabled={loading} />
              </IonItem>
              {formData.has_timeslots && (
                <div className="app-event-detail__add-button-wrapper" style={{ padding: '0 16px' }}>
                  <IonButton
                    expand="block"
                    fill="outline"
                    onClick={addTimeslot}
                    disabled={loading}
                  >
                    <IonIcon icon={add} slot="start" />
                    Zeitfenster hinzufügen
                  </IonButton>
                </div>
              )}
            </IonList>
          </IonCardContent>
          </IonCard>
        </IonList>

        {formData.has_timeslots && timeslots.map((timeslot, index) => (
          <IonList key={index} inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events">
                <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'white' }}>{index + 1}</span>
              </div>
              <IonLabel style={{ flex: 1 }}>Zeitfenster {index + 1}</IonLabel>
              <IonButton aria-label="Zeitfenster entfernen" fill="clear" color="danger" onClick={() => removeTimeslot(index)} disabled={loading} size="small">
                <IonIcon icon={trash} />
              </IonButton>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                <IonList>
                  <IonItem lines="none">
                    <IonLabel position="stacked">Startzeit</IonLabel>
                    <IonDatetimeButton datetime={`timeslot-start-${index}`} />
                  </IonItem>
                  <IonItem lines="none">
                    <IonLabel position="stacked">Endzeit</IonLabel>
                    <IonDatetimeButton datetime={`timeslot-end-${index}`} />
                  </IonItem>
                  <IonModal keepContentsMounted={true}>
                    <IonDatetime id={`timeslot-start-${index}`} presentation="time" value={timeslot.start_time}
                      onIonChange={(e) => { const v = e.detail.value as string; if (v) updateTimeslot(index, 'start_time', v); }}
                      minuteValues="0,15,30,45" disabled={loading} />
                  </IonModal>
                  <IonModal keepContentsMounted={true}>
                    <IonDatetime id={`timeslot-end-${index}`} presentation="time" value={timeslot.end_time}
                      onIonChange={(e) => { const v = e.detail.value as string; if (v) updateTimeslot(index, 'end_time', v); }}
                      minuteValues="0,15,30,45" disabled={loading} />
                  </IonModal>
                  <IonItem lines="none">
                    <IonLabel>Unbegrenzte Teilnehmer:innen</IonLabel>
                    <IonToggle slot="end" className="app-toggle--events" checked={timeslot.max_participants === 0}
                      onIonChange={(e) => updateTimeslot(index, 'max_participants', e.detail.checked ? 0 : 5)}
                      disabled={loading} />
                  </IonItem>
                  {timeslot.max_participants !== 0 && (
                    <IonItem lines="none">
                      <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Max. Teilnehmer:innen pro Slot</IonLabel>
                      <div className="app-range-row">
                        <span className="app-range-row__min">1</span>
                        <IonRange
                          className="app-range app-range--events"
                          min={1} max={10} step={1}
                          pin={true} pinFormatter={(value: number) => `${value}`}
                          value={timeslot.max_participants}
                          onIonChange={(e) => updateTimeslot(index, 'max_participants', e.detail.value as number)}
                          disabled={loading}
                        />
                        <span className="app-range-row__value">{timeslot.max_participants}</span>
                      </div>
                    </IonItem>
                  )}
                </IonList>
              </IonCardContent>
            </IonCard>
          </IonList>
        ))}
        </>)}

        {/* KONFIS — Plaetze, Warteliste und Punkte in einer Karte */}
        {!formData.mandatory && teamerAccess !== 'teamer_only' && (
          <PointsParticipantsSection formData={formData} setFormData={setFormData} loading={loading} jahrgaenge={jahrgaenge} />
        )}

        {/* TEAMER:INNEN — Plaetze/Warteliste, nur wenn Teamer:innen teilnehmen */}
        {teamerAccess !== 'normal' && (
          <TeamerSection formData={formData} setFormData={setFormData} loading={loading} />
        )}

        {/* QR CHECK-IN FENSTER */}
        <CheckinSection formData={formData} setFormData={setFormData} loading={loading} />
      </IonContent>

      {/* DateTime Modals */}
      <IonModal keepContentsMounted={true}>
        <IonDatetime id="event-date-picker" value={formData.event_date}
          max={datePickerMax}
          onIonChange={(e) => {
            const selectedDate = e.detail.value as string;
            const eventDate = new Date(selectedDate);
            const toIonDatetimeISO = (date: Date) => {
              const pad = (num: number) => num.toString().padStart(2, '0');
              return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
            };
            const endDate = new Date(eventDate); endDate.setHours(endDate.getHours() + 1);
            const regCloses = new Date(eventDate); regCloses.setHours(regCloses.getHours() - 24);
            // Anmeldezeiten NUR beim Neuanlegen mitziehen. Beim Bearbeiten
            // wuerde ein Dreh am Datums-Wheel sonst still die vom Admin
            // gesetzten Anmeldezeiten ueberschreiben (Datenverlust).
            // "Ab sofort" (leeres registration_opens_at) bleibt immer erhalten.
            setFormData({
              ...formData,
              event_date: selectedDate,
              event_end_time: toIonDatetimeISO(endDate),
              ...(event ? {} : { registration_closes_at: toIonDatetimeISO(regCloses) })
            });
          }}
          presentation="date-time" minuteValues="0,15,30,45" firstDayOfWeek={1}
          style={{ '--background': '#f8f9fa', '--border-radius': '12px', '--box-shadow': '0 4px 16px rgba(0,0,0,0.1)' }} />
      </IonModal>
      <IonModal keepContentsMounted={true}>
        <IonDatetime id="end-time-picker" value={formData.event_end_time || formData.event_date}
          max={datePickerMax}
          onIonChange={(e) => setFormData({ ...formData, event_end_time: e.detail.value as string })}
          presentation="date-time" minuteValues="0,15,30,45" firstDayOfWeek={1}
          style={{ '--background': '#f8f9fa', '--border-radius': '12px', '--box-shadow': '0 4px 16px rgba(0,0,0,0.1)' }} />
      </IonModal>
      <IonModal keepContentsMounted={true}>
        <IonDatetime id="registration-opens-picker" value={formData.registration_opens_at}
          max={datePickerMax}
          onIonChange={(e) => setFormData({ ...formData, registration_opens_at: e.detail.value as string })}
          presentation="date-time" minuteValues="0,15,30,45" firstDayOfWeek={1}
          style={{ '--background': '#f8f9fa', '--border-radius': '12px', '--box-shadow': '0 4px 16px rgba(0,0,0,0.1)' }} />
      </IonModal>
      <IonModal keepContentsMounted={true}>
        <IonDatetime id="registration-closes-picker" value={formData.registration_closes_at}
          max={datePickerMax}
          onIonChange={(e) => setFormData({ ...formData, registration_closes_at: e.detail.value as string })}
          presentation="date-time" minuteValues="0,15,30,45" firstDayOfWeek={1}
          style={{ '--background': '#f8f9fa', '--border-radius': '12px', '--box-shadow': '0 4px 16px rgba(0,0,0,0.1)' }} />
      </IonModal>
    </IonPage>
  );
};

export default EventModal;
