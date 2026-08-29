import { useIonAlert, useIonActionSheet } from '@ionic/react';
import { useApp } from '../../contexts/AppContext';
import { offlineBlockiert } from '../../utils/offlineAktion';
import api from '../../services/api';
import { ChatRoomBase, Message } from '../../types/chat';
import { chatVerlaufExportieren } from './chatTeilen';

/**
 * Verwaltungsaktionen des Chatraums (beim Aufteilen von ChatRoom.tsx hierher
 * gezogen, Verhalten unveraendert): Rechte-Ableitungen (Export, Team-Chat
 * leeren, Verlassen), das Optionen-Blatt hinter dem Menue-Button sowie die
 * Rueckfragen fuer Leeren und Verlassen.
 */

interface ChatVerwaltungDeps {
  room: ChatRoomBase | null;
  onBack: () => void;
  getDisplayRoomName: () => string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  refreshMessagesCache: () => void;
}

export function useChatVerwaltung({
  room,
  onBack,
  getDisplayRoomName,
  setMessages,
  refreshMessagesCache,
}: ChatVerwaltungDeps) {
  const { user, setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const [presentActionSheet] = useIonActionSheet();

  const canLeaveChat = (): boolean => {
    if (!room) return false;
    // Admins duerfen NIEMALS einen Chat verlassen
    if (user?.type === 'admin') return false;
    // Event-Chats sind an die Event-Teilnahme gekoppelt: Konfis verlassen sie
    // nur über die Event-Abmeldung, nicht direkt im Chat.
    if (user?.type === 'konfi' && room.event_id) return false;
    // Teamer:innen duerfen group und admin-Chats verlassen
    if (room.type === 'group') return true;
    if (room.type === 'admin') return true;
    return false;
  };

  // Nur admin/org_admin/super_admin duerfen exportieren — der Server prüft
  // das ebenfalls, hier nur zum Ein-/Ausblenden des Menuepunkts.
  const istLeitung = user?.type === 'admin'
    && ['admin', 'org_admin', 'super_admin'].includes(user?.role_name || '');

  // Das Backend hat recht: super_admin ist organisationsuebergreifend und
  // fuer die Org-VERWALTUNG zustaendig (rbac.js:57) — Inhalte einer fremden
  // Gemeinde zu loeschen gehoert nicht dazu.
  const darfTeamChatLeeren = user?.type === 'admin'
    && ['admin', 'org_admin'].includes(user?.role_name || '');

  // Chat-Export (nur Leitung), Details in chatTeilen.chatVerlaufExportieren.
  const handleExportChat = async () => {
    if (!room || !isOnline) return;
    await chatVerlaufExportieren(room.id, getDisplayRoomName(), setError);
  };

  const handleLeaveChat = () => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Chat verlassen',
      message: 'Chat wirklich verlassen? Du erhältst keine Nachrichten mehr aus diesem Chat.',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Verlassen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/chat/rooms/${room?.id}/leave`);
              onBack();
            } catch {
              setError('Fehler beim Verlassen des Chats');
            }
          }
        }
      ]
    });
  };

  // Sammelt die Optionen hinter dem Menue-Button: Export (Leitung) und
  // Verlassen (wer darf). Frueher loeste der Button direkt das Verlassen aus.
  const handleChatOptions = () => {
    const buttons: any[] = [];
    if (istLeitung) {
      buttons.push({
        text: 'Chat-Verlauf exportieren',
        handler: () => { handleExportChat(); }
      });
    }
    if (canLeaveChat()) {
      buttons.push({
        text: 'Chat verlassen',
        role: 'destructive',
        handler: () => { handleLeaveChat(); }
      });
    }
    buttons.push({ text: 'Abbrechen', role: 'cancel' });
    presentActionSheet({ header: getDisplayRoomName(), buttons });
  };

  // Team-Chat leeren (nur Leitung, nur im automatischen Team-Chat): löscht
  // ALLE Nachrichten samt Dateianhaengen unwiderruflich, der Chat selbst und
  // seine Mitglieder bleiben bestehen. Mit klarer Rückfrage.
  const handleClearChat = () => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Team-Chat leeren?',
      message: 'Alle Nachrichten dieses Chats werden endgültig gelöscht — auch Dateien, Bilder und Umfragen. Das lässt sich nicht rückgängig machen. Der Chat selbst bleibt bestehen.',
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Endgültig leeren',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/chat/rooms/${room?.id}/messages`);
              setMessages([]);
              refreshMessagesCache();
            } catch (err: any) {
              setError(err.response?.data?.error || 'Fehler beim Leeren des Chats');
            }
          }
        }
      ]
    });
  };

  return {
    canLeaveChat,
    istLeitung,
    darfTeamChatLeeren,
    handleChatOptions,
    handleClearChat,
  };
}
