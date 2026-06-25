import React from 'react';
import {
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonIcon,
  IonSelect,
  IonSelectOption,
  IonList,
  IonListHeader,
  IonToggle,
  IonCard,
  IonCardContent,
  IonRange
} from '@ionic/react';
import {
  create, people, scanOutline, copy
} from 'ionicons/icons';
import { Category, Jahrgang } from '../../../types/event';

// ---- Shared form data type ----

export interface EventFormData {
  name: string;
  description: string;
  event_date: string;
  event_end_time: string;
  location: string;
  points: number;
  point_type: 'gottesdienst' | 'gemeinde';
  category_ids: number[];
  jahrgang_ids: number[];
  type: string;
  max_participants: number;
  registration_opens_at: string;
  registration_closes_at: string;
  has_timeslots: boolean;
  waitlist_enabled: boolean;
  max_waitlist_size: number;
  is_series: boolean;
  series_count: number;
  series_interval: string;
  mandatory: boolean;
  is_konfirmation: boolean;
  bring_items: string;
  checkin_window: number;
}

// ---- BasicInfoSection (jetzt inkl. Pflicht-Event, Mitbringen, Teamer-Zugang) ----

interface BasicInfoSectionProps {
  formData: EventFormData;
  setFormData: (data: EventFormData) => void;
  teamerAccess: 'normal' | 'teamer_needed' | 'teamer_only';
  setTeamerAccess: (value: 'normal' | 'teamer_needed' | 'teamer_only') => void;
  loading: boolean;
}

