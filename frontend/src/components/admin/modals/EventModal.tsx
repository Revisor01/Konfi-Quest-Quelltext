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
  WaitlistSection, SeriesSection
} from './EventFormSections';
import type { EventFormData } from './EventFormSections';
import { safeUUID } from '../../../utils/uuid';

interface EventModalProps {
  event?: Event | null;
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
  // Meldet den "ungespeicherte Aenderungen"-Stand nach aussen, damit die
  // praesentierende Seite ueber canDismiss auch Swipe/Backdrop-Schliessen abfangen kann.
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

  // Schliessen anstossen. Die "ungespeicherte Aenderungen"-Nachfrage laeuft
  // zentral ueber canDismiss der praesentierenden Seite (faengt X-Button, Swipe
  // UND Backdrop einheitlich ab) — daher hier keine zweite Abfrage.
  const handleClose = () => { doClose(); };

  // isDirty-Stand nach aussen melden (fuer canDismiss der praesentierenden Seite).
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  const [formData, setFormData] = useState<EventFormData>({
    name: '', description: '', event_date: new Date().toISOString(), event_end_time: '',
    location: '', points: 0, point_type: 'gemeinde', category_ids: [], jahrgang_ids: [],
    type: 'event', max_participants: 5, registration_opens_at: '', registration_closes_at: '',
    has_timeslots: false, waitlist_enabled: true, max_waitlist_size: 3,
    is_series: false, series_count: 1, series_interval: 'week',
    mandatory: false, is_konfirmation: false, bring_items: '', checkin_window: 30
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
        checkin_window: event.checkin_window || 30
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
      const regOpens = roundToHalfHour(new Date());
      const regCloses = new Date(roundedEventStart);
      regCloses.setHours(regCloses.getHours() - 1);
      const toIonDatetimeISO = (date: Date) => {
        const pad = (num: number) => num.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
      };
      setFormData({
        name: '', description: '', event_date: toIonDatetimeISO(roundedEventStart),
        event_end_time: toIonDatetimeISO(eventEnd), location: '', points: 0,
        point_type: 'gemeinde', category_ids: [], jahrgang_ids: [], type: 'event',
        max_participants: 5, registration_opens_at: toIonDatetimeISO(regOpens),
        registration_closes_at: toIonDatetimeISO(regCloses), has_timeslots: false,
        waitlist_enabled: true, max_waitlist_size: 3, is_series: false,
        series_count: 1, series_interval: 'week', mandatory: false, is_konfirmation: false, bring_items: '',
        checkin_window: 30
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
    if (!formData.name.trim() || !formData.event_date) return;
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
        points: (formData.mandatory || formData.is_konfirmation) ? 0 : formData.points,
        point_type: isTeamerOnly ? 'gemeinde' : formData.point_type,
        category_ids: formData.category_ids,
        jahrgang_ids: isTeamerOnly ? [] : formData.jahrgang_ids,
        type: formData.type,
        max_participants: (formData.mandatory || isTeamerOnly) ? 0 : formData.max_participants,
        registration_opens_at: formData.mandatory ? null : toBackendTimestamp(formData.registration_opens_at),
        registration_closes_at: formData.mandatory ? null : toBackendTimestamp(formData.registration_closes_at),
        has_timeslots: (formData.mandatory || formData.is_konfirmation) ? false : formData.has_timeslots,
        waitlist_enabled: (formData.mandatory || isTeamerOnly) ? false : formData.waitlist_enabled,
        max_waitlist_size: (formData.mandatory || isTeamerOnly) ? 0 : formData.max_waitlist_size,
        timeslots: (!formData.mandatory && !formData.is_konfirmation && formData.has_timeslots) ? timeslots.map(ts => ({
          ...ts, start_time: toBackendTimestamp(ts.start_time), end_time: toBackendTimestamp(ts.end_time)
        })) : [],
        is_series: formData.is_series,
        series_count: formData.is_series ? formData.series_count : undefined,
        series_interval: formData.is_series ? formData.series_interval : undefined,
        mandatory: formData.mandatory, is_konfirmation: formData.is_konfirmation,
        bring_items: formData.bring_items.trim() || null,
        checkin_window: formData.checkin_window,
        teamer_needed: teamerAccess === 'teamer_needed', teamer_only: teamerAccess === 'teamer_only'
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
      // Dirty-Stand SYNCHRON nach aussen melden, bevor onSuccess/doClose ueber
      // canDismiss schliesst (sonst blockiert canDismiss -> Modal bleibt offen).
      setIsDirty(false); onDirtyChange?.(false); onSuccess(); doClose();
    } catch (error: any) {
      if (error.response?.data?.error) setError(error.response.data.error);
      else setError('Fehler beim Speichern des Events');
    } finally { setLoading(false); }
    });
  };

  const isFormValid = formData.name.trim().length > 0 && formData.event_date && (teamerAccess === 'teamer_only' || !formData.mandatory || formData.jahrgang_ids.length > 0);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{event ? 'Event bearbeiten' : 'Neues Event'}</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={handleClose} disabled={loading} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton onClick={handleSubmit} disabled={!isFormValid || loading || isSubmitting}
              className="app-modal-submit-btn app-modal-submit-btn--events">
              {loading ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* EVENT GRUNDDATEN (inkl. Pflicht-Event, Mitbringen, Teamer-Zugang) */}
        <BasicInfoSection formData={formData} setFormData={setFormData}
          teamerAccess={teamerAccess} setTeamerAccess={setTeamerAccess} loading={loading} />

        {/* QR CHECK-IN FENSTER */}
        <CheckinSection formData={formData} setFormData={setFormData} loading={loading} />

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
              {!formData.mandatory && (
                <>
                  <IonItem lines="none">
                    <IonLabel position="stacked">Anmeldung ab</IonLabel>
                    <IonDatetimeButton datetime="registration-opens-picker" />
                  </IonItem>
                  <IonItem lines="none">
                    <IonLabel position="stacked">Anmeldeschluss</IonLabel>
                    <IonDatetimeButton datetime="registration-closes-picker" />
                  </IonItem>
                </>
              )}
            </IonList>
          </IonCardContent>
          </IonCard>
        </IonList>

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
              <IonButton fill="clear" color="danger" onClick={() => removeTimeslot(index)} disabled={loading} size="small">
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

        {/* PUNKTE & TEILNEHMER */}
        {!formData.mandatory && teamerAccess !== 'teamer_only' && (
          <PointsParticipantsSection formData={formData} setFormData={setFormData} loading={loading} />
        )}

        {/* KATEGORIEN & ZIELGRUPPE */}
        <CategoriesTargetSection formData={formData} setFormData={setFormData}
          categories={categories} jahrgaenge={jahrgaenge} teamerAccess={teamerAccess} loading={loading} />

        {/* WARTELISTE */}
        {!formData.mandatory && teamerAccess !== 'teamer_only' && (
          <WaitlistSection formData={formData} setFormData={setFormData} loading={loading} />
        )}

        {/* SERIEN-EVENT */}
        {!event && (
          <SeriesSection formData={formData} setFormData={setFormData} loading={loading} />
        )}
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
            const regOpens = new Date(); regOpens.setHours(9, 0, 0, 0);
            const regCloses = new Date(eventDate); regCloses.setHours(regCloses.getHours() - 24);
            setFormData({ ...formData, event_date: selectedDate, event_end_time: toIonDatetimeISO(endDate),
              registration_opens_at: toIonDatetimeISO(regOpens), registration_closes_at: toIonDatetimeISO(regCloses) });
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
