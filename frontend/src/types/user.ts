// Zentrale User-Typen — alle Consumer importieren von hier

// Kern-User (auth, tokenStore, AppContext)
export interface BaseUser {
  id: number;
  type: 'admin' | 'konfi' | 'teamer' | 'user';
  display_name: string;
  username?: string;
  email?: string;
  organization?: string;
  organization_id?: number;
  roles?: string[];
  role_name?: string;
  jahrgang?: string;
  is_super_admin?: boolean;
  trial_ends_at?: string | null;
  is_trial?: boolean;
  /**
   * Eigene Jahrgangs-Zuweisungen, aus GET /auth/me.
   *
   * Nur fuer `admin` von Bedeutung: Die Rolle sieht ausschliesslich Konfis
   * ihrer zugewiesenen Jahrgaenge. Bei `org_admin` ist die Liste leer oder
   * bedeutungslos — diese Rolle sieht ohnehin alles.
   */
  assigned_jahrgaenge?: { id: number; name: string; can_view?: boolean; can_edit?: boolean }[];
}

// Admin-User-Verwaltung (UsersView, AdminUsersPage, UserManagementModal)
export interface AdminUser {
  id: number;
  username: string;
  email?: string;
  display_name: string;
  role_title?: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
  role_id?: number;
  role_name: string;
  role_display_name: string;
  assigned_jahrgaenge_count: number;
  assigned_jahrgaenge?: { id: number; name: string; can_view?: boolean; can_edit?: boolean; assigned_at?: string; assigned_by_name?: string }[];
  can_edit?: boolean;
}

/**
 * Eine Teamer:in in der Listenansicht (GET /admin/konfis/teamer).
 *
 * Achtung auf den Namen: Die Abfrage aliast `u.display_name as name`
 * (konfi-management.js:116) — in DIESER Antwort gibt es also nur `name`.
 * `display_name` ist hier optional, weil dieselbe Liste auch aus anderen
 * Quellen befuellt wird.
 */
export interface TeamerListenEintrag {
  id: number;
  name: string;
  display_name?: string;
  username?: string;
  teamer_since?: string;
  jahrgang_name?: string;
  badge_count?: number;
  cert_count?: number;
}

/**
 * Was das Konfi-Formular beim Anlegen/Bearbeiten abschickt (KonfiModal)
 * und was POST /admin/konfis erwartet.
 *
 * Das Feld heisst `name` — NICHT display_name. Das Backend liest
 * `const { name, jahrgang_id } = req.body` (konfi-management.js:154).
 */
export interface KonfiFormDaten {
  name: string;
  jahrgang_id: number;
  /** Nur beim zweiten Anlauf nach der Limit-Rueckfrage ("Trotzdem anlegen"). */
  confirm?: boolean;
}

/** Antwort von POST /admin/konfis. */
export interface KonfiAngelegtAntwort {
  id: number;
  /** Einmalpasswort — nur direkt beim Anlegen in der Antwort enthalten. */
  temporaryPassword?: string;
}

/**
 * Ein Bonuspunkt-Eintrag einer Konfi
 * (GET /admin/konfis/:id -> bonusPoints, backend/routes/konfi-management.js).
 *
 * Die Abfrage liefert `bp.*` aus bonus_points plus den aufgeloesten Namen der
 * vergebenden Person als `admin_name` — NICHT als `admin`.
 */
export interface BonusEintrag {
  id: number;
  points: number;
  type: 'gottesdienst' | 'gemeinde';
  description?: string;
  completed_date?: string;
  created_at?: string;
  admin_id?: number;
  /** Aufgeloester Name der vergebenden Person (u.display_name as admin_name). */
  admin_name?: string;
}

/**
 * Ein Event-Punkte-Eintrag einer Konfi
 * (GET /admin/konfis/:id/event-points). Liefert `ep.*` plus Name und Datum
 * des Termins sowie den Namen der vergebenden Person.
 */
export interface EventPunkteEintrag {
  id: number;
  event_id: number;
  points: number;
  point_type: 'gottesdienst' | 'gemeinde';
  awarded_date?: string;
  created_at?: string;
  admin_id?: number;
  event_name?: string;
  event_date?: string;
  admin_name?: string;
}

// Chat-User (DirectMessage, SimpleCreateChat, Members)
export interface ChatUser {
  id: number;
  name?: string;
  display_name?: string;
  // 'teamer' ist eigenstaendig: Teamer:innen lesen ihre Räume mit user_type
  // 'teamer', ein als 'admin' gefuehrter Teamer wäre für sich selbst unsichtbar.
  type: 'admin' | 'konfi' | 'teamer';
  jahrgang?: string;
  jahrgang_name?: string;
  role_name?: string;
  role_title?: string;
  role_description?: string;
}
