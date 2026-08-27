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
import {
  airplane,
  alertCircle,
  balloon,
  bicycle,
  boat,
  book,
  brush,
  business,
  calendar,
  camera,
  car,
  chatbubbles,
  checkmarkCircle,
  colorPalette,
  compass,
  construct,
  diamond,
  fitness,
  flag,
  flame,
  flash,
  gift,
  hammer,
  medkit,
  documentOutline,
  heart,
  helpCircle,
  home,
  image,
  informationCircle,
  leaf,
  location,
  medal,
  moon,
  musicalNote,
  navigate,
  people,
  personAdd,
  pin,
  restaurant,
  ribbon,
  rocket,
  rose,
  school,
  shield,
  sparkles,
  star,
  stopwatch,
  sunny,
  thumbsUp,
  time,
  timer,
  today,
  trophy} from 'ionicons/icons';

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
 * Loest einen gespeicherten Icon-Namen auf. Fallback ist die Trophaee —
 * eine der neun alten Kopien fiel auf `ribbon` zurück (admin/BadgesView),
 * das war die einzige Abweichung und ist bewusst vereinheitlicht.
 */
export const getIconFromString = (iconName?: string | null): string => {
  if (!iconName) return trophy;
  return ICON_MAP[iconName] || trophy;
};
