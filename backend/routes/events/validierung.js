
/**
 * Validiert die Felder des Teamer-Kontingents.
 * 0 = unbegrenzt (Konvention wie max_participants), negativ ist ungueltig.
 * @returns {string|null} Fehlermeldung oder null wenn alles in Ordnung ist
 */
function validateTeamerQuota(teamerMaxParticipants, teamerMaxWaitlistSize) {
  if (teamerMaxParticipants !== undefined && teamerMaxParticipants !== null) {
    const value = parseInt(teamerMaxParticipants, 10);
    if (Number.isNaN(value) || value < 0) {
      return 'teamer_max_participants muss eine Zahl >= 0 sein (0 = unbegrenzt)';
    }
  }
  if (teamerMaxWaitlistSize !== undefined && teamerMaxWaitlistSize !== null) {
    const value = parseInt(teamerMaxWaitlistSize, 10);
    if (Number.isNaN(value) || value < 0) {
      return 'teamer_max_waitlist_size muss eine Zahl >= 0 sein';
    }
  }
  return null;
}

/**
 * DER FALL: Ein Termin beginnt in drei Stunden, der Anmeldeschluss steht auf
 * "24 Stunden vor Beginn" — also gestern. Der Termin entsteht und ist in
 * derselben Sekunde geschlossen (registration_status = 'closed'). Niemand
 * kann sich anmelden, und nichts hat davor gewarnt.
 *
 * WARUM KEINE PAUSCHALE SPERRE AUF "SCHLUSS IN DER VERGANGENHEIT":
 * Wer einen Termin von letzter Woche nachtraegt oder einen alten Termin
 * korrigiert, hat zwangslaeufig beides in der Vergangenheit — Termin und
 * Schluss. Das ist voellig legitim und muss moeglich bleiben. Verboten ist
 * nur der Widerspruch: Der Termin kommt noch, die Anmeldung war nie offen.
 *
 * Deshalb haengt die Pruefung am TERMINDATUM, nicht am Schluss allein.
 *
 * BEI SERIEN gilt sie fuer den ERSTEN Termin. Die Folgetermine erben den
 * zeitlichen Abstand zum Beginn (serien.js), ihr Schluss wandert also
 * zwangslaeufig mit in die Zukunft.
 *
 * @returns {string|null} Fehlermeldung oder null, wenn alles stimmig ist
 */
function pruefeAnmeldeschluss(registrationClosesAt, eventDate, jetzt = new Date()) {
  if (!registrationClosesAt) return null;          // kein Fenster = nichts zu pruefen
  const schluss = new Date(registrationClosesAt);
  if (Number.isNaN(schluss.getTime())) return null; // Formatfehler faengt express-validator
  if (schluss >= jetzt) return null;                // Schluss liegt in der Zukunft

  const beginn = new Date(eventDate);
  // Vergangener Termin -> nachtraegliche Pflege, erlaubt.
  if (!Number.isNaN(beginn.getTime()) && beginn < jetzt) return null;

  return 'Der Anmeldeschluss liegt in der Vergangenheit — so wäre die Anmeldung von Anfang an geschlossen.';
}

/**
 * Ein Ende, das vor dem Beginn liegt.
 *
 * DER FALL: Wer beim Ende versehentlich einen frueheren Tag waehlt, speicherte
 * ohne Warnung. Die Leitungsliste sortiert den Termin dann sofort unter
 * "Vergangen" (sie rechnet mit dem Ende), die Konfis sehen ihn als vorbei --
 * waehrend der Anmeldeschluss vom Beginn aus rechnet und der Termin zugleich
 * "offen" wirkt.
 *
 * ERLAUBT BLEIBEN: gar kein Ende (das Feld ist optional) und ein Ende, das
 * GENAU auf dem Beginn liegt -- das ist kein Widerspruch, nur ein Termin ohne
 * Dauer. Ein Wert, der sich nicht als Datum lesen laesst, ist nicht Sache
 * dieser Pruefung.
 *
 * EIN ORT fuer POST /, PUT /:id (verwaltung.js) und POST /series (serien.js),
 * aus demselben Grund wie pruefeAnmeldeschluss oben.
 *
 * @returns {{error: string, error_code: string}|null} Antwort-Rumpf fuer 400,
 *   oder null, wenn alles stimmig ist
 */
const ENDE_VOR_BEGINN = 'Das Ende liegt vor dem Beginn';

function pruefeEndeNachBeginn(eventDate, eventEndTime) {
  if (!eventDate || !eventEndTime) return null;
  const beginn = new Date(eventDate);
  const ende = new Date(eventEndTime);
  if (Number.isNaN(beginn.getTime()) || Number.isNaN(ende.getTime())) return null;
  if (ende >= beginn) return null;
  return { error: ENDE_VOR_BEGINN, error_code: 'ende_vor_beginn' };
}

module.exports = { validateTeamerQuota, pruefeAnmeldeschluss, pruefeEndeNachBeginn, ENDE_VOR_BEGINN };
