import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { BAEUME, ladeRolleVor } from './rollenBaeume';
import type { Rolle } from './routes';

// Ist der Seitenbaum der angemeldeten Rolle bereit, um den Router zu montieren?
//
// Deshalb faellt die Entscheidung "warten oder rendern" VOR dem Router:
// App.tsx montiert den IonReactRouter erst, wenn hier `true` steht. Das
// Outlet sieht dadurch von Anfang an den endgueltigen Baum.
//
// Dass gewartet werden MUSS, ist nachgesehen: ladeRolleVor() wartet auf
// dynamische Importe (rollenBaeume.ts, `await Promise.allSettled`) und kommt
// fruehestens einen Microtask spaeter zurueck.

/** Rolle aus dem angemeldeten Konto ableiten — dieselbe Regel wie in MainTabs. */
export const rolleVonUser = (
  user: { type?: string; role_name?: string } | null | undefined,
  istSuperAdmin: boolean
): Rolle => {
  if (istSuperAdmin) return 'super_admin';
  if (user?.type === 'admin') return 'admin';
  if (user?.type === 'teamer') return 'teamer';
  return 'konfi';
};

/**
 * Liefert true, sobald die Seiten der aktuellen Rolle geladen sind.
 * Ohne angemeldetes Konto ist das Ergebnis false — dann gibt es keinen
 * Seitenbaum, auf den sich der Router stuetzen koennte.
 */
export function useSeitenBereit(): boolean {
  const { user } = useApp();
  const istSuperAdmin = user?.role_name === 'super_admin';
  const rolle = rolleVonUser(user, istSuperAdmin);
  const [bereit, setBereit] = useState(false);

  useEffect(() => {
    if (!user) { setBereit(false); return; }
    let abgebrochen = false;
    // Kein Zuruecksetzen auf false beim Rollenwechsel: Der Router bleibt
    // montiert, MainTabs tauscht seinen Baum ueber key={rolle} selbst aus.
    void ladeRolleVor(rolle).finally(() => {
      if (!abgebrochen) setBereit(true);
    });
    return () => { abgebrochen = true; };
  }, [rolle, user?.id]);

  return bereit;
}

/** Nur fuer Tests: Gibt es fuer diese Rolle ueberhaupt einen Baum? */
export const hatBaum = (rolle: Rolle): boolean => Boolean(BAEUME[rolle]);

export default useSeitenBereit;
