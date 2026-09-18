// neuerungenGate.ts — entscheidet, OB die "Was ist neu?"-Anzeige nach einem
// Update erscheint. Reine Funktion ohne Speicher- und Plattformzugriff: Sie
// bekommt die zuletzt gesehene und die installierte Version und sagt, was zu
// tun ist. Der Speicherzugriff liegt in hooks/useOnboardingOnce.ts.
//
// WARUM NICHT MEHR UEBER DEN SCHLUESSELNAMEN (bis 2.1.1):
// Bisher steckte die Version im Namen des Preferences-Schluessels
// (`update_walkthrough_2_1_gesehen`). Beim Release wurde die Konstante
// hochgesetzt, dadurch entstand ein neuer Schluessel, und der Hinweis
// erschien bei allen wieder. Das hat drei Loecher, die auffallen, sobald
// man sie einmal gesehen hat:
//
// 1. Neuinstallationen: Wer die App frisch installiert, hat KEINEN der
//    Schluessel -- also erschien der Hinweis. Aufgefangen wurde das nur
//    indirekt ueber das Onboarding-Flag; wer die Tour einmal abgebrochen
//    und den Account gewechselt hat, bekam trotzdem ein "Was ist neu"
//    fuer eine Version, die er nie hatte.
// 2. Es wurde nie eine Version VERGLICHEN, nur ein Name gewechselt. Ein
//    Sprung von 2.0 direkt auf 2.2 war dadurch nicht von 2.1 -> 2.2 zu
//    unterscheiden.
// 3. Die Entscheidung stand nur in einem Kommentar ("Version hochsetzen"),
//    nicht im Code -- und wurde bei 2.1.1 prompt an einer Stelle vergessen
//    (siehe walkthroughVersionEinheitlich.test.ts).
//
// Jetzt wird die INSTALLIERTE Version (App.getInfo bzw. version.json im
// Browser) gegen die zuletzt gesehene verglichen.

import { vergleicheVersionen } from './versionVergleich';

// Nur x.y(.z...) wird ueberhaupt verglichen. Alles andere (leer, undefined,
// unerwartete Strings von App.getInfo) fuehrt zu "nichts zeigen" -- eine
// Anzeige auf Basis von Datenmuell waere schlimmer als keine.
const VERSIONS_FORM = /^[0-9]+(\.[0-9]+)*$/;

/**
 * Schneidet eine Version auf "major.minor" zu: '2.2.0' -> '2.2', '2.2' -> '2.2'.
 * Gibt null zurueck, wenn die Eingabe keine Versionsform hat.
 */
export function aufMinorKuerzen(version: string | null | undefined): string | null {
  if (!version) return null;
  const sauber = version.trim();
  if (!VERSIONS_FORM.test(sauber)) return null;
  const teile = sauber.split('.');
  // Fehlendes Minor-Segment zaehlt als 0 ("3" -> "3.0").
  return `${parseInt(teile[0], 10) || 0}.${parseInt(teile[1] ?? '0', 10) || 0}`;
}

export type NeuerungenEntscheidung =
  // Bestandsnutzer:in mit aelterer Minor-Version -> Anzeige zeigen.
  | { art: 'zeigen'; merkeVersion: string }
  // Neuinstallation ODER nichts Neues -> nichts zeigen. `merkeVersion`
  // sagt, was still als gesehen vermerkt werden soll (null = nichts tun).
  | { art: 'still'; merkeVersion: string | null };

/**
 * Kernentscheidung der Aenderungsanzeige.
 *
 * @param installiert  Die laufende App-Version, z.B. '2.2.0'.
 * @param zuletztGesehen  Die zuletzt vermerkte Version, oder null/undefined.
 * @param istNeuinstallation  true, wenn dieses Geraet die App noch nie
 *   benutzt hat (kein Onboarding-Flag). Dann wird die aktuelle Version
 *   STILL vermerkt: Wer zum ersten Mal oeffnet, will loslegen und nicht
 *   lesen, was sich gegenueber einer Version geaendert hat, die er nie
 *   hatte.
 */
export function entscheideNeuerungen(
  installiert: string | null | undefined,
  zuletztGesehen: string | null | undefined,
  istNeuinstallation: boolean
): NeuerungenEntscheidung {
  const jetzt = aufMinorKuerzen(installiert);
  // Ohne brauchbare installierte Version gibt es nichts zu entscheiden --
  // und es waere falsch, irgendetwas zu vermerken.
  if (!jetzt) return { art: 'still', merkeVersion: null };

  // Neuinstallation: still vermerken, nichts zeigen.
  if (istNeuinstallation) return { art: 'still', merkeVersion: jetzt };

  const vorher = aufMinorKuerzen(zuletztGesehen);
  // Bestandsgeraet OHNE Merker: Das ist ein Geraet, das die App schon
  // benutzt hat, bevor es diesen Merker gab (Update von 2.1.x auf 2.2.0).
  // Genau der Fall, fuer den die Anzeige gebaut ist.
  if (!vorher) return { art: 'zeigen', merkeVersion: jetzt };

  // Echt neuere Minor-Version -> zeigen. Gleich oder aelter -> nichts.
  // Aelter tritt beim Zurueckrollen einer Version auf (TestFlight); dann
  // soll die Anzeige NICHT kommen, der Merker aber auch nicht zurueckfallen.
  if (vergleicheVersionen(jetzt, vorher) > 0) {
    return { art: 'zeigen', merkeVersion: jetzt };
  }
  return { art: 'still', merkeVersion: null };
}
