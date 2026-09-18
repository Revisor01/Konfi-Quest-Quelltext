import { fehlerText } from '../../../utils/fehler';
import React, { useState, useMemo } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonList,
  IonListHeader,
  IonLabel,
  IonCard,
  IonCardContent,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonItemGroup,
  IonItem,
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonPopover
} from '@ionic/react';
import {
  ICON_ABSAGE,
  ICON_BUCH,
  ICON_ENTFERNEN_GEFUELLT,
  ICON_FILTER,
  ICON_GRUPPE,
  ICON_KREIS_LEER,
  ICON_MAIL,
  ICON_SCHLIESSEN,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';
import EmptyState from '../../shared/EmptyState';
import {
  getZellStatus,
  berechneZeilenStats,
  MatrixZellStatus,
  MatrixZeilenStats
} from '../../../utils/anwesenheitsMatrix';

interface Jahrgang {
  id: number;
  name: string;
}

interface KonfiRow {
  user_id: number;
  display_name: string;
  username?: string;
}

interface EventCol {
  id: number;
  name: string;
  event_date: string;
}

interface Booking {
  event_id: number;
  user_id: number;
  status: string | null;
  // 'excused': von der Leitung nachgetragene Abmeldung.
  attendance_status: 'present' | 'absent' | 'excused' | null;
  excuse_reason?: string | null;
  attendance_note?: string | null;
}

interface MatrixResponse {
  jahrgang: { id: number; name: string };
  konfis: KonfiRow[];
  events: EventCol[];
  bookings: Booking[];
}

interface Konfspruch {
  source: 'liste' | 'freitext';
  id?: number;
  reference?: string | null;
  text: string;
  translation?: string | null;
}

interface SpruchRow {
  user_id: number;
  display_name: string;
  konfspruch: Konfspruch | null;
  konfirmation_date?: string | null;
}

type ViewMode = 'anwesenheit' | 'sprueche';

interface AttendanceMatrixModalProps {
  jahrgaenge: Jahrgang[];
  initialJahrgangId?: number;
  onClose: () => void;
}

const formatShortDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  } catch {
    return iso;
  }
};

