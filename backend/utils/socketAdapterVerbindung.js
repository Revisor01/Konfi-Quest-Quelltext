// backend/utils/socketAdapterVerbindung.js
//
// Huelle um den pg.Pool des Socket.IO-Postgres-Adapters, damit ein
// Verbindungsabbruch zur Datenbank den Backend-Prozess nicht mehr beendet
// 
//
// DAS PROBLEM: @socket.io/postgres-adapter (0.5.0, dist/util.js initClient)
// checkt fuer LISTEN dauerhaft EINEN Client aus dem Pool aus und bindet an ihn
// nur 'notification' und 'end'. Bricht diese Verbindung ab (Postgres-Neustart,
// OOM-Kill, Failover, `pg_terminate_backend`), feuert pg auf dem Client ein
// 'error'-Ereignis -- zweimal sogar: erst das FATAL des Servers, dann
// "Connection terminated unexpectedly" beim Schliessen des Sockets. Ohne
// Zuhoerer wirft Node ein uncaughtException, server.js faehrt geordnet
// herunter. Da alle Replicas dieselbe Datenbank nutzen, sterben alle im
// selben Moment; der Neustart scheitert, solange die Datenbank noch nicht
// wieder da ist. pool.on('error') in server.js hilft nicht: Der Pool hoert
// nur auf LEERLAUFENDE Verbindungen, die ausgecheckte gehoert dem Adapter.
//
// ZWEITES PROBLEM, erst hinter dem ersten sichtbar: Der Adapter plant auf
// 'end' seine Neuverbindung, gibt den toten Client aber nie an den Pool
// zurueck. Der Pool zaehlt ihn weiter als ausgeliehen; mit max 2 waere er
// nach dem zweiten Abbruch erschoepft und die Neuverbindung wartete ewig --
// Live-Updates und Chat-Zustellung an die andere Replica blieben stumm, ohne
// Fehlermeldung.
//
// DIE HUELLE gibt dem Adapter genau die zwei Methoden, die er benutzt
// (connect() und query()), und bringt jedem ausgecheckten Client bei:
//   - 'error' loggen statt sterben; der Adapter erfaehrt den Abbruch weiter
//     ueber 'end' und verbindet sich selbst neu (1-3 s, dist/util.js
//     scheduleReconnection), samt erneutem LISTEN auf allen Kanaelen.
//   - auf 'end' den Client MIT Fehler an den Pool zurueckgeben, damit pg-pool
//     ihn verwirft statt wiederverwendet und der Platz frei wird.
//   - release() gegen Doppelaufruf sichern: pg-pool wirft beim zweiten
//     release() -- und der Adapter ruft beim regulaeren Schliessen selbst
//     release(), bevor der Pool die Verbindung beendet.
//
// Kein eigener LISTEN-Client, keine Kopie des Adapters: Die Reconnect-Logik
// bleibt im Adapter, hier steht nur, was ihm fehlt.

/**
 * @param {import('pg').Pool} pool - der Adapter-Pool aus server.js
 * @param {object} [optionen]
 * @param {(...args: any[]) => void} [optionen.log] - Logger (Standard console.error)
 * @returns {{ connect: () => Promise<import('pg').PoolClient>, query: Function, schliessen: () => void }}
 */
function mitVerbindungsschutz(pool, { log = console.error } = {}) {
  let verbindungenBisher = 0;
  let geschlossen = false;
  const ausgeliehen = new Set();
  const nieFertig = () => new Promise(() => {});

  return {
    query: (...args) => pool.query(...args),

    // Beim Herunterfahren zwischen io.close() und pool.end() aufrufen.
    schliessen() {
      geschlossen = true;
      for (const client of ausgeliehen) {
        client.release(new Error('Socket.IO-Adapter wird geschlossen'));
      }
    },

    async connect() {
      if (geschlossen) return nieFertig();
      const client = await pool.connect();
      if (geschlossen) {
        // Die Anfrage lief schon, als geschlossen wurde.
        client.release(new Error('Socket.IO-Adapter wird geschlossen'));
        return nieFertig();
      }
      ausgeliehen.add(client);
      verbindungenBisher++;
      if (verbindungenBisher > 1) {
        log('Socket.IO-Adapter: Verbindung zur Datenbank wieder aufgebaut.');
      }

      // pg-pool setzt client.release je Ausleihe neu; hier die Fassung dieser
      // Ausleihe festhalten und gegen Doppelaufruf sichern.
      const releaseOriginal = client.release;
      let zurueckgegeben = false;
      client.release = (err) => {
        if (zurueckgegeben) return;
        zurueckgegeben = true;
        ausgeliehen.delete(client);
        releaseOriginal.call(client, err);
      };

      let gemeldet = false;
      client.on('error', (err) => {
        // Zwei 'error'-Ereignisse je Abbruch (siehe oben) -- einmal melden reicht.
        // Nach schliessen() ist das Ende gewollt, kein Abbruch.
        if (gemeldet || geschlossen) return;
        gemeldet = true;
        log('Socket.IO-Adapter: LISTEN-Verbindung zur Datenbank verloren, verbinde neu:', err.message);
      });

      client.on('end', () => {
        // Beim regulaeren Schliessen (adapter.close -> release ohne Fehler)
        // ist zurueckgegeben schon true; dann passiert hier nichts. Nach einem
        // Abbruch haelt der Adapter den toten Client noch -- mit Fehler
        // zurueckgeben heisst fuer pg-pool: verwerfen, nicht wieder ausleihen.
        client.release(new Error('LISTEN-Verbindung beendet'));
      });

      return client;
    },
  };
}

module.exports = { mitVerbindungsschutz };
