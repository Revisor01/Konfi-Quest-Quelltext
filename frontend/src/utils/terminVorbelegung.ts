// Vorbelegung des Termin-Formulars: neuer Termin und Kopie.

import type { Event, Timeslot } from '../types/event';

/**
 * DER FEHLER, DEN DAS BEHEBT: Hier stand `beginn - 24 Stunden`, fest. Bei
 * jedem Termin, der in weniger als 24 Stunden beginnt — "heute Abend noch
 * eine Konfistunde eintragen", der Normalfall bei kurzfristigen Terminen —
 * landete der Anmeldeschluss damit in der VERGANGENHEIT. Das Backend nahm
 * das kommentarlos an, und der Termin war in der Sekunde seiner Entstehung
 * geschlossen: `registration_status: 'closed'`, niemand konnte sich anmelden.
 * Gewarnt hat nichts.
 *
 * DIE ENTSCHEIDUNG — kuerzere Frist statt gar keiner:
 * Naheliegend waere, in so einem Fall gar keinen Schluss zu setzen (leeres
 * Feld = Anmeldung bis zum Beginn offen). Dagegen spricht, dass der
 * Anmeldeschluss eine Aussage ueber die Planung ist: Wer Material besorgt
 * oder Fahrten einteilt, will vorher wissen, wer kommt. Ein leeres Feld
 * nimmt diese Aussage stillschweigend zurueck, und die Leitung merkt es
 * nicht.
 *
 * Deshalb: Die 24 Stunden bleiben, solange sie in der Zukunft liegen.
 * Andernfalls rueckt der Schluss auf die Mitte zwischen jetzt und Beginn —
 * so bleibt immer ein Anmeldefenster offen, und der Schluss liegt trotzdem
 * spuerbar vor dem Termin. Bei sehr kurzem Vorlauf (unter zehn Minuten)
 * greift stattdessen der Beginn selbst: Bis dahin kann sich anmelden, wer
 * noch mitkommt. Ein Schluss VOR dem Aufruf dieser Funktion kommt in keinem
 * Fall mehr heraus.
 */
export const anmeldeschlussVorschlag = (beginn: Date, jetzt: Date = new Date()): Date => {
  const vierundzwanzigStundenDavor = new Date(beginn.getTime() - 24 * 60 * 60 * 1000);
  if (vierundzwanzigStundenDavor > jetzt) return vierundzwanzigStundenDavor;

  // Beginn liegt selbst in der Vergangenheit (nachgetragener Termin): Dann
  // ist ein Schluss davor richtig — das Backend laesst das ausdruecklich zu.
  if (beginn <= jetzt) return vierundzwanzigStundenDavor;

  const vorlaufMs = beginn.getTime() - jetzt.getTime();
  const ZEHN_MINUTEN = 10 * 60 * 1000;
  if (vorlaufMs <= ZEHN_MINUTEN) return new Date(beginn);
  return new Date(jetzt.getTime() + Math.floor(vorlaufMs / 2));
};

/** Lokaler ISO-String ohne Zeitzonen-Suffix — das Format, in dem formData liegt. */
export const toIonDatetimeISO = (date: Date): string => {
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
};

/**
 * Beginn eines NEUEN Termins: jetzt + 30 Minuten, auf die halbe Stunde
 * gerundet. Gerundet wird ABwaerts (14:35 -> 14:30), der Vorlauf liegt also
 * faktisch zwischen 0 und 30 Minuten.
 */
export const neuerTerminBeginn = (jetzt: Date = new Date()): Date => {
  const beginn = new Date(jetzt);
  beginn.setMinutes(beginn.getMinutes() + 30);
  const minuten = beginn.getMinutes();
  if (minuten < 30) beginn.setMinutes(0, 0, 0);
  else beginn.setMinutes(30, 0, 0);
  return beginn;
};

/**
 * Neue Endzeit, wenn am Datums-Rad gedreht wird.
 *
 * DER FEHLER: Hier stand `neuerBeginn + 1 Stunde`, fest — egal, was vorher
 * dastand. Eine Konfi-Freizeit von Freitag bis Sonntag wurde damit zu einem
 * Ein-Stunden-Termin, sobald jemand das Datum verschob. Das traf das
 * Bearbeiten bestehender Termine genauso wie das Anlegen, fiel aber kaum auf,
 * weil die meisten Termine ohnehin ein bis zwei Stunden dauern.
 *
 * JETZT wandert das Ende mit dem Beginn: Die Dauer bleibt, was sie war. Nur
 * wenn es noch keine brauchbare Endzeit gibt, greift die alte Voreinstellung
 * von einer Stunde.
 */
export const endeNachDatumswechsel = (
  neuerBeginn: Date,
  bisherigerBeginn: string,
  bisherigesEnde: string
): Date => {
  const alterBeginn = new Date(bisherigerBeginn);
  const altesEnde = new Date(bisherigesEnde);
  const dauerBekannt =
    bisherigerBeginn &&
    bisherigesEnde &&
    !Number.isNaN(alterBeginn.getTime()) &&
    !Number.isNaN(altesEnde.getTime()) &&
    altesEnde > alterBeginn;

  const dauerMs = dauerBekannt
    ? altesEnde.getTime() - alterBeginn.getTime()
    : 60 * 60 * 1000;
  return new Date(neuerBeginn.getTime() + dauerMs);
};

