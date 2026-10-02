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

/** Was eine Chat-Mitteilung über die Art der Nachricht sagt — ohne ihren Inhalt. */
function chatArtText(messageType) {
  switch (messageType) {
    case 'image': return 'Neues Foto';
    case 'video': return 'Neues Video';
    case 'audio': return 'Neue Sprachnachricht';
    case 'file':  return 'Neue Datei';
    case 'poll':  return 'Neue Umfrage';
    default:      return 'Neue Nachricht';
  }
}

/**
 * Im Direktchat steht der Name im Titel, der Text sagt nur die Art; in Gruppen
 * ist der Titel der Raumname, deshalb nennt der Text den Absender.
 * `content` und `fileName` werden bewusst nicht mehr gelesen.
 */
function chatPushText({ messageType, senderName, isDirectChat }) {
  const art = chatArtText(messageType);
  return isDirectChat ? art : `${art} von ${senderName}`;
}

module.exports = { anhangText, chatArtText, chatPushText };
