export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Sie war toter Code — kein Aufrufer im gesamten Frontend — und hatte
// dieselben Fehler wie die Backend-Fassung: Kapitel 1-50 und Vers 1-30 blind
// gewuerfelt, unabhaengig vom Buch ("Ruth47,29" gibt es nicht), dazu eine
// unvollstaendige Buchliste ohne Ordnungszahlen.
//
// Passwoerter werden ausschliesslich im Backend erzeugt
// (utils/passwordUtils.js, jetzt gegen die echte Verszaehlung). Eine zweite
// Fassung im Frontend waere eine zweite Wahrheit, die wieder auseinanderlaeuft.

export const filterByJahrgang = <T extends { jahrgang?: string }>(items: T[], selectedJahrgang: string): T[] => {
  if (selectedJahrgang === 'alle' || !selectedJahrgang) {
    return items;
  }
  return items.filter(item => item.jahrgang === selectedJahrgang);
};

export const filterBySearchTerm = <T>(
  items: T[],
  searchTerm: string,
  searchFields: string[] = ['name']
): T[] => {
  if (!searchTerm) return items;

  const lowerSearch = searchTerm.toLowerCase();
  return items.filter(item =>
    searchFields.some(field => {
      // Der Aufrufer gibt die Feldnamen als Strings mit; welche Felder T hat,
      // ist hier nicht bekannt. Deshalb wird der Wert gelesen und eingeengt,
      // statt den Typparameter zu verschaerfen.
      const wert = (item as Record<string, unknown>)[field];
      return typeof wert === 'string' && wert.toLowerCase().includes(lowerSearch);
    })
  );
};
