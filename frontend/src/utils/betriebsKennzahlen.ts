// betriebsKennzahlen.ts — die Urteile hinter dem Betriebs-Dashboard.
//
// Hier steht keine Darstellung, sondern die Auswertung: Was heisst dieser
// Apdex-Wert? Laeuft gerade alles? Was ist heute anders als an den Vortagen?
//
// Bewusst als eigene Datei und als reine Funktionen — dann laesst sich das
// pruefen, ohne eine Seite zu rendern, und die Seite exportiert weiter nur
// ihre Komponente.

import { METRIK_AMPEL } from '../theme/colors';
import { datumKurz } from './dateUtils';

// Nur die Felder, die fuer das Urteil gebraucht werden. Der Rest des
// Snapshots interessiert hier nicht.
export interface BetriebsSnapshot {
  totalErrors: number;
  timeline: { errors: number }[];
  apdex?: { wert: number | null };
  ueber1s?: { quote: number };
}

/*
 * Apdex einordnen.
 *
 * Die Zahl allein sagt nichts — 0,85 klingt nach einer guten Note, ist aber
 * fuer eine API duerftig. Die Stufen unten sind die uebliche Einteilung
 * (Apdex-Spezifikation): ab 0,94 gilt ein Dienst als ausgezeichnet, unter
 * 0,70 als inakzeptabel.
 */
export const apdexStufe = (w: number | null | undefined): { text: string; farbe: string; rat: string } => {
  if (w === null || w === undefined) return { text: 'noch keine Daten', farbe: METRIK_AMPEL.blass, rat: 'Es sind noch keine Anfragen gemessen.' };
  if (w >= 0.94) return { text: 'ausgezeichnet', farbe: METRIK_AMPEL.gut, rat: 'Nichts zu tun.' };
  if (w >= 0.85) return { text: 'gut', farbe: METRIK_AMPEL.gut, rat: 'Nichts zu tun.' };
  if (w >= 0.70) return { text: 'ausreichend', farbe: METRIK_AMPEL.maessig, rat: 'Unten nachsehen, welche Route die Zeit kostet.' };
  if (w >= 0.50) return { text: 'dürftig', farbe: METRIK_AMPEL.erhoeht, rat: 'Die Anfragen dauern spürbar zu lange.' };
  return { text: 'nicht hinnehmbar', farbe: METRIK_AMPEL.kritisch, rat: 'Hier hakt es für alle. Zuerst die Fehler ansehen.' };
};

/*
 * Gesamtzustand in einem Satz.
 */
export function gesamtzustand(snap: BetriebsSnapshot): { stufe: 'gut' | 'auffaellig' | 'stoerung'; titel: string; satz: string } {
  const fehlerimVerlauf = snap.timeline.slice(-10).reduce((s: number, p: { errors: number }) => s + p.errors, 0);
  const apdexWert = snap.apdex?.wert;
  if (snap.totalErrors > 0 && fehlerimVerlauf > 0) {
    return { stufe: 'stoerung', titel: 'Störung', satz: `In den letzten Minuten gab es ${fehlerimVerlauf} Fehler. Unter „Fehler“ steht, welche.` };
  }
  if (apdexWert !== null && apdexWert !== undefined && apdexWert < 0.7) {
    return { stufe: 'stoerung', titel: 'Spürbar langsam', satz: 'Die Anfragen dauern im Schnitt zu lange. Unter „Routen“ steht, wo die Zeit hingeht.' };
  }
  if (snap.totalErrors > 0) {
    return { stufe: 'auffaellig', titel: 'Läuft, mit Fehlern in der Vergangenheit', satz: `Seit dem Start ${snap.totalErrors} Serverfehler, aber gerade keine neuen.` };
  }
  if (apdexWert !== null && apdexWert !== undefined && apdexWert < 0.85) {
    return { stufe: 'auffaellig', titel: 'Läuft, aber zäh', satz: 'Keine Fehler, aber viele Anfragen brauchen länger als nötig.' };
  }
  if ((snap.ueber1s?.quote ?? 0) > 5) {
    return { stufe: 'auffaellig', titel: 'Läuft, Warten beim Laden', satz: `${snap.ueber1s!.quote} % der Anfragen dauern über eine Sekunde — meist die Verbindung, nicht der Server.` };
  }
  return { stufe: 'gut', titel: 'Alles läuft', satz: 'Keine Serverfehler, die Antwortzeiten sind im Rahmen.' };
}

