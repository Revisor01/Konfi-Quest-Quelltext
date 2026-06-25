import React from 'react';
import {
  IonIcon,
  IonAvatar,
  IonText
} from '@ionic/react';
import {
  barChart,
  checkmark,
  chatbubbles,
  people,
  time,
  document,
  attach,
  chevronForward,
  addOutline,
  arrowUndoOutline,
  shareOutline,
  trashOutline,
  timeOutline,
  alertCircleOutline
} from 'ionicons/icons';
import { Message, Reaction, ChatRoomBase, ReactionEmojiData } from '../../types/chat';
import { REACTION_EMOJIS } from './constants';
import { formatFileSize } from '../../utils/helpers';
import VideoPreview from './VideoPreview';
import LazyImage from './LazyImage';

const getMimeFromFileName = (fileName: string): string => {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm', m4v: 'video/mp4',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return mimeMap[ext] || 'application/octet-stream';
};

// Wandelt URLs (http/https und www.) in klickbare Links um. Gibt ein Array aus
// Text-Fragmenten und <a>-Elementen zurueck, das direkt in JSX gerendert werden kann.
// Links oeffnen extern (window.open _blank) und stoppen die Klick-Propagation,
// damit nicht gleichzeitig die Nachricht selektiert/das Reaktionsmenue getriggert wird.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}'"])/gi;

