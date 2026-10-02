/**
 * Großschreibung im Chat-Eingabefeld — nach jedem Tastendruck mit dem ganzen
 * Text aufgerufen; geprüft wird nur das zuletzt getippte Zeichen.
 *
 * Die Handy-Tastatur kann über autocapitalize="sentences" selbst
 * großschreiben; das liegt beim Betriebssystem, nicht hier.
 */
export const autoCapitalize = (value: string): string => {
  if (!value) return '';

  const newChar = value.slice(-1);
  if (newChar === newChar.toUpperCase() || !/[a-zäöü]/.test(newChar)) {
    return value;
  }

  const before = value.slice(0, -1);
  const atStart = before.trim().length === 0;
  const afterSentenceEnd = /[.!?]\s+$/.test(before);

  if (atStart || afterSentenceEnd) {
    return before + newChar.toUpperCase();
  }

  return value;
};
