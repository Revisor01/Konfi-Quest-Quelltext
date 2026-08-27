// Zentrale Event-Typen — alle Consumer importieren von hier

export interface Category {
  id: number;
  name: string;
  description?: string;
  type?: 'activity' | 'event' | 'both';
}

export interface Timeslot {
  id?: number;
  start_time: string;
  end_time: string;
  max_participants: number;
  registered_count?: number;
  waitlist_count?: number;
}

export interface Jahrgang {
  id: number;
  name: string;
  // Punktearten-Schalter des Jahrgangs. Das Backend liefert sie ueber
  // SELECT j.* mit; ohne sie boten die Termin-Formulare auch eine im Jahrgang
  // abgeschaltete Punkteart an.
  gottesdienst_enabled?: boolean;
  gemeinde_enabled?: boolean;
}

// Vollstaendiges Event-Interface (alle Felder aus allen 8 Definitionen vereint)
export interface Event {
  id: number;
  name: string;
  title?: string;
  description?: string;
  event_date: string;
  date?: string;
  event_end_time?: string;
  location?: string;
  location_maps_url?: string;
  points: number;
  point_type?: 'gottesdienst' | 'gemeinde';
  categories?: Category[];
  category_names?: string;
  category?: string;
  type: string;
  max_participants: number;
  registration_opens_at?: string;
  registration_closes_at?: string;
  registered_count: number;
  registration_status: 'upcoming' | 'open' | 'closed' | 'cancelled';
  teamer_registration_status?: 'none' | 'upcoming' | 'open' | 'waitlist' | 'closed' | 'cancelled';
  created_at?: string;
  is_registered?: boolean;
  registered?: boolean;
  can_register?: boolean;
  start_time?: string;
  // Waitlist
  waitlist_enabled?: boolean;
  max_waitlist_size?: number;
  waitlist_count?: number;
  waitlist_position?: number;
  // Booking
  booking_status?: 'confirmed' | 'waitlist' | 'pending' | 'opted_out' | null;
  registration_status_detail?: string;
  is_opted_out?: boolean;
  // Attendance
  attendance_status?: 'present' | 'absent' | null;
  cancelled?: boolean;
  // Timeslots
  has_timeslots?: boolean;
  booked_timeslot_id?: number;
  booked_timeslot_start?: string;
  booked_timeslot_end?: string;
  // Pflicht/Optionen
  mandatory?: boolean;
  is_konfirmation?: boolean;
  bring_items?: string;
  checkin_window?: number;
  // Teamer
  teamer_needed?: boolean;
  teamer_only?: boolean;
  teamer_count?: number;
  teamer_max_participants?: number;
  teamer_waitlist_enabled?: boolean;
  teamer_max_waitlist_size?: number;
  teamer_waitlist_count?: number;
  // Serien
  is_series?: boolean;
  series_id?: number;
  // Event-Chat: nur gesetzt, wenn die abrufende Person Mitglied des Raums ist
  // (die Listen-Endpunkte liefern sonst null, siehe events.js / konfi.js).
  chat_room_id?: number | null;
  // Admin-spezifisch
  pending_bookings_count?: number;
  jahrgang_ids?: string;
  jahrgang_names?: string;
  jahrgaenge?: Jahrgang[];
  material_count?: number;
  // Dashboard
  max_participants_display?: number;
}
