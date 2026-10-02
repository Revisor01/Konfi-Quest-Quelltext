import { datumKurz } from './dateUtils';
// NULL HEISST UNBEKANNT, NICHT NIEMAND: Buchungen von vor der Migration und
// Selbst-Check-ins per QR-Code tragen keinen Urheber. Dann faellt die Zeile
// ersatzlos weg -- "Eingetragen von unbekannt" behauptet mehr, als bekannt
// ist, und stuende unter jedem alten Eintrag.

export interface UrheberAngabe {
  attendance_set_by_name?: string | null;
  attendance_set_at?: string | null;
  note_set_by_name?: string | null;
  note_set_at?: string | null;
  checkin_quelle?: string | null;
  checked_in_at?: string | null;
}

/**
 * Die Absage haengt am TERMIN, nicht an einer Buchung -- deshalb ein eigener
 * Typ und nicht zwei weitere Felder in UrheberAngabe. Ein Event ist keine
 * Buchung, und die vier Felder oben haben an ihm keine Bedeutung.
 */
export interface AbsageAngabe {
  cancelled_by_name?: string | null;
  cancelled_at?: string | null;
  cancelled_reason_set_by_name?: string | null;
  cancelled_reason_set_at?: string | null;
}

/**
 * Gibt null zurueck, wenn kein Name vorliegt. Ohne Namen gibt es nichts zu
 * sagen: Ein blosses Datum beantwortet die Frage "wer war das?" nicht.
 */
export const urheberZeile = (angabe: UrheberAngabe | null | undefined): string | null =>
  zeile('Eingetragen von', angabe?.attendance_set_by_name, angabe?.attendance_set_at);

/**
 * Die Zeile unter der Notiz, z. B. "Notiz von Anna Meier, 13.09."
 *
 * Eigener Wortlaut statt "Eingetragen von": Stehen beide Zeilen untereinander
 * -- weil verschiedene Leute Status und Notiz geschrieben haben --, muss auf
 * einen Blick klar sein, welcher Name zu welchem Eintrag gehoert.
 */
export const notizUrheberZeile = (angabe: UrheberAngabe | null | undefined): string | null =>
  zeile('Notiz von', angabe?.note_set_by_name, angabe?.note_set_at);

/**
 * Die Zeile bei einem Selbst-Check-in, z. B. "Eingecheckt per QR-Code, 15.09."
 *
 * WARUM UEBERHAUPT EINE ZEILE: Beim QR-Check-in bleibt der Urheber bewusst
 * leer (Migration 148) -- die Konfi checkt sich SELBST ein, "Eingetragen von
 * Emilia" laese sich wie eine Leitungsentscheidung. Damit stand der
 * Selbst-Check-in aber im selben Nichts wie der Altbestand von vor der
 * Migration: zweimal gar keine Zeile, obwohl im einen Fall bekannt ist, was
 * passiert ist. Diese Zeile schliesst die Luecke, ohne jemanden zu benennen.
 *
 * Gibt null zurueck, wenn die Quelle nicht 'qr' ist: Bei einem manuellen
 * Eintrag steht der Name schon in urheberZeile(), und beim Altbestand ist
 * nichts bekannt. Zwei Zeilen untereinander wuerden sich sonst widersprechen.
 */
export const checkinZeile = (angabe: UrheberAngabe | null | undefined): string | null => {
  if (angabe?.checkin_quelle !== 'qr') return null;
  return mitDatum('Eingecheckt per QR-Code', angabe?.checked_in_at);
};

/**
 * WARUM HIER UND NICHT IN EINER EIGENEN DATEI: Die Frage ist dieselbe wie bei
 * den drei Zeilen darueber -- "wer war das, und wann?" --, und die Antwort
 * steht an derselben Stelle im Bild: klein, leise, direkt unter dem Grund.
 * Ein zweiter Ort mit demselben Format liefe frueher oder spaeter
 * auseinander; kurzesDatum() und mitDatum() sind schon hier.
 *
 * DER BEZUG IST EIN ANDERER, DER WORTLAUT DESHALB AUCH: Die drei Zeilen
 * darueber haengen an der Buchung EINER Person ("Abgemeldet: krank"), diese
 * am Termin selbst. "Abgesagt von ..." statt "Eingetragen von ..." macht das
 * ohne Umschweife klar -- und unterscheidet sich hoerbar von "Abgesagt von
 * dir", was in der Teamer-Ansicht die eigene Absage MEINT (die eigene
 * Teilnahme, nicht den Termin).
 *
 * Gibt null zurueck, wenn kein Name vorliegt: Termine, die vor Migration 150
 * abgesagt wurden, haben keinen Urheber -- die Zeile faellt dann ersatzlos
 * weg, statt "Abgesagt von unbekannt" zu behaupten.
 */
export const absageUrheberZeile = (angabe: AbsageAngabe | null | undefined): string | null =>
  zeile('Abgesagt von', angabe?.cancelled_by_name, angabe?.cancelled_at);

