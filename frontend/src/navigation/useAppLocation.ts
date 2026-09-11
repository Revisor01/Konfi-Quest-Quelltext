import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

// Einziger Zugriff der App auf den Standort des Routers.
//
// Neun Dateien importierten `useLocation` direkt aus react-router-dom — der
// letzte ungeschuetzte Direktzugriff. Nach diesem Hook importiert ausserhalb
// von src/navigation/ keine einzige Datei mehr react-router. Beim naechsten
// Router-Wechsel (nach Ionic 8 -> 9 kommt irgendwann der uebernaechste) ist
// dieses Verzeichnis die einzige Stelle, die angefasst werden muss.
//
// Die Form ist in react-router 5 und 6 identisch — der Hook kostet heute
// nichts und spart spaeter neun Aenderungen.

export interface AppLocation {
  pathname: string;
  search: string;
  state: unknown;
}

// DAS ERGEBNIS MUSS STABIL SEIN.
//
// Hier stand ein blankes `return { ... }`. Das erzeugt bei JEDEM Render ein
// neues Objekt; React vergleicht Abhaengigkeiten per Identitaet, also galt es
// jedes Mal als geaendert. Ein `useEffect(..., [location])` lief damit
// endlos: Effekt -> Zustand gesetzt -> Render -> "neues" location -> Effekt.
//
// GEMESSEN auf /register?code=...: 799 Aufrufe von validate-invite in 15
// Sekunden (rund 53 pro Sekunde). Die Seite flackerte, niemand konnte sich
// registrieren. Ohne Code in der Adresse blieb es unsichtbar -- dort steigt
// der Effekt vorher aus.
//
// useMemo an den beiden Feldern, die sich wirklich aendern koennen. `state`
// haengt mit dran; es wechselt nur zusammen mit einem der beiden.
export const useAppLocation = (): AppLocation => {
  const loc = useLocation();
  return useMemo(
    () => ({ pathname: loc.pathname, search: loc.search, state: loc.state }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loc.state ist
    // bewusst keine Abhaengigkeit: Der Router erzeugt es beim Navigieren neu,
    // und genau das wuerde die Stabilitaet wieder aufheben.
    [loc.pathname, loc.search]
  );
};
