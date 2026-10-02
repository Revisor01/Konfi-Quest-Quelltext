// Wie lange ein Einladungscode gilt -- die Auswahl in "Konfis einladen"
// 
//
// Die Regel steht im Backend (backend/utils/einladungsGueltigkeit.js): 7, 14,
// 30, 60 oder 90 Tage beim Anlegen, dieselben Stufen beim Verlaengern, das
// neue Ablaufdatum nie mehr als 90 Tage in der Zukunft, kein Code ohne
// Ablauf. Hier steht nur, was die Auswahl anbietet -- der Server prueft
// selbst und kuerzt, was darueber hinausginge.

import { datumKurz } from './dateUtils';

export const GUELTIGKEIT_TAGE = [7, 14, 30, 60, 90] as const;
export type GueltigkeitTage = typeof GUELTIGKEIT_TAGE[number];
export const STANDARD_TAGE: GueltigkeitTage = 7;
export const HOECHSTENS_TAGE = 90;

const TAG_MS = 24 * 60 * 60 * 1000;

export const istGueltigkeitTage = (wert: unknown): wert is GueltigkeitTage =>
  typeof wert === 'number' && (GUELTIGKEIT_TAGE as readonly number[]).includes(wert);

/** "7 Tage" ... "90 Tage" -- fuer die Auswahl beim Anlegen. */
export const gueltigkeitText = (tage: GueltigkeitTage): string => `${tage} Tage`;

export interface VerlaengerungsOption {
  /** was an den Server geht (Feld `tage`) */
  tage: GueltigkeitTage;
  /** neues Ablaufdatum, nach der 90-Tage-Grenze */
  neuesAblaufdatum: Date;
  /** die 90-Tage-Grenze kuerzt diese Stufe */
  begrenzt: boolean;
  text: string;
}

/**
 * Welche Verlaengerungen fuer einen Code noch etwas bringen. Dieselbe Rechnung
 * wie der Server: bisheriges Ablaufdatum plus Tage, hoechstens 90 Tage ab
 * jetzt, und nur, wenn dabei mindestens ein Tag dazukommt. Ab der ersten
 * Stufe, die die Grenze kuerzt, bringen die groesseren nichts mehr -- sie
 * fallen weg. Leer heisst: Der Code gilt schon so lange, wie es geht.
 */
export function verlaengerungsOptionen(ablauf: Date, jetzt: Date = new Date()): VerlaengerungsOption[] {
  const bisher = ablauf.getTime();
  const grenze = jetzt.getTime() + HOECHSTENS_TAGE * TAG_MS;
  const optionen: VerlaengerungsOption[] = [];
  for (const tage of GUELTIGKEIT_TAGE) {
    const gewuenscht = bisher + tage * TAG_MS;
    if (gewuenscht <= grenze) {
      const neu = new Date(gewuenscht);
      optionen.push({ tage, neuesAblaufdatum: neu, begrenzt: false, text: `${tage} Tage — bis ${datumKurz(neu)}` });
      continue;
    }
    if (grenze - bisher >= TAG_MS) {
      const neu = new Date(grenze);
      optionen.push({
        tage,
        neuesAblaufdatum: neu,
        begrenzt: true,
        text: `Bis ${datumKurz(neu)} — länger als ${HOECHSTENS_TAGE} Tage geht nicht`
      });
    }
    break;
  }
  return optionen;
}
