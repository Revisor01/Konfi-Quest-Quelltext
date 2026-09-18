// Gemeinsamer Icon-Vorrat für Badges, Level und Zertifikate.
//
// Bis 11.08. lag `getIconFromString` NEUNMAL im Baum, mit drei Map-Namen
// (BADGE_ICONS / LEVEL_ICONS / ICON_MAP), zwei Formaten und zwei Fallbacks.
// Der Vorrat war ueberall derselbe — die Duplikate sind beim Kopieren
// entstanden, nicht aus einem fachlichen Grund. Ab jetzt nur noch hier.
//
// ZWEI FORMATE, beide gebraucht:
//   ICON_CHOICES — mit Name und Kategorie, für die Auswahl-Dialoge
//   ICON_MAP     — flach (Name -> Icon), zum Rendern
// ICON_MAP wird aus ICON_CHOICES abgeleitet, damit sie nicht auseinanderlaufen.
// NUR-KONTUR-MODUS: Die Auswahlliste bildet in der
// DATENBANK gespeicherte Namen ab (badge.icon, certificate.icon,
// challenge.icon). Die SCHLUESSEL bleiben unveraendert -- das ist der
// Datenvertrag mit den Store-Apps. Nur das gezeigte Glyph ist jetzt die
// Kontur-Variante, passend zum Rest der App.
import {
  airplaneOutline as airplane,
  alertCircleOutline as alertCircle,
  balloonOutline as balloon,
  bicycleOutline as bicycle,
  boatOutline as boat,
  bookOutline as book,
  brushOutline as brush,
  businessOutline as business,
  calendarOutline as calendar,
  cameraOutline as camera,
  carOutline as car,
  chatbubblesOutline as chatbubbles,
  checkmarkCircleOutline as checkmarkCircle,
  colorPaletteOutline as colorPalette,
  compassOutline as compass,
  constructOutline as construct,
  diamondOutline as diamond,
  fitnessOutline as fitness,
  flagOutline as flag,
  flameOutline as flame,
  flashOutline as flash,
  giftOutline as gift,
  hammerOutline as hammer,
  medkitOutline as medkit,
  documentOutline,
  heartOutline as heart,
  helpCircleOutline as helpCircle,
  homeOutline as home,
  imageOutline as image,
  informationCircleOutline as informationCircle,
  leafOutline as leaf,
  locationOutline as location,
  medalOutline as medal,
  moonOutline as moon,
  musicalNoteOutline as musicalNote,
  navigateOutline as navigate,
  peopleOutline as people,
  personAddOutline as personAdd,
  pinOutline as pin,
  restaurantOutline as restaurant,
  ribbonOutline as ribbon,
  rocketOutline as rocket,
  roseOutline as rose,
  schoolOutline as school,
  shieldOutline as shield,
  sparklesOutline as sparkles,
  starOutline as star,
  stopwatchOutline as stopwatch,
  sunnyOutline as sunny,
  thumbsUpOutline as thumbsUp,
  timeOutline as time,
  timerOutline as timer,
  todayOutline as today,
  trophyOutline as trophy,

  bonfireOutline as bonfire,
  bookmarkOutline as bookmark,
  bulbOutline as bulb,
  busOutline as bus,
  cafeOutline as cafe,
  clipboardOutline as clipboardIcon,
  diceOutline as dice,
  earthOutline as earth,
  easelOutline as easel,
  extensionPuzzleOutline as extensionPuzzle,
  fishOutline as fish,
  flowerOutline as flower,
  footballOutline as football,
  gameControllerOutline as gameController,
  handLeftOutline as handLeft,
  happyOutline as happy,
  headsetOutline as headset,
  hourglassOutline as hourglass,
  iceCreamOutline as iceCream,
  infiniteOutline as infinite,
  keyOutline as schluessel,
  libraryOutline as library,
  megaphoneOutline as megaphone,
  micOutline as mic,
  musicalNotesOutline as musicalNotes2,
  nutritionOutline as nutrition,
  partlySunnyOutline as partlySunny,
  pawOutline as paw,
  pizzaOutline as pizza,
  planetOutline as planet,
  podiumOutline as podium,
  rainyOutline as rainy,
  shapesOutline as shapes,
  snowOutline as snow,
  telescopeOutline as telescope,
  ticketOutline as ticket,
  trailSignOutline as trailSign,
  umbrellaOutline as umbrella,
  walkOutline as walk,
  waterOutline as wasser,

  // Zusaetzlich: Namen, die in Produktion gespeichert sind, aber
  // nicht in der Auswahlliste stehen — siehe WEITERE_GESPEICHERTE_ICONS unten.
  // Sie ersetzen den frueheren `import * as alleIonicons`, der alle 1389
  // Symbole ins Start-Bundle zog.
  bookOutline,
  calendarNumberOutline,
  card,
  checkmarkDoneOutline,
  clipboard,
  compassOutline,
  diamondOutline,
  fitnessOutline,
  flagOutline,
  flameOutline,
  flashOutline,
  footsteps,
  footstepsOutline,
  giftOutline,
  gitCompareOutline,
  handLeftOutline,
  heartOutline,
  homeOutline,
  map,
  medalOutline,
  musicalNotes,
  musicalNotesOutline,
  peopleCircle,
  peopleOutline,
  person,
  ribbonOutline,
  starOutline,
  statsChartOutline,
  sunnyOutline,
  telescopeOutline,
  trophyOutline,
  walkOutline,
  water,
} from 'ionicons/icons';

