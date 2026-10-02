import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonIcon,
  IonInput,
  IonCard,
  IonCardContent,
  IonSelect,
  IonSelectOption,
  useIonAlert
} from '@ionic/react';
import {
  ICON_FILTER,
  ICON_HAKEN,
  ICON_OFFLINE,
  ICON_PERSON_GEFUELLT,
  ICON_PERSON_HINZUFUEGEN_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_SUCHE_GEFUELLT,
} from '../../shared/icons';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import type { Participant } from '../../../types/event';
// Die Jahrgangsregel liegt in utils/jahrgangsPassung.ts — sie
// spiegelt gehoertZumTermin im Backend und hat dort ihre Erklaerung.
import { passtZumTermin } from '../../../utils/jahrgangsPassung';
import { tastaturKlick } from '../../../utils/tastatur';
import { uhrzeit } from '../../../utils/dateUtils';
import { fehlerText } from '../../../utils/fehler';
import { eintragenMitRueckfrage, type UeberbuchenFrage } from '../../../utils/ueberbuchen';

interface Konfi {
  id: number;
  name: string;
  jahrgang_id?: number;
  jahrgang_ids?: number[];
  jahrgang_name?: string;
  role_name?: string;
  is_super_admin?: boolean;
}

// Participant kommt zentral aus types/event. Die fruehere Fassung hier kannte
// nur 'confirmed' | 'pending' — dieselbe Antwort liefert aber auch 'waitlist'
// und 'opted_out' (backend/routes/events/lesen.js).

interface Timeslot {
  id: number;
  start_time: string;
  end_time: string;
  max_participants: number;
  registered_count: number;
}

interface EventJahrgang {
  id: number;
  name: string;
}

interface Event {
  has_timeslots?: boolean;
  timeslots?: Timeslot[];
  teamer_only?: boolean;
  jahrgang_id?: number;
  jahrgang_name?: string;
  jahrgaenge?: EventJahrgang[];
}


interface ParticipantManagementModalProps {
  eventId: number;
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
  // 'leitung' = Admins/Org-Admins zuordnen. Bewusst pro Termin;
  // niemand rutscht automatisch in einen Event-Chat.
  filterRole?: 'teamer' | 'konfi' | 'leitung' | null;
}

