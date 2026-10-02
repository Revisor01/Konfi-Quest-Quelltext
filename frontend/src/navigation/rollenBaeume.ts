import { lazy } from 'react';
import type React from 'react';
import {
  ICON_CHALLENGE_GEFUELLT,
  ICON_CHATS_GEFUELLT,
  ICON_DATEI_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_MEHR,
  ICON_STARTSEITE_GEFUELLT,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
} from '../components/shared/icons';
import type { Rolle, RollenBaum } from './routes';

// Code-Splitting entlang der Rollen: Jede Seite wird per
// React.lazy erst geladen, wenn ihre Route erstmals rendert. Ein Konfi laedt
// damit nicht mehr die komplette Leitungsoberflaeche (52 Dateien, ~25.000
// Zeilen) mit, die er nie sieht. Vorher lag ALLES in einem Einstiegs-Bundle
// von ~3 MB (715 kB gepackt).
//
// faul() merkt sich zu jeder lazy-Seite ihren Lade-Thunk, damit
// ladeRolleVor() alle Seiten einer Rolle im Hintergrund NACHLADEN kann
// (MainTabs stoesst das kurz nach dem Start an). Das ist die
// Offline-Versicherung: Ist eine Seite einmal importiert, haelt die
// Modul-Registry sie im Speicher — ein spaeterer Tab-Wechsel braucht dann
// KEIN Netz mehr. Ohne das waere eine noch nie besuchte Seite offline
// unerreichbar (die App hat keinen Service Worker; nativ kommen die Chunks
// ohnehin aus dem App-Bundle von der Platte).

/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
Props sind kontravariant: Eine Tabelle, die Seiten mit UND ohne
Parameter-Props traegt, laesst sich nur ueber any gemeinsam typisieren
(ComponentType<Record<string, unknown>> nimmt die spezielleren Seiten
gerade nicht an). Dass Route und Props zusammenpassen, sichert
stattdessen __tests__/navigation/. */
type Lader = () => Promise<{ default: React.ComponentType<any> }>;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
Props sind kontravariant: Eine Tabelle, die Seiten mit UND ohne
Parameter-Props traegt, laesst sich nur ueber any gemeinsam typisieren
(ComponentType<Record<string, unknown>> nimmt die spezielleren Seiten
gerade nicht an). Dass Route und Props zusammenpassen, sichert
stattdessen __tests__/navigation/. */
const LADER = new Map<React.ComponentType<any>, Lader>();

// Ein fehlgeschlagener lazy-Import bleibt in React DAUERHAFT kaputt (die
// Huelle merkt sich die Ablehnung bis zum Reload). Ein kurzer Funkabriss im
// falschen Moment wuerde die Route fuer die ganze Sitzung sperren — darum
// ein zweiter Versuch nach kurzer Pause, bevor der Fehler durchschlaegt.
const mitZweitversuch = (lade: Lader): Lader => async () => {
  try {
    return await lade();
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return lade();
  }
};

/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
Props sind kontravariant: Eine Tabelle, die Seiten mit UND ohne
Parameter-Props traegt, laesst sich nur ueber any gemeinsam typisieren
(ComponentType<Record<string, unknown>> nimmt die spezielleren Seiten
gerade nicht an). Dass Route und Props zusammenpassen, sichert
stattdessen __tests__/navigation/. */
const faul = (lade: Lader): React.ComponentType<any> => {
  const laden = mitZweitversuch(lade);
  const Seite = lazy(laden);
  LADER.set(Seite, laden);
  return Seite;
};

// Welche Seiten-Chunks bereits im Speicher sind. MainTabs fragt das ab, um
// eine schon geladene Seite OHNE Umweg ueber einen Ladezustand zu rendern —
// sonst blitzt bei jedem Tab-Wechsel kurz der Spinner auf.
/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
Dieselbe Menge wie bei LADER: Sie haelt genau die Komponenten, die `faul`
erzeugt, und traegt deshalb denselben Typ. Begruendung siehe oben. */
const GELADEN = new Set<React.ComponentType<any>>();

/** Ist der Chunk dieser Seite schon da? */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
Props sind kontravariant, siehe Begruendung an LADER. */
export const istGeladen = (seite: React.ComponentType<any>): boolean => GELADEN.has(seite);

/**
 * Laedt den Chunk EINER Seite und merkt sich das.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
Props sind kontravariant, siehe Begruendung an LADER. */
export const ladeSeite = async (seite: React.ComponentType<any>): Promise<void> => {
  if (GELADEN.has(seite)) return;
  const lader = LADER.get(seite);
  if (!lader) {
    // Keine lazy-Seite (etwa in Tests direkt hineingereicht) -> nichts zu laden.
    GELADEN.add(seite);
    return;
  }
  try {
    await lader();
    GELADEN.add(seite);
  } catch {
    // Offline oder Funkabriss: nicht vermerken, der naechste Aufruf versucht
    // es wieder. mitZweitversuch() hat bereits einmal nachgefasst.
  }
};

