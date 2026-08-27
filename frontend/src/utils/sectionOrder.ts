// Reihenfolge der Dashboard-Sektionen.
//
// Organisationen speichern ihre eigene Sortierung (dashboard_section_order bzw.
// teamer_dashboard_section_order). Kommt später eine NEUE Sektion dazu, steht
// sie in diesen gespeicherten Listen natuerlich nicht drin — und weil die
// Dashboards nur über die gespeicherte Liste rendern, wäre die neue Sektion
// bei allen Bestands-Orgs unsichtbar, bis jemand die Einstellungen neu
// speichert. Deshalb wird beim Laden gemergt statt ersetzt.

/** Default-Reihenfolge der Konfi-Dashboard-Sektionen. */
export const DEFAULT_KONFI_SECTION_ORDER = [
  'konfirmation',
  'challenges',
  'konfispruch',
  'events',
  'losung',
  'badges',
  'ranking'
];

/** Default-Reihenfolge der Teamer-Dashboard-Sektionen. */
export const DEFAULT_TEAMER_SECTION_ORDER = [
  'zertifikate',
  'challenges',
  'konfispruch',
  'events',
  'badges',
  'losung'
];

/**
 * Fuehrt eine gespeicherte Sektions-Reihenfolge mit der Default-Reihenfolge
 * zusammen.
 *
 * - Die gespeicherte Sortierung des Nutzers bleibt erhalten.
 * - Keys, die nur im Default stehen (also neu hinzugekommen sind), werden an
 *   ihrer Default-Position eingefuegt: hinter dem letzten Default-Vorgaenger,
 *   der auch gespeichert ist. Steht kein Vorgaenger in der gespeicherten Liste,
 *   landet der Key vorne.
 * - Unbekannte Keys aus der gespeicherten Liste (entfernte Sektionen) werden
 *   durchgereicht; das Rendern ignoriert sie ohnehin.
 */
export const mergeSectionOrder = (
  saved: string[] | null | undefined,
  defaults: string[]
): string[] => {
  if (!Array.isArray(saved) || saved.length === 0) {
    return [...defaults];
  }

  const result = saved.filter((key) => typeof key === 'string');
  const present = new Set(result);

  defaults.forEach((key, defaultIndex) => {
    if (present.has(key)) return;

    // Letzter Default-Vorgaenger, der in der gespeicherten Liste vorkommt.
    let insertAt = 0;
    for (let i = defaultIndex - 1; i >= 0; i--) {
      const predecessor = defaults[i];
      const position = result.indexOf(predecessor);
      if (position !== -1) {
        insertAt = position + 1;
        break;
      }
    }

    result.splice(insertAt, 0, key);
    present.add(key);
  });

  return result;
};
