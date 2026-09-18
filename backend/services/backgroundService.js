const PushService = require('./pushService');
const cron = require('node-cron');
const { deleteKonfiCascade } = require('../utils/konfiDeletion');
const { meldeNachrueckern } = require('../utils/nachrueckMeldung');
const emailService = require('./emailService');
const apm = require('../utils/apm');
const { formatUhrzeit, heuteBerlin } = require('../utils/zeitformat');
const { appIconSummenFuerAlle } = require('../utils/appIconBadge');
const { abzeichenFingerabdruecke } = require('../utils/abzeichenKandidaten');

// Vorlauf für die Lizenz-Ablauf-Erinnerung (Tage vor trial_ends_at)
const LICENSE_REMINDER_DAYS = 14;

class BackgroundService {
  static badgeUpdateInterval = null;
  static eventReminderInterval = null;
  static pendingEventsCronTask = null;
  static tokenCleanupInterval = null;
  static wrappedCronTask = null;
  static autoDeletionCronTask = null;
  static trialExpiryCronTask = null;
  static apmSnapshotInterval = null;
  static challengeStartInterval = null;
  static wrappedRouter = null;
  static badgeCheckInterval = null;
  // Zuletzt an das jeweilige Geraet gesendeter Zaehlerstand. Verhindert, dass
  // jeder Takt dieselbe Zahl erneut schickt, und erlaubt trotzdem das
  // Zuruecknehmen auf null (siehe updateAllUserBadges).
  static letzterZaehler = new Map();
  // Fingerabdruck der Datenlage je Person beim letzten Abzeichen-Lauf. Wer
  // denselben Abdruck hat wie vorher, kann kein Abzeichen neu verdient haben
  // und wird uebersprungen (Begruendung in utils/abzeichenKandidaten.js).
  static letzterAbzeichenAbdruck = new Map();

  // Wie viele Personen am Stueck geprueft werden, bevor der Lauf kurz
  // pausiert. Die Pause gibt die Pool-Verbindung frei, damit ein grosser
  // Lauf nicht dauerhaft einen von 20 Plaetzen belegt.
  static ABZEICHEN_BLOCK = 50;
  static ABZEICHEN_PAUSE_MS = 50;

  // Mit der Grenze bearbeitet ein Lauf hoechstens 800 Personen (gemessen
  // rund 10 Sekunden) und der Rest kommt in den naechsten Laeufen dran. Ein
  // Kaltstart mit 10.000 Personen ist so nach 13 Stunden aufgearbeitet, ohne
  // dass irgendein Lauf den Pool blockiert. Das ist vertretbar: Der Kaltstart
  // holt ohnehin nur nach, was waehrend der Auszeit liegen blieb, und der
  // regulaere Weg (Aktivitaet eintragen) vergibt weiterhin sofort.
  //
  // Wer zuerst: die kleinsten user_id zuerst waere unfair gegenueber den
  // hinteren. Deshalb merkt sich der Dienst, wo er stehen geblieben ist, und
  // setzt dort fort (abzeichenZeiger).
  static ABZEICHEN_MAX_JE_LAUF = 800;
  static abzeichenZeiger = 0;

  /**
   * Startet regelmäßige Badge Updates für alle User (alle 5 Minuten)
   */
  static startBadgeUpdateService(db) {
    if (this.badgeUpdateInterval) {
      return;
    }

    // Zwei Aufgaben mit sehr verschiedener Dringlichkeit, deshalb zwei Takte:
    //
    //   Der App-Icon-Zähler soll zeitnah stimmen -> alle 5 Minuten.
    //   Die Abzeichen-Prüfung hängt an Wochen und Jahren (streak,
    //   time_based, teamer_year); alle anderen Kriterien werden ohnehin sofort
    //   nach dem ausloesenden Ereignis geprüft. Ein Fuenf-Minuten-Takt fragte
    //   288-mal täglich etwas ab, das sich höchstens einmal täglich ändert.
    const FUENF_MINUTEN = 5 * 60 * 1000;
    const EINE_STUNDE = 60 * 60 * 1000;

    this.badgeUpdateInterval = setInterval(async () => {
      try {
        await this.updateAllUserBadges(db, { nurZaehler: true });
      } catch (error) {
        console.error('Background badge update failed:', error);
      }
    }, FUENF_MINUTEN);

    this.badgeCheckInterval = setInterval(async () => {
      try {
        await this.updateAllUserBadges(db);
      } catch (error) {
        console.error('Background badge check failed:', error);
      }
    }, EINE_STUNDE);
  }

  /**
   * Stoppt den Badge Update Service
   */
  static stopBadgeUpdateService() {
    if (this.badgeUpdateInterval) {
      clearInterval(this.badgeUpdateInterval);
      this.badgeUpdateInterval = null;
    }
    if (this.badgeCheckInterval) {
      clearInterval(this.badgeCheckInterval);
      this.badgeCheckInterval = null;
    }
  }

