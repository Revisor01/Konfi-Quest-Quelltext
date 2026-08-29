import React from 'react';
import { Message } from '../../types/chat';
import MessageBubble from './MessageBubble';

/**
 * Nachrichtenliste des Chatraums (beim Aufteilen von ChatRoom.tsx hierher
 * gezogen, Verhalten unveraendert): Tages-Trenner, der einmalige
 * "Neue Nachrichten"-Trenner samt Anker-Logik und die Bubbles selbst.
 */

// Tages-Trenner-Label (wie WhatsApp): Heute / Gestern / TT.MM.JJJJ.
const formatDayDivider = (d: Date): string => {
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Heute';
  if (d.toDateString() === yest.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Pro Raum: Message-ID, an der der "Neue Nachrichten"-Trenner bereits gezeigt
// wurde (Modul-Scope, ueberlebt Re-Mounts). Der Trenner ist ein EINMALIGER
// Einstiegs-Indikator: Nach Verlassen+Wiederbetreten darf derselbe (evtl. aus
// stale unread_count rekonstruierte) Anker nicht erneut erscheinen — nur ein
// NEUER Anker (= wirklich neue Nachrichten seit dem letzten Besuch) zählt.
const shownMarkerAnchors = new Map<number, number>();

// Alles, was unveraendert an jede MessageBubble durchgereicht wird.
type BubbleDurchreichProps = Omit<React.ComponentProps<typeof MessageBubble>, 'message'>;

interface ChatMessagesListProps extends BubbleDurchreichProps {
  messages: Message[];
  // Beim Oeffnen eingefrorene Ungelesen-Anzahl; wird hier auf 0 gesetzt, wenn
  // derselbe Anker fuer diesen Raum bereits gezeigt wurde.
  initialUnreadRef: React.MutableRefObject<number | null>;
  // Message-ID, VOR der der "Neue Nachrichten"-Trenner steht — EINMAL beim
  // ersten vollstaendigen Laden eingefroren. Ein Index (laenge - unread) wuerde
  // bei jeder neu angehaengten (auch eigenen) Nachricht nach unten wandern.
  newDividerAnchorRef: React.MutableRefObject<number | null>;
  // DOM-Knoten des Trenners — Scrollziel des Initial-Loads (useChatScroll).
  newDividerRef: React.RefObject<HTMLDivElement | null>;
}

const ChatMessagesList: React.FC<ChatMessagesListProps> = ({
  messages,
  initialUnreadRef,
  newDividerAnchorRef,
  newDividerRef,
  ...bubbleProps
}) => {
  const { room } = bubbleProps;

  // Erste ungelesene Nachricht (= letzte N Nachrichten, N = beim
  // Oeffnen eingefrorene Ungelesen-Anzahl) EINMAL per Message-ID
  // verankern. Danach bleibt der Trenner an dieser Nachricht kleben —
  // neu ankommende/eigene Nachrichten verschieben ihn nicht mehr.
  const unread = initialUnreadRef.current ?? 0;
  if (newDividerAnchorRef.current === null && unread > 0 && unread <= messages.length) {
    const anchor = messages[messages.length - unread];
    // Nur echte Server-Nachrichten ankern (optimistische haben id < 0).
    // Und: derselbe Anker wird pro Raum nur EINMAL gezeigt — nach
    // Verlassen+Wiederbetreten erscheint der Trenner nur, wenn seither
    // wirklich neue Nachrichten dazugekommen sind (neuer Anker).
    if (anchor && anchor.id > 0) {
      if (room?.id && shownMarkerAnchors.get(room.id) === anchor.id) {
        initialUnreadRef.current = 0; // bereits gezeigt -> unterdruecken
      } else {
        newDividerAnchorRef.current = anchor.id;
        if (room?.id) shownMarkerAnchors.set(room.id, anchor.id);
      }
    }
  }

  let lastDayKey = '';
  return (
    <div style={{ paddingBottom: '0px', position: 'relative' }}>
      {messages.map((message) => {
        const created = message.created_at ? new Date(message.created_at) : null;
        const dayKey = created && !isNaN(created.getTime()) ? created.toDateString() : '';
        const showDayDivider = dayKey && dayKey !== lastDayKey;
        if (showDayDivider) lastDayKey = dayKey;
        const showNewDivider = newDividerAnchorRef.current !== null && message.id === newDividerAnchorRef.current;
        return (
          // Key bevorzugt client_id: bleibt beim Tausch optimistische ->
          // Server-Nachricht identisch, die Bubble wird NICHT neu gemountet
          // (kein Aufblitzen/Ruckeln beim Bestaetigen der eigenen Nachricht).
          <React.Fragment key={message.client_id ?? message.clientId ?? message.id}>
            {showDayDivider && (
              <div
                data-day-divider={formatDayDivider(created!)}
                style={{
                  display: 'flex', justifyContent: 'center', margin: '12px 0 8px',
                  // Trenner scrollen normal mit. Der oben SCHWEBENDE Chip
                  // (ein einziger) zeigt den aktuellen Tag -> kein Ueberlagern.
                  pointerEvents: 'none'
                }}
              >
                <span style={{
                  fontSize: '0.72rem', fontWeight: 600, color: '#555',
                  background: 'rgba(245,245,247,0.95)',
                  padding: '4px 14px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.12)'
                }}>
                  {formatDayDivider(created!)}
                </span>
              </div>
            )}
            {showNewDivider && (
              <div ref={newDividerRef} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 12px' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--app-color-events)' }} />
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--app-color-events)' }}>Neue Nachrichten</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--app-color-events)' }} />
              </div>
            )}
            <MessageBubble
              message={message}
              {...bubbleProps}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default ChatMessagesList;