/** Nur fuer Tests: Ist diese Seite per ladeRolleVor() vorladbar? */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
Props sind kontravariant: Eine Tabelle, die Seiten mit UND ohne
Parameter-Props traegt, laesst sich nur ueber any gemeinsam typisieren
(ComponentType<Record<string, unknown>> nimmt die spezielleren Seiten
gerade nicht an). Dass Route und Props zusammenpassen, sichert
stattdessen __tests__/navigation/. */
export const hatLader = (seite: React.ComponentType<any>): boolean => LADER.has(seite);

/**
 * Laedt alle Seiten einer Rolle im Hintergrund nach (dedupliziert).
 * Liefert die Zahl der erfolgreich geladenen Module — Fehler (z.B. kein
 * Netz) werden geschluckt: Dann laedt die Seite eben beim ersten Besuch.
 */
export const ladeRolleVor = async (rolle: Rolle): Promise<number> => {
  const lader = new Set<Lader>();
  for (const route of BAEUME[rolle].routes) {
    const l = LADER.get(route.page);
    if (l) lader.add(l);
  }
  const ergebnisse = await Promise.allSettled([...lader].map((l) => l()));
  // Vorgeladene Seiten als geladen vermerken, damit der Renderer sie ohne
  // Ladezustand einhaengt.
  for (const route of BAEUME[rolle].routes) {
    if (LADER.has(route.page)) GELADEN.add(route.page);
  }
  return ergebnisse.filter((e) => e.status === 'fulfilled').length;
};

const AdminKonfisPage = faul(() => import('../components/admin/pages/AdminKonfisPage'));
const AdminActivitiesPage = faul(() => import('../components/admin/pages/AdminActivitiesPage'));
const AdminEventsPage = faul(() => import('../components/admin/pages/AdminEventsPage'));
const AdminCategoriesPage = faul(() => import('../components/admin/pages/AdminCategoriesPage'));
const AdminJahrgaengeePage = faul(() => import('../components/admin/pages/AdminJahrgaengeePage'));
const AdminBadgesPage = faul(() => import('../components/admin/pages/AdminBadgesPage'));
const AdminUsersPage = faul(() => import('../components/admin/pages/AdminUsersPage'));
const AdminOrganizationsPage = faul(() => import('../components/admin/pages/AdminOrganizationsPage'));
const AdminMetricsPage = faul(() => import('../components/admin/pages/AdminMetricsPage'));
const AdminProfilePage = faul(() => import('../components/admin/pages/AdminProfilePage'));
const AdminSettingsPage = faul(() => import('../components/admin/pages/AdminSettingsPage'));
const AdminMaterialPage = faul(() => import('../components/admin/pages/AdminMaterialPage'));
const AdminWrappedPage = faul(() => import('../components/admin/pages/AdminWrappedPage'));
const AdminCertificatesPage = faul(() => import('../components/admin/pages/AdminCertificatesPage'));
const AdminDashboardSettingsPage = faul(() => import('../components/admin/pages/AdminDashboardSettingsPage'));
const AdminLevelsPage = faul(() => import('../components/admin/pages/AdminLevelsPage'));
const AdminInvitePage = faul(() => import('../components/admin/pages/AdminInvitePage'));
const AdminChallengesPage = faul(() => import('../components/admin/pages/AdminChallengesPage'));
const ChatOverviewPage = faul(() => import('../components/chat/pages/ChatOverviewPage'));
const ChatRoomView = faul(() => import('../components/chat/views/ChatRoomView'));
const KonfiDetailView = faul(() => import('../components/admin/views/KonfiDetailView'));
const EventDetailView = faul(() => import('../components/admin/views/EventDetailView'));
const KonfiDashboardPage = faul(() => import('../components/konfi/pages/KonfiDashboardPage'));
const KonfiEventsPage = faul(() => import('../components/konfi/pages/KonfiEventsPage'));
const KonfiEventDetailPage = faul(() => import('../components/konfi/pages/KonfiEventDetailPage'));
const KonfiBadgesPage = faul(() => import('../components/konfi/pages/KonfiBadgesPage'));
const KonfiChallengesPage = faul(() => import('../components/konfi/pages/KonfiChallengesPage'));
const KonfiProfilePage = faul(() => import('../components/konfi/pages/KonfiProfilePage'));
const TeamerDashboardPage = faul(() => import('../components/teamer/pages/TeamerDashboardPage'));
const TeamerEventsPage = faul(() => import('../components/teamer/pages/TeamerEventsPage'));
const TeamerMaterialPage = faul(() => import('../components/teamer/pages/TeamerMaterialPage'));
const TeamerProfilePage = faul(() => import('../components/teamer/pages/TeamerProfilePage'));
const TeamerBadgesPage = faul(() => import('../components/teamer/pages/TeamerBadgesPage'));
const TeamerKonfiStatsPage = faul(() => import('../components/teamer/pages/TeamerKonfiStatsPage'));
const TeamerChallengesPage = faul(() => import('../components/teamer/pages/TeamerChallengesPage'));