/*
 * Die Routenliste: eine Liste, zwei Sortierungen.
 *
 * Die GESAMTE Serverzeit einer Route ist als Einzelzahl wertlos: Sie waechst
 * mit der Laufzeit und sagt ohne die Aufrufzahl nichts ("2,3 s" kann drei
 * langsame oder tausend schnelle Anfragen heissen). Sie bleibt trotzdem
 * erhalten, aber nur als ANTEIL an der gesamten Serverzeit — die Frage
 * "welche Route macht die meiste Arbeit" beantwortet der Prozentwert, nicht
 * die Millisekundensumme.
 *
 * Sortiert wird nach der Zeit PRO ANFRAGE (Gesamtzeit geteilt durch die
 * Aufrufe, also dem Durchschnitt). Angezeigt wird gross der Median: Er sagt,
 * wie sich die Route normalerweise verhaelt. Liegen Median und Durchschnitt
 * weit auseinander, zieht ein Ausreisser den Durchschnitt hoch — genau das
 * soll man auf einen Blick sehen.
 */
export interface RoutenRohzeile {
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  serverAvgMs?: number;
  serverP95Ms?: number;
  serverMaxMs?: number;
  p50Ms?: number;
  serverP50Ms?: number;
  serverZeitGesamtMs?: number;
  netzAvgMs?: number;
  cacheQuote?: number;
  langsam?: number;
  langsamQuote?: number;
  /**
   * Auf wie vielen Messwerten p50 und p95 beruhen. Unter etwa 20 ist ein p95
   * der langsamste Einzelwert und sagt nichts ueber die Route — gemessen an
   * Produktion fielen p95 und Maximum bei 10 von 12 Routen
   * zusammen.
   */
  stichproben?: number;
}

export type RoutenSortierung = 'langsam' | 'haeufig';

/*
 * Ab wie vielen Messwerten sagt ein p95 etwas aus?
 */
export const P95_MINDESTPROBEN = 20;

export interface RoutenZeile extends RoutenRohzeile {
  /** Median der Serverzeit — die typische Anfrage. */
  mitteMs: number;
  /** Durchschnitt der Serverzeit: Gesamtzeit geteilt durch die Aufrufe. */
  schnittMs: number;
  /** p95 der Serverzeit — der schlechte Rand. */
  p95: number;
  /** Anteil dieser Route an der gesamten Serverzeit aller Routen, in Prozent. */
  anteilProzent: number;
  /**
   * Beruht der p95 auf so wenigen Messwerten, dass er der langsamste
   * Einzelwert ist? Dann ist er kein Merkmal der Route, sondern die Aussage
   * "einmal war es langsam".
   */
  p95Duenn: boolean;
}

/*
 * Mehrere Listen (langsamste, haeufigste, nach Gesamtzeit) kommen aus dem
 * Backend getrennt an und ueberschneiden sich. Zusammengefuehrt wird nach
 * Routenname; der erste Treffer gewinnt, die Zahlen sind identisch.
 */
export function routenListe(
  quellen: (RoutenRohzeile[] | undefined)[],
  sortierung: RoutenSortierung,
  grenze = 20,
): RoutenZeile[] {
  const proRoute = new Map<string, RoutenRohzeile>();
  for (const liste of quellen) {
    for (const r of liste ?? []) {
      if (!proRoute.has(r.route)) proRoute.set(r.route, r);
    }
  }
  const roh = [...proRoute.values()];
  const gesamtzeit = roh.reduce((s, r) => s + (r.serverZeitGesamtMs ?? 0), 0);

  const zeilen: RoutenZeile[] = roh.map(r => {
    const schnittMs = r.serverAvgMs ?? r.avgMs;
    return {
      ...r,
      mitteMs: r.serverP50Ms ?? r.p50Ms ?? schnittMs,
      schnittMs,
      p95: r.serverP95Ms ?? r.p95Ms,
      anteilProzent: gesamtzeit > 0 ? Math.round(((r.serverZeitGesamtMs ?? 0) / gesamtzeit) * 100) : 0,
      // Unter P95_MINDESTPROBEN Messwerten ist der p95 rechnerisch der
      // langsamste Einzelwert. Das aelteste Backend kennt das Feld nicht —
      // dann wird nichts behauptet (false).
      p95Duenn: r.stichproben !== undefined && r.stichproben < P95_MINDESTPROBEN,
    };
  });

  // Zweites Kriterium verhindert, dass gleich schnelle Routen bei jedem
  // Neuladen die Plaetze tauschen.
  zeilen.sort((a, b) => sortierung === 'haeufig'
    ? (b.count - a.count) || (b.schnittMs - a.schnittMs) || a.route.localeCompare(b.route)
    : (b.schnittMs - a.schnittMs) || (b.count - a.count) || a.route.localeCompare(b.route));

  return zeilen.slice(0, grenze);
}

