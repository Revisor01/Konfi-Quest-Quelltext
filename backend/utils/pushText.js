// Text einer Chat-Mitteilung.
//
// Eine echte BILDVORSCHAU in der Mitteilung ist bewusst NICHT gebaut: Sie
// braucht auf iOS eine Notification Service Extension und auf Android eine
// BigPictureStyle-Notification, beides nativer Code. Zusaetzlich muesste das
// Bild ohne Anmeldung abrufbar sein — die Anhaenge liegen aber verschluesselt
// und hinter der Rechtepruefung. Das waere ein Loch, kein Feature.

/** Was ohne Begleittext in der Mitteilung steht. */
function anhangText(messageType, fileName) {
  const name = fileName ? `: ${fileName}` : '';
  switch (messageType) {
    case 'image': return 'Foto';
    case 'video': return `Video${name}`;
    case 'audio': return 'Sprachnachricht';
    case 'file':  return `Datei${name}`;
    case 'poll':  return 'Umfrage';
    default:      return 'Anhang';
  }
}

/**
 * Der Text der Mitteilung. Im Direktchat ohne Namen (der steht im Titel),
 * in Gruppen mit vorangestelltem Absender.
 */
function chatPushText({ content, messageType, fileName, senderName, isDirectChat }) {
  const text = (content && content.trim()) ? content : anhangText(messageType, fileName);
  return isDirectChat ? text : `${senderName}: ${text}`;
}

module.exports = { anhangText, chatPushText };
