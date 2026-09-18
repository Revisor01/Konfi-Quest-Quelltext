// EINE Rueckfrage fuer das Zuruecknehmen einer Absage
//
// Es gibt zwei Wege, eine Absage zurueckzunehmen: den Wisch an der Zeile in
// der Terminliste (AdminEventsPage -> EventsView) und den Knopf ganz unten in
// der Detailansicht (EventDetailView -> EventActionsSection). Beide fuehren
// denselben Vorgang aus, also stellen sie auch dieselbe Frage und rufen
// dieselbe Route -- deshalb steht beides hier und nicht zweimal im Code.
//
// DIE RUECKFRAGE NENNT DIE ZAHL: Das Zuruecknehmen verschickt Push-Meldungen
// -- und meldet Leute wieder an, ohne sie zu fragen. Wer das ausloest, soll
// vorher wissen, wie viele das sind. Die Zahl kommt vom Server
// (durch_absage_abgemeldet_count) und meint genau die, die zurueckkommen:
// Wer sich vorher selbst abgemeldet hat oder von der Leitung abgemeldet
// wurde, bleibt abgemeldet und bekommt auch keinen Push. Das Feld liefern
// GET /events, GET /events/cancelled UND GET /events/:id (lesen.js) -- beide
// Aufrufer haben es also.

import api from '../services/api';
import { fehlerText } from './fehler';

/** Was die Rueckfrage zum Termin braucht. Absichtlich schmal gehalten, damit
 *  sowohl der Listeneintrag (Event) als auch die Detailantwort passt. */
export interface ZuruecknehmenTermin {
  id: number;
  name: string;
  durch_absage_abgemeldet_count?: number;
}

/** Die Ionic-Alert-Funktion aus useIonAlert(), ohne sie hier zu importieren. */
type AlertPresenter = (optionen: {
  header: string;
  message: string;
  buttons: Array<{ text: string; role?: string; handler?: () => void | Promise<void> }>;
}) => void;

interface ZuruecknehmenOptionen {
  presentAlert: AlertPresenter;
  setSuccess: (text: string) => void;
  setError: (text: string) => void;
  /** Laeuft nach erfolgreicher Ruecknahme -- Listen bzw. Detail neu laden. */
  onErfolg?: () => void | Promise<void>;
}

/**
 * Stellt die Rueckfrage und nimmt die Absage nach Bestaetigung zurueck.
 * Der Offline-Riegel gehoert zum Aufrufer: die Liste und das Detail melden
 * "offline" auf ihre je eigene Art.
 */
export const absageZuruecknehmenFragen = (
  termin: ZuruecknehmenTermin,
  { presentAlert, setSuccess, setError, onErfolg }: ZuruecknehmenOptionen
): void => {
  const anzahl = termin.durch_absage_abgemeldet_count ?? 0;
  const wenText = anzahl === 1
    ? '1 Person wird wieder angemeldet und bekommt eine Mitteilung.'
    : `${anzahl} Personen werden wieder angemeldet und bekommen eine Mitteilung.`;
  presentAlert({
    header: 'Absage zurücknehmen?',
    message: anzahl > 0
      ? `"${termin.name}" findet dann wieder statt. ${wenText} Wer sich vorher selbst abgemeldet hatte oder abgemeldet wurde, bleibt abgemeldet. Punkte werden nicht wiederhergestellt.`
      : `"${termin.name}" findet dann wieder statt. Es ist niemand wieder anzumelden, also geht auch keine Mitteilung raus.`,
    buttons: [
      { text: 'Abbrechen', role: 'cancel' },
      {
        text: 'Zurücknehmen',
        handler: async () => {
          try {
            await api.put(`/events/${termin.id}/reaktivieren`);
            setSuccess(`"${termin.name}" findet wieder statt`);
            await onErfolg?.();
          } catch (err) {
            setError(fehlerText(err, 'Fehler beim Zurücknehmen der Absage'));
          }
        }
      }
    ]
  });
};