export interface IconChoice { icon: string; name: string; category: string; }

export const ICON_CHOICES: Record<string, IconChoice> = {
  trophy: { icon: trophy, name: 'Pokal', category: 'Erfolg' },
  medal: { icon: medal, name: 'Medaille', category: 'Erfolg' },
  ribbon: { icon: ribbon, name: 'Band', category: 'Erfolg' },
  star: { icon: star, name: 'Stern', category: 'Erfolg' },
  checkmarkCircle: { icon: checkmarkCircle, name: 'Bestanden', category: 'Erfolg' },
  diamond: { icon: diamond, name: 'Diamant', category: 'Erfolg' },
  shield: { icon: shield, name: 'Schild', category: 'Erfolg' },

  flame: { icon: flame, name: 'Flamme', category: 'Engagement' },
  flash: { icon: flash, name: 'Blitz', category: 'Engagement' },
  rocket: { icon: rocket, name: 'Rakete', category: 'Engagement' },
  sparkles: { icon: sparkles, name: 'Funken', category: 'Engagement' },
  thumbsUp: { icon: thumbsUp, name: 'Daumen hoch', category: 'Engagement' },

  heart: { icon: heart, name: 'Herz', category: 'Gemeinschaft' },
  people: { icon: people, name: 'Gruppe', category: 'Gemeinschaft' },
  personAdd: { icon: personAdd, name: 'Neue Person', category: 'Gemeinschaft' },
  chatbubbles: { icon: chatbubbles, name: 'Chat', category: 'Gemeinschaft' },
  gift: { icon: gift, name: 'Geschenk', category: 'Gemeinschaft' },

  book: { icon: book, name: 'Buch', category: 'Lernen' },
  school: { icon: school, name: 'Schule', category: 'Lernen' },
  construct: { icon: construct, name: 'Werkzeug', category: 'Lernen' },
  brush: { icon: brush, name: 'Pinsel', category: 'Lernen' },
  colorPalette: { icon: colorPalette, name: 'Farbpalette', category: 'Lernen' },

  sunny: { icon: sunny, name: 'Sonne', category: 'Natur' },
  moon: { icon: moon, name: 'Mond', category: 'Natur' },
  leaf: { icon: leaf, name: 'Blatt', category: 'Natur' },
  rose: { icon: rose, name: 'Rose', category: 'Natur' },

  calendar: { icon: calendar, name: 'Kalender', category: 'Zeit' },
  today: { icon: today, name: 'Heute', category: 'Zeit' },
  time: { icon: time, name: 'Uhr', category: 'Zeit' },
  timer: { icon: timer, name: 'Timer', category: 'Zeit' },
  stopwatch: { icon: stopwatch, name: 'Stoppuhr', category: 'Zeit' },

  restaurant: { icon: restaurant, name: 'Restaurant', category: 'Aktivitäten' },
  fitness: { icon: fitness, name: 'Fitness', category: 'Aktivitäten' },
  bicycle: { icon: bicycle, name: 'Fahrrad', category: 'Aktivitäten' },
  car: { icon: car, name: 'Auto', category: 'Aktivitäten' },
  airplane: { icon: airplane, name: 'Flugzeug', category: 'Aktivitäten' },
  boat: { icon: boat, name: 'Boot', category: 'Aktivitäten' },
  camera: { icon: camera, name: 'Kamera', category: 'Aktivitäten' },
  image: { icon: image, name: 'Bild', category: 'Aktivitäten' },
  musicalNote: { icon: musicalNote, name: 'Musik', category: 'Aktivitäten' },
  balloon: { icon: balloon, name: 'Ballon', category: 'Aktivitäten' },

  home: { icon: home, name: 'Zuhause', category: 'Orte' },
  business: { icon: business, name: 'Gebäude', category: 'Orte' },
  location: { icon: location, name: 'Standort', category: 'Orte' },
  navigate: { icon: navigate, name: 'Navigation', category: 'Orte' },
  compass: { icon: compass, name: 'Kompass', category: 'Orte' },
  pin: { icon: pin, name: 'Pin', category: 'Orte' },
  flag: { icon: flag, name: 'Flagge', category: 'Orte' },

  informationCircle: { icon: informationCircle, name: 'Info', category: 'Sonstiges' },
  helpCircle: { icon: helpCircle, name: 'Hilfe', category: 'Sonstiges' },
  alertCircle: { icon: alertCircle, name: 'Warnung', category: 'Sonstiges' },
  hammer: { icon: hammer, name: 'Hammer', category: 'Sonstiges' },
  // Zertifikats-Symbole: standen nur im Teamer-Dashboard-Vorrat. Ohne sie
  // zeigten Erste-Hilfe- und Fuehrungszeugnis-Zertifikate die Trophaee.
  medkit: { icon: medkit, name: 'Erste Hilfe', category: 'Sonstiges' },
  documentOutline: { icon: documentOutline, name: 'Dokument', category: 'Sonstiges' },

  // Ausgewaehlt nach Konfi-Arbeit, nicht nach Vollstaendigkeit: Freizeit,
  // Musik und Kreatives, Sport und Spiel, Essen, Wetter und Schoepfung,
  // Wegzeichen. Buero- und Technik-Symbole bleiben bewusst draussen.
  //
  // KEINE kirchlichen Symbole: Ionicons hat weder Kreuz noch Kirche, Kerze,
  // Taube oder Glocke — im vollen Namensraum von 1357 Symbolen gepruft, null
  // Treffer. Was hier steht, sind weltliche Symbole, die sich fuer kirchliche
  // Bedeutungen einsetzen lassen (Wasser fuer die Taufe, Hand fuer den Segen,
  // Lagerfeuer fuer die Freizeitandacht) — wer echte braucht, muss eigene
  // SVGs zeichnen, so wie ICON_ZURUECK eines ist.
  //
  // Die SCHLUESSEL sind Datenvertrag mit den ausgelieferten Apps: Neue
  // hinzufuegen ist erlaubt, vorhandene umbenennen bricht sie.
  // ---------------------------------------------------------------------

  podium: { icon: podium, name: 'Siegertreppe', category: 'Erfolg' },
  hourglass: { icon: hourglass, name: 'Sanduhr', category: 'Erfolg' },
  infinite: { icon: infinite, name: 'Unendlich', category: 'Erfolg' },
  bookmark: { icon: bookmark, name: 'Lesezeichen', category: 'Erfolg' },

  megaphone: { icon: megaphone, name: 'Megafon', category: 'Engagement' },
  bulb: { icon: bulb, name: 'Gluehbirne', category: 'Engagement' },
  handLeft: { icon: handLeft, name: 'Hand', category: 'Engagement' },
  walk: { icon: walk, name: 'Unterwegs', category: 'Engagement' },

  happy: { icon: happy, name: 'Laecheln', category: 'Gemeinschaft' },
  peopleCircleGruppe: { icon: peopleCircle, name: 'Gruppenkreis', category: 'Gemeinschaft' },
  bonfire: { icon: bonfire, name: 'Lagerfeuer', category: 'Gemeinschaft' },
  ticket: { icon: ticket, name: 'Eintrittskarte', category: 'Gemeinschaft' },

  library: { icon: library, name: 'Buecherei', category: 'Lernen' },
  easel: { icon: easel, name: 'Staffelei', category: 'Lernen' },
  shapes: { icon: shapes, name: 'Formen', category: 'Lernen' },
  clipboardListe: { icon: clipboardIcon, name: 'Klemmbrett', category: 'Lernen' },
  telescope: { icon: telescope, name: 'Fernrohr', category: 'Lernen' },

  flower: { icon: flower, name: 'Blume', category: 'Natur' },
  wasser: { icon: wasser, name: 'Wasser', category: 'Natur' },
  earth: { icon: earth, name: 'Erde', category: 'Natur' },
  planet: { icon: planet, name: 'Planet', category: 'Natur' },
  partlySunny: { icon: partlySunny, name: 'Wolkig', category: 'Natur' },
  rainy: { icon: rainy, name: 'Regen', category: 'Natur' },
  snow: { icon: snow, name: 'Schnee', category: 'Natur' },
  paw: { icon: paw, name: 'Pfote', category: 'Natur' },
  fish: { icon: fish, name: 'Fisch', category: 'Natur' },

  musicalNotesMehr: { icon: musicalNotes2, name: 'Noten', category: 'Aktivitäten' },
  mic: { icon: mic, name: 'Mikrofon', category: 'Aktivitäten' },
  headset: { icon: headset, name: 'Kopfhoerer', category: 'Aktivitäten' },
  football: { icon: football, name: 'Fussball', category: 'Aktivitäten' },
  gameController: { icon: gameController, name: 'Spielkonsole', category: 'Aktivitäten' },
  dice: { icon: dice, name: 'Wuerfel', category: 'Aktivitäten' },
  extensionPuzzle: { icon: extensionPuzzle, name: 'Puzzleteil', category: 'Aktivitäten' },
  pizza: { icon: pizza, name: 'Pizza', category: 'Aktivitäten' },
  iceCream: { icon: iceCream, name: 'Eis', category: 'Aktivitäten' },
  cafe: { icon: cafe, name: 'Heissgetraenk', category: 'Aktivitäten' },
  nutrition: { icon: nutrition, name: 'Obst', category: 'Aktivitäten' },

  bus: { icon: bus, name: 'Bus', category: 'Orte' },
  trailSign: { icon: trailSign, name: 'Wegweiser', category: 'Orte' },
  schluessel: { icon: schluessel, name: 'Schluessel', category: 'Orte' },
  umbrella: { icon: umbrella, name: 'Schirm', category: 'Orte' }
};