// Die drei Rollenbäume als Tabelle. Reihenfolge der Routen ist bedeutsam:
// spezifischere Pfade (/admin/events/:id) müssen VOR den allgemeineren
// stehen, sonst greift der falsche — das galt schon in der JSX-Fassung.

export const BAEUME: Record<Rolle, RollenBaum> = {
  admin: {
    home: '/admin/konfis',
    routes: [
      { path: '/admin/konfis', page: AdminKonfisPage },
      { path: '/admin/konfis/:id', page: KonfiDetailView, param: 'id', propName: 'konfiId' },
      { path: '/admin/chat', page: ChatOverviewPage },
      { path: '/admin/chat/room/:roomId', page: ChatRoomView, param: 'roomId', propName: 'roomId' },
      { path: '/admin/activities', page: AdminActivitiesPage },
      { path: '/admin/events/:id', page: EventDetailView, param: 'id', propName: 'eventId' },
      { path: '/admin/events', page: AdminEventsPage },
      { path: '/admin/settings/categories', page: AdminCategoriesPage },
      { path: '/admin/settings/jahrgaenge', page: AdminJahrgaengeePage },
      { path: '/admin/settings/levels', page: AdminLevelsPage },
      { path: '/admin/settings/invite', page: AdminInvitePage },
      { path: '/admin/settings/certificates', page: AdminCertificatesPage },
      { path: '/admin/settings/dashboard', page: AdminDashboardSettingsPage },
      { path: '/admin/settings', page: AdminSettingsPage },
      { path: '/admin/badges', page: AdminBadgesPage },
      { path: '/admin/challenges', page: AdminChallengesPage },
      { path: '/admin/users', page: AdminUsersPage },
      { path: '/admin/organizations', page: AdminOrganizationsPage },
      { path: '/admin/material', page: AdminMaterialPage },
      { path: '/admin/wrapped', page: AdminWrappedPage },
      { path: '/admin/profile', page: AdminProfilePage },
      // Auch im normalen Admin-Outlet: super_admins haben meist
      // role_name=org_admin (is_super_admin=true). Die Seite prüft die
      // Berechtigung serverseitig (403 für nicht-super-admins).
      { path: '/admin/metrics', page: AdminMetricsPage },
    ],
    redirects: [
      { from: '/admin', to: '/admin/konfis' },
      // Aktivitäten sind ein Segment im Mitmachen-Tab. Die alte Route bleibt
      // wegen bestehender Deep-Links aus Push-Nachrichten erhalten.
      { from: '/admin/requests', to: '/admin/events?segment=antraege' },
    ],
    tabs: [
      { tab: 'admin-konfis', href: '/admin/konfis', icon: ICON_GRUPPE_GEFUELLT, label: 'Konfis' },
      { tab: 'admin-chat', href: '/admin/chat', icon: ICON_CHATS_GEFUELLT, label: 'Chat', badge: 'chat' },
      // Kalender wie bei Teamer und Konfi: Derselbe Reiter
      // trug bei der Leitung einen Blitz, bei den anderen beiden einen
      // Kalender -- gleiche Beschriftung, anderes Zeichen.
      { tab: 'admin-events', href: '/admin/events', icon: ICON_TERMIN_GEFUELLT, label: 'Mitmachen', badge: 'events' },
      { tab: 'admin-challenges', href: '/admin/challenges', icon: ICON_CHALLENGE_GEFUELLT, label: 'Challenges', badge: 'challenges' },
      { tab: 'admin-settings', href: '/admin/settings', icon: ICON_MEHR, label: 'Mehr' },
    ],
  },

  teamer: {
    home: '/teamer/dashboard',
    routes: [
      { path: '/teamer/dashboard', page: TeamerDashboardPage },
      { path: '/teamer/chat', page: ChatOverviewPage },
      { path: '/teamer/chat/room/:roomId', page: ChatRoomView, param: 'roomId', propName: 'roomId' },
      { path: '/teamer/events', page: TeamerEventsPage },
      { path: '/teamer/material', page: TeamerMaterialPage },
      { path: '/teamer/badges', page: TeamerBadgesPage },
      { path: '/teamer/challenges', page: TeamerChallengesPage },
      { path: '/teamer/profile/badges', page: TeamerBadgesPage },
      { path: '/teamer/profile/material', page: TeamerMaterialPage },
      { path: '/teamer/profile/konfi-stats', page: TeamerKonfiStatsPage },
      { path: '/teamer/profile', page: TeamerProfilePage },
    ],
    redirects: [
      { from: '/teamer', to: '/teamer/dashboard' },
      { from: '/teamer/requests', to: '/teamer/events?segment=antraege' },
      // Termin-Detail fuer Teamer:innen. Ihre Detailansicht
      // lebt IN der Terminliste (TeamerEventsPage, selectedEvent) und wird
      // dort seit jeher ueber ?eventId= geoeffnet -- so springt das
      // Dashboard hinein. Die Termin-Pushes bauen dagegen fuer alle Rollen
      // /<rolle>/events/<id>; ohne diese Route fiel der Link in den Catch-all
      // und landete auf dem Dashboard, schlechter noch als die Liste. Der
      // Platzhalter :id wird beim Umleiten aus der URL gefuellt (MainTabs,
      // Umleitung). Kein zweites Termin-Detail: Eine eigene Seite unter
      // dieser Route haette die 1.900 Zeilen Detailansicht dupliziert oder
      // die Liste zweimal montiert.
      { from: '/teamer/events/:id', to: '/teamer/events?eventId=:id' },
    ],
    tabs: [
      { tab: 'teamer-dashboard', href: '/teamer/dashboard', icon: ICON_STARTSEITE_GEFUELLT, label: 'Start' },
      { tab: 'teamer-chat', href: '/teamer/chat', icon: ICON_CHATS_GEFUELLT, label: 'Chat', badge: 'chat' },
      // Reihenfolge wie beim Konfi: Challenges vor
      // Mitmachen -- beide Rollen sollen dieselbe Tab-Folge haben.
      { tab: 'teamer-challenges', href: '/teamer/challenges', icon: ICON_CHALLENGE_GEFUELLT, label: 'Challenges', badge: 'challenges' },
      { tab: 'teamer-events', href: '/teamer/events', icon: ICON_TERMIN_GEFUELLT, label: 'Mitmachen' },
      // Material in der Tab-Leiste, Badges dafuer im Profil:
      // Material braucht das Team im Alltag, Badges schaut man
      // gelegentlich an.
      { tab: 'teamer-material', href: '/teamer/profile/material', icon: ICON_DATEI_GEFUELLT, label: 'Material' },
    ],
  },

  konfi: {
    home: '/konfi/dashboard',
    routes: [
      { path: '/konfi/dashboard', page: KonfiDashboardPage },
      { /* Holt sich die id selbst per useParams — kein propName noetig. */
        path: '/konfi/events/:id', page: KonfiEventDetailPage },
      { path: '/konfi/events', page: KonfiEventsPage },
      { path: '/konfi/badges', page: KonfiBadgesPage },
      { path: '/konfi/challenges', page: KonfiChallengesPage },
      { path: '/konfi/chat', page: ChatOverviewPage },
      { path: '/konfi/chat/room/:roomId', page: ChatRoomView, param: 'roomId', propName: 'roomId' },
      { path: '/konfi/profile', page: KonfiProfilePage },
    ],
    redirects: [
      { from: '/konfi', to: '/konfi/dashboard' },
      { from: '/konfi/requests', to: '/konfi/events?segment=antraege' },
    ],
    tabs: [
      { tab: 'dashboard', href: '/konfi/dashboard', icon: ICON_STARTSEITE_GEFUELLT, label: 'Start' },
      { tab: 'chat', href: '/konfi/chat', icon: ICON_CHATS_GEFUELLT, label: 'Chat', badge: 'chat' },
      { tab: 'challenges', href: '/konfi/challenges', icon: ICON_CHALLENGE_GEFUELLT, label: 'Challenges', badge: 'challenges' },
      { tab: 'events', href: '/konfi/events', icon: ICON_TERMIN_GEFUELLT, label: 'Mitmachen' },
      { tab: 'badges', href: '/konfi/badges', icon: ICON_ABZEICHEN_GEFUELLT, label: 'Badges', badge: 'badges' },
    ],
  },

  // Super-Admins bekommen nur die Organisations-Verwaltung, ohne Tab-Leiste.
  super_admin: {
    home: '/admin/organizations',
    routes: [
      { path: '/admin/organizations', page: AdminOrganizationsPage },
      { path: '/admin/metrics', page: AdminMetricsPage },
    ],
    redirects: [{ from: '/admin', to: '/admin/organizations' }],
    tabs: [],
  },
};
