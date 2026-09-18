/**
 * Die Regeln hinter "Bist du dabei?" — EINE Stelle fuer Teamer:innen UND
 * Leitung.
 *
 *   "wenn ich noch nichts gesagt habe, beide knoepfe einer rot einer gruen
 *    in line. wenn ich dann gruen gewaehlt habe, dann machst du doch nur
 *    einen button. und zwar einen roten ich bin doch nicht dabei und
 *    andersrum auch ich bin doch dabei."
 *
 *   "bei admins haben wir die buttons nebeneinander 'du bist dabei' 'bin
 *    nicht dabei'. und dann ein action modal. da muss die logik einfach
 *    identisch sein wie bei teamerinnen. erste abfrage beide danach im
 *    wechsel."
 *
 * Also in beiden Ansichten:
 *   noch nichts gewaehlt -> zwei Knoepfe: "Dabei" (gruen) / "Nicht dabei" (rot)
 *   zugesagt             -> EIN Knopf, rot:   "Nicht mehr dabei"
 *   abgesagt             -> EIN Knopf, gruen: "Doch dabei"
 *
 * WARUM HIER UND NICHT ZWEIMAL IM JSX: Die Teamer-Seite hatte die Logik
 * viermal stehen und sie lief auseinander (Absage-Knopf fehlte in zwei
 * Zweigen). Die Leitungssicht war eine dritte Handabschrift mit eigener
 * Darstellung (beide Knoepfe dauerhaft, gefuellter Knopf fuer den eigenen
 * Stand, window.prompt statt Modal). Die Knoepfe selbst bleiben in ihren
 * Seiten -- die unterscheiden sich in Offline-Warteschlange und
 * Kontingent-Sperre. Gemeinsam ist die ENTSCHEIDUNG, und die steht jetzt hier.
 */

/** Buchungsstatus, wie ihn Event (booking_status) und Participant (status) tragen. */
export type ZusageStatus = 'confirmed' | 'waitlist' | 'pending' | 'opted_out' | 'excused' | null | undefined;

/** Hat die Person zugesagt? */
export const hatZugesagt = (status: ZusageStatus): boolean =>
  status === 'confirmed' || status === 'waitlist' || status === 'pending';

/** Hat die Person abgesagt? */
export const hatAbgesagt = (status: ZusageStatus): boolean => status === 'opted_out';

/**
 * Welche Knoepfe stehen da?
 *   'beide'  — noch nichts entschieden
 *   'absage' — zugesagt, also nur noch der Weg zur Absage
 *   'zusage' — abgesagt, also nur noch der Weg zurueck
 */
export const welcheKnoepfe = (status: ZusageStatus): 'beide' | 'absage' | 'zusage' => {
  if (hatZugesagt(status)) return 'absage';
  if (hatAbgesagt(status)) return 'zusage';
  return 'beide';
};

/** Beschriftung des gruenen Knopfes. */
export const zusageBeschriftung = (status: ZusageStatus, wartelisteText?: string): string =>
  hatAbgesagt(status) ? 'Doch dabei' : (wartelisteText || 'Dabei');

/** Beschriftung des roten Knopfes. */
export const absageBeschriftung = (status: ZusageStatus): string =>
  hatZugesagt(status) ? 'Nicht mehr dabei' : 'Nicht dabei';

/**
 * Verlangt DIESE Absage einen Grund?
 *
 * Nur wenn sie eine Zusage zurueknimmt (vorher confirmed ODER waitlist — die
 * Aussage "Ich bin dabei" zaehlt, nicht der zugeteilte Platz; 'pending' ist
 * ein Alt-Status mit derselben Bedeutung). Aus 'offen' oder aus einer
 * frueheren Absage bleibt der Grund freiwillig.
 *
 * Durchgesetzt wird die Regel im Backend (bookingUtils.setzeTeamerZusage, 400
 * mit error_code 'grund_erforderlich'); die Oberflaeche erspart nur den
 * Fehlversuch.
 */
export const absageBrauchtGrund = (status: ZusageStatus): boolean => hatZugesagt(status);
