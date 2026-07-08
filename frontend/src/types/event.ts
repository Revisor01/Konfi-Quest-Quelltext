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
  // Serien
  is_series?: boolean;
  series_id?: number;
  // Admin-spezifisch
  pending_bookings_count?: number;
  jahrgang_ids?: string;
  jahrgang_names?: string;
  jahrgaenge?: Jahrgang[];
  material_count?: number;
  // Dashboard
  max_participants_display?: number;
}