const ParticipantManagementModal: React.FC<ParticipantManagementModalProps> = ({
  eventId,
  onClose,
  onSuccess,
  dismiss,
  filterRole
}) => {
  const { setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const [searchTerm, setSearchTerm] = useState('');
  const [availableKonfis, setAvailableKonfis] = useState<Konfi[]>([]);
  const [selectedKonfis, setSelectedKonfis] = useState<number[]>([]);
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [eventData, setEventData] = useState<Event | null>(null);
  const [selectedTimeslot, setSelectedTimeslot] = useState<number | null>(null);
  const [availableJahrgaenge, setAvailableJahrgaenge] = useState<string[]>([]);
  const [selectedJahrgang, setSelectedJahrgang] = useState<string>('alle');
  const [currentParticipants, setCurrentParticipants] = useState<Participant[]>([]);

  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      // Zuerst Event-Daten und Participants laden
      const eventResponse = await api.get(`/events/${eventId}`);
      setEventData(eventResponse.data);
      const loadedParticipants: Participant[] = eventResponse.data.participants || [];
      setCurrentParticipants(loadedParticipants);

      // Dann verfügbare Konfis laden (braucht Participants für Filterung)
      await loadAvailableKonfis(loadedParticipants);
    } catch (err) {
      setError('Fehler beim Laden der Daten', { ort: 'teilnehmer-verwaltung-laden', fehler: err });
    }
  };

  // Event-Jahrgänge ermitteln (für Filter)
  const eventJahrgaenge = eventData?.jahrgaenge?.map(j => j.name) ||
    (eventData?.jahrgang_name ? [eventData.jahrgang_name] : []);
  const eventJahrgangIds: number[] = eventData?.jahrgaenge?.map(j => j.id) ||
    (eventData?.jahrgang_id ? [eventData.jahrgang_id] : []);
  const hasEventJahrgaenge = eventJahrgaenge.length > 0;
  // Greift die Jahrgangsgrenze fuer die Auswahl? Nicht bei 'Nur Team' und
  // nicht ohne Jahrgang — dann steht auch kein Hinweis auf der Seite.
  const jahrgangsGrenzeAktiv = hasEventJahrgaenge && !eventData?.teamer_only;

  const loadAvailableKonfis = async (participantsList?: Participant[]) => {
    try {
      // Die Leitungsliste nur laden, wenn sie auch gebraucht wird — sonst
      // holt jedes Oeffnen des Konfi-Modals eine Liste, die es nie zeigt.
      const [konfisRes, teamerRes, leitungRes] = await Promise.all([
        api.get('/admin/konfis'),
        api.get('/admin/konfis/teamer'),
        filterRole === 'leitung' ? api.get('/admin/konfis/leitung') : Promise.resolve({ data: [] })
      ]);
      const allKonfis = konfisRes.data.map((k: Konfi) => ({ ...k, role_name: 'konfi' }));
      const teamerUsers = teamerRes.data.map((u: Konfi) => ({ ...u, role_name: 'teamer' }));
      // role_name kommt hier ECHT aus dem Backend ('admin' oder 'org_admin')
      // und wird nicht ueberschrieben — die Unterscheidung wird unten gebraucht.
      const leitungUsers = leitungRes.data as Konfi[];
      const allPersons = [...allKonfis, ...teamerUsers, ...leitungUsers];

      // Aktuelle Participants nutzen (Parameter oder State)
      const activeParticipants = participantsList || currentParticipants;

      // Filter out already registered participants based on user_id (not booking id)
      const participantUserIds = activeParticipants.map(p => p.user_id || p.id);
      const available = allPersons.filter((p: Konfi) => !participantUserIds.includes(p.id));

      // Filter by role if filterRole prop is set
      let roleFiltered = available;
      if (filterRole === 'teamer') {
        roleFiltered = available.filter((p: Konfi) => p.role_name === 'teamer');
      } else if (filterRole === 'leitung') {
        roleFiltered = available.filter((p: Konfi) => p.role_name === 'admin' || p.role_name === 'org_admin');
      } else if (filterRole === 'konfi') {
        // Positiv auf 'konfi' pruefen: Ein '!== teamer' liesse seit der
        // Leitungs-Zuordnung auch Admins in die Konfi-Auswahl.
        roleFiltered = available.filter((p: Konfi) => p.role_name === 'konfi');
      }

      // Extract available Jahrgänge (wird nur für Dropdown gebraucht wenn Event keine Jahrgänge hat)
      const jahrgaenge = [...new Set(
        roleFiltered
          .filter((k: Konfi) => k.jahrgang_name)
          .map((k: Konfi) => k.jahrgang_name!)
      )].sort() as string[];
      setAvailableJahrgaenge(jahrgaenge);

      setAvailableKonfis(roleFiltered);
    } catch {
      setError('Fehler beim Laden der Personen');
    }
  };

  const filteredKonfis = availableKonfis.filter(konfi => {
    // Search filter
    const matchesSearch = konfi.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (konfi.jahrgang_name && konfi.jahrgang_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (konfi.role_name === 'teamer' && 'teamer'.includes(searchTerm.toLowerCase())) ||
      ((konfi.role_name === 'admin' || konfi.role_name === 'org_admin') &&
        'leitung'.includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    // Wer zu keinem Jahrgang des Termins gehoert, wird gar nicht erst
    // angeboten — Konfis, Team und Leitung gleichermassen. Bis
    // dahin galt hier "Teamer:innen und Leitung sind immer sichtbar", und
    // nur die Konfis wurden ueber den Namen des Jahrgangs gefiltert.
    if (!passtZumTermin(konfi, eventData, eventJahrgangIds)) return false;

    // Der Jahrgangs-Filter im Kopf betrifft nur Konfis: Team und Leitung
    // tragen mehrere Jahrgaenge und stehen ohnehin nur bei Ueberschneidung hier.
    if (konfi.role_name !== 'konfi') return true;

    // Spezifischer Jahrgang gewählt (bei "alle" reicht passtZumTermin oben)
    if (selectedJahrgang !== 'alle') {
      return konfi.jahrgang_name === selectedJahrgang;
    }

    return true;
  });

  const formatTime = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return uhrzeit(date);
  };

  const handleKonfiSelection = (konfiId: number) => {
    setSelectedKonfis(prev => 
      prev.includes(konfiId) 
        ? prev.filter(id => id !== konfiId)
        : [...prev, konfiId]
    );
  };

  // Rueckfrage "voll -- trotzdem eintragen?" als Ja/Nein-Alert, wie beim
  // Bestaetigen von der Warteliste (EventDetailView). Tippen neben den Dialog
  // ist ein Nein; ein zweites resolve nach dem Button bleibt wirkungslos.
  const frageUeberbuchen = (frage: UeberbuchenFrage) => new Promise<boolean>((resolve) => {
    presentAlert({
      header: frage.header,
      message: frage.message,
      buttons: [
        { text: 'Abbrechen', role: 'cancel', handler: () => resolve(false) },
        { text: 'Trotzdem eintragen', handler: () => resolve(true) }
      ],
      onDidDismiss: () => resolve(false)
    });
  });

  const handleAddParticipants = async () => {
    if (selectedKonfis.length === 0) return;

    // For events with timeslots, require timeslot selection
    if (eventData?.has_timeslots && !selectedTimeslot) {
      setError('Bitte wähle einen Zeitslot aus');
      return;
    }

    // guard() wirft bei Doppel-Tap ('Aktion läuft bereits'). Ungefangen
    // bliebe loading auf true hängen — dann liess sich das Modal nur
    // noch per Swipe schliessen (User-Hinweis 12.08.).
    try {
      await guard(async () => {
      setLoading(true);
      try {
        const auswahl = selectedKonfis.map(
          (id) => availableKonfis.find((k) => k.id === id) ?? { id, name: '' }
        );
        const ergebnis = await eintragenMitRueckfrage(
          auswahl,
          (person, ueberbuchen) => api.post(`/events/${eventId}/participants`, {
            user_id: person.id,
            status: 'confirmed',
            // timeslot_id kommt nur dazu, wenn der Termin Zeitfenster hat.
            ...(eventData?.has_timeslots && selectedTimeslot ? { timeslot_id: selectedTimeslot } : {}),
            ueberbuchen
          }).then(() => undefined),
          frageUeberbuchen,
          (person) => ({ name: person.name || undefined, seite: person.role_name === 'konfi' ? 'konfi' : 'team' })
        );

        // Wer drin ist, bleibt drin -- auch nach Abbruch oder Fehler. Die
        // Uebrigen bleiben ausgewaehlt, damit man sie abwaehlen oder die
        // Teilnehmerzahl erhoehen und es noch einmal versuchen kann.
        setSelectedKonfis(ergebnis.offen.map((person) => person.id));
        // Participants und verfügbare Konfis neu laden
        const eventResponse = await api.get(`/events/${eventId}`);
        const updatedParticipants: Participant[] = eventResponse.data.participants || [];
        setCurrentParticipants(updatedParticipants);
        await loadAvailableKonfis(updatedParticipants);
        if (ergebnis.eingetragen.length > 0) onSuccess();
        if (ergebnis.fehler) throw ergebnis.fehler;
      } catch (err) {
        // Die Meldung des Servers zeigen, wenn er eine hat — etwa "… gehört
        // zu keinem Jahrgang dieses Termins" (403). Sonst der Sammelbegriff.
        // Ueber fehlerText, damit die Fehlermessung statt des Server-Textes
        // (er traegt den Namen der Person) den Sammelbegriff meldet.
        setError(fehlerText(err, 'Fehler beim Hinzufügen der Teilnehmer:innen'));
      } finally {
        setLoading(false);
      }
      });
    } catch {
      // Zweiter Aufruf verworfen — Ladezustand sicher zuruecknehmen.
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{filterRole === 'teamer' ? 'Teamer:in hinzufügen' : filterRole === 'leitung' ? 'Leitung hinzufügen' : filterRole === 'konfi' ? 'Kind hinzufügen' : 'Teilnehmer:innen verwalten'}</IonTitle>
          <IonButtons slot="start">
            {/* NICHT an loading haengen: Bleibt der Ladezustand haengen,
                waere das Modal sonst nur noch per Swipe zu verlassen.
                Die Rueckfrage bei ungespeicherten Aenderungen laeuft
                ueber canDismiss der Seite. */}
            <IonButton onClick={handleClose} className="app-modal-close-btn" aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            {selectedKonfis.length > 0 && (
              <IonButton onClick={handleAddParticipants} disabled={loading || isSubmitting || !isOnline} className="app-modal-submit-btn app-modal-submit-btn--events" aria-label="Teilnehmer:innen hinzufügen">
                {!isOnline ? <><IonIcon icon={ICON_OFFLINE} /> Du bist offline</> : <IonIcon icon={ICON_HAKEN} slot="icon-only" />}
              </IonButton>
            )}
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">

          {/* Suche & Filter - iOS26 Pattern */}
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events">
                <IonIcon icon={ICON_FILTER} />
              </div>
              <IonLabel>Suche & Filter</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                <IonList style={{ background: 'transparent' }}>
                  {/* Suchfeld */}
                  <IonItem lines={eventJahrgaenge.length !== 1 || (eventData?.has_timeslots && eventData.timeslots && eventData.timeslots.length > 0) ? 'full' : 'none'} style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Person suchen</IonLabel>
                    <IonInput aria-label="Person suchen"
                      value={searchTerm}
                      onIonInput={(e) => setSearchTerm(e.detail.value!)}
                      placeholder="Name eingeben..."
                      clearInput={true}
                    />
                  </IonItem>
                  {/* Jahrgang Filter - nur wenn Event mehrere Jahrgänge hat oder gar keine */}
                  {(eventJahrgaenge.length !== 1) && (
                    <IonItem lines={eventData?.has_timeslots && eventData.timeslots && eventData.timeslots.length > 0 ? 'full' : 'none'} style={{ '--background': 'transparent' }}>
                      <IonLabel position="stacked">Jahrgang</IonLabel>
                      <IonSelect aria-label="Jahrgang"
                        value={selectedJahrgang}
                        onIonChange={(e) => setSelectedJahrgang(e.detail.value!)}
                        placeholder="Jahrgang wählen"
                        interface="popover"
                        interfaceOptions={{ arrow: false }}
                      >
                        {hasEventJahrgaenge ? (
                          <>
                            <IonSelectOption value="alle">Alle Event-Jahrgänge</IonSelectOption>
                            {eventJahrgaenge.map(jg => (
                              <IonSelectOption key={jg} value={jg}>{jg}</IonSelectOption>
                            ))}
                          </>
                        ) : (
                          <>
                            <IonSelectOption value="alle">Alle Jahrgänge</IonSelectOption>
                            {availableJahrgaenge.map(jg => (
                              <IonSelectOption key={jg} value={jg}>{jg}</IonSelectOption>
                            ))}
                          </>
                        )}
                      </IonSelect>
                    </IonItem>
                  )}
                  {/* Zeitslot Auswahl */}
                  {eventData?.has_timeslots && eventData.timeslots && eventData.timeslots.length > 0 && (
                    <IonItem lines="none" style={{ '--background': 'transparent' }}>
                      <IonLabel position="stacked">Zeitslot</IonLabel>
                      <IonSelect aria-label="Zeitslot"
                        value={selectedTimeslot}
                        onIonChange={(e) => setSelectedTimeslot(e.detail.value)}
                        placeholder="Zeitslot wählen"
                        interface="popover"
                        interfaceOptions={{ arrow: false }}
                      >
                        <IonSelectOption value={null}>Zeitslot wählen...</IonSelectOption>
                        {eventData.timeslots.map((timeslot) => {
                          const isFull = timeslot.max_participants > 0 && (timeslot.registered_count || 0) >= timeslot.max_participants;
                          const capacityText = timeslot.max_participants === 0
                            ? `(${timeslot.registered_count || 0})`
                            : `(${timeslot.registered_count || 0}/${timeslot.max_participants})`;
                          return (
                            <IonSelectOption
                              key={timeslot.id}
                              value={timeslot.id}
                            >
                              {formatTime(timeslot.start_time)} - {formatTime(timeslot.end_time)} {capacityText}
                              {isFull && ' - Voll'}
                            </IonSelectOption>
                          );
                        })}
                      </IonSelect>
                    </IonItem>
                  )}
                </IonList>
              </IonCardContent>
            </IonCard>
          </IonList>

          {/* Personen Liste - iOS26 Pattern */}
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--events">
                <IonIcon icon={ICON_PERSON_HINZUFUEGEN_GEFUELLT} />
              </div>
              <IonLabel>Personen ({filteredKonfis.length})</IonLabel>
              {filteredKonfis.length > 0 && (
                <IonButton
                  fill="clear"
                  size="small"
                  onClick={() => {
                    // Alle sichtbaren (gefilterten) Personen aus-/abwaehlen.
                    const allIds = filteredKonfis.map(k => k.id);
                    const allSelected = allIds.every(id => selectedKonfis.includes(id));
                    setSelectedKonfis(allSelected ? [] : allIds);
                  }}
                >
                  {filteredKonfis.every(k => selectedKonfis.includes(k.id)) ? 'Keine' : 'Alle'}
                </IonButton>
              )}
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                {/* Warum jemand fehlt: Eine leere oder kuerzere Liste ohne
                    Erklaerung liesse die Leitung nach der Person suchen. */}
                {jahrgangsGrenzeAktiv && (
                  <p
                    data-testid="jahrgangs-hinweis"
                    style={{
                      margin: '0 0 var(--app-abstand-basis) 0',
                      fontSize: 'var(--app-text-klein)',
                      color: 'var(--app-text-secondary)'
                    }}
                  >
                    Angeboten werden nur Personen aus {eventJahrgaenge.length === 1 ? 'dem Jahrgang' : 'den Jahrgängen'} dieses
                    Events ({eventJahrgaenge.join(', ')}). Die Gemeindeleitung ist davon ausgenommen.
                  </p>
                )}
                {filteredKonfis.length === 0 ? (
                  <div style={{
                    padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)',
                    textAlign: 'center',
                    color: 'var(--app-text-secondary)'
                  }}>
                    <IonIcon icon={ICON_SUCHE_GEFUELLT} style={{ fontSize: 'var(--app-anzeige-riesig)', opacity: 0.3, marginBottom: 'var(--app-abstand-basis)' }} />
                    <p style={{ margin: '0', fontSize: 'var(--app-text-standard)' }}>
                      {jahrgangsGrenzeAktiv
                        ? 'Keine passenden Personen — nur wer zu einem Jahrgang dieses Events gehört, lässt sich eintragen'
                        : 'Keine Personen gefunden'}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {filteredKonfis.map((konfi) => {
                      const isSelected = selectedKonfis.includes(konfi.id);

                      return (
                        <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                          key={konfi.id}
                          className="app-list-item app-list-item--events"
                          onClick={() => handleKonfiSelection(konfi.id)}
                          style={{
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '0',
                            background: isSelected ? 'rgba(var(--app-color-events-rgb), 0.08)' : undefined
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)', flex: 1, minWidth: 0 }}>
                            <div className="app-icon-circle app-icon-circle--events">
                              <IonIcon icon={ICON_PERSON_GEFUELLT} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="app-list-item__title">{konfi.name}</div>
                              <div className="app-list-item__subtitle">
                                {konfi.role_name === 'teamer'
                                  ? `Teamer:in${konfi.jahrgang_name ? ` \u00B7 ${konfi.jahrgang_name}` : ''}`
                                  : (konfi.role_name === 'admin' || konfi.role_name === 'org_admin')
                                    ? 'Leitung'
                                    : (konfi.jahrgang_name || '')}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
      </IonContent>
    </IonPage>
  );
};

export default ParticipantManagementModal;