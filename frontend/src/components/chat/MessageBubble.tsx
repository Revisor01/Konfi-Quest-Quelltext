import React from 'react';
import { IonIcon, IonAvatar, IonSpinner } from '@ionic/react';
import {
  ICON_ANHANG_GEFUELLT,
  ICON_CHATS_GEFUELLT,
  ICON_DATEI_GEFUELLT,
  ICON_DIAGRAMM,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN_GEFUELLT,
  ICON_HINZUFUEGEN,
  ICON_LOESCHEN,
  ICON_MEHR,
  ICON_RUECKGAENGIG,
  ICON_TEILEN,
  ICON_UHRZEIT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_WARNHINWEIS,
  ICON_WEITER_GEFUELLT,
} from '../shared/icons';
import { Message, Reaction, ChatRoomBase } from '../../types/chat';
import { REACTION_EMOJIS } from './constants';
import { formatFileSize } from '../../utils/helpers';
import VideoPreview from './VideoPreview';
import LazyImage from './LazyImage';
import FortschrittsBalken from '../shared/FortschrittsBalken';
import { ladeText, sendeText } from '../../utils/fortschritt';
import { tastaturKlick } from '../../utils/tastatur';
import { datumUhrzeit, uhrzeit } from '../../utils/dateUtils';
import { rollenName } from '../../utils/rollenNamen';
import { mimeAusDateiname } from '../../utils/dateiTypen';
import { linkOeffnen } from '../../services/systemDialoge';
import { sendeFehlerText } from './sendeFehler';

const getMimeFromFileName = (fileName: string): string => mimeAusDateiname(fileName);

// Wandelt URLs (http/https und www.) in klickbare Links um. Gibt ein Array aus
// Text-Fragmenten und <a>-Elementen zurück, das direkt in JSX gerendert werden kann.
// Links oeffnen extern (window.open _blank) und stoppen die Klick-Propagation,
// damit nicht gleichzeitig die Nachricht selektiert/das Reaktionsmenue getriggert wird.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}'"])/gi;

const linkifyText = (text: string): React.ReactNode => {
  if (!text) return text;
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // NUR http/https ins href. Die Regex oben laesst ohnehin nichts
      // anderes durch -- aber sie und diese Zeile stehen getrennt, und wer
      // die Regex einmal erweitert, soll hier nicht versehentlich ein
      // `javascript:`-Ziel oeffnen. CodeQL (js/xss-through-dom) hat die
      // Stelle gemeldet, weil es dem Wert nicht bis zur Regex folgt; der
      // Schutz gehoert trotzdem dorthin, wo der Link entsteht.
      const roh = part.startsWith('www.') ? `https://${part}` : part;
      const href = /^https?:\/\//i.test(roh) ? roh : `https://${roh}`;
      return (
        <a
          key={i}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            linkOeffnen(href);
          }}
          style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }}
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

interface MessageBubbleUser {
  id: number;
  type: 'admin' | 'konfi' | 'teamer' | 'user';
  display_name: string;
  role_name?: string;
}

interface MessageBubbleProps {
  message: Message;
  room: ChatRoomBase;
  user: MessageBubbleUser | null;
  selectedMessage: Message | null;
  showReactionPicker: boolean;
  reactionTargetMessage: Message | null;
  onLongPress: (message: Message) => void;
  onReply: (message: Message) => void;
  onShare: (message: Message) => void;
  onDelete: (messageId: number) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  onOpenReactionPicker: (message: Message) => void;
  onVoteInPoll: (messageId: number, optionIndex: number) => void;
  onFileClick: (filePath: string, fileName: string, mimeType: string) => void;
  // Die gerade geladene Datei und ihr Fortschritt (null = Groesse unbekannt,
  // die Anzeige laeuft dann unbestimmt). Ohne Rueckmeldung sieht man beim
  // Antippen einer PDF nichts passieren und tippt weiter.
  ladendeDatei?: { pfad: string; prozent: number | null } | null;
  // Die gerade hochgeladene Nachricht und ihr Fortschritt. Zuordnung ueber
  // localId, weil die optimistische Nachricht noch keine Server-ID hat.
  uploadFortschritt?: { localId: string; prozent: number } | null;
  onError: (error: string) => void;
  onDeselectMessage: () => void;
  textareaRef: React.RefObject<HTMLIonTextareaElement | null>;
  onRetry?: (message: Message) => void;
}

const formatMessageTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return uhrzeit(date);
  } else {
    return datumUhrzeit(date, { ohneJahr: true });
  }
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  room,
  user,
  selectedMessage,
  showReactionPicker,
  reactionTargetMessage,
  onLongPress,
  onReply,
  onShare,
  onDelete,
  onToggleReaction,
  onOpenReactionPicker,
  onVoteInPoll,
  onFileClick,
  ladendeDatei,
  uploadFortschritt,
  onError,
  onDeselectMessage,
  textareaRef,
  onRetry,
}) => {
  const isOwnMessage = message.sender_id === user?.id && message.sender_type === user?.type;
  // Eigene Funktionsbezeichnung vor dem festen Rollenwort (utils/rollenNamen);
  // sender_role_display_name traegt in bestehenden Gemeinden die alten Namen.
  const rolleImChat = message.sender_role_title
    || (message.sender_role_name || message.sender_role_display_name
      ? rollenName(message.sender_role_name, message.sender_role_display_name)
      : '');

  // Laedt GENAU diese Datei gerade? Der Vergleich laeuft ueber den Pfad, damit
  // bei mehreren Dateien im Raum nur die angetippte den Fortschritt zeigt.
  const laedtGerade = ladendeDatei != null && ladendeDatei.pfad === message.file_path;

  // Laeuft der Upload GENAU dieser Nachricht? Die optimistische Nachricht hat
  // noch keine Server-ID, deshalb der Vergleich ueber localId.
  const sendetGerade =
    uploadFortschritt != null &&
    message.localId != null &&
    uploadFortschritt.localId === message.localId;

  // Vom Server endgueltig abgelehnt (413, 415 ...)? Dann der feste Text dazu,
  // sonst null (components/chat/sendeFehler.ts).
  const sendeFehlerGrund = message.queueStatus === 'error' ? sendeFehlerText(message.sendeFehlerStatus) : null;

  // Merkt sich, ob die aktuelle Long-Press-Geste schon behandelt wurde. Android
  // löst bei einem langen Druck BEIDE Wege aus (eigener Touch-Timer und danach
  // das native 'contextmenu'); ohne diese Sperre hob der zweite Aufruf den
  // ersten sofort wieder auf, weil onLongPress ein Toggle ist.
  const longPressFiredRef = React.useRef(false);

  const ausgewaehlt = selectedMessage?.id === message.id;
  const leisteOffen = ausgewaehlt && !showReactionPicker;
  const pickerOffen = showReactionPicker && reactionTargetMessage?.id === message.id;
  const aktionenKnopfRef = React.useRef<HTMLButtonElement>(null);
  const ersteAktionRef = React.useRef<HTMLDivElement>(null);
  const ersteReaktionRef = React.useRef<HTMLDivElement>(null);
  // Über den Knopf geöffnet -> Fokus auf die erste Aktion der Leiste.
  const fokusInLeisteRef = React.useRef(false);
  // Picker per Tastatur geöffnet -> Fokus auf die erste Reaktion, danach
  // zurück auf den Knopf (sonst fiele er an den Seitenanfang).
  const pickerPerTastaturRef = React.useRef(false);

  React.useEffect(() => {
    if (leisteOffen && fokusInLeisteRef.current) {
      fokusInLeisteRef.current = false;
      ersteAktionRef.current?.focus();
    }
  }, [leisteOffen]);

  React.useEffect(() => {
    if (!pickerPerTastaturRef.current) return;
    if (pickerOffen) {
      ersteReaktionRef.current?.focus();
    } else {
      pickerPerTastaturRef.current = false;
      aktionenKnopfRef.current?.focus();
    }
  }, [pickerOffen]);

  // Escape schließt Leiste bzw. Picker und gibt den Fokus an den Knopf
  // zurück. Nur wenn hier etwas offen ist -- sonst gehört Escape dem Fenster
  // darüber (der Chatraum kann in einem Modal stehen).
  const mitEscapeSchliessen = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || !(ausgewaehlt || pickerOffen)) return;
    e.preventDefault();
    e.stopPropagation();
    pickerPerTastaturRef.current = false;
    onDeselectMessage();
    aktionenKnopfRef.current?.focus();
  };

  if (message.deleted) {
    return (
      <div key={message.id} style={{
        display: 'flex',
        justifyContent: 'center',
        margin: 'var(--app-abstand-eng) var(--app-abstand-basis)'
      }}>
        <span style={{ fontSize: 'var(--app-text-standard)', fontStyle: 'italic', whiteSpace: 'nowrap', color: 'var(--app-text-system)' }}>
          Diese Nachricht wurde gelöscht
        </span>
      </div>
    );
  }

  return (
    <div key={message.id} id={`msg-${message.id}`} className="app-chat-nachricht" style={{
      display: 'flex',
      flexDirection: isOwnMessage ? 'row-reverse' : 'row',
      margin: 'var(--app-abstand-eng) var(--app-abstand-basis)',
      alignItems: 'flex-end',
      transition: 'background-color 0.3s ease'
    }}>
      {!isOwnMessage && room.type !== 'direct' && (
        <IonAvatar style={{
          width: '32px',
          height: '32px',
          marginRight: 'var(--app-abstand-eng)',
          backgroundColor: 'var(--app-color-chat)'
        }}>
          <div style={{
            color: 'white',
            fontSize: 'var(--app-text-hinweis)',
            fontWeight: 'var(--app-schrift-fett)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%'
          }}>
            {(message.sender_name || 'U').charAt(0).toUpperCase()}
          </div>
        </IonAvatar>
      )}

      <div role="presentation"
        style={{
          maxWidth: '70%',
          backgroundColor: isOwnMessage ? 'var(--app-color-chat)' : 'var(--app-surface-soft)',
          color: isOwnMessage ? 'white' : 'var(--app-text-emphasis)',
          borderRadius: 'var(--app-radius-gross)',
          padding: 'var(--app-abstand-schmal) var(--app-abstand-mittelweit)',
          position: 'relative',
          cursor: 'pointer',
          boxShadow: isOwnMessage
            ? '0 2px 8px rgba(var(--app-color-chat-rgb), 0.25)'
            : '0 1px 4px rgba(0,0,0,0.08)',
          ...(message.queueStatus === 'pending' ? { opacity: 0.7 } : {})
        }}
        onClick={(e) => {
          if (message.queueStatus === 'error' && onRetry) {
            e.stopPropagation();
            onRetry(message);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          // Android feuert nach dem eigenen 500ms-Timer ZUSAETZLICH 'contextmenu'.
          // Weil onLongPress ein Toggle ist, ging das Menue dadurch sofort wieder
          // zu ("blitzt kurz auf"). Hat der Touch-Timer schon ausgelöst, ist die
          // Geste hier bereits behandelt.
          if (longPressFiredRef.current) return;
          longPressFiredRef.current = true;
          onLongPress(message);
        }}
        onTouchStart={(e) => {
          longPressFiredRef.current = false;
          const timeoutId = setTimeout(() => {
            // Umgekehrter Fall: hat 'contextmenu' schon zugeschlagen, nicht
            // noch einmal togglen.
            if (longPressFiredRef.current) return;
            longPressFiredRef.current = true;
            onLongPress(message);
          }, 500);

          const cleanup = () => {
            clearTimeout(timeoutId);
            e.target.removeEventListener('touchend', cleanup);
            e.target.removeEventListener('touchmove', cleanup);
            e.target.removeEventListener('touchcancel', cleanup);
          };

          e.target.addEventListener('touchend', cleanup);
          e.target.addEventListener('touchmove', cleanup);
          e.target.addEventListener('touchcancel', cleanup);
        }}
      >
        {!isOwnMessage && room.type !== 'direct' && (
          <div style={{
            fontSize: 'var(--app-text-klein)',
            fontWeight: 'var(--app-schrift-halbfett)',
            marginBottom: 'var(--app-abstand-mini)',
            color: 'var(--app-text-chat)'
          }}>
            {message.sender_name || 'Unbekannter User'}
            {rolleImChat && (
              <span style={{
                fontWeight: 'var(--app-schrift-normal)',
                color: 'var(--app-text-system)',
                marginLeft: 'var(--app-abstand-kompakt)',
                fontSize: 'var(--app-text-meta)'
              }}>
                ({rolleImChat})
              </span>
            )}
          </div>
        )}

        {/* Reply Anzeige */}
        {message.reply_to_id && (
          <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-label="Zur beantworteten Nachricht springen"
            onClick={(e) => {
              e.stopPropagation();
              const replyElement = window.document.getElementById(`msg-${message.reply_to_id}`);
              if (replyElement) {
                replyElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                replyElement.style.backgroundColor = 'rgba(var(--app-color-chat-rgb), 0.15)';
                setTimeout(() => {
                  replyElement.style.backgroundColor = '';
                }, 1500);
              }
            }}
            style={{
              padding: 'var(--app-abstand-kompakt) var(--app-abstand-schmal)',
              marginBottom: 'var(--app-abstand-kompakt)',
              // Kartengrund statt 'white': hell derselbe Ton, dunkel eine
              // dunkle Flaeche -- die Schrift (Text-Tokens) wechselt mit.
              backgroundColor: isOwnMessage ? 'var(--app-surface-card)' : 'rgba(var(--app-color-chat-rgb), 0.08)',
              borderRadius: 'var(--app-radius-klein)',
              borderLeft: '3px solid var(--app-color-chat)',
              cursor: 'pointer'
            }}
          >
            <div style={{
              fontSize: 'var(--app-text-meta)',
              fontWeight: 'var(--app-schrift-halbfett)',
              color: 'var(--app-text-chat)',
              marginBottom: 'var(--app-abstand-winzig)'
            }}>
              {message.reply_to_sender_name}
            </div>
            <div style={{
              fontSize: 'var(--app-text-hinweis)',
              color: 'var(--app-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {message.reply_to_message_type === 'image' || message.reply_to_message_type === 'video'
                ? (message.reply_to_file_name || 'Medieninhalt')
                : message.reply_to_message_type === 'file'
                  ? (message.reply_to_file_name || 'Datei')
                  : message.reply_to_message_type === 'poll'
                    ? 'Umfrage'
                    : (message.reply_to_content || '')}
            </div>
          </div>
        )}

        {message.is_deleted ? (
          <div style={{
            fontStyle: 'italic',
            opacity: 0.6,
            fontSize: 'var(--app-text-basis)',
            whiteSpace: 'nowrap',
            /* Gleiches Muster wie am Reaktionszaehler: rohes Schwarz
               auf der fremden Blase, im Dunkeln unsichtbar. Die Daempfung
               traegt schon `opacity` darueber. */
            color: isOwnMessage ? 'rgba(255,255,255,0.7)' : 'var(--app-text-emphasis)'
          }}>
            {message.content}
          </div>
        ) : message.message_type === 'poll' && message.question && message.options ? (
          <div style={{
            // Kartengrund statt 'white': Frage und Antworten
            // schreiben mit --app-text-emphasis, im Dunkeln fast Weiss.
            background: isOwnMessage ? 'var(--app-surface-card)' : 'rgba(var(--app-color-chat-rgb), 0.06)',
            borderRadius: 'var(--app-radius-weich)',
            padding: 'var(--app-abstand-basis)',
            marginTop: 'var(--app-abstand-mini)',
            border: isOwnMessage ? '1px solid rgba(var(--app-color-chat-rgb), 0.15)' : '1px solid rgba(var(--app-color-chat-rgb), 0.15)',
          }}>
            {/* Frage mit Icon */}
            <div style={{
              fontWeight: 'var(--app-schrift-halbfett)',
              marginBottom: 'var(--app-abstand-mittel)',
              fontSize: 'var(--app-text-standard)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--app-abstand-eng)',
              color: 'var(--app-text-emphasis)'
            }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: 'var(--app-radius-kreis)',
                backgroundColor: 'var(--app-color-chat)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <IonIcon icon={ICON_DIAGRAMM} style={{ color: 'white', fontSize: 'var(--app-text-hinweis)' }} />
              </div>
              <span>{message.question}</span>
            </div>

            {/* Ablaufdatum */}
            {message.expires_at && (() => {
              const expiresDate = new Date(message.expires_at);
              const now = new Date();
              const isExpired = expiresDate < now;
              const timeRemaining = expiresDate.getTime() - now.getTime();
              const hoursRemaining = Math.floor(timeRemaining / (1000 * 60 * 60));
              const minutesRemaining = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));

              return (
                <div style={{
                  fontSize: 'var(--app-text-hinweis)',
                  marginBottom: 'var(--app-abstand-mittel)',
                  padding: 'var(--app-abstand-eng) var(--app-abstand-mittel)',
                  background: isExpired ? 'rgba(var(--app-color-danger-rgb), 0.12)' : 'rgba(var(--app-color-chat-rgb), 0.1)',
                  borderRadius: 'var(--app-radius-klein)',
                  color: isExpired ? 'var(--app-color-danger)' : 'var(--app-text-chat)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--app-abstand-kompakt)'
                }}>
                  <IonIcon icon={ICON_UHRZEIT_GEFUELLT} style={{ fontSize: 'var(--app-text-basis)' }} />
                  {isExpired ? (
                    <span style={{ fontWeight: 'var(--app-schrift-mittel)' }}>Beendet</span>
                  ) : (
                    <span>
                      Endet: {datumUhrzeit(expiresDate, { ohneJahr: true })}
                      {hoursRemaining < 24 && ` (${hoursRemaining > 0 ? `${hoursRemaining}h ` : ''}${minutesRemaining}min)`}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Optionen */}
            {message.options.map((option, index) => {
              const optionVotes = message.votes?.filter(vote => vote.option_index === index) || [];
              const totalVotes = message.votes?.length || 0;
              const percentage = totalVotes > 0 ? (optionVotes.length / totalVotes) * 100 : 0;
              const userVoted = message.votes?.some(vote =>
                vote.user_id === user?.id && vote.user_type === user?.type && vote.option_index === index
              );
              const isExclusive = !!message.exclusive_options;
              const showNames = message.anonymous === false;
              // Exklusiv: Option ist vergeben, wenn jemand sie gewählt hat — und
              // für alle außer dem Waehler selbst gesperrt.
              const takenByOther = isExclusive && optionVotes.length > 0 && !userVoted;
              // Namen der Waehlenden (nur wenn nicht-anonym + Namen vorhanden).
              const voterNames = optionVotes.map(v => v.user_name).filter(Boolean) as string[];

              return (
                <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={userVoted} aria-disabled={takenByOther}
                  key={index}
                  onClick={() => { if (!takenByOther) onVoteInPoll(message.id, index); }}
                  style={{
                    // Flaechen und Rahmen aus Tokens: 'white' mit
                    // Schrift aus --app-text-emphasis war im Dunkeln Weiss auf
                    // Weiss; Schwarz mit Deckkraft (vergeben, Rahmen)
                    // verschwindet auf dunklem Grund. Hell tragen die Tokens
                    // dieselben Toene wie vorher (#fff, #f5f5f5, #eee).
                    background: userVoted ? 'rgba(var(--app-color-chat-rgb), 0.12)' : takenByOther ? 'var(--app-surface-muted)' : 'var(--app-surface-card)',
                    border: userVoted ? '2px solid var(--app-color-chat)' : '1px solid var(--app-border-soft)',
                    borderRadius: 'var(--app-radius-knopf)',
                    padding: 'var(--app-abstand-mittel)',
                    marginBottom: 'var(--app-abstand-eng)',
                    cursor: takenByOther ? 'not-allowed' : 'pointer',
                    opacity: takenByOther ? 0.7 : 1,
                    position: 'relative',
                    overflow: 'hidden',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {/* Fortschrittsbalken (nur bei nicht-exklusiven Umfragen sinnvoll) */}
                  {!isExclusive && (
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: `${percentage}%`,
                      background: userVoted ? 'rgba(var(--app-color-chat-rgb), 0.12)' : 'rgba(var(--app-color-chat-rgb), 0.06)',
                      transition: 'width 0.4s ease',
                      borderRadius: 'var(--app-radius-klein)'
                    }} />
                  )}

                  <div style={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', minWidth: 0 }}>
                      {userVoted && (
                        <div style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: 'var(--app-radius-kreis)',
                          backgroundColor: 'var(--app-color-chat)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <IonIcon icon={ICON_HAKEN_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-klein)' }} />
                        </div>
                      )}
                      <span style={{
                        fontWeight: userVoted ? 'var(--app-schrift-halbfett)' : 'var(--app-schrift-mittel)',
                        color: 'var(--app-text-emphasis)',
                        fontSize: 'var(--app-text-basis)'
                      }}>
                        {option}
                      </span>
                    </div>

                    <div style={{
                      fontSize: 'var(--app-text-hinweis)',
                      fontWeight: 'var(--app-schrift-halbfett)',
                      color: takenByOther ? 'var(--app-text-system)' : 'var(--app-text-chat)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--app-abstand-mini)',
                      flexShrink: 0
                    }}>
                      {isExclusive ? (
                        // Exklusiv: Status statt Prozent
                        <span>{optionVotes.length > 0 ? (userVoted ? 'Deine Wahl' : 'Vergeben') : 'Frei'}</span>
                      ) : (
                        <>
                          <span>{optionVotes.length}</span>
                          <span style={{ opacity: 0.7 }}>({percentage.toFixed(0)}%)</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Namen der Waehlenden (nicht-anonyme Umfrage) */}
                  {showNames && voterNames.length > 0 && (
                    <div style={{
                      position: 'relative',
                      zIndex: 1,
                      marginTop: 'var(--app-abstand-kompakt)',
                      fontSize: 'var(--app-text-klein)',
                      color: 'var(--app-color-neutral)',
                      lineHeight: 1.4
                    }}>
                      {voterNames.join(', ')}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Info Footer */}
            <div style={{
              marginTop: 'var(--app-abstand-eng)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 'var(--app-text-klein)',
              color: 'var(--app-text-system)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                <IonIcon icon={message.multiple_choice ? ICON_HAKEN_GEFUELLT : ICON_CHATS_GEFUELLT} style={{ fontSize: 'var(--app-text-hinweis)' }} />
                <span>
                  {message.exclusive_options
                    ? 'Exklusiv-Wahl'
                    : message.multiple_choice ? 'Mehrfachauswahl' : 'Einzelauswahl'}
                  {message.anonymous === false ? ' · mit Namen' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mini)' }}>
                <IonIcon icon={ICON_GRUPPE_GEFUELLT} style={{ fontSize: 'var(--app-text-hinweis)' }} />
                <span>{message.votes?.length || 0} Stimme{(message.votes?.length || 0) !== 1 ? 'n' : ''}</span>
              </div>
            </div>
          </div>
        ) : message.file_path ? (
          <div>
            {message.content && (
              <div style={{ marginBottom: 'var(--app-abstand-eng)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{linkifyText(message.content)}</div>
            )}
            {message.file_name?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
              <div style={{ marginBottom: 'var(--app-abstand-eng)' }}>
                <LazyImage
                  filePath={message.file_path}
                  fileName={message.file_name}
                  onError={() => onError('Fehler beim Laden des Bildes')}
                  onClick={() => {
                    if (message.file_path) {
                      onFileClick(message.file_path, message.file_name || 'Bild', getMimeFromFileName(message.file_name || 'bild.jpg'));
                    }
                  }}
                />
                <div style={{ fontSize: 'var(--app-text-klein)', opacity: 0.7, marginTop: 'var(--app-abstand-mini)' }}>
                  {message.file_name} {message.file_size ? `\u2022 ${formatFileSize(message.file_size)}` : ''}
                </div>
              </div>
            ) : message.file_name?.match(/\.(mp4|mov|avi|webm|m4v)$/i) ? (
              <VideoPreview
                filePath={message.file_path}
                fileName={message.file_name}
                fileSize={message.file_size}
                onError={(error) => onError('Fehler beim Laden des Videos: ' + error)}
              />
            ) : (
              <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                style={{
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 'var(--app-radius-klein)',
                  padding: 'var(--app-abstand-eng)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--app-abstand-eng)',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (message.file_path) {
                    onFileClick(message.file_path, message.file_name || 'Datei', getMimeFromFileName(message.file_name || ''));
                  }
                }}
              >
                <IonIcon
                  icon={message.file_name?.includes('.pdf') ? ICON_DATEI_GEFUELLT : ICON_ANHANG_GEFUELLT}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-fett)' }}>
                    {message.file_name}
                  </div>
                  {laedtGerade ? (
                    <div style={{ fontSize: 'var(--app-text-klein)', opacity: 0.9 }}>
                      {ladeText(ladendeDatei?.prozent)}
                    </div>
                  ) : message.file_size ? (
                    <div style={{ fontSize: 'var(--app-text-klein)', opacity: 0.8 }}>
                      {formatFileSize(message.file_size)}
                    </div>
                  ) : null}
                  {laedtGerade && ladendeDatei?.prozent != null && (
                    <FortschrittsBalken
                      prozent={ladendeDatei.prozent}
                      beschriftung={`Datei wird geladen: ${ladendeDatei.prozent} Prozent`}
                    />
                  )}
                </div>
                {laedtGerade ? (
                  <IonSpinner name="crescent" style={{ width: '18px', height: '18px', opacity: 0.8 }} />
                ) : (
                  <IonIcon
                    icon={ICON_WEITER_GEFUELLT}
                    style={{
                      fontSize: 'var(--app-text-untertitel)',
                      opacity: 0.7
                    }}
                  />
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{linkifyText(message.content)}</div>
        )}

        <div style={{
          fontSize: 'var(--app-text-meta)',
          opacity: 0.7,
          marginTop: 'var(--app-abstand-mini)',
          textAlign: 'right'
        }}>
          {formatMessageTime(message.created_at)}
          {message.queueStatus === 'pending' && !sendetGerade && (
            <IonIcon icon={ICON_UHRZEIT} style={{ fontSize: 'var(--app-text-klein)', marginLeft: 'var(--app-abstand-mini)', verticalAlign: 'middle' }} />
          )}
          {sendetGerade && (
            <span style={{ marginLeft: 'var(--app-abstand-mini)' }}>
              {sendeText(uploadFortschritt!.prozent)}
            </span>
          )}
          {isOwnMessage && !message.queueStatus && (
            <IonIcon icon={ICON_HAKEN_GEFUELLT} style={{ fontSize: 'var(--app-text-klein)', marginLeft: 'var(--app-abstand-mini)', verticalAlign: 'middle', opacity: 0.7 }} />
          )}
          {message.queueStatus === 'error' && (
            <button
              type="button"
              className="app-knopf-nackt"
              aria-label={sendeFehlerGrund ? 'Nachricht nicht gesendet' : 'Nachricht erneut senden'}
              style={{ marginLeft: 'var(--app-abstand-mini)', verticalAlign: 'middle', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if (onRetry) onRetry(message);
              }}
            >
              <IonIcon
                icon={ICON_WARNHINWEIS}
                aria-hidden="true"
                style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-color-danger)', display: 'block' }}
              />
            </button>
          )}
        </div>

        {message.queueStatus === 'error' && sendeFehlerGrund && (
          <div style={{
            fontSize: 'var(--app-text-meta)',
            marginTop: 'var(--app-abstand-mini)',
            textAlign: 'right',
            fontWeight: 'var(--app-schrift-mittel)'
          }}>
            {`Nicht gesendet: ${sendeFehlerGrund}`}
          </div>
        )}

        {sendetGerade && (
          <FortschrittsBalken
            prozent={uploadFortschritt!.prozent}
            beschriftung={`Datei wird gesendet: ${uploadFortschritt!.prozent} Prozent`}
          />
        )}

        {/* Reaktionen Anzeige */}
        {message.reactions && message.reactions.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--app-abstand-mini)',
            marginTop: 'var(--app-abstand-kompakt)'
          }}>
            {Object.entries(
              message.reactions.reduce((acc, r) => {
                if (!acc[r.emoji]) acc[r.emoji] = [];
                acc[r.emoji].push(r);
                return acc;
              }, {} as { [key: string]: Reaction[] })
            ).map(([emoji, reactions]) => {
              const emojiData = REACTION_EMOJIS[emoji];
              const userHasReacted = reactions.some(
                r => r.user_id === user?.id && r.user_type === user?.type
              );
              return (
                <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={userHasReacted}
                  key={emoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleReaction(message.id, emoji);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--app-abstand-mini)',
                    padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
                    borderRadius: 'var(--app-radius-karte)',
                    /* Fremde Blase: Chip-Grund und Zaehler aus Tokens, nicht aus
                       rohem Schwarz -- die Blase ist im Dunkeln #242426, und
                       rgba(0,0,0,…) blieb dort Schwarz auf Schwarz: Zaehler
                       1,25:1. Auf der
                       eigenen, tuerkisen Blase bleibt Weiss richtig. */
                    backgroundColor: userHasReacted
                      ? (isOwnMessage ? 'rgba(255,255,255,0.25)' : 'rgba(var(--app-color-chat-rgb), 0.12)')
                      : (isOwnMessage ? 'rgba(255,255,255,0.12)' : 'rgba(var(--app-text-system-rgb), 0.12)'),
                    border: userHasReacted
                      ? `1.5px solid ${emojiData?.color || 'var(--app-color-chat)'}`
                      : '1px solid transparent',
                    cursor: 'pointer',
                    fontSize: 'var(--app-text-klein)',
                    transition: 'all 0.2s ease'
                  }}
                  title={reactions.map(r => r.user_name).join(', ')}
                >
                  <IonIcon
                    icon={userHasReacted ? emojiData?.filled : emojiData?.outline}
                    style={{
                      fontSize: 'var(--app-text-basis)',
                      color: emojiData?.color || 'var(--app-text-chat)'
                    }}
                  />
                  <span style={{
                    fontWeight: userHasReacted ? 'var(--app-schrift-halbfett)' : 'var(--app-schrift-mittel)',
                    color: isOwnMessage ? 'rgba(255,255,255,0.95)' : 'var(--app-text-emphasis)'
                  }}>
                    {reactions.length}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline Aktionsleiste unter ausgewählter Nachricht */}
        {leisteOffen && (
          <div role="presentation"
            id={`aktionen-${message.id}`}
            style={{
              display: 'flex',
              gap: 'var(--app-abstand-mini)',
              marginTop: 'var(--app-abstand-eng)',
              justifyContent: isOwnMessage ? 'flex-end' : 'flex-start'
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={mitEscapeSchliessen}
          >
            <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-label="Reaktion hinzufügen"
              ref={ersteAktionRef}
              onClick={(e) => {
                // detail 0: ausgelöst über Enter/Leertaste (tastaturKlick ruft
                // click()), nicht über Maus oder Finger.
                if (e.detail === 0) pickerPerTastaturRef.current = true;
                onOpenReactionPicker(message);
              }}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--app-radius-kreis)',
                backgroundColor: isOwnMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IonIcon icon={ICON_HINZUFUEGEN} style={{ fontSize: 'var(--app-text-gross)', color: isOwnMessage ? 'white' : 'var(--app-text-secondary)' }} />
            </div>
            <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-label="Antworten"
              onClick={() => {
                onReply(message);
                onDeselectMessage();
                setTimeout(() => textareaRef.current?.setFocus(), 100);
              }}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--app-radius-kreis)',
                backgroundColor: isOwnMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IonIcon icon={ICON_RUECKGAENGIG} style={{ fontSize: 'var(--app-text-standard)', color: isOwnMessage ? 'white' : 'var(--app-text-secondary)' }} />
            </div>
            <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-label="Teilen"
              onClick={() => onShare(message)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--app-radius-kreis)',
                backgroundColor: isOwnMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IonIcon icon={ICON_TEILEN} style={{ fontSize: 'var(--app-text-standard)', color: isOwnMessage ? 'white' : 'var(--app-text-secondary)' }} />
            </div>
            {/* Loeschen: Admins duerfen jede Nachricht der Organisation loeschen,
                Teamer:innen nur ihre EIGENEN. Vorher hing der Button allein an der
                Rolle — Teamer:innen sahen den Papierkorb auch bei fremden
                Nachrichten, wo ihn das Backend mit 403 abgelehnt hat.
                Konfis sehen ihn bewusst weiterhin gar nicht. */}
            {user?.role_name && (
              ['admin', 'org_admin'].includes(user.role_name) ||
              (user.role_name === 'teamer' && isOwnMessage)
            ) && (
              <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-label="Nachricht löschen"
                onClick={() => {
                  onDelete(message.id);
                  onDeselectMessage();
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--app-radius-kreis)',
                  backgroundColor: 'rgba(var(--app-color-danger-rgb), 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <IonIcon icon={ICON_LOESCHEN} style={{ fontSize: 'var(--app-text-standard)', color: 'var(--app-color-danger)' }} />
              </div>
            )}
          </div>
        )}

        {/* Inline Reaktions-Picker */}
        {pickerOffen && (
          <div role="presentation"
            onKeyDown={mitEscapeSchliessen}
            style={{
              display: 'flex',
              gap: 'var(--app-abstand-winzig)',
              marginTop: 'var(--app-abstand-eng)',
              padding: 'var(--app-abstand-kompakt) var(--app-abstand-schmal)',
              backgroundColor: 'var(--app-surface-card)',
              borderRadius: 'var(--app-radius-gross)',
              boxShadow: 'var(--app-schatten-schwebend-stark)',
              justifyContent: isOwnMessage ? 'flex-end' : 'flex-start'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {Object.entries(REACTION_EMOJIS).map(([emoji, data], index) => {
              const userHasThisReaction = message.reactions?.some(
                r => r.user_id === user?.id && r.user_type === user?.type && r.emoji === emoji
              );
              return (
                <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={userHasThisReaction} aria-label={`Mit ${emoji} reagieren`}
                  key={emoji}
                  ref={index === 0 ? ersteReaktionRef : undefined}
                  onClick={() => onToggleReaction(message.id, emoji)}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: 'var(--app-radius-kreis)',
                    cursor: 'pointer',
                    backgroundColor: userHasThisReaction ? `rgba(${data.rgb}, 0.1)` : 'transparent',
                    border: userHasThisReaction ? `2px solid ${data.color}` : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <IonIcon
                    icon={userHasThisReaction ? data.filled : data.outline}
                    style={{ fontSize: 'var(--app-text-untertitel)', color: data.color }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Aktionen per Maus und Tastatur -- in der Zeile neben der Blase (bei
          eigenen Nachrichten links, sonst rechts), damit die Blase nicht
          verrutscht. Klick bis hierher stoppen: sonst wählte der Klick-Handler
          des Chatinhalts die gerade geöffnete Auswahl sofort wieder ab. */}
      <button
        type="button"
        ref={aktionenKnopfRef}
        className="app-knopf-nackt app-beruehrungsziel app-chat-aktionen-knopf"
        aria-label="Aktionen zu dieser Nachricht"
        aria-expanded={ausgewaehlt || pickerOffen}
        aria-controls={leisteOffen ? `aktionen-${message.id}` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!ausgewaehlt) fokusInLeisteRef.current = true;
          onLongPress(message);
        }}
        onKeyDown={mitEscapeSchliessen}
      >
        <IonIcon icon={ICON_MEHR} aria-hidden="true" />
      </button>
    </div>
  );
};

export default MessageBubble;