  /**
   * Aktualisiert Badge Counts für alle User mit Push Tokens
   */
  /**
   * @param {object} db
   * @param {{nurZaehler?: boolean}} optionen  nurZaehler = App-Icon-Zähler
   *        aktualisieren, die teure Abzeichen-Prüfung auslassen.
   */
  static async updateAllUserBadges(db, optionen = {}) {
    const { nurZaehler = false } = optionen;
    try {
      // Alle Konfis und Teamer:innen laden — NICHT nur die mit Push-Token.
      //
      // Das Setzen des App-Icon-Zaehlers braucht ein Token, die
      // Abzeichen-Prüfung nicht. Beides ist unten getrennt.
      const usersQuery = `
        SELECT u.id AS user_id,
               u.organization_id,
               CASE WHEN r.name = 'konfi' THEN 'konfi'
                    WHEN r.name = 'teamer' THEN 'teamer'
                    ELSE 'admin' END AS user_type,
               r.name as role_name,
               EXISTS (
                 SELECT 1 FROM push_tokens pt
                 WHERE pt.user_id = u.id AND pt.token IS NOT NULL
               ) AS hat_push
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE r.name IN ('konfi', 'teamer', 'admin', 'org_admin')
          AND u.deleted_at IS NULL
          AND u.is_active = true
      `;
      const { rows: users } = await db.query(usersQuery, []);

      if (!users || users.length === 0) {
        return { updated: 0 };
      }

      let updatedCount = 0;
      const checkAndAwardBadges = require('../routes/badges').checkAndAwardBadges;

      // Eintraege zu Konten, die es nicht mehr gibt, aus dem Merker werfen —
      // sonst waechst er über die Laufzeit mit jedem geloeschten Konto.
      if (this.letzterZaehler.size > users.length) {
        const aktuell = new Set(users.map(u => `${u.user_id}_${u.user_type}`));
        for (const schluessel of this.letzterZaehler.keys()) {
          if (!aktuell.has(schluessel)) this.letzterZaehler.delete(schluessel);
        }
      }

      // BULK: Die App-Icon-Summe fuer ALLE auf einmal, nicht pro Person.
      //
      // Gerechnet wird fuer alle, gesendet nur an Geraete mit Token — die
      // Abzeichen-Pruefung unten braucht ohnehin die volle Liste.
      // Jahrgaenge fuer Teamer:innen UND die Rolle 'admin', in
      // EINER Abfrage: Bei beiden haengen die Zaehler an der Zuweisung
      // (Freigaben bei Teamer:innen; Antraege, Termine und Freigaben bei
      // gebundenen Admins). org_admin zaehlt org-weit und braucht keine.
      const teamerIds = users
        .filter(u => u.user_type === 'teamer' || u.role_name === 'admin')
        .map(u => u.user_id);
      const jahrgaengeProTeamer = new Map();
      if (teamerIds.length > 0) {
        const { rows: zuweisungen } = await db.query(
          'SELECT user_id, jahrgang_id AS id, can_view FROM user_jahrgang_assignments WHERE user_id = ANY($1::int[])',
          [teamerIds]
        );
        for (const z of zuweisungen) {
          if (!jahrgaengeProTeamer.has(z.user_id)) jahrgaengeProTeamer.set(z.user_id, []);
          jahrgaengeProTeamer.get(z.user_id).push({ id: z.id, can_view: z.can_view });
        }
      }

      // MULTI-ORG: Hier stand nur
      // `organization_id: u.organization_id` -- die PRIMAER-Organisation. Wer
      // mehreren Gemeinden angehoert, bekam damit alle fuenf Minuten die Zahl
      // EINER Organisation aufs Icon, egal was in den anderen offen war.
      //
      // Gemessen an einem echten Konto: Org 1 = 6, Org 2 = 0, Org 4 = 29.
      // Der Push (berechneBadge) sendete nach seinem Fix korrekt 35 -- der
      // Hintergrund-Sync ueberschrieb sie kurz darauf wieder mit 6. Genau das
      // war beobachtbar: Push zeigt 35, App oeffnen zeigt 6, wenig spaeter 0.
      //
      // Loesung wie in berechneBadge: je Organisation ein Eintrag, danach
      // aufaddieren. Fuer Single-Org-Konten (alle Konfis, die meisten
      // Teamer:innen) aendert sich nichts -- ein Eintrag wie bisher.
      const orgsProUser = new Map();
      const mehrfachIds = users.map(u => u.user_id);
      if (mehrfachIds.length > 0) {
        const { rows: zuordnungen } = await db.query(
          'SELECT user_id, organization_id FROM user_organizations WHERE user_id = ANY($1::int[])',
          [mehrfachIds]
        );
        for (const z of zuordnungen) {
          if (!orgsProUser.has(z.user_id)) orgsProUser.set(z.user_id, new Set());
          orgsProUser.get(z.user_id).add(z.organization_id);
        }
      }

      const empfaenger = [];
      for (const u of users) {
        const orgs = orgsProUser.get(u.user_id) || new Set();
        // Die Primaer-Org gehoert immer dazu, auch wenn user_organizations
        // sie (noch) nicht fuehrt.
        if (u.organization_id != null) orgs.add(u.organization_id);
        // Ohne jede Organisation trotzdem EINEN Eintrag anlegen: Sonst faellt
        // das Konto stillschweigend aus der Zaehlung, statt eine 0 zu bekommen.
        if (orgs.size === 0) orgs.add(u.organization_id ?? null);
        for (const orgId of orgs) {
          empfaenger.push({
            id: u.user_id,
            type: u.user_type,
            role_name: u.role_name,
            organization_id: orgId,
            assigned_jahrgaenge: jahrgaengeProTeamer.get(u.user_id) || []
          });
        }
      }

      // appIconSummenFuerAlle schluesselt nach `id_type` -- bei mehreren
      // Organisationen desselben Kontos kaeme sonst nur die letzte an.
      // Deshalb je Organisation einmal rechnen und hier addieren.
      const summen = new Map();
      const nachOrg = new Map();
      for (const e of empfaenger) {
        if (!nachOrg.has(e.organization_id)) nachOrg.set(e.organization_id, []);
        nachOrg.get(e.organization_id).push(e);
      }
      for (const [, liste] of nachOrg) {
        const teil = await appIconSummenFuerAlle(db, liste);
        for (const [schluessel, wert] of teil) {
          if (wert == null) continue;
          summen.set(schluessel, (summen.get(schluessel) || 0) + wert);
        }
      }

      // AUSWAHL FUER DIE ABZEICHEN-PRUEFUNG.
      //
      // Bis hierher lief die teure Pruefung ueber JEDE Person, jede Stunde —
      // rund 27 Abfragen und 12,9 ms pro Person, gemessen gegen eine echte
      // Postgres-Instanz. Bei 110 Personen faellt das nicht auf; bei 2.500
      // waeren es 67.000 Abfragen und rund 32 Sekunden, bei 10.000 rund
      // 268.000 Abfragen und ueber zwei Minuten am Stueck, die ganze Zeit auf
      // einer von 20 Pool-Verbindungen.
      //
      // Kein Kriterium kann allein durch Zeitablauf neu erfuellt werden
      // (Herleitung Kriterium fuer Kriterium in utils/abzeichenKandidaten.js).
      // Wessen Datenlage sich seit dem letzten Lauf nicht geaendert hat, kann
      // also auch kein Abzeichen neu verdient haben. Der Fingerabdruck kostet
      // sieben Abfragen fuer ALLE zusammen — unabhaengig von der Anzahl.
      //
      // Beim ERSTEN Lauf nach dem Start ist der Merker leer: dann steht jeder
      // auf der Liste. Das ist Absicht — ein Neustart darf nichts
      // verschlucken, was waehrend der Auszeit faellig wurde. Damit dieser
      // eine Lauf den Pool nicht minutenlang belegt, begrenzt
      // ABZEICHEN_MAX_JE_LAUF ihn; der Rest kommt in den Folgelaeufen dran.
      const abzeichenPersonen = (!nurZaehler)
        ? users.filter(u => u.user_type === 'konfi' || u.user_type === 'teamer')
        : [];
      let zuPruefen = new Set();
      let neueAbdruecke = null;
      if (abzeichenPersonen.length > 0) {
        try {
          neueAbdruecke = await abzeichenFingerabdruecke(db, abzeichenPersonen);
          for (const u of abzeichenPersonen) {
            const jetzt = neueAbdruecke.get(u.user_id);
            const vorher = this.letzterAbzeichenAbdruck.get(u.user_id);
            // Unbekannt (erster Lauf, neues Konto) ODER veraendert -> pruefen.
            if (vorher === undefined || vorher !== jetzt) zuPruefen.add(u.user_id);
          }
        } catch (abdruckErr) {
          // Der Fingerabdruck ist eine Abkuerzung, kein Tor. Faellt er aus,
          // wird geprueft wie frueher — lieber zu viel Arbeit als ein
          // verschlucktes Abzeichen.
          console.error('Abzeichen-Fingerabdruck fehlgeschlagen, prüfe alle:', abdruckErr);
          neueAbdruecke = null;
          zuPruefen = new Set(abzeichenPersonen.map(u => u.user_id));
        }

        // Obergrenze je Lauf (siehe ABZEICHEN_MAX_JE_LAUF). Nur wenn mehr
        // anstehen, als ein Lauf tragen soll — im Regelbetrieb greift das nie.
        if (zuPruefen.size > this.ABZEICHEN_MAX_JE_LAUF) {
          // Ab dem Zeiger weiterlaufen und hinten wieder vorn anfangen, damit
          // ueber die Laeufe hinweg jeder drankommt und niemand dauerhaft
          // hinten liegen bleibt.
          const warteschlange = abzeichenPersonen
            .map(u => u.user_id)
            .filter(id => zuPruefen.has(id));
          const start = this.abzeichenZeiger % warteschlange.length;
          const dranheute = new Set();
          for (let i = 0; i < this.ABZEICHEN_MAX_JE_LAUF; i++) {
            dranheute.add(warteschlange[(start + i) % warteschlange.length]);
          }
          this.abzeichenZeiger = (start + this.ABZEICHEN_MAX_JE_LAUF) % warteschlange.length;
          console.warn(
            `Abzeichen-Prüfung: ${zuPruefen.size} Personen stehen an, ` +
            `${dranheute.size} in diesem Lauf — der Rest folgt in den nächsten Läufen.`
          );
          zuPruefen = dranheute;
        }
      }

      let geprueft = 0;
      for (const user of users) {
        try {
          // App-Icon-Zähler nachfuehren. Nur für Geraete mit Token — ohne
          // Token gibt es kein App-Icon.
          //
          // Auch die NULL wird gesendet, und das ist der Kern: Vorher lief das
          // unter `badgeCount > 0`, eine Zahl wurde also nie zurückgenommen.
          // Wer alles gelesen hatte, behielt seinen Zähler, bis die App ihn
          // beim nächsten Start selbst loeschte — auf Android blieb er
          // dadurch oft einfach stehen.
          //
          // Damit daraus kein Dauerfeuer wird, merken wir uns den zuletzt
          // gesendeten Stand und schicken nur bei Änderung. Im Regelfall
          // bedeutet das genau EINEN zusaetzlichen Push, wenn der Zähler auf
          // null fällt.
          if (user.hat_push) {
            const schluessel = `${user.user_id}_${user.user_type}`;
            // Erst vergleichen, dann senden — sonst ginge bei JEDEM Lauf ein
            // stiller Push raus und der Merker liefe leer.
            const zuSenden = summen.get(schluessel);

            if (zuSenden != null && this.letzterZaehler.get(schluessel) !== zuSenden) {
              await PushService.sendBadgeUpdate(db, user.user_id);
              this.letzterZaehler.set(schluessel, zuSenden);
              updatedCount++;
            }
          }

          if (!nurZaehler && zuPruefen.has(user.user_id)) {
            await checkAndAwardBadges(db, user.user_id);
            geprueft++;

            // In Bloecken arbeiten statt am Stueck: Nach je
            // ABZEICHEN_BLOCK Personen einen Takt pausieren. Das gibt die
            // Pool-Verbindung zwischendurch frei, damit ein grosser Lauf
            // nicht dauerhaft einen von 20 Plaetzen belegt und die API
            // daneben weiter antworten kann.
            if (geprueft % this.ABZEICHEN_BLOCK === 0) {
              await new Promise(r => setTimeout(r, this.ABZEICHEN_PAUSE_MS));
            }
          }
        } catch (error) {
          console.error(`Badge update failed for user ${user.user_id}:`, error);
        }
      }

      // Den Merker erst NACH dem Lauf fortschreiben, und nur fuer die
      // Personen, die auch tatsaechlich geprueft wurden. Waere er vorher
      // gesetzt, ginge eine Aenderung verloren, sobald eine Pruefung
      // unterwegs scheitert — beim naechsten Lauf sähe der Abdruck dann
      // unveraendert aus und die Person fiele still heraus.
      if (neueAbdruecke) {
        for (const u of abzeichenPersonen) {
          if (zuPruefen.has(u.user_id)) {
            this.letzterAbzeichenAbdruck.set(u.user_id, neueAbdruecke.get(u.user_id));
          }
        }
        // Geloeschte Konten aus dem Merker werfen, sonst waechst er mit der
        // Laufzeit (dieselbe Vorsorge wie bei letzterZaehler oben).
        if (this.letzterAbzeichenAbdruck.size > abzeichenPersonen.length) {
          const aktuell = new Set(abzeichenPersonen.map(u => u.user_id));
          for (const id of this.letzterAbzeichenAbdruck.keys()) {
            if (!aktuell.has(id)) this.letzterAbzeichenAbdruck.delete(id);
          }
        }
      }

      return { updated: updatedCount, total: users.length, geprueft };

    } catch (error) {
      console.error('Error in updateAllUserBadges:', error);
      throw error;
    }
  }

