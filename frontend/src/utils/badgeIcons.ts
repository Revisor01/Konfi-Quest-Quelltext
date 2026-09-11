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
import * as alleIonicons from 'ionicons/icons';
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
  trophyOutline as trophy} from 'ionicons/icons';

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
  documentOutline: { icon: documentOutline, name: 'Dokument', category: 'Sonstiges' }
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

/**
 * Ionicon-Namen aus der Datenbank gegen den VOLLEN Ionicons-Namensraum
 * aufloesen ('ribbon-outline' -> ribbonOutline), nicht nur gegen ICON_MAP.
 */
export const getIconFromIoniconsName = (name?: string | null, fallback: string = trophy): string => {
  const sauber = (name || '').trim();
  const alsCamel = sauber.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return (alleIonicons as Record<string, string>)[alsCamel] || fallback;
};
