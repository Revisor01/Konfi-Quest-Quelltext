import { Filesystem, Directory } from '@capacitor/filesystem';
import { writeQueue, QueueBody, QueueItem, FailedChatMessage } from '../../services/writeQueue';
import { warteschlangenDateiSichern } from '../../services/warteschlangenDatei';
import { Message, ChatUserType } from '../../types/chat';

/**
 * Ausgangskorb des Chats: alles, was eine geschriebene Nachricht zwischen
 * "Senden gedrueckt" und "beim Server angekommen" am Leben haelt.
 */

export interface AbsenderInfo {
  id: number;
  name: string;
  type: ChatUserType;
}

function messageTypeFuer(fileName?: string, fileType?: string): Message['message_type'] {
  if (!fileName && !fileType) return 'text';
  if (fileType?.startsWith('video/')) return 'video';
  if (fileType?.startsWith('image/')) return 'image';
  return 'file';
}

/** Wartendes Queue-Item als "wird gesendet"-Bubble. */
export function queueItemZuBubble(item: QueueItem, absender: AbsenderInfo): Message {
  const body = item.body || {};
  return {
    id: -item.createdAt,
    content: body.content || body._fileName || '',
    sender_id: absender.id,
    sender_name: absender.name,
    sender_type: absender.type,
    created_at: new Date(item.createdAt).toISOString(),
    message_type: messageTypeFuer(body._fileName, body._fileType),
    file_name: body._fileName,
    queueStatus: 'pending',
    localId: item.metadata.clientId,
    clientId: item.metadata.clientId,
  };
}

/** Endgueltig fehlgeschlagene Nachricht als "fehlgeschlagen"-Bubble mit Retry. */
export function fehlgeschlageneZuBubble(f: FailedChatMessage, absender: AbsenderInfo): Message {
  return {
    id: -f.createdAt,
    content: f.content || f.fileName || '',
    sender_id: absender.id,
    sender_name: absender.name,
    sender_type: absender.type,
    created_at: new Date(f.createdAt).toISOString(),
    message_type: messageTypeFuer(f.fileName, f.fileType),
    file_name: f.fileName,
    queueStatus: 'error',
    ...(typeof f.error?.status === 'number' ? { sendeFehlerStatus: f.error.status } : {}),
    localId: f.clientId,
    clientId: f.clientId,
  };
}

/**
 * Beim Oeffnen eines Raums die noch nicht zugestellten Nachrichten wieder in
 * die Liste haengen. Doppelte werden uebersprungen: was schon als Bubble da
 * ist (localId/clientId) oder bereits vom Server kam (client_id), kommt nicht
 * noch einmal dazu. Steht eine client_id sowohl im Fehl-Merker als auch wieder
 * in der Queue (Neuversand laeuft), gewinnt die Queue ("wird gesendet").
 */
export function ergaenzeLokaleBubbles(
  vorhanden: Message[],
  queueItems: QueueItem[],
  fehlgeschlagene: FailedChatMessage[],
  absender: AbsenderInfo
): Message[] {
  const bekannt = new Set<string>();
  for (const m of vorhanden) {
    if (m.localId) bekannt.add(m.localId);
    if (m.clientId) bekannt.add(m.clientId);
    if (m.client_id) bekannt.add(m.client_id);
  }

  const neue: Message[] = [];
  for (const item of queueItems) {
    if (bekannt.has(item.metadata.clientId)) continue;
    bekannt.add(item.metadata.clientId);
    neue.push(queueItemZuBubble(item, absender));
  }
  for (const f of fehlgeschlagene) {
    if (bekannt.has(f.clientId)) continue;
    bekannt.add(f.clientId);
    neue.push(fehlgeschlageneZuBubble(f, absender));
  }
  if (neue.length === 0) return vorhanden;

  // Aelteste zuerst, ans Ende der Liste (die juengsten stehen im Chat unten).
  neue.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [...vorhanden, ...neue];
}

/**
 * Nachricht persistent in die Schreib-Queue einreihen — der EINE Weg für den
 * Offline-Versand UND den fehlgeschlagenen Online-Versand. Eine Datei wird
 * vorher lokal gesichert, damit sie den App-Neustart uebersteht.
 * Doppelversand verhindert die client_id: der Server behandelt sie idempotent.
 */
export async function chatNachrichtEinreihen(
  roomId: number,
  opts: { clientId: string; content: string; file?: File | null; replyToId?: number | null }
): Promise<void> {
  const queueBody: QueueBody = { content: opts.content, client_id: opts.clientId };
  let hasFileUpload = false;

  if (opts.file) {
    hasFileUpload = true;
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(opts.file as File);
    });
    const fileName = `queue_${opts.clientId}_${opts.file.name}`;
    queueBody._localFilePath = await warteschlangenDateiSichern(fileName, base64);
    queueBody._fileName = opts.file.name;
    queueBody._fileType = opts.file.type;
  }

  if (opts.replyToId) queueBody.reply_to = String(opts.replyToId);

  await writeQueue.enqueue({
    method: 'POST',
    url: `/chat/rooms/${roomId}/messages`,
    body: queueBody,
    headers: { 'Content-Type': opts.file ? 'multipart/form-data' : 'application/json' },
    maxRetries: 5,
    hasFileUpload,
    metadata: {
      type: 'chat',
      clientId: opts.clientId,
      roomId,
      label: 'Chat-Nachricht',
    },
  });
}

