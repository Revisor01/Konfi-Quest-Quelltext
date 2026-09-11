import type React from 'react';
import { BAEUME } from './rollenBaeume';

// Routen, Tabs und Umleitungen als DATEN — eine Quelle für alle drei Rollen.
//
// Jetzt rendert EIN Renderer (RoleTabs) aus dieser Tabelle. Eine neue Route
// hier gilt zwangsläufig für ihre Rolle, und der Test in
// __tests__/navigation/ iteriert über dieselbe Tabelle: Was hier steht, wird
// automatisch geprüft — keine Rolle kann vergessen werden.
//
// Zweiter Zweck: Beim Wechsel des Routers (Ionic 8 -> 9 bedeutet
// react-router 5 -> 6, das nächste Mal wieder etwas anderes) ändert sich nur
// der Renderer, nicht 68 einzelne JSX-Stellen.

export type Rolle = 'admin' | 'teamer' | 'konfi' | 'super_admin';

/** Welcher Zähler am Tab hängt. Die Werte kommen aus dem BadgeContext. */
export type BadgeKey = 'chat' | 'events' | 'challenges' | 'badges';

/**
 * Eine Route. Entweder ohne Parameter, oder mit — dann gehören `param` (wie
 * er in der URL heißt) und `propName` (wie die Seite ihn erwartet) zusammen.
 * Der Typ erzwingt das Paar: eines ohne das andere wäre eine Seite, die ihren
 * Parameter nie bekommt.
 *
 * Ausnahme sind Seiten, die sich den Wert selbst per useParams holen — die
 * tragen schlicht keines von beidem.
 */
export type RouteDef =
  | {
      /** Pfad wie er in der URL steht — der Vertrag nach außen. */
      path: string;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
      Props sind kontravariant: Eine Tabelle, die Seiten mit UND ohne
      Parameter-Props traegt, laesst sich nur ueber any gemeinsam typisieren
      (ComponentType<Record<string, unknown>> nimmt die spezielleren Seiten
      gerade nicht an). Dass Route und Props zusammenpassen, sichert
      stattdessen __tests__/navigation/. */
      page: React.ComponentType<any>;
      param?: undefined;
      propName?: undefined;
    }
  | {
      path: string;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
      Props sind kontravariant: Eine Tabelle, die Seiten mit UND ohne
      Parameter-Props traegt, laesst sich nur ueber any gemeinsam typisieren
      (ComponentType<Record<string, unknown>> nimmt die spezielleren Seiten
      gerade nicht an). Dass Route und Props zusammenpassen, sichert
      stattdessen __tests__/navigation/. */
      page: React.ComponentType<any>;
      /** Name des Parameters in der URL. */
      param: 'id' | 'roomId';
      /** Unter welchem Prop-Namen die Seite den Wert erwartet (als Zahl). */
      propName: 'konfiId' | 'eventId' | 'roomId';
    };

export interface RedirectDef {
  from: string;
  to: string;
}

export interface TabDef {
  tab: string;
  href: string;
  icon: string;
  label: string;
  badge?: BadgeKey;
}

export interface RollenBaum {
  /** Wohin nach dem Anmelden und von "/" bzw. "/login". */
  home: string;
  routes: RouteDef[];
  redirects: RedirectDef[];
  tabs: TabDef[];
}

/**
 * Startseite je Rolle. Stand vorher viermal ausgeschrieben (LoginView,
 * OrgSwitcherButton und zweimal in pushNavigation) — jede Kopie eine
 * Gelegenheit, eine Rolle zu vergessen.
 */
export const rollenStart = (rolle: Rolle): string => BAEUME[rolle].home;

/** Tab-Leiste verstecken: in Chat-Räumen aller Rollen. */
export const istTabLeisteVersteckt = (pfad: string): boolean =>
  /^\/(admin|teamer|konfi)\/chat\/room\//.test(pfad);

// Die Bäume stehen in rollenBaeume.ts — dort, wo auch die Seiten importiert
// werden. Diese Datei traegt nur Typen und Helfer.
export { BAEUME };
