import { fehlerDaten, type ApiFehlerAntwort } from './fehler';

/**
 * Der Server lehnt das Bestaetigen einer Wartenden bei vollem Event weiter ab
 * (400, error_code 'event_voll', dazu max und belegt) und nimmt es erst mit
 * `ueberbuchen: true` an -- still ueberbucht wird nicht. Die App fragt
 * dazwischen nach. Ablauf und Text stehen hier, damit sie sich ohne die
 * ganze Detailansicht pruefen lassen (__tests__/utils/ueberbuchen.test.ts).
 */

export interface UeberbuchenFrage {
  header: string;
  message: string;
}

export type BestaetigenErgebnis = 'bestaetigt' | 'ueberbucht' | 'abgebrochen';

/** Die Ablehnung "Event voll" erkennt die App am error_code, nicht am Text. */
export function istEventVoll(daten: ApiFehlerAntwort | undefined): boolean {
  return daten?.error_code === 'event_voll';
}

const zahl = (wert: unknown): number | undefined =>
  typeof wert === 'number' && Number.isFinite(wert) ? wert : undefined;

/**
 * Rueckfrage mit Person, Plaetzen und der Folge. `wer` ist ein Name oder eine
 * Menge ("Die übrigen 3"), `tun` das Verb der Handlung. Ist das Team voll
 * (seite 'team'), nennt die Frage die Team-Plaetze -- die Konfi-Plaetze
 * koennen dann noch frei sein.
 */
export function ueberbuchenFrage(
  wer: string | undefined,
  daten: ApiFehlerAntwort | undefined,
  tun: 'bestätigen' | 'eintragen' = 'bestätigen'
): UeberbuchenFrage {
  const max = zahl(daten?.max);
  const belegt = zahl(daten?.belegt);
  const team = daten?.seite === 'team';
  const art = team ? 'Team-Plätze' : 'Plätze';
  const plaetze = max !== undefined ? `Alle ${max} ${art} sind vergeben` : `Alle ${art} sind vergeben`;
  const schonUeber = max !== undefined && belegt !== undefined && belegt > max ? `, ${belegt} sind bestätigt` : '';
  return {
    header: team ? 'Die Team-Plätze sind voll' : 'Das Event ist voll',
    message: `${plaetze}${schonUeber}. ${wer || 'Diese Person'} trotzdem ${tun}? Das Event ist dann überbucht.`
  };
}

/**
 * Sendet das Bestaetigen; ist das Event voll, fragt es nach und sendet nach
 * dem Ja mit `ueberbuchen`. Jeder andere Fehler -- auch einer beim zweiten
 * Versuch -- geht unveraendert an den Aufrufer.
 *
 * @param senden  schickt den PUT, mit `ueberbuchen` = true nur nach dem Ja
 * @param fragen  zeigt die Rueckfrage, true = trotzdem bestaetigen
 */
export async function bestaetigenMitRueckfrage(
  senden: (ueberbuchen: boolean) => Promise<void>,
  fragen: (frage: UeberbuchenFrage) => Promise<boolean>,
  name?: string
): Promise<BestaetigenErgebnis> {
  try {
    await senden(false);
    return 'bestaetigt';
  } catch (err) {
    const daten = fehlerDaten(err);
    if (!istEventVoll(daten)) throw err;
    if (!(await fragen(ueberbuchenFrage(name, daten)))) return 'abgebrochen';
    await senden(true);
    return 'ueberbucht';
  }
}

export type Kontingent = 'konfi' | 'team';

export interface EintragenErgebnis<P> {
  /** Wer eingetragen ist -- auch bei Abbruch oder Fehler bleiben sie es. */
  eingetragen: P[];
  /** Wer nicht mehr drankam, in der Reihenfolge der Auswahl. */
  offen: P[];
  /** true, wenn die Leitung die Rueckfrage mit Abbrechen beantwortet hat. */
  abgebrochen?: true;
  /** Ein anderer Fehler als "voll"; er beendet den Durchlauf. */
  fehler?: unknown;
}

/**
 * Jede Person geht zuerst mit `ueberbuchen: false` hinaus. Meldet der Server
 * "voll", fragt die App EINMAL fuer alle Uebrigen desselben Kontingents
 * ("Die übrigen 3 trotzdem eintragen?") und schickt sie danach mit
 * `ueberbuchen: true`. Konfi- und Team-Plaetze sind getrennt: Das Ja fuer die
 * Konfis ueberbucht das Team nicht still mit, dort wird eigens gefragt.
 *
 * Kein Wurf: Abbruch und Fehler kommen im Ergebnis zurueck, zusammen mit
 * denen, die schon eingetragen sind -- die Liste muss danach neu laden.
 */
export async function eintragenMitRueckfrage<P>(
  personen: P[],
  senden: (person: P, ueberbuchen: boolean) => Promise<void>,
  fragen: (frage: UeberbuchenFrage) => Promise<boolean>,
  beschreibe: (person: P) => { name?: string; seite: Kontingent }
): Promise<EintragenErgebnis<P>> {
  const erlaubt = new Set<Kontingent>();
  const eingetragen: P[] = [];
  for (let i = 0; i < personen.length; i++) {
    const person = personen[i];
    const { name, seite } = beschreibe(person);
    try {
      await senden(person, erlaubt.has(seite));
    } catch (err) {
      const daten = fehlerDaten(err);
      if (!istEventVoll(daten)) return { eingetragen, offen: personen.slice(i), fehler: err };
      const gleiche = personen.slice(i).filter((p) => beschreibe(p).seite === seite).length;
      const schonDabei = eingetragen.some((p) => beschreibe(p).seite === seite);
      const wer = gleiche === 1 ? name : (schonDabei ? `Die übrigen ${gleiche}` : `Die ${gleiche} Ausgewählten`);
      if (!(await fragen(ueberbuchenFrage(wer, daten, 'eintragen')))) {
        return { eingetragen, offen: personen.slice(i), abgebrochen: true };
      }
      erlaubt.add(seite);
      try {
        await senden(person, true);
      } catch (err2) {
        return { eingetragen, offen: personen.slice(i), fehler: err2 };
      }
    }
    eingetragen.push(person);
  }
  return { eingetragen, offen: [] };
}