/** Flache Map (Name -> Icon) zum Rendern. */
export const ICON_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ICON_CHOICES).map(([key, value]) => [key, value.icon])
);

/**
 * Loest einen gespeicherten Icon-Namen auf. Standard-Rueckfall ist die
 * Trophaee — eine der neun alten Kopien fiel auf `ribbon` zurück
 * (admin/BadgesView), das war die einzige Abweichung und ist bewusst
 * vereinheitlicht.
 *
 * Zertifikate und Challenges brauchen einen anderen Rueckfall (Band bzw.
 * Flagge), sonst waere der Zusammenzug ihrer Icon-Listen eine sichtbare
 * Aenderung. Deshalb `fallback` — sie geben ihr bisheriges Symbol mit.
 */
export const getIconFromString = (iconName?: string | null, fallback: string = trophy): string => {
  if (!iconName) return fallback;
  const treffer = ICON_MAP[iconName];
  if (treffer) return treffer;
  // "-outline" abschneiden und erneut suchen.
  //
  // Hier statt in den Daten korrigiert: Die Namen stehen in custom_badges
  // ueber alle Gemeinden verteilt, und aeltere App-Versionen lesen dieselben
  // Werte. Ein Umbenennen in der Datenbank wuerde die brechen.
  if (iconName.endsWith('-outline')) {
    const kurz = ICON_MAP[iconName.slice(0, -'-outline'.length)];
    if (kurz) return kurz;
  }
  return fallback;
};