export interface HistorieDelta { at: string; requests: number; errors: number; worstP95: number; worstRoute: string | null }
export interface Tagesbilanz { tag: string; anfragen: number; fehler: number; schlimmsteMs: number; schlimmsteRoute: string | null }

/*
 * Tagesbilanz aus der persistenten Historie.
 *
 * Die Snapshots laufen alle fuenf Minuten und werden beim Deploy auf 0
 * zurueckgesetzt (neuer Prozess, leerer Speicher). Deshalb wird NICHT die
 * gespeicherte Gesamtzahl genommen, sondern die Summe der Deltas je Tag —
 * ein Deploy kostet dabei hoechstens ein Intervall, nicht den ganzen Tag.
 */
export function tagesbilanz(deltas: HistorieDelta[]): Tagesbilanz[] {
  const proTag = new Map<string, Tagesbilanz>();
  for (const d of deltas) {
    const tag = datumKurz(d.at, { ohneJahr: true });
    let e = proTag.get(tag);
    if (!e) { e = { tag, anfragen: 0, fehler: 0, schlimmsteMs: 0, schlimmsteRoute: null }; proTag.set(tag, e); }
    e.anfragen += d.requests;
    e.fehler += d.errors;
    if (d.worstP95 > e.schlimmsteMs) { e.schlimmsteMs = d.worstP95; e.schlimmsteRoute = d.worstRoute; }
  }
  return [...proTag.values()];
}

/*
 * Was ist auffaellig? Heute gegen den Durchschnitt der Vortage.
 *
 * Der heutige Tag ist noch nicht vorbei, ein roher Vergleich der Tagessummen
 * waere deshalb morgens immer alarmierend niedrig: Um 8 Uhr liegen erst acht
 * von 24 Stunden vor, und "-67 %" stuende jeden Vormittag da, ohne dass
 * irgendetwas passiert waere. Verglichen wird darum je STUNDE — heutige
 * Summe geteilt durch die bisher vergangenen Stunden, gegen den
 * Vortagesschnitt geteilt durch 24.
 *
 * `stundenHeute` ist herausgezogen, damit sich das ohne Zeitreise pruefen
 * laesst.
 */
export function vergleichHeuteGegenVortage(tage: Tagesbilanz[], stundenHeute?: number) {
  if (tage.length < 2) return null;
  const heute = tage[tage.length - 1];
  const vortage = tage.slice(0, -1);
  if (vortage.length === 0) return null;
  const std = Math.max(1, stundenHeute ?? (new Date().getHours() + new Date().getMinutes() / 60));
  const mittel = (f: (t: Tagesbilanz) => number) => vortage.reduce((s, t) => s + f(t), 0) / vortage.length;
  const proStunde = (wert: number) => wert / std;
  const vortagProStunde = (f: (t: Tagesbilanz) => number) => mittel(f) / 24;
  const rel = (jetzt: number, vorher: number) => vorher > 0 ? Math.round(((jetzt - vorher) / vorher) * 100) : null;
  return {
    vergleichstage: vortage.length,
    anfragen: {
      heute: proStunde(heute.anfragen),
      vorher: vortagProStunde(t => t.anfragen),
      delta: rel(proStunde(heute.anfragen), vortagProStunde(t => t.anfragen)),
    },
    fehler: {
      heute: heute.fehler,
      vorher: mittel(t => t.fehler),
      delta: rel(proStunde(heute.fehler), vortagProStunde(t => t.fehler)),
    },
    schlimmste: {
      heute: heute.schlimmsteMs,
      vorher: mittel(t => t.schlimmsteMs),
      route: heute.schlimmsteRoute,
      delta: rel(heute.schlimmsteMs, mittel(t => t.schlimmsteMs)),
    },
  };
}
