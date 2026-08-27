import { Filesystem, Directory } from '@capacitor/filesystem';
import { writeQueue, QueueItem, FailedChatMessage } from '../../services/writeQueue';
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
  const queueBody: Record<string, any> = { content: opts.content, client_id: opts.clientId };
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
    await Filesystem.writeFile({
      path: `queue-uploads/${fileName}`,
      data: base64,
      directory: Directory.Data,
    });
    queueBody._localFilePath = `queue-uploads/${fileName}`;
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