  // ====================================================================
  // EVENT REMINDER SERVICE
  // ====================================================================

  /**
   * Startet den Event-Erinnerungs-Service (alle 15 Minuten)
   */
  static startEventReminderService(db) {
    if (this.eventReminderInterval) {
      return;
    }

    // Sofort einmal ausfuehren, dann alle 15 Minuten.
    // .catch() ist Pflicht: sendEventReminders wirft den Fehler weiter (rethrow),
    // ein nackter Aufruf ohne await/catch wuerde als unhandled rejection den
    // Prozess beenden — und mit `restart: unless-stopped` eine Neustartschleife
    // ausloesen, die von aussen unsichtbar bleibt (nur die Cron-Leader-Replica
    // startet die Hintergrund-Jobs, die API antwortet weiter).
    this.sendEventReminders(db).catch(err =>
      console.error('Event reminder (initial) failed:', err));

    const FIFTEEN_MINUTES = 15 * 60 * 1000;
    this.eventReminderInterval = setInterval(async () => {
      try {
        await this.sendEventReminders(db);
      } catch (error) {
        console.error('Event reminder service failed:', error);
      }
    }, FIFTEEN_MINUTES);
  }

  /**
   * Stoppt den Event-Erinnerungs-Service
   */
  static stopEventReminderService() {
    if (this.eventReminderInterval) {
      clearInterval(this.eventReminderInterval);
      this.eventReminderInterval = null;
    }
  }

  /**
   * Startet den "Anmeldung möglich"-Push-Service.
   * Sendet für Events, deren Anmeldezeitraum geoeffnet hat (z.B. registration_opens_at
   * in der Zukunft beim Anlegen, jetzt erreicht), den "Neues Event"-Push an die
   * Org-Konfis. Flanke über events.registration_open_notified (Erstellen/Ändern
   * setzen/reset das Flag synchron, dieser Cron faengt die zeitgesteuerten Fälle).
   */
  static startRegistrationOpenService(db) {
    if (this.registrationOpenInterval) return;
    // Erstlauf verzoegert (30s), damit beim Boot zuerst die Migrations durch sind
    // (sonst Race: Spalte registration_open_notified evtl. noch nicht vorhanden).
    // Danach alle 5 Minuten (feinkoernig, da Anmeldestart sekundengenau wirkt).
    setTimeout(() => {
      this.sendRegistrationOpenPushes(db).catch(err =>
        console.error('Registration-open push (initial) failed:', err));
    }, 30 * 1000);
    const ONE_MINUTE = 60 * 1000;
    this.registrationOpenInterval = setInterval(async () => {
      try {
        await this.sendRegistrationOpenPushes(db);
      } catch (error) {
        console.error('Registration-open push service failed:', error);
      }
    }, ONE_MINUTE);
  }

  static stopRegistrationOpenService() {
    if (this.registrationOpenInterval) {
      clearInterval(this.registrationOpenInterval);
      this.registrationOpenInterval = null;
    }
  }

  /**
   * Findet Events, die JETZT für Konfis anmeldbar sind, aber noch nicht
   * benachrichtigt wurden, und sendet den "Anmeldung möglich"-Push.
   */
  static async sendRegistrationOpenPushes(db) {
    try {
      // ATOMAR: Flag in DERSELBEN Query auf true flippen und nur die geflippten
      // Zeilen zurueckgeben (RETURNING). So kann KEIN Event doppelt gepusht werden
      // (auch nicht bei parallelen Laeufen / Race mit POST/PUT) — wer die Zeile von
      // false->true setzt, ist allein für den Push zustaendig.
      // Anmeldbar = Fenster offen, nicht abgesagt, kein reines Teamer-Event,
      // kein Pflicht-Event (eigener Erstellungs-Push).
      const { rows: events } = await db.query(`
        UPDATE events
        SET registration_open_notified = true
        WHERE registration_open_notified = false
          AND cancelled IS NOT TRUE
          AND (teamer_only IS NULL OR teamer_only = false)
          AND (mandatory IS NULL OR mandatory = false)
          AND (registration_opens_at IS NULL OR registration_opens_at <= NOW())
          AND (registration_closes_at IS NULL OR registration_closes_at >= NOW())
        RETURNING id, name, event_date, organization_id
      `);

      for (const ev of events) {
        try {
          await PushService.sendNewEventToOrgKonfis(db, ev.organization_id, ev.name, ev.event_date, ev.id);
        } catch (err) {
          console.error(`Registration-open push failed for event ${ev.id}:`, err.message);
        }
      }
    } catch (error) {
      console.error('sendRegistrationOpenPushes error:', error);
    }
  }