/**
 * WARUM DIESE ZEILE MEISTENS FEHLT: Beim Absagen setzt die Route beide Paare
 * auf dieselbe Person -- der Normalfall. Zwei Zeilen mit demselben Namen
 * untereinander waeren nur Laerm, deshalb gibt es sie erst, wenn die beiden
 * auseinandergehen. Genau derselbe Fall wie bei Status und Notiz einer
 * Buchung (Migration 149): Erst wenn zwei verschiedene Leute geschrieben
 * haben, muss die Anzeige beide nennen.
 *
 * WARUM SIE BEI FEHLENDER ABSAGE-ZEILE TROTZDEM ERSCHEINT: Termine, die vor
 * Migration 150 abgesagt wurden, haben keinen cancelled_by -- dort faellt
 * "Abgesagt von ..." ersatzlos weg. Traegt jetzt jemand den Grund nach, ist
 * das die einzige Person, die ueberhaupt bekannt ist; sie zu verschweigen,
 * weil zufaellig kein Absagender daneben steht, hiesse die Auskunft an genau
 * der Stelle zu verlieren, an der sie neu entsteht.
 *
 * WARUM "geändert" UND NICHT "eingetragen": Der Wortlaut soll zu dem passen,
 * was passiert ist -- und passiert ist eine Korrektur an etwas, das schon
 * dastand. "Eingetragen von" laese sich wie die urspruengliche Absage und
 * wuerde neben "Abgesagt von ..." zwei Urheber desselben Vorgangs behaupten.
 *
 * Gibt null zurueck, wenn kein Name vorliegt oder es derselbe ist wie beim
 * Absagen.
 */
export const absagegrundUrheberZeile = (angabe: AbsageAngabe | null | undefined): string | null => {
  const grundName = angabe?.cancelled_reason_set_by_name?.trim();
  if (!grundName) return null;

  // Vergleich ueber den ANGEZEIGTEN Namen und nicht ueber die Kennung: Genau
  // dieser Name steht in der Zeile darueber, und genau seine Wiederholung
  // soll vermieden werden. Zwei Konten mit demselben Anzeigenamen sind der
  // einzige Fall, in dem das danebengeht -- und dann waeren die zwei Zeilen
  // fuer die Lesenden ohnehin nicht zu unterscheiden.
  const absagerName = angabe?.cancelled_by_name?.trim();
  if (absagerName && absagerName === grundName) return null;

  return zeile('Grund geändert von', grundName, angabe?.cancelled_reason_set_at);
};

/**
 * Dasselbe wie absageUrheberZeile(), aber OHNE den Vorspann: nur
 * "Pastorin Kathrin Möller, 16.09."
 *
 * WARUM ES BEIDE GIBT: In der Absage-Karte steht das
 * Label "Abgesagt von" schon als eigene Zeile darueber -- der volle Satz
 * ergaebe dort "Abgesagt von" ueber "Abgesagt von Kathrin Möller". In Listen
 * und Kacheln steht kein Label daneben, dort traegt die Zeile ihren Vorspann
 * weiter selbst.
 */
export const absageUrheberName = (angabe: AbsageAngabe | null | undefined): string | null =>
  zeile('', angabe?.cancelled_by_name, angabe?.cancelled_at);

/**
 * "Geändert von Anna Meier, 16.09." fuer die Karte -- kurz, weil das Label
 * daneben schon "Abgesagt von" sagt und diese Zeile nur die Abweichung
 * nachtraegt. Dieselbe Regel wie absagegrundUrheberZeile(): nur wenn es eine
 * ANDERE Person war als beim Absagen.
 */
export const absagegrundUrheberName = (angabe: AbsageAngabe | null | undefined): string | null => {
  const grundName = angabe?.cancelled_reason_set_by_name?.trim();
  if (!grundName) return null;

  const absagerName = angabe?.cancelled_by_name?.trim();
  if (absagerName && absagerName === grundName) return null;

  return zeile('Geändert von', grundName, angabe?.cancelled_reason_set_at);
};

const zeile = (
  vorspann: string,
  name: string | null | undefined,
  zeitstempel: string | null | undefined
): string | null => {
  const sauber = name?.trim();
  if (!sauber) return null;

  // Leerer Vorspann heisst "nur der Name" (absageUrheberName) -- ohne diese
  // Fallunterscheidung staende dort ein fuehrendes Leerzeichen.
  const text = vorspann ? `${vorspann} ${sauber}` : sauber;
  return mitDatum(text, zeitstempel);
};

/**
 * Haengt ", 13.09." an, falls der Zeitstempel lesbar ist. Ein unlesbarer
 * faellt weg -- die Aussage der Zeile haengt nicht am Datum.
 */
const mitDatum = (text: string, zeitstempel: string | null | undefined): string => {
  const datum = kurzesDatum(zeitstempel);
  return datum ? `${text}, ${datum}` : text;
};

/**
 * Tag und Monat, mehr nicht ("13.09."). Das Jahr wuerde die Zeile laenger
 * machen, ohne etwas beizutragen -- sie steht an einem Termin, dessen Datum
 * eine Zeile darueber schon sichtbar ist.
 *
 * Ein unlesbarer Zeitstempel fuehrt zu null statt zu "Invalid Date": lieber
 * nur der Name als eine kaputte Angabe.
 */
const kurzesDatum = (zeitstempel: string | null | undefined): string | null => {
  if (!zeitstempel) return null;
  const d = new Date(zeitstempel);
  if (Number.isNaN(d.getTime())) return null;
  return datumKurz(d, { ohneJahr: true });
};
