// Antwort von GET /teamer/badges in EINE Form bringen.
//
// Hintergrund: Die Route wurde am 28.08. von einem Array auf die
// Konfi-Form { available, earned, stats } umgestellt. Die ausgelieferten Apps
// (iOS 2.0.0 / Android versionCode 81) rufen darauf `.filter()` auf — auf einem
// Objekt wirft das einen TypeError, das Teamer-Dashboard stuerzte sofort nach
// dem Login ab. Deshalb liefert die Route wieder ein Array plus Kopfzeilen.
//
// Diese Oberflaeche liest BEIDE Formen: das Array von heute und die Objektform,
// falls die Route spaeter versioniert umgestellt wird. So bricht keine Seite,
// egal welche Fassung antwortet — und alte Eintraege im Zwischenspeicher
// (flaches Array) werden ebenfalls verstanden.

export interface TeamerBadgeBasis {
  id: number;
  earned?: boolean;
  is_hidden?: boolean;
  unreachable?: boolean;
}

export interface TeamerBadgeNormalisiert<T extends TeamerBadgeBasis> {
  available: T[];
  earned: T[];
  stats: { totalVisible: number; totalSecret: number };
}

export function normalisiereTeamerBadges<T extends TeamerBadgeBasis>(
  daten: unknown,
  headers?: Record<string, unknown>
): TeamerBadgeNormalisiert<T> {
  const leer = { available: [] as T[], earned: [] as T[], stats: { totalVisible: 0, totalSecret: 0 } };
  if (!daten) return leer;

  // Objektform: unveraendert durchreichen, fehlende Teile auffuellen.
  if (!Array.isArray(daten)) {
    const o = daten as Partial<TeamerBadgeNormalisiert<T>>;
    if (!Array.isArray(o.available) && !Array.isArray(o.earned)) return leer;
    return {
      available: o.available ?? [],
      earned: o.earned ?? [],
      stats: o.stats ?? { totalVisible: 0, totalSecret: 0 },
    };
  }

  // Array-Form: aufteilen wie es das Backend tut.
  const liste = daten as T[];
  const earned = liste.filter(b => b.earned);
  const available = liste.filter(b => !b.earned && !b.is_hidden && !b.unreachable);

  // Zahlen stehen in den Kopfzeilen; fehlen sie, aus der Liste rechnen.
  const zahl = (name: string): number | null => {
    const roh = headers?.[name];
    const n = Number(roh);
    return Number.isFinite(n) ? n : null;
  };
  const totalSecret = zahl('x-badges-secret-total') ?? liste.filter(b => b.is_hidden).length;
  const totalVisible = zahl('x-badges-visible-total') ?? liste.filter(b => !b.is_hidden).length;

  return { available, earned, stats: { totalVisible, totalSecret } };
}
