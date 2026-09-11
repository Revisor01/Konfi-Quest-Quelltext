import React from 'react';

/**
 * Die Motiv-Verteilung eines Rueckblicks.
 *
 * Die Verteilung entsteht EINMAL in WrappedModal (fuer alle Seiten
 * zusammen) und wird hier durchgereicht. SlideBase kann sie nicht selbst
 * berechnen -- jede Seite kennt nur sich, nicht die anderen, und koennte
 * deshalb nicht wissen, welches Motiv schon vergeben ist.
 */
export interface MotivZuweisung {
  haupt: string;
  zweit: string;
}

export const MotivKontext = React.createContext<Record<string, MotivZuweisung> | null>(null);

export const useMotive = () => React.useContext(MotivKontext);
