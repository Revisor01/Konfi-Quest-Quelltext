// Zentrale Stelle für wiederkehrende Icons.
//
// Warum: "Wir könnten Icons global tauschen, sodass wir
// die an einer Stelle nur definieren müssen. Ich überlege, mittels Icon dem
// Ganzen noch mal einen etwas anderen Look zu geben."
//
// Vorher stand `arrowBack` an 34 Stellen einzeln importiert — ein Wechsel
// hätte 34 Dateien angefasst und dabei zuverlässig eine vergessen.

/**
 * Zurück-Pfeil in Kopfzeilen.
 *
 * ZUR STRICHSTÄRKE — der Grund für das eigene SVG: Ionicons hat KEINE dünnere
 * Variante. Alle Strich-Icons dort nutzen stroke-width 48 auf einer
 * Zeichenfläche von 512, das entspricht 2.25 auf 24er-Fläche. Auch die
 * `-outline`-Namen sind bei Pfeil und Chevron mit der Basisvariante identisch.
 * Heroicons "outline" zeichnet mit 1.5 auf 24 — ein Drittel dünner, und genau
 * das macht den leichteren, moderneren Eindruck.
 *
 * Als Data-URL, weil IonIcon `icon` entweder einen Ionicons-Namen ODER eine
 * URL entgegennimmt. Kein zusätzliches Paket, keine Netzabfrage, und der
 * Strich erbt über `stroke="currentColor"` die Farbe der Umgebung — sonst
 * bliebe der Pfeil im Dunkelmodus schwarz.
 *
 * Zum Ändern des Looks reicht es, hier ein anderes Icon zuzuweisen.
 */
const ZURUECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>`;

export const ICON_ZURUECK = `data:image/svg+xml,${encodeURIComponent(ZURUECK_SVG)}`;

// ---------------------------------------------------------------------------
// ALLE uebrigen Icons der App, semantisch benannt.
//
// Vorher importierten 144 Dateien direkt aus 'ionicons/icons' — ein Wechsel
// des Icon-Satzes (z.B. auf Heroicons wie beim Zurueck-Pfeil oben) haette
// jede einzelne angefasst. Jetzt gilt:
//
//   * Komponenten importieren Icons NUR aus dieser Datei (abgesichert durch
//     __tests__/components/zentraleIcons.test.ts).
//   * Die Konstanten sind nach BEDEUTUNG benannt, nicht nach Icon-Name:
//     Wer "das Zusage-Symbol" tauschen will, aendert EINE Zeile hier —
//     nicht 33 Importe.
//   * Suffix _GEFUELLT = die gefuellte Ionicons-Variante; ohne Suffix die
//     Strich-Variante (bzw. die einzige, die es gibt). Beide Varianten je
//     Bedeutung existieren nur, wo die App beide wirklich nutzt.
//   * Ein Glyph darf mehrere Bedeutungen tragen (siehe Aliase unten):
//     home ist zugleich Gottesdienst-Kategorie UND Start-Tab. Getrennte
//     Konstanten, damit ein spaeterer Tausch die andere Bedeutung nicht
//     mitreisst.
//
// Diese Datei liegt bewusst in components/shared (nicht theme/): Das Muster
// ICON_ZURUECK wohnte schon hier, 62 Importe zeigten bereits auf diesen Ort,
// und die Datei exportiert neben Namen auch eigene SVGs (oben) — das ist
// Komponenten-Zubehoer, kein Theme-Token.
//
// AUSNAHMEN, die weiter direkt aus 'ionicons/icons' importieren:
//   * utils/badgeIcons.ts — loest in der DATENBANK gespeicherte Icon-Namen
//     (badge.icon, certificate.icon) auf. Die Schluessel dort sind
//     Datenvertrag mit alten App-Versionen, keine UI-Semantik.
//   * die badgeIcons-Tests, die genau diesen Vorrat pruefen.
export {
  // ===================================================================
  // GEFUELLT/KONTUR — der Schalter fuer den Look der ganzen App

  // --- Navigation & Grundaktionen ---
  add as ICON_HINZUFUEGEN_GEFUELLT,
  addOutline as ICON_HINZUFUEGEN,
  addCircle as ICON_PLUS_KREIS_GEFUELLT,
  addCircleOutline as ICON_PLUS_KREIS,
  arrowForward as ICON_PFEIL_WEITER_GEFUELLT,
  arrowUndoOutline as ICON_RUECKGAENGIG,
  chevronDown as ICON_AUFKLAPPEN_GEFUELLT,
  chevronDownOutline as ICON_AUFKLAPPEN,
  chevronUp as ICON_ZUKLAPPEN,
  chevronForward as ICON_WEITER_GEFUELLT,
  chevronForwardOutline as ICON_WEITER,
  close as ICON_SCHLIESSEN_GEFUELLT,
  closeOutline as ICON_SCHLIESSEN,
  create as ICON_BEARBEITEN_GEFUELLT,
  createOutline as ICON_BEARBEITEN,
  copy as ICON_KOPIEREN_GEFUELLT,
  copyOutline as ICON_KOPIEREN,
  trash as ICON_LOESCHEN_GEFUELLT,
  trashOutline as ICON_LOESCHEN,
  search as ICON_SUCHE_GEFUELLT,
  searchOutline as ICON_SUCHE,
  filterOutline as ICON_FILTER,
  refreshOutline as ICON_AKTUALISIEREN,
  swapHorizontalOutline as ICON_WECHSEL,
  swapVertical as ICON_SORTIEREN,
  openOutline as ICON_EXTERN_OEFFNEN,
  downloadOutline as ICON_HERUNTERLADEN,
  cloudUploadOutline as ICON_HOCHLADEN,
  printOutline as ICON_DRUCKEN,
  shareOutline as ICON_TEILEN,
  scanOutline as ICON_SCANNEN,
  ellipsisHorizontal as ICON_MEHR,
  ellipsisVertical as ICON_MEHR_VERTIKAL,
  removeCircle as ICON_ENTFERNEN_GEFUELLT,
  removeCircleOutline as ICON_ENTFERNEN,
  listOutline as ICON_LISTE,
  grid as ICON_RASTER_GEFUELLT,
  gridOutline as ICON_RASTER,
  appsOutline as ICON_APPS,
  checkboxOutline as ICON_CHECKBOX,
  logOut as ICON_ABMELDEN_GEFUELLT,
  logOutOutline as ICON_ABMELDEN,

  // --- Status & Rueckmeldung ---
  checkmark as ICON_HAKEN_GEFUELLT,
  checkmarkOutline as ICON_HAKEN,
  checkmarkCircle as ICON_ZUSAGE_GEFUELLT,
  checkmarkCircleOutline as ICON_ZUSAGE,
  checkmarkDoneCircle as ICON_ANWESEND,
  closeCircle as ICON_ABSAGE,
  ellipseOutline as ICON_KREIS_LEER,
  hourglass as ICON_WARTEND_GEFUELLT,
  hourglassOutline as ICON_WARTEND,
  alertCircle as ICON_WARNHINWEIS_GEFUELLT,
  alertCircleOutline as ICON_WARNHINWEIS,
  warning as ICON_WARNUNG_GEFUELLT,
  warningOutline as ICON_WARNUNG,
  informationCircle as ICON_INFO_GEFUELLT,
  informationCircleOutline as ICON_INFO,
  helpCircle as ICON_HILFE_GEFUELLT,
  helpCircleOutline as ICON_HILFE,
  ban as ICON_GESPERRT,
  cloudOfflineOutline as ICON_OFFLINE,
  infinite as ICON_UNENDLICH,
  pulseOutline as ICON_PULS,
  notifications as ICON_BENACHRICHTIGUNG,

  // --- Termine & Zeit ---
  calendar as ICON_TERMIN_GEFUELLT,
  calendarOutline as ICON_TERMIN,
  time as ICON_UHRZEIT_GEFUELLT,
  timeOutline as ICON_UHRZEIT,

  // --- Personen & Rollen ---
  person as ICON_PERSON_GEFUELLT,
  personOutline as ICON_PERSON,
  people as ICON_GRUPPE_GEFUELLT,
  peopleOutline as ICON_GRUPPE,
  personAdd as ICON_PERSON_HINZUFUEGEN_GEFUELLT,
  personAddOutline as ICON_PERSON_HINZUFUEGEN,
  personCircleOutline as ICON_PROFIL,
  school as ICON_JAHRGANG_GEFUELLT,
  schoolOutline as ICON_JAHRGANG,
  handLeft as ICON_HAND_GEFUELLT,
  handLeftOutline as ICON_HAND,
  happy as ICON_FROEHLICH_GEFUELLT,
  happyOutline as ICON_FROEHLICH,
  sad as ICON_TRAURIG_GEFUELLT,
  sadOutline as ICON_TRAURIG,
  thumbsUp as ICON_DAUMEN_HOCH_GEFUELLT,
  thumbsUpOutline as ICON_DAUMEN_HOCH,
  heart as ICON_HERZ_GEFUELLT,
  heartOutline as ICON_HERZ,

  // --- Punkte, Abzeichen & Erfolge ---
  trophy as ICON_POKAL_GEFUELLT,
  trophyOutline as ICON_POKAL,
  ribbon as ICON_ABZEICHEN_GEFUELLT,
  ribbonOutline as ICON_ABZEICHEN,
  star as ICON_STERN_GEFUELLT,
  starOutline as ICON_STERN,
  flag as ICON_CHALLENGE_GEFUELLT,
  flagOutline as ICON_CHALLENGE,
  flash as ICON_AKTION_GEFUELLT,
  flashOutline as ICON_AKTION,
  gift as ICON_BONUS_GEFUELLT,
  giftOutline as ICON_BONUS,
  sparkles as ICON_FUNKELN_GEFUELLT,
  sparklesOutline as ICON_FUNKELN,
  flame as ICON_FLAMME_GEFUELLT,
  flameOutline as ICON_FLAMME,
  rocket as ICON_RAKETE,
  podium as ICON_PODIUM,
  statsChart as ICON_STATISTIK_GEFUELLT,
  statsChartOutline as ICON_STATISTIK,
  barChart as ICON_DIAGRAMM,
  speedometerOutline as ICON_TACHO,
  layersOutline as ICON_STUFEN,
  pricetag as ICON_KATEGORIE_GEFUELLT,
  pricetagOutline as ICON_KATEGORIE,

  // --- Chat & Kommunikation ---
  chatbubbleOutline as ICON_CHAT,
  chatbubbleEllipsesOutline as ICON_CHAT_AKTIV,
  chatbubbles as ICON_CHATS_GEFUELLT,
  chatbubblesOutline as ICON_CHATS,
  paperPlaneOutline as ICON_SENDEN,
  // send statt paperPlane: Der Papierflieger ist im SVG selbst diagonal
  // gezeichnet (er zeigt nach rechts oben) und sah im runden Chat-Knopf
  // schief aus. `send` stammt aus derselben Familie, liegt aber waagerecht.
  // Die Outline-Variante ICON_SENDEN bleibt der Papierflieger — sie steht bei
  // den Challenges fuer "eingereicht", nicht fuer einen Senden-Knopf.
  send as ICON_SENDEN_GEFUELLT,
  returnUpBack as ICON_ANTWORTEN,
  mail as ICON_MAIL_GEFUELLT,
  mailOutline as ICON_MAIL,
  at as ICON_AT_ZEICHEN,
  callOutline as ICON_TELEFON,
  megaphoneOutline as ICON_ANKUENDIGUNG,

  // --- Medien & Dateien ---
  document as ICON_DATEI_GEFUELLT,
  documentOutline as ICON_DATEI,
  documentText as ICON_TEXTDOKUMENT_GEFUELLT,
  documentTextOutline as ICON_TEXTDOKUMENT,
  image as ICON_BILD_GEFUELLT,
  imageOutline as ICON_BILD,
  imagesOutline as ICON_GALERIE,
  camera as ICON_KAMERA_GEFUELLT,
  cameraOutline as ICON_KAMERA,
  videocamOutline as ICON_VIDEO,
  mic as ICON_MIKROFON_GEFUELLT,
  micOutline as ICON_MIKROFON,
  musicalNotesOutline as ICON_MUSIK,
  play as ICON_ABSPIELEN,
  pause as ICON_PAUSE,
  attach as ICON_ANHANG_GEFUELLT,
  attachOutline as ICON_ANHANG,
  linkOutline as ICON_LINK,
  folderOpenOutline as ICON_ORDNER,
  archiveOutline as ICON_ARCHIV,
  albumsOutline as ICON_ALBEN,
  textOutline as ICON_TEXT,
  bagHandle as ICON_MATERIAL,
  book as ICON_BUCH_GEFUELLT,
  bookOutline as ICON_BUCH,

  // --- Sichtbarkeit & Sicherheit ---
  eye as ICON_SICHTBAR_GEFUELLT,
  eyeOutline as ICON_SICHTBAR,
  eyeOff as ICON_VERBORGEN_GEFUELLT,
  eyeOffOutline as ICON_VERBORGEN,
  lockClosed as ICON_SPERRE_GEFUELLT,
  lockClosedOutline as ICON_SPERRE,
  lockOpen as ICON_ENTSPERRT,
  key as ICON_SCHLUESSEL_GEFUELLT,
  keyOutline as ICON_SCHLUESSEL,
  shield as ICON_SCHILD_GEFUELLT,
  shieldOutline as ICON_SCHILD,
  shieldCheckmark as ICON_SCHUTZ_GEFUELLT,
  shieldCheckmarkOutline as ICON_SCHUTZ,
  fingerPrintOutline as ICON_FINGERABDRUCK,
  qrCode as ICON_QRCODE_GEFUELLT,
  qrCodeOutline as ICON_QRCODE,

  // --- Orte & Organisation ---
  home as ICON_GOTTESDIENST_GEFUELLT,
  homeOutline as ICON_GOTTESDIENST,
  location as ICON_ORT_GEFUELLT,
  locationOutline as ICON_ORT,
  business as ICON_ORGANISATION_GEFUELLT,
  businessOutline as ICON_ORGANISATION,
  globeOutline as ICON_WELT,
  compassOutline as ICON_KOMPASS,
  gitNetworkOutline as ICON_NETZWERK,

  // --- Sonstiges ---
  settings as ICON_EINSTELLUNGEN_GEFUELLT,
  settingsOutline as ICON_EINSTELLUNGEN,
  constructOutline as ICON_WERKZEUG,
  briefcase as ICON_AKTENTASCHE_GEFUELLT,
  briefcaseOutline as ICON_AKTENTASCHE,
  cubeOutline as ICON_WUERFEL,
  prismOutline as ICON_PRISMA,
  flask as ICON_EXPERIMENT,
  sunny as ICON_SONNE,
  arrowUpCircleOutline as ICON_UPGRADE,

} from 'ionicons/icons';

// Aliase: dasselbe Glyph, eine ANDERE Bedeutung. Absichtlich eigene
// Konstanten, damit ein spaeterer Icon-Wechsel nur die gemeinte Stelle
// trifft:
//   * home steht in Punkte-Kontexten fuer die Kategorie Gottesdienst
//     (ICON_GOTTESDIENST oben), in Tab-Leiste und Onboarding aber fuer
//     die Startseite.
//   * people steht meist fuer Gruppe/Teilnehmende (ICON_GRUPPE oben), im
//     Paar "gottesdienst : gemeinde" aber fuer die Kategorie Gemeinde.
export {
  home as ICON_STARTSEITE_GEFUELLT,
  homeOutline as ICON_STARTSEITE,
  people as ICON_GEMEINDE_GEFUELLT,
  peopleOutline as ICON_GEMEINDE,
} from 'ionicons/icons';
