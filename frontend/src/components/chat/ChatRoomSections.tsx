import {
  ICON_ABSAGE,
  ICON_ANHANG_GEFUELLT,
  ICON_ANTWORTEN,
  ICON_DIAGRAMM,
  ICON_GRUPPE_GEFUELLT,
  ICON_LOESCHEN,
  ICON_MEHR_VERTIKAL,
  ICON_SENDEN_GEFUELLT,
} from '../shared/icons';
import React from 'react';
import {
  IonToolbar,
  IonButton,
  IonIcon,
  IonTextarea,
  IonFooter,
  IonSpinner
} from '@ionic/react';
import { Message, ChatUserType } from '../../types/chat';
import { formatFileSize } from '../../utils/helpers';
import { Capacitor } from '@capacitor/core';
import AppKopfzeile from '../shared/AppKopfzeile';

// Validiert URLs für img src, erlaubt nur sichere Protokolle (blob: und data:)
export const getSafePreviewUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (url.startsWith('blob:') || url.startsWith('data:image/')) return url;
  return null;
};

// ChatHeader Komponente
interface ChatHeaderProps {
  roomName: string;
  roomType: string;
  isAdmin: boolean;
  canLeave: boolean;
  isOnline: boolean;
  onBack: () => void;
  onOpenMembers: () => void;
  onOpenPoll: () => void;
  onLeaveChat: () => void;
  // Team-Chat leeren (nur Leitung, nur im automatischen Team-Chat gesetzt):
  // Mülleimer im Header, löscht alle Nachrichten, der Raum bleibt.
  onClearChat?: (() => void) | null;
  eventId?: number | null;
  partnerType?: ChatUserType | null;
}

export const ChatHeader = React.memo<ChatHeaderProps>(({
  roomName,
  roomType,
  isAdmin,
  canLeave,
  isOnline,
  onBack,
  onOpenMembers,
  onOpenPoll,
  onLeaveChat,
  onClearChat
}) => {
  return (
    // Die gemeinsame Kopfzeile (Glocke, Gemeinde-Umschalter) -- ein Chatraum
    // ist eine Seite mit eigener Route, kein Modal. translucent bewusst AUS:
    // Der Chat-Content ist nicht fullscreen (Footer mit Eingabefeld), daher
    // wuerde ein translucent-Header die Safe-Area oben falsch behandeln ->
    // Header sitzt unter Notch/Statusbar. Opaker Header sitzt korrekt.
    <AppKopfzeile
      titel={roomName}
      onZurueck={onBack}
      translucent={false}
      gemeindeUmschalter={false}
      rechts={(
        <>
          {roomType !== 'direct' && (
            <IonButton aria-label="Mitglieder anzeigen" onClick={onOpenMembers}>
              <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
            </IonButton>
          )}
          {/* Umfragen anlegen bleibt der Leitung vorbehalten. */}
          {isAdmin && (
            <IonButton aria-label="Umfrage erstellen" onClick={onOpenPoll}>
              <IonIcon icon={ICON_DIAGRAMM} />
            </IonButton>
          )}
          {onClearChat && (
            <IonButton aria-label={isOnline ? "Team-Chat leeren" : "Team-Chat leeren — Ohne Internetverbindung nicht möglich"}
              title={isOnline ? undefined : "Ohne Internetverbindung nicht möglich"}
              disabled={!isOnline} onClick={onClearChat}>
              <IonIcon icon={ICON_LOESCHEN} />
            </IonButton>
          )}
          {canLeave && (
            <IonButton aria-label={isOnline ? "Weitere Chat-Optionen" : "Weitere Chat-Optionen — Ohne Internetverbindung nicht möglich"}
              title={isOnline ? undefined : "Ohne Internetverbindung nicht möglich"}
              disabled={!isOnline} onClick={onLeaveChat}>
              <IonIcon icon={ICON_MEHR_VERTIKAL} />
            </IonButton>
          )}
        </>
      )}
    />
  );
});