  // ====================================================================
  // CHALLENGE-START-PUSH SERVICE
  // ====================================================================

  /**
   * Startet den Challenge-Start-Push-Service (alle 5 Minuten).
   * Challenges werden geplant (starts_at in der Zukunft) und sollen genau dann
   * einen Push an die Konfis der zugewiesenen Jahrgänge auslösen, wenn sie
   * tatsaechlich starten. Idempotent über challenges.start_push_sent.
   */
  static startChallengeStartService(db) {
    if (this.challengeStartInterval) return;

    // Erstlauf verzoegert (30s), damit beim Boot zuerst die Migrations durch
    // sind (sonst Race: Tabelle challenges evtl. noch nicht vorhanden).
    setTimeout(() => {
      this.sendChallengeStartPushes(db).catch(err =>
        console.error('Challenge-Start-Push (initial) failed:', err));
    }, 30 * 1000);

    const FIVE_MINUTES = 5 * 60 * 1000;
    this.challengeStartInterval = setInterval(async () => {
      try {
        await this.sendChallengeStartPushes(db);
      } catch (error) {
        console.error('Challenge-Start-Push-Service failed:', error);
      }
    }, FIVE_MINUTES);
  }

  static stopChallengeStartService() {
    if (this.challengeStartInterval) {
      clearInterval(this.challengeStartInterval);
      this.challengeStartInterval = null;
    }
  }

  /**
   * Findet Challenges, die JETZT gestartet sind, aber noch keinen Start-Push
   * ausgelöst haben, und benachrichtigt die Konfis der zugewiesenen Jahrgänge.
   *
   * ATOMAR: das Flag wird in DERSELBEN Query auf true geflippt und nur die
   * geflippten Zeilen zurueckgegeben (RETURNING) — so kann KEINE Challenge
   * doppelt gepusht werden, auch nicht bei parallelen Laeufen.
   * Beendete Challenges werden übersprungen (ends_at > NOW()): eine Challenge,
   * die während eines Ausfalls komplett durchgelaufen ist, soll nicht
   * nachträglich noch "mach mit!" pushen.
   */
  static async sendChallengeStartPushes(db) {
    try {
      const { rows: challenges } = await db.query(`
        UPDATE challenges
        SET start_push_sent = true
        WHERE start_push_sent = false
          AND is_draft = false
          AND starts_at <= NOW()
          AND ends_at > NOW()
        RETURNING id, title
      `);

      for (const challenge of challenges) {
        try {
          await PushService.sendChallengeStartedToJahrgaenge(db, challenge.id, challenge.title);
        } catch (err) {
          console.error(`Challenge-Start-Push failed for challenge ${challenge.id}:`, err.message);
        }
      }
    } catch (error) {
      console.error('sendChallengeStartPushes error:', error);
    }
  }

  /**
   * Sendet Event-Erinnerungen (1 Tag und 1 Stunde vorher)
   *
   * Der Filter haengt bewusst NICHT an eb.status: sollte das Abmelden spaeter
   * zusaetzlich status='excused' setzen, greift `attendance_status IS NULL`
   * unveraendert. `eb.status = 'confirmed'` bleibt als Positivliste stehen —
   * ein kuenftiges 'excused' faellt dort ohnehin heraus, das ist dieselbe
   * Entscheidung, nur doppelt getroffen. Eine Aufweichung zu
   * `status <> 'cancelled'` waere falsch: Warteliste und Absage duerfen keine
   * Erinnerung bekommen.
   */
  static async sendEventReminders(db) {
    try {
      const now = new Date();

      // 1. Events die morgen stattfinden (1 Tag vorher Erinnerung)
      const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const oneDayWindowStart = new Date(oneDayFromNow.getTime() - 15 * 60 * 1000);
      const oneDayWindowEnd = new Date(oneDayFromNow.getTime() + 15 * 60 * 1000);

      const oneDayQuery = `
        SELECT DISTINCT e.id, e.name, e.event_date, e.organization_id, eb.user_id
        FROM events e
        JOIN event_bookings eb ON e.id = eb.event_id
        WHERE eb.status = 'confirmed'
          AND eb.attendance_status IS NULL
          AND e.cancelled IS NOT TRUE
          AND e.event_date::date = $1::date
          AND NOT EXISTS (
            SELECT 1 FROM event_reminders er
            WHERE er.event_id = e.id
              AND er.user_id = eb.user_id
              AND er.reminder_type = '1_day'
          )
      `;

      // heuteBerlin() statt toISOString(): Der Vergleich unten laeuft gegen
      // e.event_date::date unter Berliner Sitzungszone. Mit dem UTC-Tag traf
      // der nachts laufende Terminhinweis den falschen Kalendertag.
      const tomorrowDate = heuteBerlin(oneDayFromNow);
      const { rows: oneDayEvents } = await db.query(oneDayQuery, [tomorrowDate]);

      for (const event of oneDayEvents) {
        try {
          // Extrahiere Zeit aus event_date
          const eventTime = event.event_date ? formatUhrzeit(event.event_date) : null;
          await PushService.sendEventReminderToKonfi(
            db,
            event.user_id,
            event.name,
            event.event_date,
            eventTime,
            '1_day',
            event.organization_id
          );

          // Erinnerung als gesendet markieren
          await db.query(
            `INSERT INTO event_reminders (event_id, user_id, reminder_type, sent_at) VALUES ($1, $2, '1_day', NOW())`,
            [event.id, event.user_id]
          );
        } catch (err) {
          console.error(`1-day reminder failed for event ${event.id}, user ${event.user_id}:`, err);
        }
      }

      // 2. Events die in ca. 1 Stunde stattfinden
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const oneHourWindowStart = new Date(oneHourFromNow.getTime() - 15 * 60 * 1000);
      const oneHourWindowEnd = new Date(oneHourFromNow.getTime() + 15 * 60 * 1000);

      const oneHourQuery = `
        SELECT DISTINCT e.id, e.name, e.event_date, e.organization_id, eb.user_id
        FROM events e
        JOIN event_bookings eb ON e.id = eb.event_id
        WHERE eb.status = 'confirmed'
          AND eb.attendance_status IS NULL
          AND e.cancelled IS NOT TRUE
          AND e.event_date BETWEEN $1 AND $2
          AND NOT EXISTS (
            SELECT 1 FROM event_reminders er
            WHERE er.event_id = e.id
              AND er.user_id = eb.user_id
              AND er.reminder_type = '1_hour'
          )
      `;

      const { rows: oneHourEvents } = await db.query(oneHourQuery, [oneHourWindowStart, oneHourWindowEnd]);

      for (const event of oneHourEvents) {
        try {
          const eventTime = event.event_date ? formatUhrzeit(event.event_date) : null;
          await PushService.sendEventReminderToKonfi(
            db,
            event.user_id,
            event.name,
            event.event_date,
            eventTime,
            '1_hour',
            event.organization_id
          );

          await db.query(
            `INSERT INTO event_reminders (event_id, user_id, reminder_type, sent_at) VALUES ($1, $2, '1_hour', NOW())`,
            [event.id, event.user_id]
          );
        } catch (err) {
          console.error(`1-hour reminder failed for event ${event.id}, user ${event.user_id}:`, err);
        }
      }

    } catch (error) {
      console.error('Error in sendEventReminders:', error);
      throw error;
    }
  }

  // ====================================================================
  // PENDING EVENTS ADMIN REMINDER SERVICE
  // ====================================================================