const linkifyText = (text: string): React.ReactNode => {
  if (!text) return text;
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const href = part.startsWith('www.') ? `https://${part}` : part;
      return (
        <a
          key={i}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(href, '_blank');
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
  onError: (error: string) => void;
  onDeselectMessage: () => void;
  textareaRef: React.RefObject<HTMLIonTextareaElement | null>;
  onRetry?: (message: Message) => void;
  onDeleteQueued?: (message: Message) => void;
}

const formatMessageTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
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
  onError,
  onDeselectMessage,
  textareaRef,
  onRetry,
  onDeleteQueued
}) => {
  const isOwnMessage = message.sender_id === user?.id && message.sender_type === user?.type;

  if (message.deleted) {
    return (
      <div key={message.id} style={{
        display: 'flex',
        justifyContent: 'center',
        margin: '8px 16px'
      }}>
        <span style={{ fontSize: '1.05rem', fontStyle: 'italic', whiteSpace: 'nowrap', color: '#8e8e93' }}>
          Diese Nachricht wurde gelöscht
        </span>
      </div>
    );
  }

  return (
    <div key={message.id} id={`msg-${message.id}`} style={{
      display: 'flex',
      flexDirection: isOwnMessage ? 'row-reverse' : 'row',
      margin: '8px 16px',
      alignItems: 'flex-end',
      transition: 'background-color 0.3s ease'
    }}>
      {!isOwnMessage && room.type !== 'direct' && (
        <IonAvatar style={{
          width: '32px',
          height: '32px',
          marginRight: '8px',
          backgroundColor: '#06b6d4'
        }}>
          <div style={{
            color: 'white',
            fontSize: '0.8rem',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%'
          }}>
            {(message.sender_name || 'U').charAt(0).toUpperCase()}
          </div>
        </IonAvatar>
      )}

      <div
        style={{
          maxWidth: '70%',
          backgroundColor: isOwnMessage ? '#06b6d4' : '#f8f9fa',
          color: isOwnMessage ? 'white' : '#1a1a1a',
          borderRadius: '18px',
          padding: '10px 14px',
          position: 'relative',
          cursor: 'pointer',
          boxShadow: isOwnMessage
            ? '0 2px 8px rgba(6, 182, 212, 0.25)'
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
          onLongPress(message);
        }}
        onTouchStart={(e) => {
          const timeoutId = setTimeout(() => {
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
            fontSize: '0.75rem',
            fontWeight: '600',
            marginBottom: '4px',
            color: '#06b6d4'
          }}>
            {message.sender_name || 'Unbekannter User'}
            {(message.sender_role_title || message.sender_role_display_name) && (
              <span style={{
                fontWeight: 'normal',
                color: '#8e8e93',
                marginLeft: '6px',
                fontSize: '0.7rem'
              }}>
                ({message.sender_role_title || message.sender_role_display_name})
              </span>
            )}
          </div>
        )}

        {/* Reply Anzeige */}
        {message.reply_to_id && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              const replyElement = window.document.getElementById(`msg-${message.reply_to_id}`);
              if (replyElement) {
                replyElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                replyElement.style.backgroundColor = 'rgba(6, 182, 212, 0.15)';
                setTimeout(() => {
                  replyElement.style.backgroundColor = '';
                }, 1500);
              }
            }}
            style={{
              padding: '6px 10px',
              marginBottom: '6px',
              backgroundColor: isOwnMessage ? 'white' : 'rgba(6, 182, 212, 0.08)',
              borderRadius: '8px',
              borderLeft: '3px solid #06b6d4',
              cursor: 'pointer'
            }}
          >
            <div style={{
              fontSize: '0.7rem',
              fontWeight: '600',
              color: '#06b6d4',
              marginBottom: '2px'
            }}>
              {message.reply_to_sender_name}
            </div>
            <div style={{
              fontSize: '0.8rem',
              color: '#666',
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
            fontSize: '0.90rem',
            whiteSpace: 'nowrap',
            color: isOwnMessage ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)'
          }}>
            {message.content}
          </div>
        ) : message.message_type === 'poll' && message.question && message.options ? (
          <div style={{
            background: isOwnMessage ? 'white' : 'rgba(6, 182, 212, 0.06)',
            borderRadius: '14px',
            padding: '16px',
            marginTop: '4px',
            border: isOwnMessage ? '1px solid rgba(6, 182, 212, 0.15)' : '1px solid rgba(6, 182, 212, 0.15)',
          }}>
            {/* Frage mit Icon */}
            <div style={{
              fontWeight: '600',
              marginBottom: '12px',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              color: '#1a1a1a'
            }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: '#06b6d4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <IonIcon icon={barChart} style={{ color: 'white', fontSize: '0.8rem' }} />
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
                  fontSize: '0.8rem',
                  marginBottom: '12px',
                  padding: '8px 12px',
                  background: isExpired ? 'rgba(220,53,69,0.12)' : 'rgba(6, 182, 212, 0.1)',
                  borderRadius: '8px',
                  color: isExpired ? '#dc3545' : '#06b6d4',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <IonIcon icon={time} style={{ fontSize: '0.9rem' }} />
                  {isExpired ? (
                    <span style={{ fontWeight: '500' }}>Beendet</span>
                  ) : (
                    <span>
                      Endet: {expiresDate.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
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
              // Exklusiv: Option ist vergeben, wenn jemand sie gewaehlt hat — und
              // fuer alle ausser dem Waehler selbst gesperrt.
              const takenByOther = isExclusive && optionVotes.length > 0 && !userVoted;
              // Namen der Waehlenden (nur wenn nicht-anonym + Namen vorhanden).
              const voterNames = optionVotes.map(v => v.user_name).filter(Boolean) as string[];

              return (
                <div
                  key={index}
                  onClick={() => { if (!takenByOther) onVoteInPoll(message.id, index); }}
                  style={{
                    background: userVoted ? 'rgba(6, 182, 212, 0.12)' : takenByOther ? 'rgba(0,0,0,0.04)' : 'white',
                    border: userVoted ? '2px solid #06b6d4' : '1px solid rgba(0,0,0,0.08)',
                    borderRadius: '10px',
                    padding: '12px',
                    marginBottom: '8px',
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
                      background: userVoted ? 'rgba(6, 182, 212, 0.12)' : 'rgba(6, 182, 212, 0.06)',
                      transition: 'width 0.4s ease',
                      borderRadius: '8px'
                    }} />
                  )}

                  <div style={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      {userVoted && (
                        <div style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          backgroundColor: '#06b6d4',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <IonIcon icon={checkmark} style={{ color: 'white', fontSize: '0.75rem' }} />
                        </div>
                      )}
                      <span style={{
                        fontWeight: userVoted ? '600' : '500',
                        color: '#1a1a1a',
                        fontSize: '0.9rem'
                      }}>
                        {option}
                      </span>
                    </div>

                    <div style={{
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      color: takenByOther ? '#8e8e93' : '#06b6d4',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
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
                      marginTop: '6px',
                      fontSize: '0.75rem',
                      color: '#6b7280',
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
              marginTop: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.75rem',
              color: '#8e8e93'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <IonIcon icon={message.multiple_choice ? checkmark : chatbubbles} style={{ fontSize: '0.8rem' }} />
                <span>
                  {message.exclusive_options
                    ? 'Exklusiv-Wahl'
                    : message.multiple_choice ? 'Mehrfachauswahl' : 'Einzelauswahl'}
                  {message.anonymous === false ? ' · mit Namen' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <IonIcon icon={people} style={{ fontSize: '0.8rem' }} />
                <span>{message.votes?.length || 0} Stimme{(message.votes?.length || 0) !== 1 ? 'n' : ''}</span>
              </div>
            </div>
          </div>
        ) : message.file_path ? (
          <div>
            {message.content && (
              <div style={{ marginBottom: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{linkifyText(message.content)}</div>
            )}
            {message.file_name?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
              <div style={{ marginBottom: '8px' }}>
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
                <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '4px' }}>
                  {message.file_name} {message.file_size ? `\u2022 ${formatFileSize(message.file_size)}` : ''}
                </div>
              </div>
            ) : message.file_name?.match(/\.(mp4|mov|avi|webm|m4v)$/i) ? (
              <VideoPreview
                message={message}
                onError={(error) => onError('Fehler beim Laden des Videos: ' + error)}
              />
            ) : (
              <div
                style={{
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '8px',
                  padding: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
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
                  icon={message.file_name?.includes('.pdf') ? document : attach}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>
                    {message.file_name}
                  </div>
                  {message.file_size && (
                    <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                      {formatFileSize(message.file_size)}
                    </div>
                  )}
                </div>
                <IonIcon
                  icon={chevronForward}
                  style={{
                    fontSize: '1.2rem',
                    opacity: 0.7
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{linkifyText(message.content)}</div>
        )}

        <div style={{
          fontSize: '0.7rem',
          opacity: 0.7,
          marginTop: '4px',
          textAlign: 'right'
        }}>
          {formatMessageTime(message.created_at)}
          {message.queueStatus === 'pending' && (
            <IonIcon icon={timeOutline} style={{ fontSize: '0.75rem', marginLeft: '4px', verticalAlign: 'middle' }} />
          )}
          {isOwnMessage && !message.queueStatus && (
            <IonIcon icon={checkmark} style={{ fontSize: '0.75rem', marginLeft: '4px', verticalAlign: 'middle', opacity: 0.7 }} />
          )}
          {message.queueStatus === 'error' && (
            <IonIcon
              icon={alertCircleOutline}
              style={{ fontSize: '0.75rem', marginLeft: '4px', color: '#dc3545', verticalAlign: 'middle', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if (onRetry) onRetry(message);
              }}
            />
          )}
        </div>

        {/* Reaktionen Anzeige */}
        {message.reactions && message.reactions.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            marginTop: '6px'
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
                <div
                  key={emoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleReaction(message.id, emoji);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '3px 8px',
                    borderRadius: '12px',
                    backgroundColor: userHasReacted
                      ? (isOwnMessage ? 'rgba(255,255,255,0.25)' : 'rgba(6, 182, 212, 0.12)')
                      : (isOwnMessage ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.05)'),
                    border: userHasReacted
                      ? `1.5px solid ${emojiData?.color || '#06b6d4'}`
                      : '1px solid transparent',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    transition: 'all 0.2s ease'
                  }}
                  title={reactions.map(r => r.user_name).join(', ')}
                >
                  <IonIcon
                    icon={userHasReacted ? emojiData?.filled : emojiData?.outline}
                    style={{
                      fontSize: '0.9rem',
                      color: emojiData?.color || '#06b6d4'
                    }}
                  />
                  <span style={{
                    fontWeight: userHasReacted ? '600' : '500',
                    color: isOwnMessage ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.75)'
                  }}>
                    {reactions.length}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline Aktionsleiste unter ausgewählter Nachricht */}
        {selectedMessage?.id === message.id && !showReactionPicker && (
          <div
            style={{
              display: 'flex',
              gap: '4px',
              marginTop: '8px',
              justifyContent: isOwnMessage ? 'flex-end' : 'flex-start'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              onClick={() => onOpenReactionPicker(message)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: isOwnMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IonIcon icon={addOutline} style={{ fontSize: '1.1rem', color: isOwnMessage ? 'white' : '#666' }} />
            </div>
            <div
              onClick={() => {
                onReply(message);
                onDeselectMessage();
                setTimeout(() => textareaRef.current?.setFocus(), 100);
              }}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: isOwnMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IonIcon icon={arrowUndoOutline} style={{ fontSize: '1rem', color: isOwnMessage ? 'white' : '#666' }} />
            </div>
            <div
              onClick={() => onShare(message)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: isOwnMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <IonIcon icon={shareOutline} style={{ fontSize: '1rem', color: isOwnMessage ? 'white' : '#666' }} />
            </div>
            {user?.role_name && ['admin', 'org_admin', 'teamer'].includes(user.role_name) && (
              <div
                onClick={() => {
                  onDelete(message.id);
                  onDeselectMessage();
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(220, 53, 69, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
              >
                <IonIcon icon={trashOutline} style={{ fontSize: '1rem', color: '#dc3545' }} />
              </div>
            )}
          </div>
        )}

        {/* Inline Reaktions-Picker */}
        {showReactionPicker && reactionTargetMessage?.id === message.id && (
          <div
            style={{
              display: 'flex',
              gap: '2px',
              marginTop: '8px',
              padding: '6px 10px',
              backgroundColor: 'white',
              borderRadius: '20px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              justifyContent: isOwnMessage ? 'flex-end' : 'flex-start'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {Object.entries(REACTION_EMOJIS).map(([emoji, data]) => {
              const userHasThisReaction = message.reactions?.some(
                r => r.user_id === user?.id && r.user_type === user?.type && r.emoji === emoji
              );
              return (
                <div
                  key={emoji}
                  onClick={() => onToggleReaction(message.id, emoji)}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    backgroundColor: userHasThisReaction ? `${data.color}18` : 'transparent',
                    border: userHasThisReaction ? `2px solid ${data.color}` : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <IonIcon
                    icon={userHasThisReaction ? data.filled : data.outline}
                    style={{ fontSize: '1.2rem', color: data.color }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