// ReplyPreview Komponente
interface ReplyPreviewProps {
  replyToMessage: Message;
  onClear: () => void;
}

export const ReplyPreview = React.memo<ReplyPreviewProps>(({ replyToMessage, onClear }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    padding: 'var(--app-abstand-eng) var(--app-abstand-basis)',
    backgroundColor: 'rgba(var(--app-color-chat-rgb), 0.08)',
    borderTop: '1px solid rgba(var(--app-color-chat-rgb), 0.15)',
    borderLeft: '3px solid var(--app-color-chat)',
    gap: 'var(--app-abstand-eng)'
  }}>
    <IonIcon icon={ICON_ANTWORTEN} style={{ fontSize: 'var(--app-text-untertitel)', color: 'var(--app-text-chat)' }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 'var(--app-schrift-halbfett)', fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-chat)' }}>
        {replyToMessage.sender_name}
      </div>
      <div style={{
        fontSize: 'var(--app-text-sekundaer)',
        color: 'var(--app-text-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {replyToMessage.message_type === 'image' || replyToMessage.message_type === 'video'
          ? (replyToMessage.file_name || 'Medieninhalt')
          : replyToMessage.message_type === 'file'
            ? (replyToMessage.file_name || 'Datei')
            : replyToMessage.message_type === 'poll'
              ? 'Umfrage'
              : (replyToMessage.content || '')}
      </div>
    </div>
    <IonButton aria-label="Antwort verwerfen"
      fill="clear"
      size="small"
      onClick={onClear}
      style={{ '--padding-start': 'var(--app-abstand-mini)', '--padding-end': 'var(--app-abstand-mini)' }}
    >
      <IonIcon icon={ICON_ABSAGE} style={{ fontSize: 'var(--app-text-untertitel)', color: 'var(--app-text-system)' }} />
    </IonButton>
  </div>
));

// FilePreviewBar Komponente
interface FilePreviewBarProps {
  selectedFile: File;
  selectedFilePreview: string | null;
  onClear: () => void;
}