  /**
   * Startet den Service für Admin-Erinnerungen (täglich 09:00 Europe/Berlin).
   * Vorher alle 4 Stunden via setInterval (Boot-verankert) — das führte zu bis zu
   * 6 identischen Pushes pro Tag, auch nachts. Jetzt genau eine Erinnerung pro Tag,
   * solange Events unverbucht sind.
   */
  static startPendingEventsService(db) {
    if (this.pendingEventsCronTask) {
      return;
    }

    console.log('Pending-Events-Cron: Starte node-cron 0 9 * * * Europe/Berlin');

    // '0 9 * * *' = täglich um 09:00 Uhr
    this.pendingEventsCronTask = cron.schedule('0 9 * * *', async () => {
      try {
        await this.checkPendingEvents(db);
      } catch (error) {
        console.error('Pending events check failed:', error);
      }
    }, {
      timezone: 'Europe/Berlin'
    });
  }

  /**
   * Stoppt den Pending Events Service
   */
  static stopPendingEventsService() {
    if (this.pendingEventsCronTask) {
      this.pendingEventsCronTask.stop();
      this.pendingEventsCronTask = null;
    }
  }

  /**
   * Prüft ob es Events gibt die verbucht werden müssen
   */
  static async checkPendingEvents(db) {
    try {
      // Events die vorbei sind und noch nicht alle Teilnehmer verbucht haben.
      //
      // Geloeschte Konten zaehlen nicht mit: Sonst erinnerte die App ewig an
      // eine Buchung, die niemand mehr verbuchen kann.
      const query = `
        SELECT e.organization_id, COUNT(DISTINCT e.id) as pending_count
        FROM events e
        JOIN event_bookings eb ON e.id = eb.event_id
        JOIN users u ON eb.user_id = u.id AND u.deleted_at IS NULL
        WHERE e.event_date < CURRENT_DATE
          AND e.cancelled IS NOT TRUE
          AND eb.status = 'confirmed'
          AND eb.attendance_status IS NULL
        GROUP BY e.organization_id
        HAVING COUNT(DISTINCT e.id) > 0
      `;

      const { rows: pendingOrgs } = await db.query(query);

      for (const org of pendingOrgs) {
        try {
          await PushService.sendEventsPendingApprovalToAdmins(db, org.organization_id, org.pending_count);
        } catch (err) {
          console.error(`Pending events reminder failed for org ${org.organization_id}:`, err);
        }
      }

    } catch (error) {
      console.error('Error in checkPendingEvents:', error);
      throw error;
    }
  }

  // ====================================================================
  // TOKEN CLEANUP SERVICE
  // ====================================================================

  /**
   * Startet den Token-Cleanup Service (alle 6 Stunden)
   * Bereinigt fehlerhafte, inaktive und verwaiste Push-Tokens
   */
  static startTokenCleanupService(db) {
    if (this.tokenCleanupInterval) {
      return;
    }

    // Sofort einmal ausfuehren. .catch() ist Pflicht — cleanupStaleTokens wirft
    // den Fehler weiter (rethrow), ein nackter Aufruf wuerde den Prozess ueber
    // eine unhandled rejection beenden (siehe startEventReminderService).
    this.cleanupStaleTokens(db).catch(err =>
      console.error('Token cleanup (initial) failed:', err));

    const SIX_HOURS = 6 * 60 * 60 * 1000;
    this.tokenCleanupInterval = setInterval(async () => {
      try {
        await this.cleanupStaleTokens(db);
      } catch (error) {
        console.error('Token cleanup service failed:', error);
      }
    }, SIX_HOURS);
  }

  /**
   * Stoppt den Token-Cleanup Service
   */
  static stopTokenCleanupService() {
    if (this.tokenCleanupInterval) {
      clearInterval(this.tokenCleanupInterval);
      this.tokenCleanupInterval = null;
    }
  }

  /**
   * Bereinigt verwaiste und fehlerhafte Push-Tokens
   * - error_count >= 10: Token hat zu viele Fehler
   * - updated_at > 30 Tage: Token ist inaktiv
   * - user_id nicht in users: User wurde gelöscht
   */
  static async cleanupStaleTokens(db) {
    try {
      // 1. Fehlerhafte Tokens (error_count >= 10)
      const { rows: errorTokens } = await db.query(
        'DELETE FROM push_tokens WHERE error_count >= 10 RETURNING id'
      );

      // 2. Inaktive Tokens (aelter als 30 Tage)
      const { rows: inactiveTokens } = await db.query(
        "DELETE FROM push_tokens WHERE updated_at < NOW() - INTERVAL '30 days' RETURNING id"
      );

      // 3. Verwaiste Tokens (User existiert nicht mehr)
      const { rows: orphanedTokens } = await db.query(
        'DELETE FROM push_tokens WHERE user_id NOT IN (SELECT id FROM users) RETURNING id'
      );

      // 4. Tokens von Usern ohne eine einzige gueltige Sitzung (stiller
      //    Sitzungsablauf). Laeuft der letzte Refresh-Token ab oder wird er
      //    revoked, ohne dass die App den Push-Token abmelden konnte (der
      //    DELETE verlangt Auth und scheitert nach dem Ablauf mit 401), blieb
      //    der Token stehen — und Regel 2 griff nie, weil jede erfolgreiche
      //    Zustellung updated_at auffrischt. Das Geraet bekam unbegrenzt
      //    weiter Pushes fuer ein Konto, an dem niemand mehr angemeldet ist.
      //    Jeder Login legt einen Refresh-Token an; wer noch irgendwo
      //    angemeldet ist, hat immer mindestens eine gueltige Zeile.
      const { rows: sessionlessTokens } = await db.query(
        `DELETE FROM push_tokens pt
         WHERE NOT EXISTS (
           SELECT 1 FROM refresh_tokens rt
           WHERE rt.user_id = pt.user_id
             AND rt.revoked_at IS NULL
             AND rt.expires_at > NOW()
         ) RETURNING id`
      );

      const totalDeleted = errorTokens.length + inactiveTokens.length + orphanedTokens.length + sessionlessTokens.length;
      if (totalDeleted > 0) {
        console.log(`Token cleanup: ${errorTokens.length} error tokens, ${inactiveTokens.length} inactive tokens, ${orphanedTokens.length} orphaned tokens, ${sessionlessTokens.length} sessionless tokens deleted`);
      }

      return { errorTokens: errorTokens.length, inactiveTokens: inactiveTokens.length, orphanedTokens: orphanedTokens.length, sitzungsloseTokens: sessionlessTokens.length };
    } catch (error) {
      console.error('Error in cleanupStaleTokens:', error);
      throw error;
    }
  }

  // ====================================================================
  // WRAPPED CRON SERVICE
  // ====================================================================

  /**
   * Startet den Wrapped-Cron Service (jaehrlich am 6. Januar um 06:00 Uhr)
   * - Teamer-Wrapped: Jaehrlich am 6.1. für alle Organisationen generieren
   * - Konfi-Wrapped wird NICHT mehr per Cron getriggert (Toggle pro Jahrgang, 119)
   */
  static startWrappedCron(db) {
    if (this.wrappedCronTask) {
      return;
    }

    console.log('Wrapped-Cron: Starte node-cron (0 6 6 1 * -- jaehrlich am 6.1. um 06:00 Uhr)');

    // '0 6 6 1 *' = Jaehrlich am 6. Januar um 06:00 Uhr
    // node-cron berechnet nach Neustart den nächsten Trigger korrekt
    this.wrappedCronTask = cron.schedule('0 6 6 1 *', async () => {
      console.log('Wrapped-Cron: Ausfuehrung gestartet (jaehrlich am 6.1.)');
      try {
        await this.checkWrappedTriggers(db);
      } catch (error) {
        console.error('Wrapped-Cron service failed:', error);
      }
    }, {
      timezone: 'Europe/Berlin'
    });
  }

  /**
   * Stoppt den Wrapped-Cron Service
   */
  static stopWrappedCron() {
    if (this.wrappedCronTask) {
      this.wrappedCronTask.stop();
      this.wrappedCronTask = null;
    }
  }