export const BasicInfoSection = React.memo<BasicInfoSectionProps>(({
  formData, setFormData, teamerAccess, setTeamerAccess, loading
}) => (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={create} />
      </div>
      <IonLabel>Event Grunddaten</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
    <IonCardContent>
      <IonList>
        <IonItem lines="inset">
          <IonLabel position="stacked">Event Name *</IonLabel>
          <IonInput
            value={formData.name}
            onIonInput={(e) => setFormData({ ...formData, name: e.detail.value! })}
            placeholder="z.B. Konfirmandenausflug"
            disabled={loading}
            clearInput={true}
          />
        </IonItem>
        <IonItem lines="inset">
          <IonLabel position="stacked">Beschreibung</IonLabel>
          <IonTextarea
            value={formData.description}
            onIonInput={(e) => setFormData({ ...formData, description: e.detail.value! })}
            placeholder="Beschreibung des Events..."
            rows={3}
            disabled={loading}
          />
        </IonItem>
        <IonItem lines="inset">
          <IonLabel position="stacked">Ort</IonLabel>
          <IonInput
            value={formData.location}
            onIonInput={(e) => setFormData({ ...formData, location: e.detail.value! })}
            placeholder="z.B. Gemeindehaus"
            disabled={loading}
            clearInput={true}
          />
        </IonItem>
        <IonItem lines="inset">
          <IonLabel position="stacked">Was mitbringen (optional)</IonLabel>
          <IonTextarea
            value={formData.bring_items}
            onIonInput={(e) => setFormData({ ...formData, bring_items: e.detail.value || '' })}
            placeholder="z.B. Bibel, Stift, Block"
            rows={2}
            disabled={loading}
          />
        </IonItem>
        <IonItem lines="inset">
          <IonLabel position="stacked">Pflicht-Event</IonLabel>
          <IonToggle
            slot="end"
            className="app-toggle--events"
            checked={formData.mandatory}
            onIonChange={(e) => {
              const mandatory = e.detail.checked;
              // Pflicht-Event schliesst Timeslots aus -> beim Aktivieren abschalten
              setFormData({ ...formData, mandatory, ...(mandatory ? { has_timeslots: false } : {}) });
            }}
            disabled={loading}
          />
        </IonItem>
        <IonItem lines="inset">
          <IonLabel position="stacked">Konfirmation</IonLabel>
          <IonToggle
            slot="end"
            className="app-toggle--konfis"
            checked={formData.is_konfirmation}
            onIonChange={(e) => {
              const is_konfirmation = e.detail.checked;
              // Konfirmation schliesst Timeslots aus (feste Termine) -> beim Aktivieren abschalten
              setFormData({ ...formData, is_konfirmation, ...(is_konfirmation ? { has_timeslots: false } : {}) });
            }}
            disabled={loading}
          />
        </IonItem>
        <IonItem lines="none">
          <IonLabel position="stacked">Teamer-Zugang</IonLabel>
          <IonSelect
            value={teamerAccess}
            onIonChange={(e) => setTeamerAccess(e.detail.value)}
            disabled={loading}
            interface="popover"
            interfaceOptions={{ cssClass: 'app-select-popover--wide' }}
          >
            <IonSelectOption value="normal">Nur Konfis</IonSelectOption>
            <IonSelectOption value="teamer_needed">Teamer:innen gesucht</IonSelectOption>
            <IonSelectOption value="teamer_only">Nur Teamer:innen</IonSelectOption>
          </IonSelect>
        </IonItem>
      </IonList>
    </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- CheckinSection ----

interface CheckinSectionProps {
  formData: EventFormData;
  setFormData: (data: EventFormData) => void;
  loading: boolean;
}

export const CheckinSection = React.memo<CheckinSectionProps>(({
  formData, setFormData, loading
}) => (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={scanOutline} />
      </div>
      <IonLabel>QR Check-in</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
    <IonCardContent>
      <IonList>
        <IonItem lines="none">
          <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Check-in-Fenster (Minuten)</IonLabel>
          <div className="app-range-row">
            <span className="app-range-row__min">5</span>
            <IonRange
              className="app-range app-range--events"
              min={5} max={60} step={5}
              pin={true} pinFormatter={(value: number) => `${value}`}
              value={formData.checkin_window}
              onIonChange={(e) => setFormData({ ...formData, checkin_window: e.detail.value as number })}
              disabled={loading}
            />
            <span className="app-range-row__value">{formData.checkin_window} min</span>
          </div>
        </IonItem>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: '4px 16px 8px 16px', lineHeight: '1.4' }}>
          QR-Code Check-in ist {formData.checkin_window} Min. vor bis {formData.checkin_window} Min. nach Event-Start möglich
        </p>
      </IonList>
    </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- PointsParticipantsSection ----

interface PointsParticipantsSectionProps {
  formData: EventFormData;
  setFormData: (data: EventFormData) => void;
  loading: boolean;
}

export const PointsParticipantsSection = React.memo<PointsParticipantsSectionProps>(({
  formData, setFormData, loading
}) => (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={people} />
      </div>
      <IonLabel>{formData.is_konfirmation ? 'Teilnehmer:innen' : `Punkte${!formData.has_timeslots ? ' & Teilnehmer:innen' : ''}`}</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
    <IonCardContent>
      <IonList>
        {/* Max. Teilnehmer - nur anzeigen wenn KEINE Zeitfenster aktiv */}
        {!formData.has_timeslots && (
          <>
            <IonItem lines="none">
              <IonLabel>Unbegrenzte Teilnehmer:innen</IonLabel>
              <IonToggle
                slot="end"
                className="app-toggle--events"
                checked={formData.max_participants === 0}
                onIonChange={(e) => setFormData({ ...formData, max_participants: e.detail.checked ? 0 : 5 })}
                disabled={loading}
              />
            </IonItem>
            {formData.max_participants !== 0 && (
              <IonItem lines="none">
                <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Max. Teilnehmer:innen</IonLabel>
                <div className="app-range-row">
                  <span className="app-range-row__min">1</span>
                  <IonRange
                    className="app-range app-range--events"
                    min={1} max={50} step={1}
                    pin={true} pinFormatter={(value: number) => `${value}`}
                    value={formData.max_participants}
                    onIonChange={(e) => setFormData({ ...formData, max_participants: e.detail.value as number })}
                    disabled={loading}
                  />
                  <span className="app-range-row__value">{formData.max_participants}</span>
                </div>
              </IonItem>
            )}
          </>
        )}

        {/* Punkte + Typ: bei Konfirmation ausgeblendet (Konfirmations-Events geben keine Punkte) */}
        {!formData.is_konfirmation && (
          <>
            <IonItem lines="none">
              <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Punkte</IonLabel>
              <div className="app-range-row">
                <span className="app-range-row__min">1</span>
                <IonRange
                  className="app-range app-range--events"
                  min={1} max={5} step={1}
                  pin={true} pinFormatter={(value: number) => `${value}`}
                  value={formData.points}
                  onIonChange={(e) => setFormData({ ...formData, points: e.detail.value as number })}
                  disabled={loading}
                />
                <span className="app-range-row__value">{formData.points}</span>
              </div>
            </IonItem>

            <IonItem lines="none" style={{ '--background': 'transparent', paddingBottom: '8px', paddingTop: '16px' }}>
              <IonLabel style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666' }}>Typ *</IonLabel>
            </IonItem>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                className={`app-list-item app-list-item--gemeinde${formData.point_type === 'gemeinde' ? ' app-list-item--selected' : ''}`}
                onClick={() => !loading && setFormData({ ...formData, point_type: 'gemeinde' })}
                style={{
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0'
                }}>
                <span style={{ fontWeight: '500', color: '#333' }}>Gemeinde</span>
              </div>
              <div
                className={`app-list-item app-list-item--gottesdienst${formData.point_type === 'gottesdienst' ? ' app-list-item--selected' : ''}`}
                onClick={() => !loading && setFormData({ ...formData, point_type: 'gottesdienst' })}
                style={{
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0'
                }}>
                <span style={{ fontWeight: '500', color: '#333' }}>Gottesdienst</span>
              </div>
            </div>
          </>
        )}
      </IonList>
    </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- CategoriesTargetSection ----

interface CategoriesTargetSectionProps {
  formData: EventFormData;
  setFormData: React.Dispatch<React.SetStateAction<EventFormData>>;
  categories: Category[];
  jahrgaenge: Jahrgang[];
  teamerAccess: string;
  loading: boolean;
}

export const CategoriesTargetSection = React.memo<CategoriesTargetSectionProps>(({
  formData, setFormData, categories, jahrgaenge, teamerAccess, loading
}) => (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={people} />
      </div>
      <IonLabel>Kategorien & Zielgruppe</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
    <IonCardContent>
      <IonList>
        {categories.length > 0 ? (
          <>
            <IonItem lines="none" style={{ '--background': 'transparent', paddingBottom: '8px' }}>
              <IonLabel style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666' }}>
                Kategorien (mehrere möglich)
                {formData.category_ids.length > 0 && (
                  <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--app-color-categories)', fontWeight: 'normal' }}>
                    ({formData.category_ids.length} ausgewählt)
                  </span>
                )}
              </IonLabel>
            </IonItem>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {categories.map((category) => {
                const isSelected = formData.category_ids.includes(category.id);
                return (
                  <div
                    key={category.id}
                    className={`app-list-item app-list-item--categories${isSelected ? ' app-list-item--selected' : ''}`}
                    onClick={() => {
                      if (!loading) {
                        setFormData(prev => ({
                          ...prev,
                          category_ids: prev.category_ids.includes(category.id)
                            ? prev.category_ids.filter(id => id !== category.id)
                            : [...prev.category_ids, category.id]
                        }));
                      }
                    }}
                    style={{
                      cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0'
                    }}>
                    <span style={{ fontWeight: '500', color: '#333' }}>{category.name}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <IonItem lines="none">
            <IonLabel color="medium"><p>Keine Kategorien verfügbar</p></IonLabel>
          </IonItem>
        )}

        {teamerAccess !== 'teamer_only' && (<>
        <IonItem lines="none" style={{ '--background': 'transparent', paddingBottom: '8px', paddingTop: '16px' }}>
          <IonLabel style={{ fontSize: '0.9rem', fontWeight: '500', color: formData.mandatory && formData.jahrgang_ids.length === 0 ? '#dc3545' : '#666' }}>
            Jahrgänge (mehrere möglich) *{formData.mandatory && formData.jahrgang_ids.length === 0 ? ' (Pflicht bei Pflicht-Events)' : ''}
            {formData.jahrgang_ids.length > 0 && (
              <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--app-color-jahrgang)', fontWeight: 'normal' }}>
                ({formData.jahrgang_ids.length} ausgewählt)
              </span>
            )}
          </IonLabel>
        </IonItem>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {jahrgaenge.map((jahrgang) => {
            const isSelected = formData.jahrgang_ids.includes(jahrgang.id);
            return (
              <div
                key={jahrgang.id}
                className={`app-list-item app-list-item--jahrgang${isSelected ? ' app-list-item--selected' : ''}`}
                onClick={() => {
                  if (!loading) {
                    setFormData(prev => ({
                      ...prev,
                      jahrgang_ids: prev.jahrgang_ids.includes(jahrgang.id)
                        ? prev.jahrgang_ids.filter(id => id !== jahrgang.id)
                        : [...prev.jahrgang_ids, jahrgang.id]
                    }));
                  }
                }}
                style={{
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0'
                }}>
                <span style={{ fontWeight: '500', color: '#333' }}>{jahrgang.name}</span>
              </div>
            );
          })}
        </div>
        </>)}
      </IonList>
    </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- WaitlistSection ----

interface WaitlistSectionProps {
  formData: EventFormData;
  setFormData: (data: EventFormData) => void;
  loading: boolean;
}

export const WaitlistSection = React.memo<WaitlistSectionProps>(({
  formData, setFormData, loading
}) => (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={people} />
      </div>
      <IonLabel>Warteliste</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
    <IonCardContent>
      <IonList>
        <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: formData.waitlist_enabled ? '12px' : '0' }}>
          <IonLabel>Warteliste aktivieren</IonLabel>
          <IonToggle
            slot="end"
            className="app-toggle--events"
            checked={formData.waitlist_enabled}
            onIonChange={(e) => setFormData({ ...formData, waitlist_enabled: e.detail.checked })}
            disabled={loading}
          />
        </IonItem>
        {formData.waitlist_enabled && (
          <IonItem lines="none">
            <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Max. Wartelisten-Plätze</IonLabel>
            <div className="app-range-row">
              <span className="app-range-row__min">1</span>
              <IonRange
                className="app-range app-range--events"
                min={1} max={10} step={1}
                pin={true} pinFormatter={(value: number) => `${value}`}
                value={formData.max_waitlist_size}
                onIonChange={(e) => setFormData({ ...formData, max_waitlist_size: e.detail.value as number })}
                disabled={loading}
              />
              <span className="app-range-row__value">{formData.max_waitlist_size}</span>
            </div>
          </IonItem>
        )}
      </IonList>
    </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- SeriesSection ----

interface SeriesSectionProps {
  formData: EventFormData;
  setFormData: (data: EventFormData) => void;
  loading: boolean;
}

export const SeriesSection = React.memo<SeriesSectionProps>(({
  formData, setFormData, loading
}) => {
  // Serien-Limit: max. 12 Monate Spannweite (Backend prüft identisch).
  // Monatliches Intervall -> max. 12 Termine, alle anderen -> max. 26.
  const maxCount = formData.series_interval === 'month' ? 12 : 26;

  // Letzten Termin der Serie berechnen (gleiche Datums-Logik wie das Backend)
  const lastDate = React.useMemo(() => {
    if (!formData.is_series || !formData.event_date) return null;
    const d = new Date(formData.event_date);
    if (isNaN(d.getTime())) return null;
    const steps = (formData.series_count || 2) - 1;
    if (formData.series_interval === 'day') d.setDate(d.getDate() + steps);
    else if (formData.series_interval === '2weeks') d.setDate(d.getDate() + steps * 14);
    else if (formData.series_interval === 'month') d.setMonth(d.getMonth() + steps);
    else d.setDate(d.getDate() + steps * 7);
    return d;
  }, [formData.is_series, formData.event_date, formData.series_count, formData.series_interval]);

  return (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={copy} />
      </div>
      <IonLabel>Event-Serie (optional)</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent>
        <IonList>
          <IonItem lines="none">
            <IonLabel>Als Serie erstellen</IonLabel>
            <IonToggle
              slot="end"
              className="app-toggle--events"
              checked={formData.is_series}
              onIonChange={(e) => setFormData({ ...formData, is_series: e.detail.checked })}
              disabled={loading}
            />
          </IonItem>
          {formData.is_series && (
            <>
              <IonItem lines="none">
                <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Anzahl Events</IonLabel>
                <div className="app-range-row">
                  <span className="app-range-row__min">2</span>
                  <IonRange
                    className="app-range app-range--events"
                    min={2} max={maxCount} step={1}
                    pin={true} pinFormatter={(value: number) => `${value}`}
                    value={Math.min(formData.series_count, maxCount)}
                    onIonChange={(e) => setFormData({ ...formData, series_count: e.detail.value as number })}
                    disabled={loading}
                  />
                  <span className="app-range-row__value">{formData.series_count}</span>
                </div>
              </IonItem>
              <IonItem lines="none">
                <IonLabel position="stacked">Intervall</IonLabel>
                <IonSelect
                  value={formData.series_interval}
                  onIonChange={(e) => {
                    const interval = e.detail.value;
                    // Beim Wechsel auf monatlich Anzahl auf das 12-Monats-Limit kappen
                    const cap = interval === 'month' ? 12 : 26;
                    setFormData({
                      ...formData,
                      series_interval: interval,
                      series_count: Math.min(formData.series_count, cap)
                    });
                  }}
                  placeholder="Intervall wählen"
                  disabled={loading}
                  interface="popover"
                  interfaceOptions={{ cssClass: 'app-select-popover--wide' }}
                >
                  <IonSelectOption value="day">Täglich</IonSelectOption>
                  <IonSelectOption value="week">Wöchentlich</IonSelectOption>
                  <IonSelectOption value="2weeks">Alle 2 Wochen</IonSelectOption>
                  <IonSelectOption value="month">Monatlich</IonSelectOption>
                </IonSelect>
              </IonItem>
              {lastDate && (
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel color="medium">
                    <p>Letzter Termin: {lastDate.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                  </IonLabel>
                </IonItem>
              )}
            </>
          )}
          {!formData.is_series && (
            <IonItem lines="none" style={{ '--background': 'transparent', opacity: 0.6 }}>
              <IonLabel color="medium"><p>Einzelnes Event</p></IonLabel>
            </IonItem>
          )}
        </IonList>
      </IonCardContent>
    </IonCard>
  </IonList>
  );
});