const AttendanceMatrixModal: React.FC<AttendanceMatrixModalProps> = ({
  jahrgaenge,
  initialJahrgangId,
  onClose
}) => {
  const { setError, setSuccess } = useApp();
  const [jahrgangId, setJahrgangId] = useState<number | null>(
    initialJahrgangId ?? (jahrgaenge.length > 0 ? jahrgaenge[0].id : null)
  );
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('anwesenheit');
  const [sprueche, setSprueche] = useState<SpruchRow[] | null>(null);
  const [spruecheLoading, setSpruecheLoading] = useState(false);
  const [sending, setSending] = useState(false);
  // Popover: Tipp auf ein Datum im Tabellenkopf zeigt den Event-Titel
  const [eventPopover, setEventPopover] = useState<{ anchor: Event; event: EventCol } | null>(null);

  const loadMatrix = async (id: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/jahrgaenge/${id}/attendance-matrix`);
      setData(res.data);
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Laden der Anwesenheit'));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const loadSprueche = async (id: number) => {
    setSprueche(null); // alte Sprueche sofort verwerfen (kein kurzes Aufblitzen beim Jahrgang-Wechsel)
    setSpruecheLoading(true);
    try {
      const res = await api.get(`/admin/jahrgaenge/${id}/sprueche`);
      setSprueche(res.data);
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Laden der Konfisprüche'));
      setSprueche(null);
    } finally {
      setSpruecheLoading(false);
    }
  };

  React.useEffect(() => {
    if (jahrgangId) loadMatrix(jahrgangId);
  }, [jahrgangId]);

  React.useEffect(() => {
    if (jahrgangId && viewMode === 'sprueche') loadSprueche(jahrgangId);
  }, [jahrgangId, viewMode]);

  // Schickt die aktuelle Ansicht (Anwesenheit oder Sprüche) per E-Mail an die eigene Adresse.
  const handleSendEmail = async () => {
    if (!jahrgangId) return;
    setSending(true);
    try {
      await api.post(`/admin/jahrgaenge/${jahrgangId}/matrix-email`, { type: viewMode });
      setSuccess('E-Mail an deine Adresse gesendet');
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Senden der E-Mail'));
    } finally {
      setSending(false);
    }
  };

  // Sprüche-Liste nach Suchbegriff filtern (gleiches Suchfeld wie die Matrix).
  const filteredSprueche = useMemo(() => {
    if (!sprueche) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return sprueche;
    return sprueche.filter(s => s.display_name.toLowerCase().includes(term));
  }, [sprueche, searchTerm]);

  // Schneller Lookup: bookings nach (user, event) gruppieren
  const bookingMap = useMemo(() => {
    const map = new Map<string, Booking>();
    if (data) {
      data.bookings.forEach(b => map.set(`${b.user_id}-${b.event_id}`, b));
    }
    return map;
  }, [data]);

  // Zellstatus kommt aus utils/anwesenheitsMatrix:
  // Abgemeldete ('opted_out') sind ein eigener Status und fallen nicht mehr
  // auf "ausstehend" — sie waren sonst von "noch nicht verbucht" nicht
  // unterscheidbar (Prod-Events 105, 129, 132).
  const getCellStatus = (userId: number, eventId: number): MatrixZellStatus =>
    getZellStatus(bookingMap.get(`${userId}-${eventId}`));

  // Pro-Konfi-Statistik
  const konfiStats = useMemo(() => {
    const stats = new Map<number, MatrixZeilenStats>();
    if (!data) return stats;
    data.konfis.forEach(k => {
      stats.set(k.user_id, berechneZeilenStats(
        data.events.map(e => getCellStatus(k.user_id, e.id))
      ));
    });
    return stats;
  }, [data, bookingMap]);

  // Live-Suche: Konfi-Zeilen nach Name/Benutzername filtern
  const filteredKonfis = useMemo(() => {
    if (!data) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return data.konfis;
    return data.konfis.filter(k =>
      k.display_name.toLowerCase().includes(term) ||
      (k.username || '').toLowerCase().includes(term)
    );
  }, [data, searchTerm]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>{viewMode === 'sprueche' ? 'Konfisprüche' : 'Anwesenheit'}</IonTitle>
          <IonButtons slot="end">
            <IonButton
              onClick={handleSendEmail}
              disabled={sending || !jahrgangId}
              title="Per E-Mail an dich senden"
              aria-label="Per E-Mail an dich senden"
            >
              {sending
                ? <IonSpinner name="crescent" />
                : <IonIcon icon={ICON_MAIL} slot="icon-only" />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        {/* Suche & Filter */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_FILTER} />
            </div>
            <IonLabel>Suche & Filter</IonLabel>
          </IonListHeader>
          <IonItemGroup>
            {/* Suchfeld */}
            <IonItem>
              <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
              <IonInput
                value={searchTerm}
                onIonInput={(e) => setSearchTerm(e.detail.value!)}
                placeholder="Konfi suchen..."
              />
            </IonItem>
            {/* Jahrgang Filter */}
            <IonItem>
              <IonIcon icon={ICON_TERMIN} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
              <IonSelect
                value={jahrgangId}
                onIonChange={(e) => setJahrgangId(e.detail.value)}
                interface="popover"
                placeholder="Jahrgang"
                style={{ width: '100%' }}
              >
                {jahrgaenge.map(j => (
                  <IonSelectOption key={j.id} value={j.id}>{j.name}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
          </IonItemGroup>
        </IonList>

        {/* Umschaltung Anwesenheit / Konfispruch */}
        <div className="app-segment-wrapper">
          <IonSegment
            value={viewMode}
            onIonChange={(e) => setViewMode(e.detail.value as ViewMode)}
          >
            <IonSegmentButton value="anwesenheit">
              <IonLabel>Anwesenheit</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="sprueche">
              <IonLabel>Konfispruch</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </div>

        {/* Konfispruch-Ansicht: Liste Konfi -> gewaehlter Spruch */}
        {viewMode === 'sprueche' ? (
          spruecheLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-extraweit)' }}>
              <IonSpinner name="crescent" />
            </div>
          ) : !sprueche || filteredSprueche.length === 0 ? (
            <EmptyState
              icon={ICON_BUCH}
              title="Keine Konfisprüche"
              message="Für diesen Jahrgang gibt es noch keine Konfis oder keine Treffer."
            />
          ) : (
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--events">
                  <IonIcon icon={ICON_BUCH} />
                </div>
                <IonLabel>
                  {filteredSprueche.length} Konfi{filteredSprueche.length === 1 ? '' : 's'}
                </IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: '0', overflowX: 'auto' }}>
                  <table className="attendance-matrix attendance-matrix--sprueche">
                    <thead>
                      <tr>
                        <th className="attendance-matrix__th-konfi">Konfi</th>
                        <th className="attendance-matrix__th-cell">Konfirmation</th>
                        <th className="attendance-matrix__th-cell">Buch / Stelle</th>
                        <th className="attendance-matrix__th-cell">Konfispruch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSprueche.map(s => (
                        <tr key={s.user_id}>
                          <td className="attendance-matrix__td-konfi">{s.display_name}</td>
                          <td className="attendance-matrix__td-cell">
                            {s.konfirmation_date
                              ? `${new Date(s.konfirmation_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${new Date(s.konfirmation_date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`
                              : <span style={{ color: 'var(--app-text-muted)', fontStyle: 'italic' }}>nicht gebucht</span>}
                          </td>
                          <td className="attendance-matrix__td-cell">
                            {s.konfspruch?.reference || <span style={{ color: 'var(--app-text-muted)' }}>—</span>}
                          </td>
                          <td className="attendance-matrix__td-cell">
                            {s.konfspruch?.text
                              ? s.konfspruch.text
                              : <span style={{ color: 'var(--app-text-muted)', fontStyle: 'italic' }}>{s.konfspruch ? '(Übersetzung fehlt)' : 'noch keiner'}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </IonCardContent>
              </IonCard>
            </IonList>
          )
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-extraweit)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : !data ? (
          <EmptyState
            icon={ICON_TERMIN}
            title="Keine Daten"
            message="Wähle einen Jahrgang."
          />
        ) : data.events.length === 0 ? (
          <EmptyState
            icon={ICON_TERMIN}
            title="Keine Pflichtevents"
            message="Für diesen Jahrgang gibt es keine Pflichtevents."
          />
        ) : data.konfis.length === 0 ? (
          <EmptyState
            icon={ICON_GRUPPE}
            title="Keine Konfis"
            message="Dieser Jahrgang hat noch keine Konfis."
          />
        ) : (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events">
                <IonIcon icon={ICON_TERMIN} />
              </div>
              <IonLabel>
                {data.events.length} Pflichtevent{data.events.length === 1 ? '' : 's'} · {filteredKonfis.length} Konfi{filteredKonfis.length === 1 ? '' : 's'}
              </IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '0', overflowX: 'auto' }}>
                <table className="attendance-matrix">
                  <thead>
                    <tr>
                      <th className="attendance-matrix__th-konfi">Konfi</th>
                      {data.events.map(e => (
                        <th
                          key={e.id}
                          className="attendance-matrix__th-event"
                          title={e.name}
                          onClick={(ev) => setEventPopover({ anchor: ev.nativeEvent, event: e })}
                        >
                          <div className="attendance-matrix__event-date">{formatShortDate(e.event_date)}</div>
                        </th>
                      ))}
                      <th className="attendance-matrix__th-summary">Σ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKonfis.map(k => {
                      const stats = konfiStats.get(k.user_id)
                        || { present: 0, absent: 0, excused: 0, open: 0, opted_out: 0, nenner: 0 };
                      return (
                        <tr key={k.user_id}>
                          <td className="attendance-matrix__td-konfi">{k.display_name}</td>
                          {data.events.map(e => {
                            const s = getCellStatus(k.user_id, e.id);
                            const b = bookingMap.get(`${k.user_id}-${e.id}`);
                            // Grund und Notiz als Tooltip an der Zelle: Die
                            // Matrix ist die Uebersicht, in der die Kolleginnen
                            // nachsehen -- ohne das waere nur das graue Zeichen
                            // da und die Frage "warum?" unbeantwortet.
                            const hinweis = [
                              s === 'excused' ? b?.excuse_reason : null,
                              b?.attendance_note
                            ].filter(Boolean).join(' · ');
                            return (
                              <td key={e.id} className="attendance-matrix__td-cell" title={hinweis || undefined}>
                                <span className={`attendance-matrix__dot attendance-matrix__dot--${s}`}>
                                  <IonIcon
                                    icon={
                                      s === 'present' ? ICON_ZUSAGE_GEFUELLT
                                      : s === 'absent' ? ICON_ABSAGE
                                      : s === 'opted_out' || s === 'excused' ? ICON_ENTFERNEN_GEFUELLT
                                      : ICON_KREIS_LEER
                                    }
                                  />
                                </span>
                              </td>
                            );
                          })}
                          <td className="attendance-matrix__td-summary">
                            <span className="attendance-matrix__summary-text">
                              {/* Nenner ohne abgemeldete Termine */}
                              {stats.present}/{stats.nenner}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Legende */}
        {viewMode === 'anwesenheit' && data && data.events.length > 0 && data.konfis.length > 0 && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonCard className="app-card">
              <IonCardContent>
                <div className="attendance-matrix__legend">
                  <div className="attendance-matrix__legend-item">
                    <span className="attendance-matrix__dot attendance-matrix__dot--present">
                      <IonIcon icon={ICON_ZUSAGE_GEFUELLT} />
                    </span>
                    <span>Anwesend</span>
                  </div>
                  <div className="attendance-matrix__legend-item">
                    <span className="attendance-matrix__dot attendance-matrix__dot--absent">
                      <IonIcon icon={ICON_ABSAGE} />
                    </span>
                    <span>Fehlt</span>
                  </div>
                  <div className="attendance-matrix__legend-item">
                    <span className="attendance-matrix__dot attendance-matrix__dot--opted_out">
                      <IonIcon icon={ICON_ENTFERNEN_GEFUELLT} />
                    </span>
                    <span>Abgemeldet</span>
                  </div>
                  {/* Zweiter Abmelde-Weg: die Leitung traegt nach, was
                      ausserhalb der App gemeldet wurde. Gleiches Zeichen,
                      gleiche Wirkung auf den Nenner — aber eine andere
                      Herkunft, deshalb ein eigener Eintrag. */}
                  <div className="attendance-matrix__legend-item">
                    <span className="attendance-matrix__dot attendance-matrix__dot--excused">
                      <IonIcon icon={ICON_ENTFERNEN_GEFUELLT} />
                    </span>
                    <span>Abgemeldet (nachgetragen)</span>
                  </div>
                  <div className="attendance-matrix__legend-item">
                    <span className="attendance-matrix__dot attendance-matrix__dot--open">
                      <IonIcon icon={ICON_KREIS_LEER} />
                    </span>
                    <span>Offen</span>
                  </div>
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        <IonPopover
          isOpen={eventPopover !== null}
          event={eventPopover?.anchor}
          onDidDismiss={() => setEventPopover(null)}
        >
          <div style={{ padding: 'var(--app-abstand-schmal) var(--app-abstand-mittelweit)' }}>
            <div style={{ fontWeight: 'var(--app-schrift-halbfett)', fontSize: 'var(--app-text-basis)' }}>{eventPopover?.event.name}</div>
            <div style={{ color: 'var(--app-text-secondary)', fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
              {eventPopover
                ? new Date(eventPopover.event.event_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : ''}
            </div>
          </div>
        </IonPopover>

        <div className="ion-padding-bottom" />
      </IonContent>
    </IonPage>
  );
};

export default AttendanceMatrixModal;