  /**
   * Legt am 6. Januar in JEDER Organisation den Team-Rueckblick fuer das
   * abgelaufene Kalenderjahr an -- und gibt ihn frei.
   *
   * Der KONFI-Rueckblick laeuft NICHT automatisch: Er umfasst die ganze
   * Konfi-Zeit bis zum Tag der Erzeugung, und wann dieser Tag ist, weiss
   * nur die Gemeinde (Konfirmation, Abschlussfahrt, letzter Abend). Ein
   * Datum im Kalender kann das nicht wissen.
   */
  static async checkWrappedTriggers(db) {
    try {
      const today = new Date();

      // DAS ABGELAUFENE KALENDERJAHR. Der Cron feuert am 6. Januar -- der
      // Rueckblick gilt dem Jahr davor.
      const jahr = today.getFullYear() - 1;

      let teamerOrgsGenerated = 0;

      const { rows: orgs } = await db.query('SELECT id FROM organizations');

      for (const org of orgs) {
        try {
          if (!this.wrappedRouter || !this.wrappedRouter.generateAllTeamerWrapped) continue;

          // DOPPELTE ANLAGE VERHINDERT generateAllTeamerWrapped SELBST:
          // Sie prueft, ob fuer diese Organisation schon eine Team-Ausgabe
          // ueber genau dieses Kalenderjahr steht, und tut dann nichts.
          //
          // Die Pruefung gehoert dorthin und nicht hierher, weil sie auch
          // fuer den manuellen Weg gelten muss -- eine Leitung, die den
          // Rueckblick am 3. Januar selbst erzeugt, darf am 6. keinen
          // zweiten bekommen. Zwei Pruefungen an zwei Stellen liefen
          // irgendwann auseinander.
          //
          // Frueher stand hier eine eigene Abfrage auf wrapped_snapshots
          // (year = laufendes Jahr). Sie war doppelt falsch: Sie pruefte das
          // LAUFENDE statt des abgelaufenen Jahres, und sie zaehlte
          // Snapshots statt Ausgaben.
          const ergebnis = await this.wrappedRouter.generateAllTeamerWrapped(db, org.id, jahr);
          if (ergebnis && !ergebnis.uebersprungen) teamerOrgsGenerated++;
        } catch (err) {
          console.error(`Wrapped-Cron: Teamer-Org ${org.id} Fehler:`, err.message);
        }
      }

      if (teamerOrgsGenerated > 0) {
        console.log(`Wrapped-Cron: Team-Rueckblick ${jahr} fuer ${teamerOrgsGenerated} Organisationen erzeugt`);
      }
    } catch (error) {
      console.error('Error in checkWrappedTriggers:', error);
      throw error;
    }
  }


  /**
   * Startet den Auto-Loesch-Cron (täglich 02:00 Uhr Europe/Berlin).
   * Prueft je Jahrgang ab dem Stichtag (is_konfirmation-Event): Tag 60 ->
   * Soft-Löschung, Tag 120 -> kaskadierende Hard-Löschung.
   */
  static startAutoDeletionCron(db) {
    if (this.autoDeletionCronTask) {
      return;
    }

    console.log('Auto-Deletion-Cron: Starte node-cron 0 2 * * * Europe/Berlin');

    // '0 2 * * *' = täglich um 02:00 Uhr
    this.autoDeletionCronTask = cron.schedule('0 2 * * *', async () => {
      // ERST warnen (7 Tage vor Löschung), DANN löschen — beides im selben
      // 02:00-Lauf, aber getrennt fehler-isoliert.
      try {
        await this.runJahrgangDeletionReminders(db);
      } catch (e) {
        console.error('Jahrgang-Loesch-Reminder-Cron failed:', e);
      }
      try {
        await this.runAutoDeletion(db);
      } catch (e) {
        console.error('Auto-Deletion-Cron failed:', e);
      }
    }, {
      timezone: 'Europe/Berlin'
    });
  }

  /**
   * Stoppt den Auto-Loesch-Cron.
   */
  static stopAutoDeletionCron() {
    if (this.autoDeletionCronTask) {
      this.autoDeletionCronTask.stop();
      this.autoDeletionCronTask = null;
    }
  }

  /**
   * Startet den Trial-Ablauf-Cron: setzt Organisationen mit abgelaufener
   * Testphase (trial_ends_at < jetzt) auf is_active = false (Sperre).
   * Login + Refresh prüfen trial_ends_at zusaetzlich direkt, daher ist der
   * Cron nur die persistente Sperre für bestehende Sessions/Listen-Anzeige.
   */
  static startTrialExpiryCron(db) {
    if (this.trialExpiryCronTask) {
      return;
    }

    console.log('Trial-Expiry-Cron: Starte node-cron 0 3 * * * Europe/Berlin');

    // '0 3 * * *' = täglich um 03:00 Uhr (nach Auto-Deletion um 02:00)
    this.trialExpiryCronTask = cron.schedule('0 3 * * *', async () => {
      try {
        await this.runTrialExpiry(db);
      } catch (e) {
        console.error('Trial-Expiry-Cron failed:', e);
      }
      try {
        // Lizenz-Erinnerung (bezahlte Lizenzen ~14 Tage vor Ablauf) — läuft NACH
        // der Sperrung, damit gerade abgelaufene Orgs nicht mehr erinnert werden.
        await this.runLicenseReminders(db);
      } catch (e) {
        console.error('Lizenz-Erinnerung-Cron failed:', e);
      }
    }, {
      timezone: 'Europe/Berlin'
    });
  }

  /**
   * Stoppt den Trial-Ablauf-Cron.
   */
  static stopTrialExpiryCron() {
    if (this.trialExpiryCronTask) {
      this.trialExpiryCronTask.stop();
      this.trialExpiryCronTask = null;
    }
  }

  /**
   * Sperrt Organisationen mit abgelaufener Testphase.
   * Nur Orgs mit trial_ends_at gesetzt (NULL = bezahlt/unbegrenzt bleibt unangetastet)
   * und die noch aktiv sind. Idempotent durch is_active = true-Bedingung.
   */
  static async runTrialExpiry(db) {
    try {
      const { rows } = await db.query(
        `UPDATE organizations
         SET is_active = false, updated_at = NOW()
         WHERE trial_ends_at IS NOT NULL
           AND trial_ends_at < NOW()
           AND is_active = true
         RETURNING id, display_name`
      );
      if (rows.length > 0) {
        console.log(`Trial-Expiry: ${rows.length} Organisation(en) gesperrt:`, rows.map(r => r.display_name).join(', '));
      }
      return { locked: rows.length };
    } catch (error) {
      console.error('Trial-Expiry: Sperrung fehlgeschlagen:', error.message);
      return { locked: 0 };
    }
  }

