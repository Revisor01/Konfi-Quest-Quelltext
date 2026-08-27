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
  IonRange,
  IonAccordion,
  IonAccordionGroup
} from '@ionic/react';
import {
  create, people, scanOutline, copy, chevronDownOutline
} from 'ionicons/icons';
import { Category, Jahrgang } from '../../../types/event';
import { istPunkteartAktiv, PUNKTEART_NAME, type Punkteart } from '../../../utils/punktearten';

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
  teamer_max_participants: number;
  teamer_waitlist_enabled: boolean;
  teamer_max_waitlist_size: number;
}

// ---- BasicInfoSection ----
// Enthaelt bewusst ALLES, was den weiteren Formularverlauf steuert (User-
// Entscheid 09.08.): Pflicht-Event, Konfirmation und der Teamer-Zugang. Sobald
// hier feststeht, FUER WEN das Event ist, blendet sich der Rest des Formulars
// entsprechend ein oder aus — deshalb darf diese Entscheidung nicht weiter
// unten stehen.

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
        {/* Steuert, welche Abschnitte weiter unten ueberhaupt erscheinen —
            gehoert deshalb ganz nach oben in die Grunddaten. */}
        <IonItem lines={teamerAccess === 'teamer_only' ? 'none' : 'inset'}>
          <IonLabel position="stacked">Für wen ist das Event?</IonLabel>
          <IonSelect
            value={teamerAccess}
            onIonChange={(e) => {
              const value = e.detail.value;
              setTeamerAccess(value);
              // "Nur Teamer:innen" schließt Pflicht-Event und Konfirmation aus:
              // beides sind Konfi-Kategorien (Pflicht für den Jahrgang bzw. der
              // Konfirmationstermin) und ergeben ohne Konfis keinen Sinn.
              if (value === 'teamer_only') {
                setFormData({ ...formData, mandatory: false, is_konfirmation: false, has_timeslots: false });
              }
            }}
            disabled={loading}
            interface="popover"
            interfaceOptions={{ cssClass: 'app-select-popover--wide' }}
          >
            <IonSelectOption value="normal">Nur Konfis</IonSelectOption>
            <IonSelectOption value="teamer_needed">Konfis, Teamer:innen gesucht</IonSelectOption>
            <IonSelectOption value="teamer_only">Nur Teamer:innen</IonSelectOption>
          </IonSelect>
        </IonItem>
        {/* Pflicht-Event und Konfirmation nur, wenn Konfis teilnehmen */}
        {teamerAccess !== 'teamer_only' && (<>
        <IonItem lines="inset">
          <IonLabel position="stacked">Pflicht-Event</IonLabel>
          <IonToggle
            slot="end"
            className="app-toggle--events"
            checked={formData.mandatory}
            onIonChange={(e) => {
              const mandatory = e.detail.checked;
              // Pflicht-Event schließt Timeslots aus -> beim Aktivieren abschalten
              setFormData({ ...formData, mandatory, ...(mandatory ? { has_timeslots: false } : {}) });
            }}
            disabled={loading}
          />
        </IonItem>
        <IonItem lines="none">
          <IonLabel position="stacked">Konfirmation</IonLabel>
          <IonToggle
            slot="end"
            className="app-toggle--konfis"
            checked={formData.is_konfirmation}
            onIonChange={(e) => {
              const is_konfirmation = e.detail.checked;
              // Konfirmation schließt Timeslots aus (feste Termine) -> beim Aktivieren abschalten
              setFormData({ ...formData, is_konfirmation, ...(is_konfirmation ? { has_timeslots: false } : {}) });
            }}
            disabled={loading}
          />
        </IonItem>
        </>)}
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
  /**
   * Alle Jahrgaenge der Organisation. Gebraucht, um die Punkteart-Auswahl auf
   * die Arten zu beschraenken, die in den ausgewaehlten Jahrgaengen ueberhaupt
   * aktiv sind -- sonst laesst sich ein Termin anlegen, dessen Punkte spaeter
   * pro Teilnehmer:in am Server scheitern.
   */
  jahrgaenge?: Jahrgang[];
}

