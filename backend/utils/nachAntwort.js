// Seiteneffekte ausfuehren, NACHDEM die Antwort beim Client ist.
//
// Warum es das gibt: Mehrere Termin-Routen senden bewusst erst `res.json()`
// und erledigen danach Push, Badges und Live-Updates. Das ist fachlich
// richtig — die anfragende Person soll nicht warten, bis alle Pushes raus
// sind, und ein Push-Fehler darf die Buchung nicht kippen.
//
// Im Testlauf brach das aber sporadisch ab: supertest schliesst die
// Verbindung, sobald die Antwort da ist. Laeuft der Handler dann noch,
// trifft ein spaeterer Schreibversuch auf einen geschlossenen Socket, und
// der HTTP-Parser des naechsten Tests bekommt den Rest ab
// ("Parse Error: Expected HTTP/, RTSP/ or ICE/" / "socket hang up").
// Reproduzierbar 1 von rund 1200 Tests, wechselnd welcher.
//
// Dieser Helfer aendert am Ablauf im Betrieb nichts: Die Arbeit laeuft
// weiterhin nach der Antwort. Er haengt sie nur an ein Versprechen, das
// Tests abwarten koennen (`app.locals.offeneNachwehen`), und faengt Fehler
// ab, damit ein fehlgeschlagener Push keinen unbehandelten Promise-Fehler
// erzeugt.
//
// Verwendung in einer Route:
//   res.json({ ... });
//   nachAntwort(req, async () => {
//     await PushService.irgendwas(...);
//     liveUpdate.sendToOrg(...);
//   });

/**
 * Fuehrt `arbeit` aus, nachdem die Antwort raus ist.
 *
 * @param {import('express').Request} req  Anfrage (liefert app.locals)
 * @param {() => Promise<void>|void} arbeit  Die Seiteneffekte
 * @param {string} [bezeichnung]  Taucht in der Fehlermeldung auf
 * @returns {Promise<void>} Laeuft immer durch, wirft nie
 */
function nachAntwort(req, arbeit, bezeichnung = 'Seiteneffekt nach Antwort') {
  const lauf = (async () => {
    try {
      await arbeit();
    } catch (err) {
      // Bewusst nur melden: Diese Arbeit ist Beiwerk. Die eigentliche
      // Aenderung ist zu diesem Zeitpunkt laengst committet und bestaetigt.
      console.error(`${bezeichnung} fehlgeschlagen:`, err);
    }
  })();

  // Nur im Test mitschreiben, damit der Lauf abwartbar ist. In Produktion
  // waere ein wachsendes Set unnoetiger Ballast.
  const locals = req?.app?.locals;
  if (locals && process.env.NODE_ENV === 'test') {
    if (!locals.offeneNachwehen) locals.offeneNachwehen = new Set();
    locals.offeneNachwehen.add(lauf);
    lauf.finally(() => locals.offeneNachwehen.delete(lauf));
  }

  return lauf;
}

/**
 * Wartet, bis alle angefangenen Seiteneffekte durch sind. Nur fuer Tests —
 * in Produktion gibt es nichts zu warten, dort ist die Antwort schon weg.
 *
 * @param {import('express').Application} app
 */
async function warteAufNachwehen(app) {
  const offene = app?.locals?.offeneNachwehen;
  if (!offene) return;
  // Mehrfach durchlaufen: Ein Seiteneffekt kann seinerseits einen neuen
  // anstossen.
  for (let runde = 0; runde < 10 && offene.size > 0; runde++) {
    await Promise.allSettled([...offene]);
  }
}

module.exports = { nachAntwort, warteAufNachwehen };
