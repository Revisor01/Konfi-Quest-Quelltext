// Push-Tap-Navigation (Multi-Org-fähig).
//
// Jeder Push-Payload trägt seit dem Multi-Org-Ausbau eine organization_id —
// die Organisation des INHALTS. Ist die App beim Antippen auf eine andere
// Organisation geschaltet, wird VOR der Navigation über den bestehenden
// switchOrg-Flow gewechselt und erst nach abgeschlossenem Wechsel navigiert
// (window.location.href schneidet im nativen WebView sonst die asynchronen
// Preferences-Writes ab).
//
// Wichtig (String vs. Number): FCM-data-Werte sind IMMER Strings, die Org im
// Client eine Number — verglichen wird deshalb auf beiden Seiten per String().

export type PushUserType = 'admin' | 'teamer' | 'konfi' | 'user';

export interface PushOrgSwitchDeps {
  // tokenStore-Getter (frisch, KEINE Closure-Werte — der Push-Effect in
  // AppContext hat nur [user] als Dependency, Closure-Werte wären veraltet).
  getActiveOrgId: () => number | null;
  getUserOrgId: () => number | null | undefined;
  // switchOrg aus dem AppContext: liefert ok + den User-Typ in der ZIEL-Org
  // (die Rolle kann pro Organisation unterschiedlich sein).
  switchOrg: (orgId: number) => Promise<{ ok: boolean; type?: PushUserType }>;
}

/**
 * Wechselt bei Bedarf in die Organisation des Push-Inhalts und liefert den
 * User-Typ, mit dem anschliessend die Ziel-Route gebaut wird.
 *
 * Fallbacks (bewusst konservativ — heutiges Verhalten beibehalten):
 * - keine organization_id im Payload (alte Pushes während des Rollouts),
 * - aktive Org unbekannt,
 * - Wechsel schlägt fehl (offline, Mitgliedschaft entzogen).
 */
export const resolveOrgForPush = async (
  data: Record<string, unknown> | undefined,
  currentType: PushUserType,
  deps: PushOrgSwitchDeps
): Promise<PushUserType> => {
  const raw = data?.organization_id;
  if (raw === undefined || raw === null || raw === '') return currentType;

  const targetOrgId = parseInt(String(raw), 10);
  if (!Number.isInteger(targetOrgId) || targetOrgId <= 0) return currentType;

  // Aktive Org: null im tokenStore heisst "Primär-Org" -> dann zählt die
  // organization_id des Users (wird bei switchOrg auf die aktive Org gesetzt).
  const currentOrgId = deps.getActiveOrgId() ?? deps.getUserOrgId() ?? null;
  if (currentOrgId === null) return currentType;
  if (String(currentOrgId) === String(targetOrgId)) return currentType;

  try {
    const result = await deps.switchOrg(targetOrgId);
    if (result?.ok) {
      return result.type || currentType;
    }
  } catch {
    // Fehlgeschlagener Wechsel: nicht abstürzen, mit dem alten Kontext
    // navigieren (wie vor dem Multi-Org-Ausbau).
  }
  return currentType;
};

/**
 * Ziel-URL für einen angetippten Push. Reine Funktion — der userType muss
 * bereits der Typ in der ZIEL-Organisation sein (siehe resolveOrgForPush).
 * Leerer String = keine Navigation (unbekannter Typ).
 */