  /**
   * Lizenz-Ablauf-Erinnerung per Mail an Org-Admins.
   * Nur für BEZAHLTE Lizenzen (is_trial = false) mit gesetztem trial_ends_at,
   * die in <= LICENSE_REMINDER_DAYS Tagen ablaufen, noch nicht abgelaufen sind
   * und für die noch keine Erinnerung verschickt wurde (license_reminder_sent_at IS NULL).
   * Trials (is_trial = true) bekommen KEINE Mail — die zeigen den App-Banner.
   * Pro Org wird einmal erinnert; der Marker wird beim Ändern von trial_ends_at zurückgesetzt.
   */
  static async runLicenseReminders(db) {
    let sent = 0;
    try {
      const { rows: orgs } = await db.query(
        `SELECT id, display_name, trial_ends_at
         FROM organizations
         WHERE is_trial = false
           AND is_active = true
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at > NOW()
           AND trial_ends_at <= NOW() + ($1 || ' days')::interval
           AND license_reminder_sent_at IS NULL`,
        [LICENSE_REMINDER_DAYS]
      );

      for (const org of orgs) {
        try {
          // Org-Admins mit E-Mail laden (admin + org_admin, aktiv)
          const { rows: admins } = await db.query(
            `SELECT u.display_name, u.email
             FROM users u
             JOIN roles r ON u.role_id = r.id
             WHERE u.organization_id = $1
               AND u.is_active = true
               AND r.name IN ('admin', 'org_admin')
               AND u.email IS NOT NULL AND u.email <> ''`,
            [org.id]
          );

          const end = new Date(org.trial_ends_at);
          const daysLeft = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

          let anySent = false;
          for (const admin of admins) {
            try {
              await emailService.sendLicenseExpiryReminderEmail(
                admin.email, admin.display_name, org.display_name, end, daysLeft
              );
              anySent = true;
              sent++;
            } catch (mailErr) {
              console.error(`Lizenz-Erinnerung: Mail an ${admin.email} fehlgeschlagen:`, mailErr.message);
            }
          }

          // Marker nur setzen, wenn mindestens eine Mail rausging — sonst nächster
          // Lauf erneut versuchen (z.B. SMTP-Ausfall).
          if (anySent) {
            await db.query(
              'UPDATE organizations SET license_reminder_sent_at = NOW() WHERE id = $1',
              [org.id]
            );
          }
        } catch (orgErr) {
          console.error(`Lizenz-Erinnerung: Org ${org.id} fehlgeschlagen:`, orgErr.message);
        }
      }

      if (sent > 0) {
        console.log(`Lizenz-Erinnerung: ${sent} Mail(s) fuer ${orgs.length} Organisation(en) verschickt.`);
      }
      return { sent };
    } catch (error) {
      console.error('Lizenz-Erinnerung fehlgeschlagen:', error.message);
      return { sent: 0 };
    }
  }

  /**
   * Der Stichtag wird je Jahrgang aus dem is_konfirmation-Event abgeleitet
   * (frueheste, nicht-cancelled Konfirmation, org-gescopt). Hat ein Jahrgang
   * KEIN is_konfirmation-Event, gibt es keinen Stichtag -> keine Aufbewahrungs-
   * frist -> KEINE Auto-Löschung (sicherer Default, kein versehentlicher
   * Datenverlust).
   *
   * Die 120er-Schwelle hat Vorrang; die 60er-Query grenzt mit `< 120` ab, damit
   * ein Konfi nie gleichzeitig in beiden Buckets landet (T-114-17).
   */
  /**
   * "Letzte Chance"-Reminder: 7 Tage VOR der automatischen Löschung (Tag 60
   * nach Konfirmation = Soft-Delete) bekommen die Org-Admins eine Mail + Push,
   * dass der Jahrgang gelöscht wird und sie jetzt noch Konfis befoerdern
   * können. Idempotent pro Jahrgang via deletion_reminder_sent_at.
   *
   * Stichtag-Logik identisch zu runAutoDeletion (frueheste, nicht-cancelled
   * is_konfirmation, org-gescopt). Fenster: Tag 53..59 (>= 60-WARN, < 60),
   * damit ein verpasster Tag (Cron-Ausfall) bis zur Soft-Delete-Grenze noch
   * nachgeholt wird. Kein Konfirmationstermin = keine Löschung = kein Reminder.
   */
  static async runJahrgangDeletionReminders(db) {
    const SOFT_DELETE_DAY = 60;   // ab diesem Tag greift die Loeschung (runAutoDeletion)
    const WARN_LEAD_DAYS = 7;     // so viele Tage vorher warnen
    let sent = 0;
    try {
      const { rows: jahrgaenge } = await db.query('SELECT id, name, organization_id FROM jahrgaenge');

      for (const jg of jahrgaenge) {
        try {
          // Stichtag (Konfirmationstermin) ableiten
          const { rows: stichtagRows } = await db.query(
            `SELECT MIN(e.event_date) AS stichtag
               FROM events e
               JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
              WHERE eja.jahrgang_id = $1
                AND e.is_konfirmation = true
                AND e.organization_id = $2
                AND e.cancelled IS NOT TRUE`,
            [jg.id, jg.organization_id]
          );
          const stichtag = stichtagRows[0] && stichtagRows[0].stichtag;
          if (!stichtag) continue; // keine Frist -> keine Loeschung -> kein Reminder

          // Im Warn-Fenster? (Tag 53..59) und noch nicht erinnert?
          const { rows: [windowRow] } = await db.query(
            `SELECT (CURRENT_DATE - $1::date) AS age,
                    (SELECT deletion_reminder_sent_at FROM jahrgaenge WHERE id = $2) AS sent_at`,
            [stichtag, jg.id]
          );
          const age = Number(windowRow.age);
          const alreadySent = windowRow.sent_at !== null;
          if (alreadySent) continue;
          if (age < (SOFT_DELETE_DAY - WARN_LEAD_DAYS) || age >= SOFT_DELETE_DAY) continue;

          // Gibt es überhaupt noch AKTIVE Konfis, die gelöscht wuerden?
          // Sonst ist die Warnung sinnlos (nur befoerderte/keine).
          const { rows: [{ count: konfiCount }] } = await db.query(
            `SELECT COUNT(*)::int AS count
               FROM users u
               JOIN konfi_profiles kp ON kp.user_id = u.id
               JOIN roles r ON u.role_id = r.id
              WHERE kp.jahrgang_id = $1 AND u.organization_id = $2
                AND r.name = 'konfi' AND u.deleted_at IS NULL`,
            [jg.id, jg.organization_id]
          );
          if (konfiCount === 0) continue;

          const daysLeft = SOFT_DELETE_DAY - age; // Tage bis zur Loeschung

          // Org-Admins mit E-Mail laden
          const { rows: admins } = await db.query(
            `SELECT u.display_name, u.email
               FROM users u JOIN roles r ON u.role_id = r.id
              WHERE u.organization_id = $1 AND u.is_active = true
                AND r.name IN ('admin', 'org_admin')
                AND u.email IS NOT NULL AND u.email <> ''`,
            [jg.organization_id]
          );

          const { rows: [org] } = await db.query('SELECT display_name FROM organizations WHERE id = $1', [jg.organization_id]);
          const orgName = (org && org.display_name) || '';

          let anySent = false;
          for (const admin of admins) {
            try {
              await emailService.sendJahrgangDeletionWarningEmail(
                admin.email, admin.display_name, orgName, jg.name, daysLeft
              );
              anySent = true;
              sent++;
            } catch (mailErr) {
              console.error(`Jahrgang-Loesch-Reminder: Mail an ${admin.email} fehlgeschlagen:`, mailErr.message);
            }
          }

          // Push an alle Org-Admins (zuverlaessiger Kanal, kein externer SMTP).
          let pushSent = false;
          try {
            const pushRes = await PushService.sendJahrgangDeletionWarningToAdmins(db, jg.organization_id, jg.name, daysLeft);
            // sendToMultipleUsers liefert kein einheitliches Erfolgsflag; wir
            // werten "kein Fehler geworfen" als zugestellt-versucht. Ein echtes
            // false (z.B. keine Admins) liefert {success:false}.
            pushSent = !(pushRes && pushRes.success === false);
          } catch (pushErr) {
            console.error(`Jahrgang-Loesch-Reminder: Push fuer Org ${jg.organization_id} fehlgeschlagen:`, pushErr.message);
          }

          // Marker setzen, wenn die Warnung über MINDESTENS einen Kanal raus ist
          // (Mail ODER Push) -- sonst (beides fehlgeschlagen) nächster Lauf erneut.
          // Push ist der robuste Kanal; bei reinem SMTP-Ausfall reicht der Push.
          if (anySent || pushSent || admins.length === 0) {
            await db.query('UPDATE jahrgaenge SET deletion_reminder_sent_at = NOW() WHERE id = $1', [jg.id]);
          }
        } catch (jgErr) {
          console.error(`Jahrgang-Loesch-Reminder: Jahrgang ${jg.id} fehlgeschlagen:`, jgErr.message);
        }
      }

      if (sent > 0) {
        console.log(`Jahrgang-Loesch-Reminder: ${sent} Mail(s) verschickt.`);
      }
      return { sent };
    } catch (error) {
      console.error('Jahrgang-Loesch-Reminder fehlgeschlagen:', error.message);
      return { sent: 0 };
    }
  }