// Eine Karte "Konfis" — Plätze, Warteliste und Punkte zusammen, damit die
// Struktur der Teamer-Karte entspricht (einziger Unterschied: die Punkte).
export const PointsParticipantsSection = React.memo<PointsParticipantsSectionProps>(({
  formData, setFormData, loading, jahrgaenge = []
}) => {
  // Ein Termin gehoert mehreren Jahrgaengen. Eine Punkteart bleibt waehlbar,
  // solange sie in MINDESTENS EINEM der ausgewaehlten Jahrgaenge aktiv ist --
  // fuer die uebrigen verbucht der Server sie ohnehin nicht.
  // Ohne Jahrgangs-Auswahl (noch keiner gewaehlt) bleiben beide waehlbar,
  // sonst haette man vor der ersten Auswahl gar keine Punkteart.
  const gewaehlte = jahrgaenge.filter((j) => formData.jahrgang_ids.includes(j.id));
  const verfuegbareArten: Punkteart[] = (['gottesdienst', 'gemeinde'] as Punkteart[]).filter(
    (art) => gewaehlte.length === 0 || gewaehlte.some((j) => istPunkteartAktiv(j, art))
  );

  return (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={people} />
      </div>
      <IonLabel>Konfis</IonLabel>
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

            {/* Warteliste NUR bei begrenzter Teilnahme — bei unbegrenzt kann
                niemand warten, dann waere der Schalter irrefuehrend. */}
            {formData.max_participants !== 0 && (
              <>
                <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: formData.waitlist_enabled ? '12px' : '0', paddingTop: '8px' }}>
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
              </>
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
              {verfuegbareArten.map((art) => (
                <div
                  key={art}
                  className={`app-list-item app-list-item--${art}${formData.point_type === art ? ' app-list-item--selected' : ''}`}
                  onClick={() => !loading && setFormData({ ...formData, point_type: art })}
                  style={{
                    cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0'
                  }}>
                  <span style={{ fontWeight: '500', color: '#333' }}>{PUNKTEART_NAME[art]}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </IonList>
    </IonCardContent>
    </IonCard>
  </IonList>
  );
});

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
          // Akkordeon mit Multi-Auswahl (Muster: Icon-Picker im Challenge-Modal) —
          // die Kategorien-Liste ist sonst der laengste Block im Formular.
          <IonAccordionGroup>
            <IonAccordion value="kategorien" toggleIcon={chevronDownOutline} toggleIconSlot="end">
              <IonItem slot="header" lines="none">
                <IonLabel>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                    Kategorien (mehrere möglich)
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: '#333', margin: '0', fontWeight: '500' }}>
                    {formData.category_ids.length === 0
                      ? 'Keine Auswahl'
                      : categories
                          .filter((c) => formData.category_ids.includes(c.id))
                          .map((c) => c.name)
                          .join(', ')}
                  </p>
                </IonLabel>
              </IonItem>
              <div slot="content" style={{ padding: '8px 0' }}>
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
              </div>
            </IonAccordion>
          </IonAccordionGroup>
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

// ---- TeamerSection (Plaetze + Warteliste für Teamer:innen) ----
// Der Zugang ("Für wen ist das Event?") steht in den GRUNDDATEN, weil er den
// weiteren Formularverlauf steuert (User-Entscheid 09.08.). Diese Karte wird
// von EventModal nur gerendert, wenn Teamer:innen überhaupt teilnehmen —
// Aufbau identisch zur Konfis-Karte, nur ohne Punkte.

interface TeamerSectionProps {
  formData: EventFormData;
  setFormData: (data: EventFormData) => void;
  loading: boolean;
}

export const TeamerSection = React.memo<TeamerSectionProps>(({
  formData, setFormData, loading
}) => (
  <IonList inset={true} className="app-modal-section">
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={people} />
      </div>
      <IonLabel>Teamer:innen</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
    <IonCardContent>
      <IonList>
        <IonItem lines="none">
          <IonLabel>Unbegrenzte Teamer:innen</IonLabel>
          <IonToggle
            slot="end"
            className="app-toggle--events"
            checked={formData.teamer_max_participants === 0}
            onIonChange={(e) => setFormData({ ...formData, teamer_max_participants: e.detail.checked ? 0 : 5 })}
            disabled={loading}
          />
        </IonItem>
        {formData.teamer_max_participants !== 0 && (
          <IonItem lines="none">
            <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Wie viele Teamer:innen werden gesucht?</IonLabel>
            <div className="app-range-row">
              <span className="app-range-row__min">1</span>
              <IonRange
                className="app-range app-range--events"
                min={1} max={25} step={1}
                pin={true} pinFormatter={(value: number) => `${value}`}
                value={Math.min(formData.teamer_max_participants, 25)}
                onIonChange={(e) => setFormData({ ...formData, teamer_max_participants: e.detail.value as number })}
                disabled={loading}
              />
              <span className="app-range-row__value">{formData.teamer_max_participants}</span>
            </div>
          </IonItem>
        )}

        {/* Warteliste NUR bei begrenzten Teamer-Plaetzen (wie bei den Konfis) */}
        {formData.teamer_max_participants !== 0 && (<>
          <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: formData.teamer_waitlist_enabled ? '12px' : '0', paddingTop: '8px' }}>
            <IonLabel>Warteliste aktivieren</IonLabel>
            <IonToggle
              slot="end"
              className="app-toggle--events"
              checked={formData.teamer_waitlist_enabled}
              onIonChange={(e) => setFormData({ ...formData, teamer_waitlist_enabled: e.detail.checked })}
              disabled={loading}
            />
          </IonItem>
          {formData.teamer_waitlist_enabled && (
            <IonItem lines="none">
              <IonLabel position="stacked" style={{ marginBottom: '8px' }}>Max. Wartelisten-Plätze</IonLabel>
              <div className="app-range-row">
                <span className="app-range-row__min">1</span>
                <IonRange
                  className="app-range app-range--events"
                  min={1} max={10} step={1}
                  pin={true} pinFormatter={(value: number) => `${value}`}
                  value={formData.teamer_max_waitlist_size}
                  onIonChange={(e) => setFormData({ ...formData, teamer_max_waitlist_size: e.detail.value as number })}
                  disabled={loading}
                />
                <span className="app-range-row__value">{formData.teamer_max_waitlist_size}</span>
              </div>
            </IonItem>
          )}
        </>)}
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
