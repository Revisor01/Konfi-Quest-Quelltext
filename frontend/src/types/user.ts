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

// Chat-User (DirectMessage, SimpleCreateChat, Members)
export interface ChatUser {
  id: number;
  name?: string;
  display_name?: string;
  type: 'admin' | 'konfi';
  jahrgang?: string;
  jahrgang_name?: string;
  role_name?: string;
  role_title?: string;
  role_description?: string;
}