  static async runAutoDeletion(db) {
    let totalSoft = 0;
    let totalHard = 0;

    let jahrgaenge;
    try {
      const res = await db.query(
        'SELECT id, organization_id FROM jahrgaenge'
      );
      jahrgaenge = res.rows;
    } catch (error) {
      console.error('Auto-Deletion: Jahrgaenge konnten nicht geladen werden:', error.message);
      return { soft: 0, hard: 0 };
    }

    for (const jg of jahrgaenge) {
      try {
        // Stichtag je Jahrgang aus dem is_konfirmation-Event ableiten
        // (frueheste, nicht-cancelled Konfirmation, org-gescopt).
        const { rows: stichtagRows } = await db.query(
          `SELECT MIN(e.event_date) AS stichtag
             FROM events e
             JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
            WHERE eja.jahrgang_id = $1
              AND e.is_konfirmation = true
              AND e.organization_id = $2
              AND e.cancelled IS NOT TRUE`,
          [jg.id, jg.organization_id]
        );
        const stichtag = stichtagRows[0] && stichtagRows[0].stichtag;

        // Kein Konfirmationstermin -> keine Aufbewahrungsfrist -> keine Löschung
        // (sicherer Default, verhindert versehentlichen Datenverlust).
        if (!stichtag) {
          continue;
        }

        // --- HARD-DELETE (>= 120 Tage) ---
        // Nur aktive Konfis (r.name='konfi'); promotete Teamer (role gewechselt,
        // teamer_since gesetzt) werden durch den Rollen-Filter NIE erfasst.
        // Bewusst KEIN deleted_at-Guard: ab Tag 120 wird hart gelöscht, auch wenn
        // der Soft-Delete-Lauf (Tag 60-120) nie stattfand (z.B. Cron-Ausfall) —
        // sonst bliebe der Datensatz über die Aufbewahrungsfrist hinaus erhalten.
        // deleteKonfiCascade entfernt den User physisch -> kein wiederholter Lauf.
        const { rows: hardKandidaten } = await db.query(
          `SELECT u.id
             FROM users u
             JOIN konfi_profiles kp ON kp.user_id = u.id
             JOIN roles r ON u.role_id = r.id
            WHERE kp.jahrgang_id = $1
              AND u.organization_id = $3
              AND r.name = 'konfi'
              AND (CURRENT_DATE - $2::date) >= 120`,
          [jg.id, stichtag, jg.organization_id]
        );

        for (const konfi of hardKandidaten) {
          let client;
          try {
            client = await db.getClient();
          } catch (clientErr) {
            console.error(`Auto-Deletion: Client-Fehler bei Konfi ${konfi.id} (Jahrgang ${jg.id}):`, clientErr.message);
            continue;
          }
          try {
            await client.query('BEGIN');
            const nachgerueckt = await deleteKonfiCascade(client, konfi.id, jg.organization_id);
            await client.query('COMMIT');
            totalHard++;
            // Benachrichtigung nach dem COMMIT; Fehler werden dort je Person
            // geschluckt und duerfen den Lauf nicht abbrechen.
            await meldeNachrueckern(db, jg.organization_id, nachgerueckt);
          } catch (delErr) {
            try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
            console.error(`Auto-Deletion: Hard-Delete fuer Konfi ${konfi.id} (Jahrgang ${jg.id}) fehlgeschlagen:`, delErr.message);
          } finally {
            client.release();
          }
        }

        // --- SOFT-DELETE (>= 60 und < 120 Tage, deleted_at IS NULL) ---
        // Idempotent: nur Konfis ohne gesetztes deleted_at. Rollen-Filter.
        const { rows: softUpdated } = await db.query(
          `UPDATE users u
              SET deleted_at = NOW(), archived_at = NOW()
             FROM konfi_profiles kp, roles r
            WHERE u.id = kp.user_id
              AND u.role_id = r.id
              AND kp.jahrgang_id = $1
              AND u.organization_id = $3
              AND r.name = 'konfi'
              AND u.deleted_at IS NULL
              AND (CURRENT_DATE - $2::date) >= 60
              AND (CURRENT_DATE - $2::date) < 120
            RETURNING u.id`,
          [jg.id, stichtag, jg.organization_id]
        );
        totalSoft += softUpdated.length;
      } catch (jgErr) {
        // Fehler pro Jahrgang isolieren -> Job läuft weiter.
        console.error(`Auto-Deletion: Jahrgang ${jg.id} fehlgeschlagen:`, jgErr.message);
      }
    }

    if (totalSoft > 0 || totalHard > 0) {
      console.log(`Auto-Deletion: ${totalSoft} soft-geloescht, ${totalHard} hart-geloescht`);
    }

    return { soft: totalSoft, hard: totalHard };
  }

  // ====================================================================
  // START ALL SERVICES
  // ====================================================================

  /**
   * Startet alle Background Services
   */
  /**
   * Schreibt alle 5 Minuten einen APM-Snapshot in apm_snapshots (persistente
   * Historie über Deploys hinweg) und räumt Snapshots aelter als 30 Tage auf.
   */
  static startApmSnapshotService(db) {
    if (this.apmSnapshotInterval) return;
    const FIVE_MINUTES = 5 * 60 * 1000;
    const write = async () => {
      try {
        const s = apm.persistSummary();
        await db.query(
          `INSERT INTO apm_snapshots (total_requests, total_errors, max_in_flight, worst_p95_ms, worst_route)
           VALUES ($1, $2, $3, $4, $5)`,
          [s.totalRequests, s.totalErrors, s.maxInFlight, s.worstP95Ms, s.worstRoute]
        );
        // Aufräumen: die letzten zwei Jahre behalten — bewusst grosszügig,
        // damit sich das Wachstum überhaupt erst beobachten lässt und danach
        // mit Zahlen entschieden werden kann.
        await db.query("DELETE FROM apm_snapshots WHERE captured_at < NOW() - INTERVAL '2 years'");
      } catch (error) {
        console.error('APM-Snapshot fehlgeschlagen:', error.message);
      }
    };
    this.apmSnapshotInterval = setInterval(write, FIVE_MINUTES);
  }

  static stopApmSnapshotService() {
    if (this.apmSnapshotInterval) {
      clearInterval(this.apmSnapshotInterval);
      this.apmSnapshotInterval = null;
    }
  }

  static startAllServices(db, options = {}) {
    if (options.wrappedRouter) {
      this.wrappedRouter = options.wrappedRouter;
    }
    this.startBadgeUpdateService(db);
    this.startEventReminderService(db);
    this.startRegistrationOpenService(db);
    this.startPendingEventsService(db);
    this.startTokenCleanupService(db);
    this.startWrappedCron(db);
    this.startAutoDeletionCron(db);
    this.startTrialExpiryCron(db);
    this.startApmSnapshotService(db);
    this.startChallengeStartService(db);
  }

  /**
   * Stoppt alle Background Services
   */
  static stopAllServices() {
    this.stopBadgeUpdateService();
    this.stopEventReminderService();
    this.stopRegistrationOpenService();
    this.stopPendingEventsService();
    this.stopTokenCleanupService();
    this.stopWrappedCron();
    this.stopAutoDeletionCron();
    this.stopTrialExpiryCron();
    this.stopApmSnapshotService();
    this.stopChallengeStartService();
  }
}

module.exports = BackgroundService;
