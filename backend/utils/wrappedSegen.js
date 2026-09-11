// backend/utils/wrappedSegen.js
//
// DER ZUSPRUCH statt eines leeren Rueckblicks.
//
// ZWEI GETRENNTE EBENEN, die man nicht verwechseln darf:
//   Das JAHR  -- gibt es fuer NIEMANDEN im Team etwas, wird es gar nicht
//                erst zur Auswahl angeboten (routes/wrapped.js, team-jahre).
//   Die PERSON -- das Jahr laeuft, aber fuer diese eine Person kam nichts
//                zusammen. Sie faellt nicht heraus, sondern bekommt DIESEN
//                Zuspruch. Genau darum geht es hier.
//
// WARUM NUR TEAMER:INNEN: Ein Konfi ohne Punkte ist ein Konfi, der noch am
// Anfang steht -- sein Rueckblick kommt spaeter. Eine Teamer:in ohne
// Eintraege ist jemand, der da war, ohne dass es jemand eingetragen hat. Ihr
// eine Bilanz aus Nullen zu zeigen, waere die falsche Auskunft ueber einen
// Menschen.
//
// WARUM FEST IM CODE und nicht einstellbar: Der Zuspruch muss in jeder
// Gemeinde vom ersten Tag an funktionieren, ohne dass jemand ihn einrichtet.
// Ein leeres Einstellungsfeld haette genau die Luecke gelassen, die es zu
// schliessen gilt.

/**
 * Die Zuspruchtexte.
 *
 * Bewusst kurz und ohne Bezug auf Zahlen, Leistung oder Abwesenheit. Kein
 * "wir vermissen dich", kein "leider", kein "du warst dieses Jahr nicht" --
 * nichts, was das Fehlen zum Thema macht.
 */
const SEGENSWORTE = [
  {
    text: 'Der Herr segne dich und behüte dich. Der Herr lasse sein Angesicht leuchten über dir und sei dir gnädig.',
    quelle: '4. Mose 6,24-25'
  },
  {
    text: 'Von guten Mächten wunderbar geborgen erwarten wir getrost, was kommen mag.',
    quelle: 'Dietrich Bonhoeffer'
  },
  {
    text: 'Ich bin bei dir, und ich will dich behüten, wo du hinziehst.',
    quelle: '1. Mose 28,15'
  },
  {
    text: 'Du stellst meine Füße auf weiten Raum.',
    quelle: 'Psalm 31,9'
  },
  {
    text: 'Befiehl dem Herrn deine Wege und hoffe auf ihn, er wird es wohl machen.',
    quelle: 'Psalm 37,5'
  },
  {
    text: 'Gott hat seinen Engeln befohlen, dass sie dich behüten auf allen deinen Wegen.',
    quelle: 'Psalm 91,11'
  },
  {
    text: 'Der Herr ist mein Hirte, mir wird nichts mangeln.',
    quelle: 'Psalm 23,1'
  },
  {
    text: 'Fürchte dich nicht, denn ich habe dich erlöst; ich habe dich bei deinem Namen gerufen; du bist mein.',
    quelle: 'Jesaja 43,1'
  }
];

/**
 * Waehlt einen Zuspruch -- stabil fuer dieselbe Person im selben Jahr.
 *
 * WARUM STABIL UND NICHT ZUFAELLIG: Der Rueckblick laesst sich beliebig oft
 * wieder oeffnen. Wechselte der Text dabei, waere er Dekoration; so bleibt
 * es der eine Satz, der fuer dieses Jahr zu dieser Person gehoert.
 *
 * @param {number} userId die Person
 * @param {number} jahr   das Jahr des Rueckblicks
 * @returns {{text: string, quelle: string}}
 */
function waehleSegen(userId, jahr) {
  const id = Number(userId) || 0;
  const j = Number(jahr) || 0;
  const index = Math.abs((id * 31 + j * 17)) % SEGENSWORTE.length;
  return SEGENSWORTE[index];
}

module.exports = { SEGENSWORTE, waehleSegen };
