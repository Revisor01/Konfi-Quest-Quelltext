// useBetriebsstatus — liest Mindestversion und Wartungshinweis aus
// services/betriebsstatus. Nur lesen: Die Pruefung selbst haengt EINMAL in
// App.tsx (beobachteBetriebsstatus); der Mindestversions-Hinweis und die
// Wartungshinweise auf mehreren Seiten teilen denselben Stand und loesen
// keine eigenen Anfragen aus.

import { useSyncExternalStore } from 'react';
import {
  abonniereBetriebsstatus,
  holeBetriebsstatus,
  Betriebsstatus,
} from '../services/betriebsstatus';

export function useBetriebsstatus(): Betriebsstatus {
  return useSyncExternalStore(abonniereBetriebsstatus, holeBetriebsstatus);
}
