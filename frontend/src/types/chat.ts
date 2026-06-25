export interface PollVote {
  user_id: number;
  user_type: 'admin' | 'konfi';
  option_index: number;
  user_name?: string;
}

export interface Reaction {
  id: number;
  emoji: string;
  user_id: number;
  user_type: 'admin' | 'konfi';
  user_name: string;
}

export interface Message {
  id: number;
  content: string;
  sender_id: number;
  sender_name: string;
  sender_role_title?: string;
  sender_role_display_name?: string;
  sender_type: 'admin' | 'konfi' | 'teamer';
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
}

export interface ChatParticipant {
  user_id: number;
  user_type: 'admin' | 'konfi';
  name: string;
  display_name?: string;
}

export interface ChatRoomBase {
  id: number;
  name: string;
  type: 'group' | 'direct' | 'jahrgang' | 'admin';
  event_id?: number | null;
  participants?: ChatParticipant[];
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
  // Rolle des Direktchat-Partners (nur bei type='direct'): admin=Teamer:in, konfi=Konfi.
  partner_user_type?: 'admin' | 'konfi';
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