export const buildPushTargetUrl = (
  notificationType: string | undefined,
  data: Record<string, unknown> | undefined,
  userType: PushUserType
): string => {
  const routePrefix = userType === 'admin' ? '/admin' : userType === 'teamer' ? '/teamer' : '/konfi';

  switch (notificationType) {
    case 'chat':
      // Direkt in den Raum: Die Route ist /chat/room/:roomId — der
      // fruehere Query-Parameter (?room=) wurde von keiner Seite
      // konsumiert, der Tap landete nur auf der Chat-Übersicht.
      if (data?.roomId) {
        return `${routePrefix}/chat/room/${data.roomId}`;
      }
      return `${routePrefix}/chat`;

    case 'activity_request_status':
    case 'new_activity_request':
      return `${routePrefix}/requests`;

    case 'badge_earned':
      return `${routePrefix}/badges`;

    case 'new_event': {
      // "Anmeldung möglich"-Push: direkt zum Event-Detail, wenn die ID
      // mitkommt (Konfi hat eine Detail-Route). Sonst zur Events-Liste.
      const evId = data?.event_id || data?.eventId;
      if (evId && userType === 'konfi') {
        return `/konfi/events/${evId}`;
      }
      return `${routePrefix}/events`;
    }

    case 'event_registered':
    case 'event_unregistered':
    case 'waitlist_promotion':
    case 'event_attendance':
    case 'event_reminder':
    case 'event_cancelled':
      return `${routePrefix}/events`;

    case 'level_up':
    case 'activity_assigned':
    case 'bonus_points':
      // Dashboard (Punkte/Level)
      return userType === 'admin' ? '/admin/konfis' : `${routePrefix}/dashboard`;

    case 'event_unregistration':
    case 'events_pending_approval':
      // Admin: Event-Abmeldungen / ausstehende Verbuchungen
      return userType === 'admin' ? '/admin/events' : `${routePrefix}/events`;

    case 'new_konfi_registration':
      // Admin: neue Registrierung
      return userType === 'admin' ? '/admin/konfis' : `${routePrefix}/dashboard`;

    case 'challenge_started':
      // Neue Challenge gestartet -> Challenge-Tab des Konfi (Leitung
      // bekommt diesen Push nicht, fällt aber sauber auf ihre
      // Challenge-Verwaltung zurück).
      return `${routePrefix}/challenges`;

    case 'challenge_submission':
      // Neuer Beitrag -> Moderation in der Leitungs-Ansicht.
      return userType === 'konfi' ? '/konfi/challenges' : `${routePrefix}/challenges`;

    case 'wrapped':
      // Bestandsluecke: Das Wrapped-Modal liegt auf dem Dashboard —
      // ohne diesen Fall lief der Tap ins Leere (default-Zweig).
      return `${routePrefix}/dashboard`;


    case 'event_changed':
    case 'event_opt_in':
    case 'event_opt_out':
    case 'mandatory_event_created': {
      // Termin-Detail, wenn die ID mitkommt und die Rolle eine Detailroute
      // hat (Konfi und Leitung -- Teamer:innen haben keine, siehe MainTabs).
      const evId = data?.event_id || data?.eventId;
      if (evId && (userType === 'konfi' || userType === 'admin')) {
        return `${routePrefix}/events/${evId}`;
      }
      return `${routePrefix}/events`;
    }

    case 'teamer_event_booking':
    case 'teamer_event_cancellation':
      // Meldungen an die Leitung ueber Teamer-Buchungen: zur Terminliste
      // der Leitung. Andere Rollen bekommen diese Pushes nicht, fallen aber
      // sauber auf ihre eigene Liste zurueck.
      return `${routePrefix}/events`;

    case 'challenge_badge_earned':
      // Stempel aus einer Challenge -> Abzeichen-Seite der Rolle.
      return `${routePrefix}/badges`;

    case 'challenge_submission_hidden':
      // Eigener Beitrag ausgeblendet -> Challenge-Bereich, dort steht die
      // Begruendung am Beitrag.
      return `${routePrefix}/challenges`;

    case 'certificate':
      // Zertifikat -> Profil, dort liegt der Download.
      return `${routePrefix}/profile`;

    case 'jahrgang_deletion_warning':
      // Vorwarnung zur Jahrgangs-Archivierung. Betrifft die Leitung:
      // Einstellungen -> Jahrgaenge. Teamer:innen und Konfis haben diese
      // Seite nicht, fuer sie bleibt das Dashboard.
      return userType === 'admin'
        ? '/admin/settings/jahrgaenge'
        : `${routePrefix}/dashboard`;

    default:
      console.warn('Unbekannter Notification-Typ:', notificationType);
      return '';
  }
};