/**
 *   "termin kopieren übernimmt alles, aber nicht material und nicht den chat.
 *    und nicht die anderen dingen. kopieren eröffnet ein modal mit allem
 *    voreingetragen."
 *
 *   "es wird ja nur das modal vorausgefüllt und man kann es dann direkt
 *    anlegen."
 *
 * Die Kopie legt NICHTS an. Sie oeffnet dasselbe Formular wie "Neuer Termin",
 * nur mit den Werten des Originals darin — erst das Speichern erzeugt etwas.
 * Deshalb braucht es auch keinen Rueckweg.
 *
 * WAS MITKOMMT: alles, was im Formular steht — Titel (unveraendert, ohne
 * "Kopie von"), Beschreibung, Ort, Mitbringen, Punkte und Punkteart,
 * Kategorien, Jahrgaenge, Plaetze und Wartelisten fuer Konfis wie fuer das
 * Team, Pflicht- und Konfirmations-Kennzeichen, Check-in-Fenster, Zielgruppe
 * und die Zeitfenster.
 *
 * DIE DAUER bleibt die des Originals: Eine Freizeit ueber drei Tage bleibt
 * drei Tage lang. Ohne das waere aus jedem Wochenende beim Kopieren ein
 * Zwei-Stunden-Termin geworden.
 */
export interface KopierVorbelegung {
  /** Vorbefuelltes Pseudo-Event fuer das Modal. id 0 heisst "neu". */
  event: Event;
  /** Zeitfenster, auf den neuen Tag verschoben. Leer, wenn das Original keine hatte. */
  timeslots: Timeslot[];
}

export const kopiereTermin = (
  original: Event,
  timeslots: Timeslot[] = [],
  jetzt: Date = new Date()
): KopierVorbelegung => {
  const beginn = neuerTerminBeginn(jetzt);

  // Dauer des Originals uebernehmen. Fehlt die Endzeit oder ist sie kaputt,
  // bleibt sie auch in der Kopie leer — nicht heimlich eine erfinden.
  const originalBeginn = new Date(original.event_date);
  const originalEnde = original.event_end_time ? new Date(original.event_end_time) : null;
  const dauerMs =
    originalEnde &&
    !Number.isNaN(originalEnde.getTime()) &&
    !Number.isNaN(originalBeginn.getTime()) &&
    originalEnde > originalBeginn
      ? originalEnde.getTime() - originalBeginn.getTime()
      : null;
  const ende = dauerMs !== null ? new Date(beginn.getTime() + dauerMs) : null;

  const schluss = anmeldeschlussVorschlag(beginn, jetzt);

  const verschobeneTimeslots: Timeslot[] = Number.isNaN(originalBeginn.getTime())
    ? []
    : timeslots.map((slot) => {
        const slotStart = new Date(slot.start_time);
        const slotEnde = new Date(slot.end_time);
        if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnde.getTime())) return slot;
        const versatz = beginn.getTime() - originalBeginn.getTime();
        return {
          start_time: toIonDatetimeISO(new Date(slotStart.getTime() + versatz)),
          end_time: toIonDatetimeISO(new Date(slotEnde.getTime() + versatz)),
          max_participants: slot.max_participants,
          // id, registered_count und waitlist_count bewusst weglassen: Die
          // gehoeren zum Original, nicht zur Vorlage.
        };
      });

  return {
    event: {
      ...original,
      id: 0, // 0 heisst "neu" — dasselbe Signal wie beim Anlegen einer Serie.
      event_date: toIonDatetimeISO(beginn),
      event_end_time: ende ? toIonDatetimeISO(ende) : '',
      registration_opens_at: '', // "ab sofort", wie beim neuen Termin
      registration_closes_at: toIonDatetimeISO(schluss),
      // Zustand des Originals, der nicht zur Vorlage gehoert:
      is_series: false,
      series_id: undefined,
      registered_count: 0,
      teamer_count: 0,
      waitlist_count: 0,
      teamer_waitlist_count: 0,
      abgemeldet_count: 0,
      durch_absage_abgemeldet_count: 0,
      cancelled: false,
      cancelled_at: null,
      cancelled_reason: null,
      cancelled_by: null,
      cancelled_by_name: null,
      cancelled_reason_set_by: null,
      cancelled_reason_set_by_name: null,
      cancelled_reason_set_at: null,
      created_at: undefined,
      // Eigene Buchung am Original — die Kopie hat keine.
      is_registered: false,
      registered: false,
      booking_status: null,
      attendance_status: null,
      is_opted_out: false,
      booked_timeslot_id: undefined,
      booked_timeslot_start: undefined,
      booked_timeslot_end: undefined,
      registration_status: undefined,
      teamer_registration_status: undefined,
    } as Event,
    timeslots: verschobeneTimeslots,
  };
};
