import { useState } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useApp } from '../../contexts/AppContext';
import api from '../../services/api';
import { writeQueue } from '../../services/writeQueue';
import { networkMonitor } from '../../services/networkMonitor';
import { safeUUID } from '../../utils/uuid';
import { Message, PollVote } from '../../types/chat';

/**
 * Umfrage-Stimmen und Emoji-Reaktionen des Chatraums (beim Aufteilen von
 * ChatRoom.tsx hierher gezogen, Verhalten unveraendert): optimistisches UI,
 * Offline-Weg über die Schreib-Queue ('chat-aktion') und der Zustand des
 * Reaktions-Pickers.
 */

interface UmfragenReaktionenDeps {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setShouldAutoScroll: React.Dispatch<React.SetStateAction<boolean>>;
  loadMessages: () => Promise<void>;
}

export function useUmfragenUndReaktionen({
  setMessages,
  setShouldAutoScroll,
  loadMessages,
}: UmfragenReaktionenDeps) {
  const { user, setError } = useApp();
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [reactionTargetMessage, setReactionTargetMessage] = useState<Message | null>(null);

  const voteInPoll = async (messageId: number, optionIndex: number) => {
    // Offline: Optimistic UI + Queue-Fallback (fire-and-forget)
    if (!networkMonitor.isOnline) {
      setShouldAutoScroll(false);

      // Optimistisch den Vote anzeigen
      setMessages(prev => prev.map(m => {
        if (m.id === messageId && m.votes) {
          // user.type direkt uebernehmen: Der Server speichert 'teamer' als
          // eigenen Wert. Wurde hier 'admin' angenommen, erkannte die Anzeige
          // (MessageBubble prüft vote.user_type === user.type) die eigene
          // Stimme einer Teamer:in offline nicht als gesetzt.
          const newVote: PollVote = {
            user_id: user?.id ?? 0,
            user_type: (user?.type ?? 'konfi') as PollVote['user_type'],
            option_index: optionIndex,
          };
          return { ...m, votes: [...m.votes, newVote] };
        }
        return m;
      }));

      // 'chat-aktion' statt 'fire-and-forget': Als
      // 'fire-and-forget' uebersprang handleFlushResult das Item vollstaendig
      // — kein Toast, kein Merker. Die Stimme wurde optimistisch angezeigt,
      // kam aber nie an, und niemand erfuhr davon; beim naechsten Laden war
      // sie kommentarlos weg. Bei einer exklusiven Umfrage antwortet der
      // Server ausserdem 409 ("Option bereits vergeben") — offline blieb auch
      // das ungesagt.
      //
      // await, weil enqueue selbst werfen kann (voller Speicher). Ohne das
      // wurde daraus eine unbehandelte Zusage und die Stimme war still weg.
      await writeQueue.enqueue({
        method: 'POST',
        url: `/chat/polls/${messageId}/vote`,
        body: { option_index: optionIndex },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'chat-aktion', clientId: `poll-${messageId}-${optionIndex}-${safeUUID()}`, label: 'Abstimmung' },
      });

      setTimeout(() => setShouldAutoScroll(true), 1000);
      return;
    }

    try {
      setShouldAutoScroll(false); // Prevent auto-scroll when voting
      await api.post(`/chat/polls/${messageId}/vote`, { option_index: optionIndex });
      await loadMessages();
      // Re-enable auto-scroll after a short delay
      setTimeout(() => setShouldAutoScroll(true), 1000);
    } catch (err: any) {
      // Exklusive Umfrage: Option wurde inzwischen von jemand anderem belegt (409).
      if (err?.response?.status === 409) {
        setError('Diese Option ist bereits vergeben');
        await loadMessages(); // aktuellen Stand (Belegung) nachziehen
      } else {
        setError('Fehler beim Abstimmen');
        console.error('Error voting in poll:', err);
      }
      setShouldAutoScroll(true); // Re-enable on error
    }
  };

  // Reaktion hinzufügen/entfernen
  const toggleReaction = async (messageId: number, emoji: string) => {
    // Offline: Optimistic UI + Queue-Fallback (fire-and-forget)
    if (!networkMonitor.isOnline) {
      await Haptics.impact({ style: ImpactStyle.Light });
      setShouldAutoScroll(false);

      // Optimistisch toggeln
      setMessages(prev => prev.map(msg => {
        if (msg.id !== messageId) return msg;
        const reactions = msg.reactions || [];
        const existing = reactions.find(r =>
          r.user_id === user!.id && r.user_type === user!.type && r.emoji === emoji
        );
        if (existing) {
          return { ...msg, reactions: reactions.filter(r => r !== existing) };
        }
        return {
          ...msg,
          reactions: [...reactions, {
            id: 0,
            emoji,
            user_id: user!.id,
            user_type: user!.type as 'admin' | 'konfi',
            user_name: user!.display_name || ''
          }]
        };
      }));

      // Wie bei der Stimme: 'chat-aktion' statt 'fire-and-forget', damit ein
      // Fehlschlag gemeldet wird statt lautlos zu verschwinden.
      await writeQueue.enqueue({
        method: 'POST',
        url: `/chat/messages/${messageId}/reactions`,
        body: { emoji },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'chat-aktion', clientId: `reaction-${messageId}-${emoji}-${safeUUID()}`, label: 'Reaktion' },
      });

      setShowReactionPicker(false);
      setReactionTargetMessage(null);
      setTimeout(() => setShouldAutoScroll(true), 500);
      return;
    }

    try {
      await Haptics.impact({ style: ImpactStyle.Light });
      setShouldAutoScroll(false);

      const response = await api.post(`/chat/messages/${messageId}/reactions`, { emoji });

      // Optimistic update - direkt im State aktualisieren
      setMessages(prev => prev.map(msg => {
        if (msg.id !== messageId) return msg;

        const reactions = msg.reactions || [];
        if (response.data.action === 'added') {
          // Prüfe ob Reaktion schon existiert (verhindert Duplikate durch WebSocket)
          const alreadyExists = reactions.some(r =>
            r.user_id === user!.id && r.user_type === user!.type && r.emoji === emoji
          );
          if (alreadyExists) return msg;

          // Reaktion hinzufügen
          return {
            ...msg,
            reactions: [...reactions, {
              id: response.data.id,
              emoji,
              user_id: user!.id,
              user_type: user!.type as 'admin' | 'konfi',
              user_name: user!.display_name || ''
            }]
          };
        } else {
          // Reaktion entfernen
          return {
            ...msg,
            reactions: reactions.filter(r =>
              !(r.user_id === user!.id && r.user_type === user!.type && r.emoji === emoji)
            )
          };
        }
      }));

      setShowReactionPicker(false);
      setReactionTargetMessage(null);
      setTimeout(() => setShouldAutoScroll(true), 500);
    } catch (err) {
      setError('Fehler beim Reagieren');
      console.error('Error toggling reaction:', err);
      setShouldAutoScroll(true);
    }
  };

  // Reaktion-Picker öffnen
  const openReactionPicker = (message: Message) => {
    setReactionTargetMessage(message);
    setShowReactionPicker(true);
  };

  return {
    showReactionPicker,
    setShowReactionPicker,
    reactionTargetMessage,
    setReactionTargetMessage,
    voteInPoll,
    toggleReaction,
    openReactionPicker,
  };
}
