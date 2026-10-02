import api from './api';
import { offlineCache, CACHE_TTL } from './offlineCache';
import { netzZuerstLaden, type NetzZuerstErgebnis } from './netzZuerst';
import { medienVergessen } from './mediaCache';

// Material-Dateien liegen seitdem im Medien-Cache (Quelle 'material'). Was die
// Leitung löscht, darf danach nicht aus dem Speicher eines Geräts weiter
// auftauchen:
//  - Wer löscht, räumt sein Gerät sofort (materialVergessen, und
//    medienVergessen für eine einzelne Datei).
//  - Alle anderen Geräte räumen beim nächsten Öffnen des Materials: Das Detail
//    kommt erst vom Server (netzZuerst, wie bei den Challenge-Beiträgen), und
//    was der zuletzt gemerkte Stand noch führte, der Server aber nicht mehr,
//    fliegt vom Gerät. Meldet der Server das Material als weg (403/404), gehen
//    alle seine Dateien und der gemerkte Stand.
// Bewusst nicht "gemerkter Stand zuerst" (useOfflineQuery): Eine gelöschte
// Datei stünde dann nach dem Öffnen kurz wieder in der Liste — und öffnete
// sich aus dem Cache.

/** Was hier von einer Datei gebraucht wird. */
export interface MaterialDateiVerweis {
  stored_name: string;
}

/** Der zuletzt geladene Stand eines Materials im offlineCache. */
export const materialDetailSchluessel = (id: number): string => `teamer:material-detail:${id}`;

/** Wirft vom Gerät, was `vorher` führte und `jetzt` nicht mehr. */
export async function materialDateienAbgleichen(
  vorher: MaterialDateiVerweis[] | null | undefined,
  jetzt: MaterialDateiVerweis[] | null | undefined
): Promise<void> {
  const bleiben = new Set((jetzt || []).map((d) => d.stored_name));
  for (const d of vorher || []) {
    if (!bleiben.has(d.stored_name)) await medienVergessen(d.stored_name, 'material');
  }
}

const gemerkteDateien = async (id: number): Promise<MaterialDateiVerweis[]> => {
  const eintrag = await offlineCache.get<{ files?: MaterialDateiVerweis[] }>(materialDetailSchluessel(id)).catch(() => null);
  return eintrag?.data?.files || [];
};

/**
 * Das Detail eines Materials: erst der Server, den gemerkten Stand nur ohne
 * Netz (Rückgriff wie netzZuerstLaden). Dateien, die der Server nicht mehr
 * führt, gehen dabei vom Gerät.
 */
export async function materialDetailLaden<T extends { files?: MaterialDateiVerweis[] }>(
  id: number
): Promise<NetzZuerstErgebnis<T>> {
  const vorher = await gemerkteDateien(id);
  try {
    const ergebnis = await netzZuerstLaden<T>(
      materialDetailSchluessel(id),
      () => api.get(`/material/${id}`).then((r) => r.data as T),
      CACHE_TTL.PROFILE
    );
    if (!ergebnis.ausSpeicher) await materialDateienAbgleichen(vorher, ergebnis.daten.files);
    return ergebnis;
  } catch (fehler) {
    const status = (fehler as { response?: { status?: number } })?.response?.status;
    if (status === 403 || status === 404) await materialVergessen(id);
    throw fehler;
  }
}

/**
 * Ein gelöschtes (oder nicht mehr sichtbares) Material vom Gerät nehmen: die
 * genannten Dateien, die des gemerkten Stands und den Stand selbst.
 */
export async function materialVergessen(id: number, dateien: MaterialDateiVerweis[] = []): Promise<void> {
  await materialDateienAbgleichen([...dateien, ...(await gemerkteDateien(id))], []);
  await offlineCache.remove(materialDetailSchluessel(id)).catch(() => undefined);
}
