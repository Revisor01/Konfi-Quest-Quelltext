/**
 * Nutzertyp im Chat: DREI Werte, wie sie chat_participants.user_type,
 * chat_poll_votes.user_type und chat_message_reactions.user_type fuehren.
 * 'teamer' fehlte in mehreren Typen unten, obwohl die Datenbank ihn speichert —
 * dadurch fielen Vergleiche wie `=== 'admin'` für "gehört zum Team" nicht auf.
 */
export type ChatUserType = 'admin' | 'teamer' | 'konfi';

export interface PollVote {
  // Bei anonymen Umfragen liefert der Server für FREMDE Stimmen null: sonst
  // liesse sich über die Teilnehmerliste aufloesen, wer was gewählt hat. Die
  // eigene Stimme behält ihre Kennung, damit sie markiert werden kann.
  user_id: number | null;
  user_type: ChatUserType | null;
  option_index: number;
  user_name?: string;
}

export interface Reaction {
  id: number;
  emoji: string;
  user_id: number;
  user_type: ChatUserType;
  user_name: string;
}

/**
 * Ein Eintrag aus GET /chat/available-users (Konfi-Sicht).
 *
 * `jahrgang_name` liefert das Backend derzeit immer als null (chat.js,
 * `null as jahrgang_name`) — das Feld steht nur der Vollstaendigkeit halber.
 */
export interface VerfuegbarerPartner {
  id: number;
  name: string;
  type: ChatUserType;
  role_name?: string;
  role_description?: string;
  jahrgang_name?: string | null;
}

/** Ein Eintrag aus GET /chat/team-contacts. */
export interface TeamKontakt {
  id: number;
  display_name: string;
  role_name: string;
  role_description?: string;
}

/**
 * Ein Eintrag aus GET /admin/konfis (konfi-management.js).
 *
 * Der Anzeigename kommt als `name`, der Jahrgang ausschliesslich als
 * `jahrgang_name` — weder `display_name` noch `jahrgang` gibt es.
 */
export interface KonfiEintrag {
  id: number;
  name: string;
  username?: string;
  jahrgang_id?: number | null;
  jahrgang_name?: string | null;
  gottesdienst_points?: number;
  gemeinde_points?: number;
  badgeCount?: number;
}

/** Ein Eintrag aus GET /users/me/jahrgaenge (users.js). */
export interface EigenerJahrgang {
  id: number;
  name: string;
  can_view?: boolean;
  can_edit?: boolean;
  assigned_at?: string;
  assigned_by_name?: string | null;
}

/**
 * Kompletter Umfrage-Stand, wie ihn das Socket-Ereignis `pollUpdated`
 * mitliefert (chat.js, pollPayload). Der Server gewinnt immer: der Client
 * ersetzt damit nur den Umfrage-Teil der betroffenen Nachricht.
 */
export interface PollStand {
  poll_id: number;
  message_id: number;
  question: string;
  options: string[];
  multiple_choice: boolean;
  anonymous: boolean;
  exclusive_options: boolean;
  expires_at: string | null;
  votes: PollVote[];
}

export interface Message {
  id: number;
  content: string;
  sender_id: number;
  sender_name: string;
  sender_role_title?: string;
  sender_role_display_name?: string;
  sender_type: ChatUserType;
  created_at: string;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  message_type: 'text' | 'file' | 'poll' | 'image' | 'video';
  is_deleted?: number;
  deleted?: boolean;
  // Poll-Daten
  question?: string;
  options?: string[];
  votes?: PollVote[];
  multiple_choice?: boolean;
  anonymous?: boolean;
  exclusive_options?: boolean;
  expires_at?: string;
  poll_id?: number;
  // Reply-Daten
  reply_to?: number;
  reply_to_id?: number;
  reply_to_content?: string;
  reply_to_file_name?: string;
  reply_to_message_type?: string;
  reply_to_sender_name?: string;
  // Reaktionen
  reactions?: Reaction[];
  // Queue-Status (Offline-Queue)
  queueStatus?: 'pending' | 'error';
  localId?: string;
  // client_id der eigenen optimistischen Nachricht — Match gegen das
  // newMessage-Event (message.client_id) für In-Place-Ersetzen ohne Flackern
  clientId?: string;
  client_id?: string;
}

export interface ChatParticipant {
  user_id: number;
  user_type: ChatUserType;
  name: string;
  display_name?: string;
}

export interface ChatRoomBase {
  id: number;
  name: string;
  type: 'group' | 'direct' | 'jahrgang' | 'admin';
  event_id?: number | null;
  participants?: ChatParticipant[];
  // Automatischer Team-Chat der Organisation (Migration 104) — nur er
  // laesst sich über den Mülleimer im Header leeren.
  is_team_chat?: boolean;
  // Ungelesen-Stand aus der Chat-Uebersicht: vorhanden, wenn der Raum von
  // dort geoeffnet wurde (ChatRoomOverview verlangt ihn dann verpflichtend).
  unread_count?: number;
}

export interface ChatRoomOverview extends ChatRoomBase {
  participant_count?: number;
  last_message?: {
    content: string;
    sender_name: string;
    created_at: string;
    file_name?: string;
    message_type?: string;
  };
  unread_count: number;
  jahrgang_name?: string;
  // Rolle des Direktchat-Partners (nur bei type='direct').
  partner_user_type?: ChatUserType;
  // Reiner Team-Gruppenchat: alle Teilnehmer sind Teamer:innen (nur bei type='group' relevant).
  is_team_only?: boolean;
}

export interface ChatRoomProps {
  room: ChatRoomBase | null;
  onBack: () => void;
  presentingElement: HTMLElement | undefined | null;
}

export interface ReactionEmojiData {
  outline: string;
  filled: string;
  label: string;
  color: string;
}
