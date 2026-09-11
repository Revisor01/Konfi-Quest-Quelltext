// Kennzahlen fuer den Kopf der Materialseite (AdminMaterialPage).
//
// Eintraege aus einem aelteren Offline-Cache koennen link_url gar nicht
// haben -- fehlend zaehlt wie leer, also "kein Link", nie ein Fehler.

export interface MaterialFuerStats {
  file_count?: number;
  link_url?: string | null;
}

export interface MaterialKennzahlen {
  material: number;
  dateien: number;
  links: number;
}

export const materialStats = (materials: MaterialFuerStats[]): MaterialKennzahlen => ({
  material: materials.length,
  dateien: materials.reduce((sum, m) => sum + (m.file_count || 0), 0),
  links: materials.filter((m) => !!m.link_url).length,
});