// Zusaetzliche gespeicherte Namen, die es NICHT in ICON_CHOICES gibt.
//
// Gemessen gegen Produktion: In custom_badges.icon,
// challenges.badge_icon und certificate_types.icon stehen 66 verschiedene
// Ionicons-Namen. Die meisten kennt ICON_CHOICES, diese hier nicht — sie
// stammen aus der Zeit vor der Auswahlliste bzw. aus Importen.
//
// Warum eine feste Liste statt `import * as alleIonicons` (der vorherige Weg):
// Der Namespace-Import zog ALLE 1389 Ionicons ins Bundle — gemessen
// 1.978.519 Bytes roh, 447.574 gzip, also 38 % des gesamten JS. Geladen wurde
// das bei JEDEM App-Start (modulepreload), gebraucht von genau EINER
// Wrapped-Folie. Mit der Liste faellt der Brocken weg; aufloesbar bleibt alles,
// was in den Daten wirklich vorkommt.
//
// WICHTIG beim Ergaenzen: Die gespeicherten Namen sind der Datenvertrag mit den
// ausgelieferten Apps. Ein Name, der hier fehlt, bricht nichts — er faellt auf
// die Trophaee zurueck, wie schon vorher bei unbekannten Namen. Wer neue
// Symbole in die Auswahl aufnimmt, ergaenzt sie in ICON_CHOICES; hier stehen
// nur die Altlasten.
const WEITERE_GESPEICHERTE_ICONS: Record<string, string> = {
  // calendarOutline und colorPaletteOutline sind oben schon als `calendar`
  // bzw. `colorPalette` importiert — hier nur der gespeicherte Name darauf.
  bookOutline, calendarNumberOutline, calendarOutline: calendar, card, checkmarkDoneOutline,
  clipboard, colorPaletteOutline: colorPalette, compassOutline, diamondOutline, fitnessOutline,
  flagOutline, flameOutline, flashOutline, footsteps, footstepsOutline, giftOutline,
  gitCompareOutline, handLeftOutline, heartOutline, homeOutline, map, medalOutline,
  musicalNotes, musicalNotesOutline, peopleCircle, peopleOutline, person, ribbonOutline,
  starOutline, statsChartOutline, sunnyOutline, telescopeOutline, trophyOutline,
  walkOutline, water,
};

/**
 * Ionicon-Namen aus der Datenbank aufloesen ('ribbon-outline' -> ribbonOutline).
 */
export const getIconFromIoniconsName = (name?: string | null, fallback: string = trophy): string => {
  const sauber = (name || '').trim();
  if (!sauber) return fallback;

  if (!/^[a-zA-Z0-9-]+$/.test(sauber)) return sauber;

  const alsCamel = sauber.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return ICON_MAP[alsCamel] || WEITERE_GESPEICHERTE_ICONS[alsCamel] || fallback;
};

/**
 * Ist der gespeicherte Wert ein Emoji (und kein Ionicons-Name)?
 * Dann gehoert er als Text gerendert, nicht in ein IonIcon.
 */
export const istEmojiIcon = (name?: string | null): boolean => {
  const sauber = (name || '').trim();
  return sauber !== '' && !/^[a-zA-Z0-9-]+$/.test(sauber);
};