/**
 * Server-Liste mit den noch nicht zugestellten LOKALEN Nachrichten zusammenfuehren.
 *
 * Behalten werden nur Nachrichten mit localId und Status pending/error, deren
 * Server-Kopie noch nicht angekommen ist (Abgleich über client_id/localId).
 */
export function mergeMitLokalen(server: Message[], vorher: Message[]): Message[] {
  const offen = vorher.filter(m =>
    m.localId && (m.queueStatus === 'pending' || m.queueStatus === 'error')
  );
  if (offen.length === 0) return server;

  // Ist die Server-Kopie inzwischen da, fällt die lokale Fassung weg.
  const serverClientIds = new Set(
    server.map(m => m.client_id || m.localId).filter(Boolean)
  );
  const nochOffen = offen.filter(m => !serverClientIds.has(m.localId));
  if (nochOffen.length === 0) return server;

  // Lokale Nachrichten ans Ende: sie sind die juengsten und stehen im Chat unten.
  return [...server, ...nochOffen];
}

/**
 * Fehlgeschlagene Nachricht erneut einreihen ("Erneut senden").
 *
 * Rueckgabe false: ein Neuversand ist nicht moeglich (Datei-Nachricht ohne
 * Queue-Item und ohne lokale Kopie im Merker) — der Aufrufer meldet das
 * ehrlich statt still nichts zu tun.
 */
export async function nachrichtNeuEinreihen(
  roomId: number | undefined,
  message: Message
): Promise<boolean> {
  const queueItems = await writeQueue.getByMetadata({ roomId, type: 'chat' });
  const item = queueItems.find(qi => qi.metadata.clientId === message.localId || qi.id === message.localId);
  if (item) {
    await writeQueue.remove(item.id);
    const retryItem = { ...item, retryCount: 0 };
    // retryCount/id/createdAt werden von enqueue überschrieben, also Omit-kompatibel machen
    await writeQueue.enqueue({
      method: retryItem.method,
      url: retryItem.url,
      body: retryItem.body,
      headers: retryItem.headers,
      maxRetries: retryItem.maxRetries,
      hasFileUpload: retryItem.hasFileUpload,
      metadata: retryItem.metadata,
    });
    return true;
  }

  if (roomId && message.localId) {
    const merker = (await writeQueue.getFailedChat(roomId))
      .find(f => f.clientId === message.localId);
    if (merker?.localFilePath) {
      await writeQueue.enqueue({
        method: 'POST',
        url: `/chat/rooms/${roomId}/messages`,
        body: {
          content: merker.content || '',
          client_id: message.localId,
          _localFilePath: merker.localFilePath,
          _fileName: merker.fileName,
          _fileType: merker.fileType,
        },
        headers: { 'Content-Type': 'multipart/form-data' },
        maxRetries: 5,
        hasFileUpload: true,
        metadata: {
          type: 'chat',
          clientId: message.localId,
          roomId,
          label: 'Chat-Nachricht',
        },
      });
      return true;
    }
    if (message.content && !message.file_path) {
      await writeQueue.enqueue({
        method: 'POST',
        url: `/chat/rooms/${roomId}/messages`,
        body: {
          content: message.content,
          client_id: message.localId,
          ...(message.reply_to ? { reply_to: String(message.reply_to) } : {})
        },
        headers: { 'Content-Type': 'application/json' },
        maxRetries: 5,
        hasFileUpload: false,
        metadata: {
          type: 'chat',
          clientId: message.localId,
          roomId,
          label: 'Chat-Nachricht',
        },
      });
      return true;
    }
  }

  return false;
}

/**
 * Wartende/fehlgeschlagene Nachricht restlos aufraeumen (Loeschen ist eine
 * bewusste Entscheidung): Queue-Item samt lokaler Dateikopie entfernen und
 * auch den "endgueltig fehlgeschlagen"-Merker samt Dateikopie leeren.
 */
export async function wartendeNachrichtAufraeumen(
  roomId: number | undefined,
  localId: string | undefined
): Promise<void> {
  const queueItems = await writeQueue.getByMetadata({ roomId, type: 'chat' });
  const item = queueItems.find(qi => qi.metadata.clientId === localId || qi.id === localId);
  if (item) {
    await writeQueue.remove(item.id);
    // Lokale Datei löschen falls vorhanden
    if (item.body?._localFilePath) {
      try {
        await Filesystem.deleteFile({ path: item.body._localFilePath, directory: Directory.Data });
      } catch { /* ignore */ }
    }
  }
  const merker = (await writeQueue.getFailedChat(roomId)).find(f => f.clientId === localId);
  if (merker?.localFilePath) {
    try {
      await Filesystem.deleteFile({ path: merker.localFilePath, directory: Directory.Data });
    } catch { /* ignore */ }
  }
  await writeQueue.forgetFailedChat(localId);
}
