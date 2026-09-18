import { ICON_FINGERABDRUCK, ICON_SCANNEN, ICON_SPERRE } from './icons';
import type { BiometrieSinnbild } from '../../services/biometrics';

// ---------------------------------------------------------------------------
// Biometrie: EIN Symbol je erkanntem Verfahren, an EINER Stelle.
//
// IM ZWEIFEL DAS SCHLOSS, NIE DER FINGER. Ein falsches Symbol legt die falsche
// Geste nahe: Wer ein Fingerabdruck-Symbol sieht und das Gesicht hinhalten
// soll, haelt das fuer einen Fehler der App. Ein neutrales Schloss sagt
// weniger, aber nichts Falsches.
//
// Warum eine eigene Datei und nicht icons.ts: Dort stehen ausschliesslich
// ICON_*-Konstanten, und genau das prueft zentraleIcons.test.ts — eine
// Hilfsfunktion dazwischen wuerde die Regel aufweichen.
//
// ZUM GESICHTS-SYMBOL: Ionicons hat kein eigenes Face-ID-Glyph. Der Rahmen mit
// den vier Ecken (ICON_SCANNEN) ist das gelaeufige Sinnbild dafuer und traegt
// hier dieselbe Bedeutung wie auf dem Systemdialog.
// ---------------------------------------------------------------------------

/** Das Symbol zum erkannten Verfahren. Ohne Auskunft: das neutrale Schloss. */
export const biometrieIcon = (sinnbild: BiometrieSinnbild | undefined): string => {
  switch (sinnbild) {
    case 'gesicht': return ICON_SCANNEN;
    case 'finger': return ICON_FINGERABDRUCK;
    default: return ICON_SPERRE;
  }
};