export const FilePreviewBar = React.memo<FilePreviewBarProps>(({ selectedFile, selectedFilePreview, onClear }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    padding: 'var(--app-abstand-schmal) var(--app-abstand-basis)',
    backgroundColor: 'rgba(var(--app-color-chat-rgb), 0.06)',
    borderTop: '1px solid rgba(var(--app-color-chat-rgb), 0.12)',
    borderLeft: '3px solid var(--app-color-chat)',
    gap: 'var(--app-abstand-schmal)'
  }}>
    {/* Image Preview or File Icon */}
    {selectedFilePreview ? (
      <div style={{
        width: '48px',
        height: '48px',
        borderRadius: 'var(--app-radius-klein)',
        overflow: 'hidden',
        flexShrink: 0,
        border: '2px solid var(--app-color-chat)'
      }}>
        <img
          src={getSafePreviewUrl(selectedFilePreview) || ''}
          alt="Preview"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />
      </div>
    ) : (
      <div style={{
        width: '44px',
        height: '44px',
        borderRadius: 'var(--app-radius-klein)',
        backgroundColor: 'rgba(var(--app-color-chat-rgb), 0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}>
        <IonIcon icon={ICON_ANHANG_GEFUELLT} style={{ fontSize: 'var(--app-text-titel-gross)', color: 'var(--app-text-chat)' }} />
      </div>
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontWeight: 'var(--app-schrift-halbfett)',
        fontSize: 'var(--app-text-basis)',
        color: 'var(--app-text-emphasis)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {selectedFile.name}
      </div>
      <div style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-chat)', fontWeight: 'var(--app-schrift-mittel)' }}>
        {formatFileSize(selectedFile.size)}
      </div>
    </div>
    <IonButton aria-label="Datei entfernen"
      fill="clear"
      size="small"
      onClick={onClear}
      style={{ '--padding-start': 'var(--app-abstand-kompakt)', '--padding-end': 'var(--app-abstand-kompakt)' }}
    >
      <IonIcon icon={ICON_ABSAGE} style={{ fontSize: 'var(--app-text-titel-gross)', color: 'var(--app-text-system)' }} />
    </IonButton>
  </div>
));

// MessageInput Komponente
interface MessageInputProps {
  messageText: string;
  uploading: boolean;
  selectedFile: File | null;
  selectedFilePreview: string | null;
  replyToMessage: Message | null;
  textareaRef: React.RefObject<HTMLIonTextareaElement | null>;
  onTextChange: (value: string) => void;
  onFocus: () => void;
  onSend: () => void;
  /** Öffnet die Dateiauswahl (useChatDateien.dateiWaehlen, über die Hülle in services/systemDialoge). */
  onDateiWaehlen: () => void;
  onClearFile: () => void;
  onClearReply: () => void;
}

export const MessageInput = React.memo<MessageInputProps>(({
  messageText,
  uploading,
  selectedFile,
  selectedFilePreview,
  replyToMessage,
  textareaRef,
  onTextChange,
  onFocus,
  onSend,
  onDateiWaehlen,
  onClearFile,
  onClearReply
}) => {
  // Manuelles Auto-Resize des Eingabefeldes (statt Ionic autoGrow, das echtes
  // Hochscrollen verhindert). Hoehe = Inhalt, gedeckelt auf MAX_H (~5 Zeilen);
  // darueber wird das native Element scrollbar -> man kommt an alten Text.
  const MAX_H = 110;
  const resizeTextarea = React.useCallback(async () => {
    const ionTa = textareaRef.current;
    if (!ionTa || !ionTa.getInputElement) return;
    const native = await ionTa.getInputElement();
    if (!native) return;
    native.style.height = 'auto';
    const next = Math.min(native.scrollHeight, MAX_H);
    native.style.height = next + 'px';
    native.style.overflowY = native.scrollHeight > MAX_H ? 'auto' : 'hidden';
  }, [textareaRef]);

  // Nach Senden/Leeren (messageText wird leer) Hoehe zuruecksetzen.
  React.useEffect(() => {
    if (!messageText) resizeTextarea();
  }, [messageText, resizeTextarea]);

  return (
  <IonFooter style={{ backgroundColor: 'var(--app-surface-soft)', backdropFilter: 'blur(10px)' }}>
    {/* Reply Preview */}
    {replyToMessage && (
      <ReplyPreview replyToMessage={replyToMessage} onClear={onClearReply} />
    )}

    {/* File Preview - direkt an Input angehängt wie Reply */}
    {selectedFile && (
      <FilePreviewBar
        selectedFile={selectedFile}
        selectedFilePreview={selectedFilePreview}
        onClear={onClearFile}
      />
    )}

    <IonToolbar style={{
      '--background': 'transparent',
      '--min-height': 'auto',
      '--padding-start': 'var(--app-abstand-mittel)',
      '--padding-end': 'var(--app-abstand-mittel)',
      '--padding-top': 'var(--app-abstand-eng)',
      '--padding-bottom': 'var(--app-abstand-eng)'
    }}>
      {/* Flex-Container für Input und Buttons - vertikal zentriert */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--app-abstand-eng)',
        width: '100%'
      }}>
        <IonButton aria-label="Datei anhängen" className="app-beruehrungsziel"
          fill="clear"
          size="small"
          onClick={() => onDateiWaehlen()}
          style={{
            '--padding-start': 'var(--app-abstand-mini)',
            '--padding-end': 'var(--app-abstand-mini)',
            '--color': 'var(--app-text-chat)',
            '--height': '38px',
            '--min-height': '38px',
            fontSize: 'var(--app-icon-chat-anhang)'
          }}
        >
          <IonIcon icon={ICON_ANHANG_GEFUELLT} />
        </IonButton>

        <div style={{
          flex: 1,
          backgroundColor: 'var(--app-surface-card)',
          borderRadius: 'var(--app-radius-gross)',
          border: '1.5px solid rgba(var(--app-color-chat-rgb), 0.3)',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(var(--app-color-chat-rgb), 0.1)',
          display: 'flex',
          alignItems: 'center'
        }}>
          <IonTextarea aria-label="Nachricht schreiben"
            ref={textareaRef}
            value={messageText}
            onIonInput={(e) => { onTextChange(e.detail.value || ''); resizeTextarea(); }}
            onIonFocus={onFocus}
            placeholder="Nachricht schreiben..."
            rows={1}
            autocapitalize="sentences"
            spellcheck={true}
            enterkeyhint="enter"
            inputmode="text"
            className="chat-message-textarea"
            style={{
              '--background': 'transparent',
              '--border-radius': '0',
              '--padding-start': 'var(--app-abstand-mittelweit)',
              '--padding-end': 'var(--app-abstand-mittelweit)',
              '--padding-top': 'var(--app-abstand-schmal)',
              '--padding-bottom': 'var(--app-abstand-schmal)',
              '--box-shadow': 'none',
              margin: '0',
              '--color': 'var(--app-text-emphasis)',
              '--placeholder-color': 'var(--app-text-system)',
              minHeight: '38px'
              // Hoehe wird manuell in resizeTextarea() gesetzt (KEIN autoGrow —
              // dessen Grid-Replikation verhindert echtes Hochscrollen). Ab ~5
              // Zeilen wird das native Element scrollbar (overflow-y via CSS).
            }}
            onKeyDown={(e) => {
              // Auf nativen Apps (iOS/Android, Touch-Tastatur) erzeugt Enter IMMER
              // einen Zeilenumbruch — gesendet wird nur über den Senden-Button.
              // Sonst (Browser/Hardware-Tastatur) sendet Enter, Shift+Enter = Umbruch.
              if (Capacitor.isNativePlatform()) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
          />
        </div>

        <IonButton className="app-beruehrungsziel"
          fill="solid"
          shape="round"
          size="small"
          disabled={(!messageText.trim() && !selectedFile) || uploading}
          // preventDefault auf pointerdown: Der Button soll dem Textfeld den
          // Fokus moeglichst gar nicht erst stehlen.
          onPointerDown={(e) => e.preventDefault()}
          // Fokus SYNCHRON in der Klick-Geste zuruecksetzen: Nach dem Senden
          // wird der Button disabled (Text leer) und der Browser wirft den
          // Fokus sonst auf BODY -> iOS schließt die Tastatur. Innerhalb der
          // User-Geste haelt setFocus die Tastatur offen (verifiziert im Web:
          // activeElement war BODY nach Senden).
          onClick={() => {
            onSend();
            textareaRef.current?.setFocus();
          }}
          style={{
            '--background': 'var(--app-color-chat)',
            '--background-activated': 'var(--app-color-chat-dunkel)',
            '--background-hover': 'var(--app-color-chat-dunkel)',
            '--height': '38px',
            '--min-height': '38px',
            '--border-radius': 'var(--app-radius-kreis)',
            '--padding-start': '0',
            '--padding-end': '0',
            '--box-shadow': '0 2px 8px rgba(var(--app-color-chat-rgb), 0.35)',
            minWidth: '38px',
            maxWidth: '38px',
            fontSize: 'var(--app-icon-chat-senden)'
          }}
        >
          {uploading ? <IonSpinner name="dots" /> : <IonIcon icon={ICON_SENDEN_GEFUELLT} />}
        </IonButton>
      </div>
    </IonToolbar>
  </IonFooter>
  );
});

export { autoCapitalize } from '../../utils/chatGrossschreibung';

