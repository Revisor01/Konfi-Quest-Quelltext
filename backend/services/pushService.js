// Nicht destrukturieren: Die Tests haengen ihre Attrappen per vi.spyOn an das
// Modul-Objekt (siehe tests/services/pushService.test.js). Wer die Funktionen
// beim Require herausziehen wuerde, haette die echte Fassung in der Hand und
// wuerde an FCM senden.
const firebase = require('../push/firebase');
const { appIconSummenAllerGemeinden } = require('../utils/appIconBadge');
const { berechneLevelFortschritt } = require('../utils/levelFortschritt');
const { formatUhrzeit, formatDatum } = require('../utils/zeitformat');
const { ladeLeitungDerOrganisation, ladeMitgliederDerOrganisation } = require('../utils/orgMitglieder');
const { abfragenBuendeln } = require('../utils/abfragenBuendeln');
const { TEAM_ORGWEITE_AUDIENCES, ladeTeamDasMitmacht } = require('../utils/challengeLeitungSicht');
const { ladeKonfisDieTerminSehen } = require('../utils/konfiTerminSicht');
// Postfach: Welche Arten neben dem Push auch einen Eintrag in
// der Tabelle notifications bekommen, steht in EINER Positivliste
// (utils/postfachArten.js). Geschrieben wird zentral in sendToUser und
// sendToMultipleUsers -- nicht an den rund vierzig Aufrufstellen.
const { schreibePostfach } = require('../utils/postfachArten');
// Push-Gruppen: Nutzende koennen in der App einzelne Gruppen
// (Nachrichten, Termine, Punkte und Abzeichen, Anfragen und Freigaben)
// stummschalten -- users.push_gruppen_stumm, gefuellt ueber PUT
// /notifications/preferences. Die Gruppe einer Art bestimmt
// utils/pushGruppen.js; geprueft wird sie in den Token-Abfragen, neben dem
// Hauptschalter push_enabled. Der Postfach-Eintrag entsteht davor und
// unabhaengig davon.
const { gruppeFuerArt, GRUPPE_CHAT } = require('../utils/pushGruppen');
// Zahl am App-Symbol auf Android: welcher Weg zum Startbildschirm
// eines Geraets passt, meldet die App bei der Token-Anmeldung
// (push_tokens.app_symbol_weg, Migration 185).
const { APP_SYMBOL_WEGE, wegFuerGeraet } = require('../utils/appSymbolWeg');

/**
 * Push Notification Type Registry
 *
 * Alle Push-Types werden durch statische Methoden in dieser Klasse definiert.
 * Zum Deaktivieren eines Types: Aufruf in der jeweiligen Route auskommentieren.
 *
 * POSTFACH: Ob eine Art zusaetzlich als Mitteilung in der
 * Tabelle notifications landet, steht NICHT hier, sondern in der
 * Positivliste utils/postfachArten.js (POSTFACH_ARTEN, mit den bewusst
 * ausgenommenen Arten in NICHT_IM_POSTFACH). sendToUser und
 * sendToMultipleUsers schreiben den Eintrag vor dem Versand -- auch dann,
 * wenn die Person kein Push-Geraet hat.
 *
 * Type                        | Methode                              | Empfaenger      | Enabled
 * ----------------------------|--------------------------------------|-----------------|--------
 * chat                        | sendChatNotification                 | User            | ja
 * badge_update                | sendBadgeUpdate                      | User            | ja
 * new_activity_request        | sendNewActivityRequestToLeadership   | Antrags-Leitung | ja
 * activity_request_status     | sendActivityRequestStatusToKonfi     | Konfi           | ja
 * badge_earned                | sendBadgeEarnedToKonfi               | Konfi           | ja
 * activity_assigned           | sendActivityAssignedToKonfi          | Konfi           | ja
 * bonus_points                | sendBonusPointsToKonfi               | Konfi           | ja
 * event_registered            | sendEventRegisteredToKonfi           | Konfi           | ja
 * event_unregistered          | sendEventUnregisteredToKonfi         | Konfi           | ja
 * event_removed               | sendEventRemovedByLeitung            | Gebuchte Person | ja
 * event_waitlisted            | sendEventRemovedByLeitung            | Gebuchte Person | ja
 * event_unregistration        | sendEventUnregistrationToLeadership  | Event-Leitung   | ja
 * level_up                    | sendLevelUpToKonfi                   | Konfi           | ja
 * event_reminder              | sendEventReminderToKonfi             | Konfi           | ja
 * waitlist_promotion          | sendWaitlistPromotionToKonfi         | Konfi           | ja
 * event_registered            | sendEventRegisteredToTeamer          | Teamer:in       | ja
 * waitlist_promotion          | sendWaitlistPromotionToTeamer        | Teamer:in       | ja
 * event_cancelled             | sendEventCancellationToKonfis        | Konfi (multi)   | ja
 * event_reactivated           | sendEventReactivationToKonfis        | Konfi (multi)   | ja
 * event_changed               | sendEventChangedToKonfis             | Konfi (multi)   | ja
 * new_event                   | sendNewEventToOrgKonfis              | Jahrgangs-Konfis| ja
 * event_attendance            | sendEventAttendanceToKonfi           | Konfi           | ja
 * events_pending_approval     | sendEventsPendingApprovalToLeadership| Event-Leitung   | ja
 * new_konfi_registration      | sendNewKonfiRegistrationToLeadership | Jahrgangs-Leitung| ja
 * jahrgang_deletion_warning   | sendJahrgangDeletionWarningToLeadership | Jahrgangs-Leitung| ja
 * event_opt_out               | sendEventOptOutToLeadership          | Event-Leitung   | ja
 * event_opt_in                | sendEventOptInToLeadership           | Event-Leitung   | ja
 * teamer_event_booking        | sendTeamerEventBookingToLeadership   | Event-Leitung   | ja
 * teamer_event_cancellation   | sendTeamerEventCancellationToLeadership | Event-Leitung | ja
 * challenge_started           | sendChallengeStartedToJahrgaenge     | Teilnehmende    | ja
 * challenge_submission        | sendChallengeSubmissionToLeadership  | Leitung         | ja
 * challenge_started (Feed)    | sendChallengeFeedToJahrgaenge        | Jahrgangs-Konfis| ja
 * challenge_badge_earned      | sendChallengeBadgeEarnedToKonfi      | Konfi           | ja
 * challenge_submission_hidden | sendChallengeSubmissionHiddenToUser  | Einreichende:r  | ja
 * gemeinde_einladung_beantwortet | sendEinladungBeantwortetToLeitung | Einladende:r / Org-Admins | ja
 *
 * Helper-Methoden (nicht direkt als Push-Type):
 * - getTokensForUser(db, userId)
 * - sendToUser(db, userId, notification)
 * - sendToMultipleUsers(db, userIds, notification)
 * - resolveRecipientOrgId(db, userId)
 *
 * Multi-Org: JEDER Payload trägt data.organization_id (als String, FCM-data
 * ist immer String) — die Organisation des INHALTS. Der Client wechselt beim
 * Antippen automatisch in diese Organisation, bevor er navigiert. Fehlt die
 * Content-Org an der Aufrufstelle, setzt sendToUser die Primär-Org des
 * Empfängers ein (für Single-Org-Empfänger identisch).
 *
 * Multi-Org, Empfängerseite: "Org-Admins", "Jahrgangs-Admins"
 * und "Leitung" werden über utils/orgMitglieder.js ermittelt — Stamm-
 * Organisation UND user_organizations, die Rolle gilt je Organisation. Wer
 * hier eine neue Empfänger-Abfrage mit `u.organization_id = $1` schreibt,
 * baut den Fehler wieder ein, den Nutzer 41 in Produktion gezeigt hat.
 */

class PushService {
  // ====================================================================
  // GRENZEN FUER DEN VERSAND AN VIELE
  //
  // Anlass: Der EKD-weite Rollout hebt die Nutzerzahl von 138 auf ueber
  // 15.000. Bis hierher lief sendToMultipleUsers als unbegrenztes
  // Promise.all ueber ALLE Empfaenger -- der Kommentar dort nannte die
  // urspruengliche Auslegung selbst ("bei 5 Admins"). Eine Ankuendigung an
  // eine grosse Gemeinde haette damit Tausende Ketten gleichzeitig eroeffnet,
  // jede mit eigenen Abfragen, gegen 20 Pool-Plaetze (database.js). Was
  // darueber hinaus anstand, lief in den Verbindungs-Timeout von 5 Sekunden
  // -- und zwar auch fuer die normale API im selben Prozess.
  static EMPFAENGER_BLOCK = 50;
  static EMPFAENGER_PAUSE_MS = 50;

  // firebase-admin 14.3.0 hat `sendEach()`: mehrere Nachrichten in einem
  // Aufruf, hoechstens 500 je Aufruf (hart geprueft in
  // lib/messaging/messaging.js, FCM_MAX_BATCH_SIZE), mit Teilergebnissen je
  // Token. Gebaut und dann wieder ausgebaut, weil die Messung dagegen steht.
  //
  // WANN ES SICH LOHNEN WUERDE: Wenn `sendEach` die Nachrichten VERSCHIEDENER
  // Empfaenger buendelte. Das geht nicht, solange jede Person ihre eigene
  // Badge-Zahl im apns-Paket traegt -- die Zahl ist je Person verschieden, das
  // Paket also auch. Ein Sammelversand ueber Empfaenger hinweg braeuchte
  // Gruppen gleicher Badge-Zahl; bei 15.000 Empfaengern mit je eigener Zahl
  // waeren das wieder nahezu 15.000 Pakete.

  // ====================================================================
  // WIEDERHOLEN BEI ZEITWEILIGEN FEHLERN
  //
  // Bis hierher war jeder FCM-Fehler endgueltig: Bei quota-exceeded und
  // server-unavailable wurde der Fehlerzaehler erhoeht und die Nachricht war
  // weg. Das sind aber genau die zwei Faelle, in denen ein zweiter Versuch
  // Aussicht auf Erfolg hat -- FCM sagt damit "gerade nicht", nicht "nie".
  // Und beide treten ausgerechnet dann auf, wenn viel auf einmal rausgeht.
  //
  // WARUM NUR DIESE ZWEI: Ein ungueltiger oder abgemeldeter Token bleibt
  // ungueltig, egal wie oft man fragt -- Wiederholen kostet dort nur Zeit und
  // verzoegert das Aufraeumen. Ein Argumentfehler (invalid-argument) wird
  // beim zweiten Mal genauso falsch sein. Deshalb steht hier eine
  // ausdrueckliche Liste und kein "alles ausser den fatalen": Ein
  // unbekannter, neuer Fehlercode koennte dauerhaft sein, und blindes
  // Wiederholen vervielfacht bei 15.000 Empfaengern die Last, statt sie zu
  // daempfen.
  static ZEITWEILIGE_FEHLER = [
    'messaging/quota-exceeded',
    'messaging/server-unavailable',
    // Interner Serverfehler bei FCM -- dieselbe Lage wie server-unavailable.
    'messaging/internal-error',
  ];

  // Dauerhafte Fehler: Token sofort loeschen, nicht wiederholen.
  static FATALE_FEHLER = [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token'
  ];

  // Drei Versuche, Abstand verdoppelt sich (200 ms, 400 ms). Kurz gehalten:
  // Der Versand haengt an einer Anfrage oder einem Cron-Lauf, und ein Push,
  // der eine Minute spaeter kommt, ist fuer eine Chat-Nachricht nichts mehr
  // wert. Wachsender Abstand statt gleichbleibender, weil quota-exceeded
  // gerade heisst, dass zu viel gleichzeitig laeuft -- sofort im selben Takt
  // nachzufassen wuerde die Lage verschaerfen.
  static WIEDERHOLUNG_VERSUCHE = 3;
  static WIEDERHOLUNG_PAUSE_MS = 200;

  static istZeitweilig(errorCode) {
    return this.ZEITWEILIGE_FEHLER.includes(errorCode);
  }

  static istFatal(errorCode) {
    return this.FATALE_FEHLER.includes(errorCode);
  }

  static schlafen(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Einen Push an EIN Geraet, bei zeitweiligen Fehlern wiederholt.
   *
   * Bricht beim ersten Erfolg ab und ebenso bei jedem Fehler, der nicht
   * ausdruecklich als zeitweilig gilt -- bei einem ungueltigen Token waere
   * jeder weitere Versuch verlorene Zeit, die das Aufraeumen verzoegert.
   *
   * @returns {Promise<object>} das letzte Ergebnis von Firebase
   */
  static async sendeMitWiederholung(senden) {
    let result;
    for (let versuch = 1; versuch <= this.WIEDERHOLUNG_VERSUCHE; versuch++) {
      if (versuch > 1) {
        // Wachsender Abstand: 200 ms, dann 400 ms.
        await this.schlafen(this.WIEDERHOLUNG_PAUSE_MS * Math.pow(2, versuch - 2));
      }
      result = await senden();
      if (result.success || !this.istZeitweilig(result.errorCode)) break;
    }
    return result;
  }

  /**
   * Das Ergebnis eines Geraets in der Datenbank nachfuehren: erreichbar
   * vermerken, ungueltigen Token loeschen, sonst Fehlerzaehler hochsetzen.
   *
   * Steht als eigene Methode, weil zwei Versandwege (sendToUser,
   * sendChatNotification) genau dieselbe Behandlung brauchen und sie vorher
   * zweimal Zeile fuer Zeile im Code stand.
   *
   * @param {object} [sammler]  Nur beim Versand an viele: statt je Geraet
   *   sofort zu schreiben, wird die Token-ID hier eingesammelt und der
   *   Aufrufer schreibt am Ende des Blocks in DREI Abfragen fuer alle
   *   (schreibeErgebnisSammler). Ohne den Parameter wie bisher sofort.
   * @returns {Promise<boolean>} true, wenn der Push ankam
   */
  static async verarbeiteErgebnis(db, token, result, sammler = null) {
    if (result.success) {
      // Erfolgreiche Zustellung frischt `updated_at` auf.
      // Die Bereinigung wirft Tokens weg, die 30 Tage nicht aktualisiert
      // wurden — und aktualisiert wurden sie bis dahin NUR, wenn jemand die
      // App oeffnete. Wer ueber die Ferien pausierte, verlor stillschweigend
      // die Zustellung und merkte es nicht, obwohl sein Geraet die ganze Zeit
      // erreichbar war. Ein angekommener Push ist der bessere Beleg dafuer
      // als ein App-Start.
      if (sammler) sammler.erreichbar.push(token.id);
      else await this.markiereTokenErreichbar(db, token);
      return true;
    }

    // Log-Zeilen: Im Sammelweg keine Zeile
    // je Geraet, sondern die Bilanz des Versands -- der Aufrufer schreibt am
    // Ende EINE Zeile je Art (protokolliereBilanz). Bei einem FCM-Ausfall
    // standen sonst tausend gleiche Fehlerzeilen im Log und schoben alles
    // Fruehere aus der Rotation. Der Einzelweg bleibt bei der Zeile je Geraet.
    if (this.istFatal(result.errorCode)) {
      // Fatale Errors: Token sofort löschen
      if (sammler) {
        sammler.ungueltig.push(token.id);
        this.bilanzFehler(sammler.bilanz, result, 'geloescht');
      } else {
        await db.query('DELETE FROM push_tokens WHERE id = $1', [token.id]);
        console.warn(`Token ${token.id} gelöscht (${result.errorCode})`);
      }
    } else {
      // Sonstige Errors: Counter erhöhen
      if (sammler) {
        sammler.fehlgeschlagen.push(token.id);
        this.bilanzFehler(sammler.bilanz, result, 'fehlgeschlagen');
      } else {
        await db.query(
          'UPDATE push_tokens SET error_count = error_count + 1, last_error_at = NOW() WHERE id = $1',
          [token.id]
        );
        console.error('Push failed for token:', result.error);
      }
    }
    return false;
  }

  /**
   * Buchfuehrung ueber die Geraete eines ganzen Blocks.
   *
   * Nach dem Umbau der Badge-Rechnung und der Token-Abfrage auf "einmal fuer
   * alle" war das UPDATE je Geraet die letzte Abfrage, die mit der Zahl der
   * Empfaenger wuchs: 278 Geraete in einem Raum mit 150 Teilnehmenden, 278
   * UPDATEs je Nachricht. Gesammelt sind es hoechstens drei Abfragen je Block
   * -- eine fuer die erreichten Geraete, eine fuer die ungueltigen, eine fuer
   * die zeitweilig gescheiterten -- und die Wirkung in der Datenbank ist
   * dieselbe (updated_at und Fehlerzaehler zurueck bzw. hoch, Token weg).
   *
   * Der Einzelweg (sendToUser ohne vorberechnet) schreibt weiter sofort:
   * dort gibt es nichts zu sammeln.
   */
  static neuerErgebnisSammler(bilanz = null) {
    return { erreichbar: [], ungueltig: [], fehlgeschlagen: [], bilanz };
  }

  /**
   * Bilanz eines Versands an viele: zaehlt
   * statt zu protokollieren -- Personen ohne Geraet, geloeschte und
   * fehlgeschlagene Tokens je Fehlercode, dazu die erste Fehlermeldung.
   * protokolliereBilanz schreibt daraus hoechstens drei Zeilen.
   */
  static neueBilanz() {
    return {
      empfaenger: 0,
      ohneGeraet: 0,
      geloescht: { anzahl: 0, codes: new Map() },
      fehlgeschlagen: { anzahl: 0, codes: new Map() },
      ersteMeldung: null,
    };
  }

  static bilanzFehler(bilanz, result, art) {
    if (!bilanz) return;
    const posten = bilanz[art];
    posten.anzahl++;
    const code = result.errorCode || 'ohne Code';
    posten.codes.set(code, (posten.codes.get(code) || 0) + 1);
    if (art === 'fehlgeschlagen' && bilanz.ersteMeldung === null) {
      bilanz.ersteMeldung = String(result.error || code);
    }
  }

  /**
   * @param {string} bezeichnung  z.B. "Push event_cancelled"
   * @param {object} bilanz       aus neueBilanz
   * @param {{ohneGeraet?: boolean}} [optionen]  ohneGeraet: false, wenn der
   *   Aufrufer die Zeile "ohne Push-Token" selbst schreibt (Chat-Weg)
   */
  static protokolliereBilanz(bezeichnung, bilanz, { ohneGeraet = true } = {}) {
    const codes = (posten) => [...posten.codes.entries()]
      .map(([code, n]) => `${code} ×${n}`).join(', ');
    if (ohneGeraet && bilanz.ohneGeraet > 0) {
      console.warn(`${bezeichnung}: ${bilanz.ohneGeraet} von ${bilanz.empfaenger} Empfänger:innen ohne Push-Token`);
    }
    if (bilanz.geloescht.anzahl > 0) {
      console.warn(`${bezeichnung}: ${bilanz.geloescht.anzahl} Token gelöscht (${codes(bilanz.geloescht)})`);
    }
    if (bilanz.fehlgeschlagen.anzahl > 0) {
      console.error(
        `${bezeichnung}: an ${bilanz.fehlgeschlagen.anzahl} Geräte fehlgeschlagen `
        + `(${codes(bilanz.fehlgeschlagen)}), erste Meldung: ${bilanz.ersteMeldung}`
      );
    }
  }

  static async schreibeErgebnisSammler(db, sammler) {
    if (!sammler) return;
    try {
      if (sammler.erreichbar.length > 0) {
        await db.query(
          'UPDATE push_tokens SET updated_at = NOW(), error_count = 0, last_error_at = NULL WHERE id = ANY($1::bigint[])',
          [sammler.erreichbar]
        );
      }
      if (sammler.ungueltig.length > 0) {
        await db.query('DELETE FROM push_tokens WHERE id = ANY($1::bigint[])', [sammler.ungueltig]);
      }
      if (sammler.fehlgeschlagen.length > 0) {
        await db.query(
          'UPDATE push_tokens SET error_count = error_count + 1, last_error_at = NOW() WHERE id = ANY($1::bigint[])',
          [sammler.fehlgeschlagen]
        );
      }
    } catch (err) {
      // Wie markiereTokenErreichbar: Die Buchfuehrung darf den Versand nicht
      // kippen -- die Nachrichten sind zu diesem Zeitpunkt laengst zugestellt.
      console.error('Token-Buchfuehrung fehlgeschlagen:', err.message);
    }
  }

  /**
   * Alle Geraete einer Person beliefern.
   *
   * @param {number|null} [badgeAlteApps] Zahl fuer Geraete der Store-Apps
   *   2.2.x (siehe badgeFuerGeraet); null = alle Geraete bekommen payload.badge.
   * @returns {Promise<{erfolge: number, fehler: number}>}
   */
  static async sendeAnGeraete(db, tokens, payload, sammler = null, badgeAlteApps = null) {
    const ergebnisse = await Promise.all(tokens.map(async (token) => {
      const badge = this.badgeFuerGeraet(token, payload.badge, badgeAlteApps);
      let nutzlast = badge === payload.badge ? payload : { ...payload, badge };
      // Weg "mitteilungen" (Samsung, Xiaomi): Der Startbildschirm rechnet die
      // Zahl aus den liegenden Mitteilungen. firebase.js gibt der Mitteilung
      // dafuer den festen tag und die Gesamtzahl mit.
      if (wegFuerGeraet(token) === APP_SYMBOL_WEGE.MITTEILUNGEN) {
        nutzlast = { ...nutzlast, appSymbolWeg: APP_SYMBOL_WEGE.MITTEILUNGEN };
      }
      const result = await this.sendeMitWiederholung(
        () => firebase.sendFirebasePushNotification(token.token, nutzlast)
      );
      const angekommen = await this.verarbeiteErgebnis(db, token, result, sammler);
      if (angekommen) await this.zahlNachMitteilung(token, badge);
      return angekommen;
    }));

    const erfolge = ergebnisse.filter(Boolean).length;
    return { erfolge, fehler: ergebnisse.length - erfolge };
  }

  /**
   * Auf dem iPhone setzt aps.badge in derselben Nachricht die Zahl. Auf
   * Android zeigt das FCM-SDK eine Mitteilung bei geschlossener App selbst
   * an, OHNE die App zu wecken -- die Zahl darin erreicht sie nie. Ein reines
   * Datenpaket dagegen weckt den Push-Dienst der App (KonfiMessagingService),
   * und der setzt die Zahl ueber den Zahl-Anbieter des Startbildschirms. Die
   * Zahl ist dieselbe wie im sichtbaren Push an dieses Geraet
   * (badgeFuerGeraet).
   *
   * Nur fuer "anbieter": Bei "mitteilungen" traegt die Mitteilung die Zahl
   * selbst, bei "punkt" kann der Startbildschirm keine zeigen, und Geraete
   * ohne Angabe (Store-Apps 2.2.x, 2.3.0 bis Build 128) bekommen genau das,
   * was sie bisher bekamen. Ein Fehler hier kippt den sichtbaren Push nicht:
   * Der ist zu diesem Zeitpunkt zugestellt und verbucht; die Zahl holt
   * spaetestens der naechste Hintergrundlauf nach (sendBadgeUpdates).
   */
  static async zahlNachMitteilung(token, badge) {
    if (wegFuerGeraet(token) !== APP_SYMBOL_WEGE.ANBIETER || badge == null) return;
    try {
      const result = await this.sendeMitWiederholung(
        () => firebase.sendFirebaseSilentPush(token.token, badge)
      );
      if (!result.success) {
        console.warn(`Zahl nach Mitteilung fuer Token ${token.id} nicht zugestellt: ${result.errorCode || result.error}`);
      }
    } catch (err) {
      console.error('Zahl nach Mitteilung fehlgeschlagen:', err.message);
    }
  }

  /**
   * Helper: Holt alle Push-Tokens für einen User
   */
  static async getTokensForUser(db, userId, art = null) {
    // Master-Schalter: Hat der User Push global deaktiviert, gar keine Tokens
    // zurueckgeben -> es wird nichts gesendet (gilt für alle Push-Typen).
    //
    // Stummgeschaltete Gruppe: Ist `art` angegeben (data.type des
    // Pushs) und hat die Person die Gruppe dieser Art abgewaehlt, ebenfalls
    // keine Tokens. OHNE `art` greift die Abwahl nicht -- so laeuft der stille
    // badge_update (nur die Zahl am App-Symbol) immer durch. Der Postfach-
    // Eintrag ist zu diesem Zeitpunkt schon geschrieben (sendToUser).
    //
    // Ebenso fuer gesperrte und geloeschte Konten. Vorher
    // pruefte das nur ein Teil der Empfaenger-Abfragen selbst — elf von
    // fuenfzehn nicht, darunter sendToOrgAdmins und die Opt-in/Opt-out-
    // Meldungen. Wer aus dem Team ausgeschieden und deaktiviert war, wurde
    // weiter ueber neue Antraege und Termine informiert. Hier greift es fuer
    // ALLE Wege auf einmal, statt an fuenfzehn Stellen einzeln.
    //
    // DISTINCT ON (token): derselbe FCM-Token darf nie mehrfach beliefert werden,
    // auch wenn er (noch) unter mehreren device_ids gespeichert ist (Alt-Daten).
    const query = `
      SELECT DISTINCT ON (pt.token) pt.* FROM push_tokens pt
      JOIN users u ON pt.user_id = u.id
      WHERE pt.user_id = $1
        AND u.push_enabled = true
        AND ($2::text IS NULL OR NOT ($2::text = ANY(u.push_gruppen_stumm)))
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND pt.id IN (
          SELECT MAX(id)
          FROM push_tokens
          WHERE user_id = $1
          GROUP BY device_id, platform
        )
      ORDER BY pt.token, pt.id DESC
    `;
    const { rows: tokens } = await db.query(query, [userId, art ? gruppeFuerArt(art) : null]);
    return tokens || [];
  }

  /**
   * Wie getTokensForUser, aber fuer viele Empfaenger in EINER Abfrage
   * 
   *
   * Nach dem Umbau der Badge-Rechnung war das die groesste verbliebene Abfrage
   * je Kopf: bei 15.000 Empfaengern 15.000 Token-Abfragen, jede mit
   * Unterabfrage. Die Bedingungen sind Zeichen fuer Zeichen dieselben wie oben
   * -- Master-Schalter, gesperrte und geloeschte Konten, MAX(id) je
   * device_id/platform, DISTINCT ON (token). Wer die eine aendert, aendert die
   * andere mit; getrennt bleiben sie nur, weil der Einzelweg von rund vierzig
   * Aufrufstellen gebraucht wird.
   *
   * DISTINCT ON (pt.user_id, pt.token): Die Eindeutigkeit gilt je PERSON, nicht
   * global. Zwei Konten duerfen denselben Token tragen (Alt-Daten, geteiltes
   * Geraet) -- global entdoppelt wuerde einem davon die Nachricht fehlen.
   *
   * @returns {Promise<Map<number, Array<object>>>} je userId die Token-Zeilen
   */
  static async getTokensForUsers(db, userIds, art = null) {
    const jeUser = new Map();
    const eindeutige = [...new Set(userIds)];
    if (eindeutige.length === 0) return jeUser;
    for (const id of eindeutige) jeUser.set(id, []);

    const { rows } = await db.query(
      `SELECT DISTINCT ON (pt.user_id, pt.token) pt.* FROM push_tokens pt
         JOIN users u ON pt.user_id = u.id
        WHERE pt.user_id = ANY($1::bigint[])
          AND u.push_enabled = true
          AND ($2::text IS NULL OR NOT ($2::text = ANY(u.push_gruppen_stumm)))
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND pt.id IN (
            SELECT MAX(id) FROM push_tokens
             WHERE user_id = ANY($1::bigint[])
             GROUP BY user_id, device_id, platform
          )
        ORDER BY pt.user_id, pt.token, pt.id DESC`,
      [eindeutige, art ? gruppeFuerArt(art) : null]
    );

    for (const zeile of rows) {
      const liste = jeUser.get(zeile.user_id);
      if (liste) liste.push(zeile);
    }
    return jeUser;
  }

  /**
   * Nach erfolgreicher Zustellung: Fehlerzaehler zuruecksetzen und
   * `updated_at` auffrischen.
   *
   * `updated_at` ist das Feld, an dem die 30-Tage-Bereinigung
   * (backgroundService.cleanupStaleTokens) haengt. Geschrieben wurde es
   * vorher ausschliesslich von POST /notifications/device-token, also nur
   * beim Oeffnen der App. Damit traf die Bereinigung bevorzugt genau die
   * Konten, die laenger pausierten — obwohl ihre Geraete erreichbar waren.
   * Eine angekommene Nachricht verlaengert die Frist jetzt selbst.
   */
  static async markiereTokenErreichbar(db, token) {
    try {
      await db.query(
        'UPDATE push_tokens SET updated_at = NOW(), error_count = 0, last_error_at = NULL WHERE id = $1',
        [token.id]
      );
    } catch (err) {
      // Ein fehlgeschlagenes Auffrischen darf den Versand nicht kippen — die
      // Nachricht ist zu diesem Zeitpunkt bereits zugestellt.
      console.error('Token-Zeitstempel konnte nicht aufgefrischt werden:', err.message);
    }
  }

  /**
   * Helper: Primär-Org eines Empfängers als String auflösen.
   *
   * Fallback für Payloads OHNE explizite Content-Org: Für Konfis (immer
   * Single-Org) ist die Primär-Org automatisch die richtige Organisation.
   * Aufrufstellen, deren Empfänger Multi-Org sein können (Admins,
   * Teamer:innen), setzen die Content-Org explizit im data-Objekt — dieser
   * Fallback greift dann nicht.
   */
  static async resolveRecipientOrgId(db, userId) {
    try {
      const { rows: [row] } = await db.query(
        'SELECT organization_id FROM users WHERE id = $1',
        [userId]
      );
      return row && row.organization_id != null ? String(row.organization_id) : null;
    } catch (err) {
      console.error('resolveRecipientOrgId error:', err);
      return null;
    }
  }

  /**
   * Fehlertolerant: Bei einem Fehler oder einem unbekannten Konto kommt null
   * zurueck und der Badge wird weggelassen — eine Nachricht darf nicht daran
   * scheitern, dass eine Zahl fehlt.
   */
  static async berechneBadge(db, userId) {
    const { badges } = await this.berechneBadgesFuerAlle(db, [userId]);
    const id = Number(userId);
    return badges.has(id) ? badges.get(id) : null;
  }

  /**
   * Wie berechneBadge, aber mit der Zahl fuer die Store-Apps 2.2.x daneben
   * (siehe badgeFuerGeraet). null, wenn die Zahl nicht ermittelbar ist.
   *
   * @returns {Promise<{badge: number, badgeAlteApps: number}|null>}
   */
  static async berechneBadgePaar(db, userId) {
    const { badges, badgesAlteApps } = await this.berechneBadgesFuerAlle(db, [userId]);
    const id = Number(userId);
    if (!badges.has(id)) return null;
    return { badge: badges.get(id), badgeAlteApps: badgesAlteApps.get(id) };
  }

  /**
   * Ist badgeAlteApps null (ausdruecklich uebergebene Zahl, oder die Summe
   * liess sich nicht ermitteln), bekommen alle Geraete dieselbe Zahl.
   */
  static badgeFuerGeraet(token, badge, badgeAlteApps) {
    if (badgeAlteApps == null || (token && token.app_version)) return badge;
    return badgeAlteApps;
  }

  /**
   * Die Zahl fuers App-Icon fuer VIELE Empfaenger in wenigen Abfragen
   * 
   *
   * Die Primaer-Organisation kommt mit zurueck: Sie steht in derselben
   * Abfrage, und sendToUser braucht sie fuer den organization_id-Rueckfall im
   * Payload. Holte er sie weiter selbst (resolveRecipientOrgId), waere das die
   * naechste Abfrage je Kopf.
   *
   * @returns {Promise<{badges: Map<number, number|null>, badgesAlteApps: Map<number, number>, orgs: Map<number, string>}>}
   *   badges: je userId die Zahl (fehlt der Eintrag, liess sie sich nicht
   *   ermitteln). badgesAlteApps: dieselbe Zahl fuer Geraete der Store-Apps
   *   2.2.x (siehe badgeFuerGeraet). orgs: je userId die Primaer-Org als
   *   String.
   */
  static async berechneBadgesFuerAlle(db, userIds) {
    const badges = new Map();
    const badgesAlteApps = new Map();
    const orgs = new Map();
    const eindeutige = [...new Set(userIds)];
    if (eindeutige.length === 0) return { badges, badgesAlteApps, orgs };

    try {
      const jePerson = await appIconSummenAllerGemeinden(db, eindeutige);
      for (const [userId, { summe, summeAlteApps, stamm_organization_id }] of jePerson) {
        badges.set(userId, summe);
        badgesAlteApps.set(userId, summeAlteApps);
        // Primaer-Org als String, weil FCM-data immer String ist (dieselbe
        // Regel wie in resolveRecipientOrgId).
        if (stamm_organization_id != null) orgs.set(userId, String(stamm_organization_id));
      }
      return { badges, badgesAlteApps, orgs };
    } catch (err) {
      // Fehlertolerant: Ohne Zahl geht der Push trotzdem raus (der Aufrufer
      // faellt dann auf 1 zurueck). Eine Nachricht darf nicht daran
      // scheitern, dass eine Zahl fehlt.
      console.error('berechneBadgesFuerAlle error:', err.message);
      return { badges, badgesAlteApps, orgs };
    }
  }

  /**
   * Postfach-Eintrag zu einem Push -- fuer eine oder viele Personen.
   *
   * Als Methode hier, damit Tests sie per vi.spyOn abklemmen oder
   * beobachten koennen (dasselbe Muster wie bei den Versand-Methoden).
   * Die Regel, welche Art schreibt, liegt in utils/postfachArten.js.
   *
   * @returns {Promise<number>} Anzahl geschriebener Eintraege
   */
  static async schreibePostfach(db, userIds, notification) {
    return schreibePostfach(db, userIds, notification);
  }

  /**
   * Helper: Sendet Push an einen User
   *
   * @param {object} [vorberechnet] Optional, nur vom Versand an viele belegt:
   *   { badge, badgeAlteApps?, orgId, tokens } -- die schon fuer ALLE Empfaenger gemeinsam
   *   ermittelten Werte. Ohne den Parameter holt die Methode sie wie bisher
   *   selbst; alle bestehenden Aufrufstellen bleiben unveraendert gueltig.
   */
  static async sendToUser(db, userId, notification, vorberechnet = null) {
    try {
      // Beim Versand an viele hat sendToMultipleUsers den Eintrag schon fuer
      // den ganzen Block geschrieben (vorberechnet gesetzt) -- dann nicht
      // noch einmal je Kopf.
      //
      // Eigener Fehlerfang: Ein fehlgeschlagener Eintrag darf den Push nicht
      // kippen -- und umgekehrt haengt der Eintrag nicht am Push.
      if (!vorberechnet) {
        await this.schreibePostfach(db, [userId], notification)
          .catch((err) => console.error('Postfach-Eintrag fehlgeschlagen:', err.message));
      }

      // Beim Versand an viele stehen die Tokens schon aus der gemeinsamen
      // Abfrage bereit -- das war nach der Badge-Rechnung die groesste
      // verbliebene Abfrage je Kopf.
      // Mit der Art des Pushs: Hat die Person die Gruppe dieser Art
      // stummgeschaltet, kommen keine Tokens -- der Postfach-Eintrag oben
      // steht da schon.
      const tokens = (vorberechnet && vorberechnet.tokens)
        ? vorberechnet.tokens
        : await this.getTokensForUser(db, userId, notification.data && notification.data.type);

      if (tokens.length === 0) {
        // Im Einzelweg eine Zeile -- sie beantwortet "warum kam bei mir
        // nichts?". Beim Versand an viele zaehlt der Aufrufer nur und
        // schreibt EINE Sammelzeile: Dort kamen sonst je
        // Absage an 1.000 Personen 500 gleiche Zeilen zusammen.
        if (vorberechnet && vorberechnet.sammler && vorberechnet.sammler.bilanz) {
          vorberechnet.sammler.bilanz.ohneGeraet++;
        } else if (!vorberechnet) {
          console.warn(`Keine Push-Tokens für User ${userId} gefunden`);
        }
        return { success: false, message: 'No tokens found' };
      }

      // organization_id gehört in JEDEN Push-Payload: Multi-Org-Empfänger
      // wechseln beim Antippen automatisch in die Organisation des Inhalts.
      // Fehlt die Content-Org, wird die Primär-Org des Empfängers eingesetzt
      // (für Single-Org-Empfänger identisch). FCM-data ist IMMER String —
      // deshalb String() und der Vergleich im Client ebenfalls per String().
      // Kopie statt Mutation: notification wird bei sendToMultipleUsers über
      // mehrere Empfänger geteilt.
      const data = { ...(notification.data || {}) };
      if (data.organization_id != null && data.organization_id !== '') {
        data.organization_id = String(data.organization_id);
      } else {
        // Beim Versand an viele steht die Primaer-Org schon aus der
        // gemeinsamen Abfrage bereit -- dann nicht erneut nachsehen. Das war
        // die letzte Abfrage, die noch je Kopf lief.
        const recipientOrgId = (vorberechnet && 'orgId' in vorberechnet)
          ? vorberechnet.orgId
          : await this.resolveRecipientOrgId(db, userId);
        if (recipientOrgId) data.organization_id = recipientOrgId;
      }

      let berechneterBadge;
      let badgeAlteApps = null;
      if (notification.badge != null) {
        berechneterBadge = notification.badge;
      } else if (vorberechnet && 'badge' in vorberechnet) {
        berechneterBadge = vorberechnet.badge;
        badgeAlteApps = vorberechnet.badgeAlteApps != null ? vorberechnet.badgeAlteApps : null;
      } else {
        const paar = await this.berechneBadgePaar(db, userId);
        berechneterBadge = paar ? paar.badge : null;
        badgeAlteApps = paar ? paar.badgeAlteApps : null;
      }

      // Alle Geraete dieser Person in EINEM FCM-Aufruf (sendEach) statt je
      // Geraet einzeln, mit Wiederholung bei zeitweiligen Fehlern. Die
      // Fehlerbehandlung PRO TOKEN bleibt erhalten -- daran haengt das
      // Aufraeumen ungueltiger Tokens.
      // Beim Versand an viele sammelt der Aufrufer die Buchfuehrung je Block
      // (vorberechnet.sammler) statt je Geraet zu schreiben.
      const { erfolge, fehler } = await this.sendeAnGeraete(db, tokens, {
        title: notification.title,
        body: notification.body,
        badge: berechneterBadge != null ? berechneterBadge : 1,
        sound: 'default',
        data: data
      }, (vorberechnet && vorberechnet.sammler) || null,
      berechneterBadge != null ? badgeAlteApps : null);

      // `success` sagt jetzt die Wahrheit. Vorher stand hier hart
      // `success: true`, auch wenn KEIN einziger Push zugestellt wurde -- ein
      // Versand, der nichts erreicht hat, sah wie ein Erfolg aus.
      //
      // Teilerfolg bleibt Erfolg: Kam wenigstens ein Geraet durch, hat die
      // Nachricht ihr Ziel erreicht; die Fehlerzahl steht daneben. Nur wenn
      // alles scheitert, ist es kein Erfolg.
      return { success: erfolge > 0, sent: erfolge, errors: fehler, total: tokens.length };
    } catch (error) {
 console.error('PushService.sendToUser error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper: Sendet Push an mehrere User (z.B. alle Admins)
   *
   * ZWEI AENDERUNGEN AM WEG DORTHIN:
   *
   * 1. Die Zahl fuers App-Icon wird EINMAL fuer alle gerechnet. Vorher rief
   *    jede Kette `berechneBadge` fuer sich und damit die Bulk-Funktion mit
   *    einem Array aus einem Element -- gemessen 7 Abfragen je Kopf.
   *
   * 2. Bloecke statt eines unbegrenzten Promise.all ueber ALLE Empfaenger.
   *    Der frueherige Kommentar hier nannte die Auslegung selbst: "bei 5
   *    Admins". Bei 15.000 Empfaengern eroeffnete das 15.000 Ketten
   *    gleichzeitig gegen 20 Pool-Plaetze; was darueber hinausging, lief in
   *    den Verbindungs-Timeout -- auch die normale API im selben Prozess.
   *    Innerhalb eines Blocks bleibt es parallel, das war nie das Problem.
   */
  static async sendToMultipleUsers(db, userIds, notification) {
    if (!userIds || userIds.length === 0) return [];

    // Braucht der Payload den Organisations-Rueckfall? Traegt er schon eine
    // Content-Org, nicht. Steht ausserdem eine feste Badge-Zahl im Aufruf,
    // ist ueberhaupt nichts vorzubereiten.
    const braucheOrgs = !(notification.data && notification.data.organization_id != null
      && notification.data.organization_id !== '');
    const braucheVorarbeit = notification.badge == null || braucheOrgs;

    const ergebnisse = [];
    const bilanz = this.neueBilanz();
    bilanz.empfaenger = userIds.length;
    for (let i = 0; i < userIds.length; i += this.EMPFAENGER_BLOCK) {
      const block = userIds.slice(i, i + this.EMPFAENGER_BLOCK);

      // Postfach-Eintrag fuer den ganzen Block in EINER Abfrage, VOR dem
      // Versand (siehe sendToUser). sendToUser schreibt unten nicht erneut,
      // weil vorberechnet gesetzt ist.
      await this.schreibePostfach(db, block, notification)
        .catch((err) => console.error('Postfach-Eintrag fehlgeschlagen:', err.message));

      // Badge-Zahl, Organisationen und Tokens JE BLOCK in wenigen Abfragen --
      // statt je Kopf, aber auch nicht fuer alle Empfaenger auf einmal. Bei
      // 15.000 Empfaengern waere ein Zug ueber alle ein Ergebnis mit 15.000
      // Zeilen im Speicher, bevor der erste Push raus ist; genau die Spitze,
      // die die Drosselung vermeiden soll. So kostet ein Block eine feste,
      // kleine Zahl von Abfragen, unabhaengig davon, wie viele Bloecke folgen.
      const { badges, badgesAlteApps, orgs } = braucheVorarbeit
        ? await this.berechneBadgesFuerAlle(db, block)
        : { badges: new Map(), badgesAlteApps: new Map(), orgs: new Map() };
      const tokensJeUser = await this.getTokensForUsers(db, block, notification.data && notification.data.type);

      // Token-Buchfuehrung fuer den ganzen Block gesammelt (drei Abfragen
      // statt einer je Geraet, siehe schreibeErgebnisSammler); die Bilanz
      // fuers Log laeuft ueber alle Bloecke.
      const sammler = this.neuerErgebnisSammler(bilanz);
      const teil = await Promise.all(
        block.map(async (userId) => {
          // `badge: null` heisst hier "fuer diese Person nicht ermittelbar" --
          // sendToUser faellt dann wie bisher auf 1 zurueck. Wichtig ist, dass
          // der Schluessel gesetzt IST: sonst wuerde dort erneut gerechnet und
          // wir haetten die Abfrage je Kopf wieder. Dasselbe gilt fuer orgId.
          const vorberechnet = {
            badge: badges.has(userId) ? badges.get(userId) : null,
            badgeAlteApps: badgesAlteApps.has(userId) ? badgesAlteApps.get(userId) : null,
            orgId: orgs.has(userId) ? orgs.get(userId) : null,
            tokens: tokensJeUser.get(userId) || [],
            sammler,
          };
          const result = await this.sendToUser(db, userId, notification, vorberechnet);
          return { userId, ...result };
        })
      );
      await this.schreibeErgebnisSammler(db, sammler);
      ergebnisse.push(...teil);

      // Nach jedem Block kurz pausieren -- aber nicht nach dem letzten, sonst
      // verzoegert jede Meldung an eine Handvoll Leute ohne Grund. Die Pause
      // gibt die Pool-Verbindung frei, damit die API daneben weiter antwortet
      // (dieselbe Begruendung wie backgroundService.ABZEICHEN_PAUSE_MS).
      if (i + this.EMPFAENGER_BLOCK < userIds.length) {
        await this.schlafen(this.EMPFAENGER_PAUSE_MS);
      }
    }

    const art = (notification.data && notification.data.type) || 'ohne Art';
    this.protokolliereBilanz(`Push ${art}`, bilanz);
    return ergebnisse;
  }

  /**
   * Chat-Push an VIELE Empfaenger:innen -- der Fan-out einer Nachricht
   * 
   *
   * Vorher rief routes/chat.js je Teilnehmer:in sendChatNotification, und
   * jede dieser Ketten holte fuer sich Raum-Organisation, Sender-Tokens,
   * Empfaenger-Tokens und die Zahl fuers App-Icon (berechneBadge: Rolle,
   * Organisationen, sieben Zaehler-Abfragen) und schrieb je Geraet ein
   * UPDATE. Gemessen auf kq_i1 (Raum mit 150 Teilnehmenden, 278 Geraete):
   * 2.002 Abfragen und 2,7 s Datenbankzeit je Nachricht. Dazu kam in
   * chat.js noch eine `total_unread`-Abfrage je Kopf, deren Ergebnis hier
   * ohnehin ersetzt wurde.
   *
   * Jetzt laeuft dieselbe Arbeit EINMAL fuer alle: Badge-Zahl und Primaer-Org
   * (berechneBadgesFuerAlle), Tokens (getTokensForUsers), und die
   * Buchfuehrung ueber die Geraete gesammelt je Block
   * (schreibeErgebnisSammler). Gesendet wird in Bloecken von EMPFAENGER_BLOCK
   * wie in sendToMultipleUsers -- die Vorarbeit aber fuer alle zusammen, nicht
   * je Block: Ein Chat-Raum hat hoechstens so viele Teilnehmende wie eine
   * Gemeinde Konten (rund 150), da lohnt die Zerlegung nicht, sie kostete nur
   * je Block die Zaehler-Abfragen erneut. Gemessen danach: 22 Abfragen und
   * 170 ms Datenbankzeit.
   *
   * WAS GLEICH BLEIBT (Vertrag mit den Apps): Titel, Text, `badge` als
   * Gesamtsumme fuers App-Icon (der von chat.js gereichte Wert ist nur
   * Rueckfall, wenn die Summe nicht ermittelbar ist) und der data-Block
   * type/roomId/messageId/sender_id/sender_name/room_name/organization_id.
   * Die Gruppe "Nachrichten" (GRUPPE_CHAT) bleibt stummschaltbar, gesperrte
   * und geloeschte Konten bleiben aussen vor -- beides steckt in
   * getTokensForUsers.
   *
   * WAS WEGFAELLT: Die eigene Abfrage der Sender-Tokens ("gleicher Token bei
   * verschiedenen Accounts"). Seit Migration 095 ist push_tokens.token
   * eindeutig (idx_push_tokens_token_unique); ein Token gehoert genau einer
   * Person, und der Sender steht nicht in der Empfaengerliste.
   *
   * Personen ohne Geraet ergeben EINE Sammelzeile im Log statt einer je Kopf
   * -- bei 150 Teilnehmenden waren das vorher bis zu 150 Zeilen je Nachricht.
   *
   * @param {object} db
   * @param {number[]} userIds  Empfaenger:innen OHNE den Sender
   * @param {object} notificationData  { title, body, badge?, roomId, messageId,
   *   data: { sender_id, sender_name, room_name, organization_id? } }
   * @returns {Promise<Array<{userId:number, success:boolean, ...}>>} ein
   *   Eintrag je Empfaenger:in, in der Reihenfolge der userIds
   */
  static async sendChatNotificationToMany(db, userIds, notificationData) {
    const empfaenger = [...new Set(userIds || [])];
    if (empfaenger.length === 0) return [];
    try {
      // Content-Org des Chat-Raums (Multi-Org: der Tap wechselt in die
      // Organisation des Raums, NICHT in die Primär-Org des Empfängers).
      // chat.js reicht sie mit; sonst EINE Abfrage fuer alle.
      let chatOrgId = notificationData.data?.organization_id != null
        ? String(notificationData.data.organization_id)
        : '';
      if (!chatOrgId && notificationData.roomId) {
        try {
          const { rows: [roomRow] } = await db.query(
            'SELECT organization_id FROM chat_rooms WHERE id = $1',
            [notificationData.roomId]
          );
          if (roomRow && roomRow.organization_id != null) {
            chatOrgId = String(roomRow.organization_id);
          }
        } catch (orgErr) {
          console.error('Chat-Push: Raum-Org konnte nicht aufgelöst werden:', orgErr);
        }
      }

      const notification = {
        title: notificationData.title || 'Neue Nachricht',
        body: notificationData.body,
        data: {
          type: 'chat',
          roomId: notificationData.roomId?.toString() || '',
          messageId: notificationData.messageId?.toString() || '',
          sender_id: notificationData.data?.sender_id?.toString() || '',
          sender_name: notificationData.data?.sender_name || '',
          room_name: notificationData.data?.room_name || '',
          organization_id: chatOrgId
        }
      };

      // Vorarbeit EINMAL fuer alle: App-Icon-Zahl und Tokens.
      const { badges, badgesAlteApps } = await this.berechneBadgesFuerAlle(db, empfaenger);
      const tokensJeUser = await this.getTokensForUsers(db, empfaenger, 'chat');

      const ergebnisse = [];
      let ohneGeraet = 0;
      // Fehlschlaege und geloeschte Tokens als Bilanz statt je Geraet
      // "ohne Geraet" zaehlt dieser Weg schon selbst.
      const bilanz = this.neueBilanz();
      for (let i = 0; i < empfaenger.length; i += this.EMPFAENGER_BLOCK) {
        const block = empfaenger.slice(i, i + this.EMPFAENGER_BLOCK);
        const sammler = this.neuerErgebnisSammler(bilanz);
        const teil = await Promise.all(block.map(async (userId) => {
          const tokens = tokensJeUser.get(userId) || [];
          if (tokens.length === 0) {
            ohneGeraet++;
            return { userId, success: false, message: 'No tokens found' };
          }
          const vorberechnet = {
            badge: badges.has(userId)
              ? badges.get(userId)
              : (notificationData.badge != null ? notificationData.badge : null),
            badgeAlteApps: badgesAlteApps.has(userId) ? badgesAlteApps.get(userId) : null,
            orgId: chatOrgId || null,
            tokens,
            sammler,
          };
          const result = await this.sendToUser(db, userId, notification, vorberechnet);
          return { userId, ...result };
        }));
        await this.schreibeErgebnisSammler(db, sammler);
        ergebnisse.push(...teil);

        if (i + this.EMPFAENGER_BLOCK < empfaenger.length) {
          await this.schlafen(this.EMPFAENGER_PAUSE_MS);
        }
      }

      if (ohneGeraet > 0) {
        console.warn(
          `Chat-Push Raum ${notification.data.roomId}: ${ohneGeraet} von ${empfaenger.length} Empfänger:innen ohne Push-Token`
        );
      }
      this.protokolliereBilanz(`Chat-Push Raum ${notification.data.roomId}`, bilanz, { ohneGeraet: false });
      return ergebnisse;
    } catch (error) {
      console.error('PushService.sendChatNotificationToMany error:', error);
      throw error;
    }
  }

  /**
   * Chat-Push an EINE Person -- derselbe Weg wie sendChatNotificationToMany
   * mit einer Empfaengerin. Bleibt fuer Aufrufer und Tests, die eine Person
   * meinen; der Nachrichten-Fan-out in routes/chat.js nutzt den Sammelweg.
   */
  static async sendChatNotification(db, userId, notificationData) {
    const [ergebnis] = await this.sendChatNotificationToMany(db, [userId], notificationData);
    if (!ergebnis) return { success: false, message: 'No tokens found' };
    const { userId: _weg, ...rest } = ergebnis;
    return rest;
  }

  /**
   * Sendet Badge Update (für Background App Badge Count)
   *
   * Die Zahl wird HIER gerechnet, nicht vom Aufrufer uebernommen.
   * Der Hintergrunddienst uebergab bisher seinen eigenen
   * Wert, und der zaehlte NUR ungelesene Chat-Nachrichten
   * (`backgroundService.js:162`). Am App-Icon steht aber dieselbe Zahl, die
   * jeder Push aus `berechneBadge` setzt — Chat PLUS Antraege, Termine
   * und Abzeichen. Ergebnis: Ein Push setzte korrekt "7", und bis zu fuenf
   * Minuten spaeter ueberschrieb der Hintergrund-Sync sie mit "2".
   *
   * Das ist derselbe Fehler wie B2b, nur an der letzten Stelle, die damals
   * aussen vor blieb: Wer die Zahl setzt, muss sie auch rechnen.
   *
   * Die Funktion nimmt bewusst KEINE Zahl mehr entgegen: Wer sie setzt, holt
   * sie aus der einen Quelle. Laesst sie sich nicht ermitteln (Person
   * geloescht oder Datenbankfehler), wird NICHT gesendet — eine geratene Zahl
   * am App-Icon ist schlechter als keine.
   *
   * @param {object} db
   * @param {number} userId
   */
  static async sendBadgeUpdate(db, userId) {
    try {

      const tokens = await this.getTokensForUser(db, userId);

      if (tokens.length === 0) {
        return { success: false, message: 'No tokens found' };
      }

      const paar = await this.berechneBadgePaar(db, userId);
      if (paar == null || paar.badge == null) {
        return { success: false, message: 'Badge nicht ermittelbar' };
      }
      const badgeCount = paar.badge;

      let successCount = 0;
      let errorCount = 0;

      for (const token of tokens) {
        // Wiederholen bei zeitweiligen Fehlern, wie beim sichtbaren Push
        // Der stille Push traegt die Zahl am App-Icon nach;
        // faellt er wegen quota-exceeded aus, steht dort bis zum naechsten
        // Ereignis eine veraltete Zahl.
        //
        // Je Geraet die passende Zahl (Store-Apps 2.2.x, badgeFuerGeraet).
        const zahl = this.badgeFuerGeraet(token, badgeCount, paar.badgeAlteApps);
        const result = await this.sendeMitWiederholung(
          () => firebase.sendFirebaseSilentPush(token.token, zahl)
        );

        if (result.success) {
          successCount++;
          if (token.error_count > 0) {
            await db.query(
              'UPDATE push_tokens SET error_count = 0, last_error_at = NULL WHERE id = $1',
              [token.id]
            );
          }
        } else {
          if (this.istFatal(result.errorCode)) {
            await db.query('DELETE FROM push_tokens WHERE id = $1', [token.id]);
            console.warn(`Token ${token.id} gelöscht (${result.errorCode})`);
          } else {
            await db.query(
              'UPDATE push_tokens SET error_count = error_count + 1, last_error_at = NOW() WHERE id = $1',
              [token.id]
            );
          }
          errorCount++;
        }
      }

      // `badge` mit zurueckgeben: Der Hintergrunddienst merkt sich den zuletzt
      // gesendeten Stand, um nicht bei jedem Lauf zu senden. Er kennt die
      // Gesamtzahl aber nicht — er zaehlt nur den Chat. Ohne diesen Rueckgabe-
      // wert vergliche er Aepfel mit Birnen und feuerte entweder dauernd oder
      // gar nicht mehr.
      // `success` nach dem tatsaechlichen Versand, wie in
      // sendToUser und sendChatNotification.
      return {
        success: successCount > 0, sent: successCount, errors: errorCount, total: tokens.length,
        badge: badgeCount, badgeAlteApps: paar.badgeAlteApps
      };

    } catch (error) {
 console.error('PushService.sendBadgeUpdate error:', error);
      throw error;
    }
  }

  /**
   * Stiller App-Icon-Push an VIELE Personen mit schon gerechneter Zahl
   * 
   *
   * Der Hintergrunddienst (updateAllUserBadges) rechnet die Summe fuer alle
   * Konten in wenigen Bulk-Abfragen -- und rief dann fuer jede Person, deren
   * Stand sich geaendert hat, sendBadgeUpdate, das die Summe ERNEUT je Kopf
   * rechnete (Rolle, Organisationen, Zaehler-Abfragen) und die Tokens je Kopf
   * holte: rund 7 Abfragen je Person. Eine neue Chat-Nachricht in einem Raum
   * mit 60 Teilnehmenden kostete im naechsten Takt 439 Abfragen
   * (tests/services/appIconLaufNeustart.test.js, N3).
   *
   * Hier stattdessen: Tokens EINMAL fuer alle (getTokensForUsers, ohne Art --
   * der stille Push traegt nur die Zahl und ist nicht stummschaltbar, wie in
   * sendBadgeUpdate), je Geraet der stille Push mit der mitgegebenen Zahl,
   * Buchfuehrung gesammelt je Block. Die Regeln je Geraet sind dieselben wie
   * in sendBadgeUpdate: Erfolg setzt einen Fehlerzaehler zurueck (aber ruehrt
   * updated_at NICHT an -- ein stiller Push ist kein Beleg, dass jemand die
   * App noch nutzt), fatale Fehler loeschen den Token, sonstige zaehlen hoch.
   *
   * @param {object} db
   * @param {Array<{userId:number, badge:number, badgeAlteApps?:number}>} eintraege
   *   badgeAlteApps: Zahl fuer Geraete der Store-Apps 2.2.x (badgeFuerGeraet);
   *   fehlt sie, bekommen alle Geraete `badge`.
   * @returns {Promise<{sent:number, errors:number, total:number}>}
   */
  static async sendBadgeUpdates(db, eintraege) {
    let sent = 0;
    let errors = 0;
    let total = 0;
    if (!eintraege || eintraege.length === 0) return { sent, errors, total };

    for (let i = 0; i < eintraege.length; i += this.EMPFAENGER_BLOCK) {
      const block = eintraege.slice(i, i + this.EMPFAENGER_BLOCK);
      const tokensJeUser = await this.getTokensForUsers(db, block.map((e) => e.userId));
      const sammler = { zurueckgesetzt: [], ungueltig: [], fehlgeschlagen: [] };

      await Promise.all(block.map(async ({ userId, badge, badgeAlteApps }) => {
        const tokens = tokensJeUser.get(userId) || [];
        for (const token of tokens) {
          total++;
          const zahl = this.badgeFuerGeraet(token, badge, badgeAlteApps);
          const result = await this.sendeMitWiederholung(
            () => firebase.sendFirebaseSilentPush(token.token, zahl)
          );
          if (result.success) {
            sent++;
            if (token.error_count > 0) sammler.zurueckgesetzt.push(token.id);
          } else if (this.istFatal(result.errorCode)) {
            sammler.ungueltig.push(token.id);
            errors++;
          } else {
            sammler.fehlgeschlagen.push(token.id);
            errors++;
          }
        }
      }));

      try {
        if (sammler.zurueckgesetzt.length > 0) {
          await db.query(
            'UPDATE push_tokens SET error_count = 0, last_error_at = NULL WHERE id = ANY($1::bigint[])',
            [sammler.zurueckgesetzt]
          );
        }
        if (sammler.ungueltig.length > 0) {
          await db.query('DELETE FROM push_tokens WHERE id = ANY($1::bigint[])', [sammler.ungueltig]);
          console.warn(`${sammler.ungueltig.length} Token(s) gelöscht (von FCM abgelehnt, stiller Push)`);
        }
        if (sammler.fehlgeschlagen.length > 0) {
          await db.query(
            'UPDATE push_tokens SET error_count = error_count + 1, last_error_at = NOW() WHERE id = ANY($1::bigint[])',
            [sammler.fehlgeschlagen]
          );
        }
      } catch (err) {
        console.error('Token-Buchfuehrung (stiller Push) fehlgeschlagen:', err.message);
      }

      if (i + this.EMPFAENGER_BLOCK < eintraege.length) {
        await this.schlafen(this.EMPFAENGER_PAUSE_MS);
      }
    }
    return { sent, errors, total };
  }

  // ====================================================================
  // ACTIVITY REQUEST NOTIFICATIONS
  // ====================================================================

  /**
   * Generische Push-Notification an alle Admins einer Organisation
   *
   * NICHT fuer Vorgaenge mit Jahrgangsbezug: Diese Methode
   * kennt keine Jahrgangsbindung und erreicht jeden Admin der Gemeinde. Die
   * Leitungs-Meldungen zu Terminen, Jahrgaengen und Antraegen nehmen ihre
   * Empfaenger aus der jeweiligen Regel-Stelle (utils/terminLeitungSicht.js,
   * utils/jahrgangLeitungSicht.js, utils/antragLeitungSicht.js) und senden
   * ueber sendToLeadership.
   *
   * @param {object} db - DB-Pool
   * @param {number} organizationId - Organisation ID
   * @param {object} notification - { title, body, data? }
   */
  static async sendToOrgAdmins(db, organizationId, notification) {
    try {
      const admins = await ladeLeitungDerOrganisation(db, organizationId);
      if (admins.length === 0) {
        return { success: false, message: 'No admins found' };
      }
      const adminIds = admins;
      // Content-Org in den Payload: Admins können Multi-Org sein, der Tap
      // muss in DIESE Organisation wechseln (nicht in ihre Primär-Org).
      const enriched = {
        ...notification,
        data: {
          ...(notification.data || {}),
          organization_id: String(notification.data?.organization_id ?? organizationId)
        }
      };
      return await this.sendToMultipleUsers(db, adminIds, enriched);
    } catch (error) {
      console.error('sendToOrgAdmins error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Push an eine AUSDRUECKLICHE Empfaengerliste der Leitung.
   *
   * Die Liste kommt von der Aufrufstelle, aus der Regel-Stelle des Vorgangs
   * (ladeLeitungZumTermin, ladeLeitungZumJahrgang, ...) -- dieselbe Regel,
   * nach der Liste und Zaehler filtern. Ohne Liste geht NICHTS raus: kein
   * stiller Rueckfall auf die ganze Leitung.
   * Die Organisation des Inhalts kommt in den Payload, damit
   * der Tap in DIESE Gemeinde wechselt.
   *
   * @param {object} db
   * @param {number} organizationId  Organisation des Inhalts
   * @param {Array<number>} empfaenger
   * @param {object} notification  { title, body, data }
   * @param {string} bezeichnung  fuer die Fehlermeldung
   */
  static async sendToLeadership(db, organizationId, empfaenger, notification, bezeichnung = 'sendToLeadership') {
    if (!Array.isArray(empfaenger)) {
      console.error(`${bezeichnung}: Empfaengerliste fehlt, nichts gesendet`);
      return { success: false, message: 'Empfängerliste fehlt' };
    }
    if (empfaenger.length === 0) {
      return { success: false, message: 'No admins found' };
    }
    const enriched = {
      ...notification,
      data: {
        ...(notification.data || {}),
        organization_id: String(notification.data?.organization_id ?? organizationId)
      }
    };
    return this.sendToMultipleUsers(db, empfaenger, enriched);
  }

  /**
   * Neuer Antrag eingereicht - Push an die Leitung, die den Antrag sieht.
   *
   * Ohne Empfaengerliste wird NICHTS gesendet -- kein stiller Rueckfall auf
   * die ganze Leitung.
   *
   * @param {object} db
   * @param {number} organizationId  Organisation des Antrags (Content-Org)
   * @param {Array<number>} empfaenger  aus ladeLeitungZumAntrag
   * @param {string} konfiName
   * @param {string} activityName
   * @param {number} points
   */
  static async sendNewActivityRequestToLeadership(db, organizationId, empfaenger, konfiName, activityName, points) {
    try {
      if (!Array.isArray(empfaenger)) {
        console.error('sendNewActivityRequestToLeadership: Empfaengerliste fehlt, nichts gesendet');
        return { success: false, message: 'Empfängerliste fehlt' };
      }
      if (empfaenger.length === 0) {
        return { success: false, message: 'No admins found' };
      }

      const notification = {
        title: 'Neuer Antrag',
        body: `${konfiName} hat einen Antrag für "${activityName}" (${points}P) eingereicht`,
        data: {
          type: 'new_activity_request',
          organization_id: organizationId.toString()
        }
      };

      return await this.sendToMultipleUsers(db, empfaenger, notification);
    } catch (error) {
      console.error('sendNewActivityRequestToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Antrag genehmigt/abgelehnt - Push an Konfi
   */
  static async sendActivityRequestStatusToKonfi(db, konfiId, activityName, points, status, adminComment = null, requestId = null, organizationId = null) {
    try {

      const isApproved = status === 'approved';
      const notification = {
        title: isApproved ? 'Antrag genehmigt!' : 'Antrag abgelehnt',
        body: isApproved
          ? `Dein Antrag für "${activityName}" wurde genehmigt. +${points} Punkte!`
          : `Dein Antrag für "${activityName}" wurde leider abgelehnt.${adminComment ? ` Grund: ${adminComment}` : ''}`,
        data: {
          type: 'activity_request_status',
          status: status,
          activity_name: activityName,
          points: points.toString(),
          request_id: requestId?.toString() || '',
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendActivityRequestStatusToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  // ====================================================================
  // BADGE NOTIFICATIONS
  // ====================================================================

  /**
   * Badge erhalten - Push an Konfi
   */
  static async sendBadgeEarnedToKonfi(db, konfiId, badgeName, badgeIcon, badgeDescription, badgeId = null, organizationId = null) {
    try {

      const notification = {
        title: 'Neues Badge erhalten!',
        body: `Herzlichen Glückwunsch! Du hast das Badge "${badgeName}" erhalten.`,
        data: {
          type: 'badge_earned',
          badge_name: badgeName,
          badge_icon: badgeIcon,
          badge_id: badgeId?.toString() || '',
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendBadgeEarnedToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  // ====================================================================
  // BONUS POINTS NOTIFICATIONS
  // ====================================================================

  /**
   * Aktivität direkt zugewiesen - Push an Konfi
   */
  static async sendActivityAssignedToKonfi(db, konfiId, activityName, points, type) {
    try {

      const typeText = type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde';
      const notification = {
        title: `+${points} Punkte!`,
        body: `Du hast ${points} ${typeText}-Punkte für "${activityName}" erhalten.`,
        data: {
          type: 'activity_assigned',
          activity_name: activityName,
          points: points.toString(),
          category: type
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendActivityAssignedToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Bonuspunkte erhalten - Push an Konfi
   */
  static async sendBonusPointsToKonfi(db, konfiId, points, description, type) {
    try {

      const typeText = type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde';
      const notification = {
        title: `+${points} Bonuspunkte!`,
        body: `Du hast ${points} ${typeText}-Bonuspunkte erhalten: ${description}`,
        data: {
          type: 'bonus_points',
          points: points.toString(),
          category: type
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendBonusPointsToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  // ====================================================================
  // EVENT NOTIFICATIONS
  // ====================================================================

  /**
   * Event-Anmeldung bestätigt - Push an Konfi
   * @param {Object} timeslot - Optional: {start_time, end_time} des gebuchten Timeslots
   */
  static async sendEventRegisteredToKonfi(db, konfiId, eventName, eventDate, status, eventId = null, timeslot = null, organizationId = null) {
    try {

      const dateFormatted = formatDatum(eventDate, {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });

      // Build time string - use timeslot time if available, otherwise event time
      let timeString = '';
      if (timeslot && timeslot.start_time) {
        const startTime = formatUhrzeit(timeslot.start_time);
        const endTime = timeslot.end_time
          ? formatUhrzeit(timeslot.end_time)
          : null;
        timeString = endTime ? ` von ${startTime} - ${endTime} Uhr` : ` um ${startTime} Uhr`;
      } else {
        const eventTime = formatUhrzeit(eventDate);
        timeString = ` um ${eventTime} Uhr`;
      }

      const isConfirmed = status === 'confirmed';
      const notification = {
        title: isConfirmed ? 'Anmeldung bestätigt!' : 'Auf Warteliste',
        body: isConfirmed
          ? `Du bist für "${eventName}" am ${dateFormatted}${timeString} angemeldet.`
          : `Du stehst auf der Warteliste für "${eventName}" am ${dateFormatted}.`,
        data: {
          type: 'event_registered',
          event_name: eventName,
          status: status,
          event_id: eventId?.toString() || '',
          // Event-Org explizit: Teamer:innen können Multi-Org sein.
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendEventRegisteredToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Event-Anmeldung bestätigt - Push an Teamer:in
   *
   * Teamer:innen haben seit dem Teamer-Kontingent ebenfalls eine Warteliste,
   * brauchen also dieselbe Rueckmeldung wie Konfis. Die Texte sind identisch
   * (sendEventRegisteredToKonfi ist rollenagnostisch und sendet nur an eine
   * User-ID) — daher wird sie hier bewusst wiederverwendet.
   * @param {string} status - 'confirmed' oder 'waitlist'
   */
  static async sendEventRegisteredToTeamer(db, teamerId, eventName, eventDate, status, eventId = null, organizationId = null) {
    return await this.sendEventRegisteredToKonfi(db, teamerId, eventName, eventDate, status, eventId, null, organizationId);
  }

  /**
   * Event-Abmeldung bestätigt - Push an Konfi
   */
  static async sendEventUnregisteredToKonfi(db, konfiId, eventName, eventId = null) {
    try {

      const notification = {
        title: 'Abmeldung bestätigt',
        body: `Du hast dich von "${eventName}" abgemeldet.`,
        data: {
          type: 'event_unregistered',
          event_name: eventName,
          ...(eventId != null ? { event_id: String(eventId) } : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendEventUnregisteredToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Die Leitung hat jemanden aus einem Termin ausgetragen oder auf die
   * Warteliste zurueckgesetzt -- Push und Postfach an die Person.
   *
   * ZWEI EIGENE ARTEN statt event_unregistered: Die sagt "Du hast dich
   * abgemeldet" und ist die Bestaetigung der EIGENEN Handlung. Hier handelt
   * jemand anderes. Rollenagnostisch wie sendEventRegisteredToKonfi --
   * Konfis, Teamer:innen und zugeordnete Leitung gehen denselben Weg.
   *
   * ALTE APPS: Store-Fassungen 2.2.x kennen beide Arten nicht. Der Push
   * erscheint dort mit Titel und Text wie jeder andere (das zeigt das
   * Betriebssystem); das Antippen oeffnet die App, ohne zu springen
   * (buildPushTargetUrl liefert fuer unbekannte Arten ''). Ein Postfach haben
   * sie nicht. Fassungen mit Postfach, die die Arten noch nicht kennen,
   * zeigen den Eintrag in der Terminfarbe (Praefix event_) ohne Sprungziel.
   *
   * @param {'removed'|'waitlist'} vorgang  ausgetragen oder auf die Warteliste
   */
  static async sendEventRemovedByLeitung(db, userId, eventName, eventDate, vorgang, eventId = null, organizationId = null) {
    try {
      const datum = eventDate
        ? ` am ${formatDatum(eventDate, { weekday: 'long', day: 'numeric', month: 'long' })}`
        : '';
      const gemeinsam = {
        event_name: eventName,
        event_id: eventId?.toString() || '',
        // Event-Org explizit: Teamer:innen koennen Multi-Org sein.
        ...(organizationId != null ? { organization_id: String(organizationId) } : {})
      };

      const notification = vorgang === 'waitlist'
        ? {
          title: 'Auf die Warteliste gesetzt',
          body: `Die Leitung hat dich für "${eventName}"${datum} auf die Warteliste gesetzt. Rückst du nach, bekommst du Bescheid.`,
          data: {
            type: 'event_waitlisted',
            ...gemeinsam
          }
        }
        : {
          title: 'Vom Event ausgetragen',
          body: `Die Leitung hat dich aus "${eventName}"${datum} ausgetragen.`,
          data: {
            type: 'event_removed',
            ...gemeinsam
          }
        };

      return await this.sendToUser(db, userId, notification);
    } catch (error) {
      console.error('sendEventRemovedByLeitung error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Konfi hat sich von Event abgemeldet - Push an die Leitung, die den
   * Termin sieht.
   *
   * EMPFAENGER KOMMEN VON DER AUFRUFSTELLE: ladeLeitungZumTermin
   * (utils/terminLeitungSicht.js) -- dieselbe Regel wie Terminliste und
   * Verbuchen-Zaehler. Vorher holte die Methode selbst
   * ladeLeitungDerOrganisation, also JEDEN Admin der Gemeinde; der Text
   * traegt Name und Grund.
   */
  // eventId optional und am Ende: Die Meldung geht seit dem
  // Postfach nicht nur als Push raus, sondern bleibt als Mitteilung stehen --
  // und stirbt mit dem Termin (utils/postfachAufraeumen.js). Dafuer braucht
  // sie seine Kennung. Ausserdem springt der Tap damit an den Termin statt
  // auf die Liste (frontend utils/pushNavigation.ts).
  // konfiId optional und am Ende: Die Mitteilung
  // geht mit dem Konto der Konfi (utils/postfachAufraeumen.js,
  // loescheMitteilungenUeberPerson) -- dafuer traegt sie konfi_id.
  static async sendEventUnregistrationToLeadership(db, organizationId, empfaenger, konfiName, eventName, reason = null, eventId = null, konfiId = null) {
    try {
      const notification = {
        title: 'Event-Abmeldung',
        body: reason
          ? `${konfiName} hat sich von "${eventName}" abgemeldet. Grund: ${reason}`
          : `${konfiName} hat sich von "${eventName}" abgemeldet.`,
        data: {
          type: 'event_unregistration',
          event_name: eventName,
          konfi_name: konfiName,
          ...(eventId != null ? { event_id: String(eventId) } : {}),
          ...(konfiId != null ? { konfi_id: String(konfiId) } : {}),
          organization_id: String(organizationId)
        }
      };

      return await this.sendToLeadership(db, organizationId, empfaenger, notification, 'sendEventUnregistrationToLeadership');
    } catch (error) {
      console.error('sendEventUnregistrationToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Level-Check nach Punkte-Vergabe: Vergleicht aktuelles Level mit gespeichertem Level
   * und sendet Level-Up Push falls aufgestiegen.
   * Wird an allen Punkte-Vergabe-Stellen aufgerufen (activities, konfi-managment, events).
   */
  static async checkAndSendLevelUp(db, konfiId, organizationId) {
    try {
      // 1. Aktuelle Punkte, gespeichertes Level UND Jahrgang-Config holen.
      // WICHTIG: nur AKTIVIERTE Punkt-Kategorien zählen (gemeinde_enabled /
      // gottesdienst_enabled des Jahrgangs) — sonst wuerde ein Single-Kategorie-
      // Jahrgang anhand zu hoher Punkte ins falsche Level eingestuft (+ falsche
      // Level-Up-Pushes). Identische Logik wie der Dashboard-Endpoint.
      const { rows: [profile] } = await db.query(
        `SELECT kp.gottesdienst_points, kp.gemeinde_points, kp.current_level_id,
                COALESCE(j.gottesdienst_enabled, true) AS gottesdienst_enabled,
                COALESCE(j.gemeinde_enabled, true) AS gemeinde_enabled
         FROM konfi_profiles kp
         LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
         WHERE kp.user_id = $1`,
        [konfiId]
      );
      if (!profile) return;

      const totalPoints =
        (profile.gottesdienst_enabled ? (profile.gottesdienst_points || 0) : 0) +
        (profile.gemeinde_enabled ? (profile.gemeinde_points || 0) : 0);

      // 2. Alle aktiven Levels der Organisation holen (aufsteigend nach Punkten)
      const { rows: levels } = await db.query(
        'SELECT * FROM levels WHERE organization_id = $1 AND is_active = true ORDER BY points_required ASC',
        [organizationId]
      );
      if (levels.length === 0) return;

      const { currentLevel: newLevel } = berechneLevelFortschritt(totalPoints, levels);

      // 4. Vergleich mit gespeichertem Level — nur wenn Level AUFGESTIEGEN
      if (newLevel && newLevel.id !== profile.current_level_id) {
        // Prüfen ob neues Level HÖHER ist (nicht Level-Down bei Punkte-Abzug)
        const oldLevel = levels.find(l => l.id === profile.current_level_id);
        if (oldLevel && newLevel.points_required <= oldLevel.points_required) {
          // Level-Down oder gleiches Level — kein Push, aber Level-ID updaten
          await db.query(
            'UPDATE konfi_profiles SET current_level_id = $1 WHERE user_id = $2',
            [newLevel.id, konfiId]
          );
          return;
        }

        // Level-ID updaten
        await db.query(
          'UPDATE konfi_profiles SET current_level_id = $1 WHERE user_id = $2',
          [newLevel.id, konfiId]
        );

        // Level-Up Push senden
        await this.sendLevelUpToKonfi(
          db, konfiId, newLevel.name, newLevel.title, newLevel.icon, newLevel.id
        );
      }
    } catch (error) {
      console.error('checkAndSendLevelUp error:', error);
      // Fehler nicht weiterwerfen — Level-Check darf Punkte-Vergabe nicht blockieren
    }
  }

  /**
   * Level-Up - Push an Konfi
   */
  static async sendLevelUpToKonfi(db, konfiId, levelName, levelTitle, levelIcon, levelId = null) {
    try {

      const notification = {
        title: 'Level Up!',
        body: `Herzlichen Glückwunsch! Du hast Level "${levelTitle || levelName}" erreicht!`,
        data: {
          type: 'level_up',
          level_name: levelName,
          level_title: levelTitle || levelName,
          level_id: levelId?.toString() || ''
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendLevelUpToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Event-Erinnerung - Push an Konfi (1 Tag oder 1 Stunde vorher)
   */
  static async sendEventReminderToKonfi(db, konfiId, eventName, eventDate, eventTime, reminderType, organizationId = null, eventId = null) {
    try {

      const isOneDay = reminderType === '1_day';
      const notification = {
        title: isOneDay ? 'Morgen: Event!' : 'Gleich: Event!',
        // Die Ein-Stunden-Erinnerung nennt die Uhrzeit statt "In 1 Stunde"
        // Der Text stimmt dann auch, wenn der Push spaeter
        // ankommt -- Takt, Spielraum (backgroundService.erinnerungsFenster)
        // oder ein Handy im Ruhemodus.
        body: isOneDay
          ? `Morgen: ${eventName}${eventTime ? ` um ${eventTime} Uhr` : ''}`
          : `Gleich: ${eventName}${eventTime ? ` um ${eventTime} Uhr` : ''}`,
        data: {
          type: 'event_reminder',
          reminder_type: reminderType,
          event_name: eventName,
          ...(eventId != null ? { event_id: String(eventId) } : {}),
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      if (Array.isArray(konfiId)) {
        return await this.sendToMultipleUsers(db, konfiId, notification);
      }
      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendEventReminderToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Von Warteliste aufgerückt - Push an Konfi
   */
  /**
   * Einladung in eine weitere Gemeinde. Der Empfaenger
   * entscheidet -- deshalb Gruppe "Anfragen und Freigaben".
   *
   * organization_id ist die EINLADENDE Gemeinde: Der Tap soll dorthin
   * fuehren, wo die Einladung herkommt. Der Empfaenger ist dort allerdings
   * noch NICHT Mitglied -- resolveOrgForPush kann also nicht wechseln. Das
   * Ziel ist deshalb eine Seite seiner EIGENEN Rolle
   * (utils/pushNavigation.ts, Fall 'gemeinde_einladung').
   *
   * einladung_id ist mehr als Beiwerk: Zieht die Leitung die Einladung
   * zurueck, findet utils/postfachAufraeumen.js den Postfach-Eintrag darueber
   * und nimmt ihn mit.
   */
  static async sendGemeindeEinladungToUser(db, userId, orgName, rolleName, einladungId, organizationId) {
    try {
      const notification = {
        title: 'Einladung in eine Gemeinde',
        body: `${orgName} lädt dich ein, dort als ${rolleName} mitzuarbeiten. Tippe, um zu antworten.`,
        data: {
          type: 'gemeinde_einladung',
          einladung_id: einladungId?.toString() || '',
          org_name: String(orgName || ''),
          rolle: String(rolleName || ''),
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };
      return await this.sendToUser(db, userId, notification);
    } catch (error) {
      console.error('sendGemeindeEinladungToUser error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Eine Einladung in eine weitere Gemeinde wurde angenommen oder abgelehnt
   * -- Postfach und Push an die Person, die eingeladen hat.
   *
   * @param {object} p
   * @param {number} p.organizationId  die EINLADENDE Gemeinde (Org des Inhalts)
   * @param {number|null} p.eingeladenVon
   * @param {number} p.eingeladenId    die eingeladene Person
   * @param {boolean} p.angenommen
   * @returns {Promise<Array>} Ergebnis je Empfaenger (sendToMultipleUsers)
   */
  static async sendEinladungBeantwortetToLeitung(db, { einladungId, organizationId, eingeladenVon, eingeladenId, personName, rolleName, orgName, angenommen }) {
    try {
      const orgAdmins = (await ladeMitgliederDerOrganisation(db, organizationId, ['org_admin']))
        .filter((id) => Number(id) !== Number(eingeladenId));
      const einladende = orgAdmins.filter((id) => eingeladenVon != null && Number(id) === Number(eingeladenVon));
      const empfaenger = einladende.length > 0 ? einladende : orgAdmins;
      if (empfaenger.length === 0) return [];

      const person = personName || 'Die eingeladene Person';
      const rolle = rolleName || 'Mitglied';
      const gemeinde = orgName || 'eurer Gemeinde';
      const notification = {
        title: angenommen ? 'Einladung angenommen' : 'Einladung abgelehnt',
        body: angenommen
          ? `${person} hat die Einladung angenommen und arbeitet jetzt als ${rolle} in ${gemeinde} mit.`
          : `${person} hat die Einladung als ${rolle} in ${gemeinde} abgelehnt.`,
        data: {
          type: 'gemeinde_einladung_beantwortet',
          einladung_id: einladungId?.toString() || '',
          user_id: eingeladenId?.toString() || '',
          status: angenommen ? 'angenommen' : 'abgelehnt',
          organization_id: String(organizationId)
        }
      };
      return await this.sendToMultipleUsers(db, empfaenger, notification);
    } catch (error) {
      console.error('sendEinladungBeantwortetToLeitung error:', error);
      return [];
    }
  }

  static async sendWaitlistPromotionToKonfi(db, konfiId, eventName, eventDate = null, eventId = null, organizationId = null) {
    try {

      let dateInfo = '';
      if (eventDate) {
        const date = new Date(eventDate);
        dateInfo = ` am ${formatDatum(date, { day: '2-digit', month: '2-digit' })} um ${formatUhrzeit(date)} Uhr`;
      }

      const notification = {
        title: 'Platz frei geworden!',
        body: `Du bist für "${eventName}"${dateInfo} nachgerückt und jetzt angemeldet.`,
        data: {
          type: 'waitlist_promotion',
          event_name: eventName,
          event_id: eventId?.toString() || '',
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendWaitlistPromotionToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Von der Teamer-Warteliste aufgerückt - Push an Teamer:in
   *
   * Gleiche Nachricht wie bei Konfis (sendWaitlistPromotionToKonfi ist
   * rollenagnostisch), eigener Einstiegspunkt für die Lesbarkeit der
   * Aufrufstellen und der Registry oben.
   */
  static async sendWaitlistPromotionToTeamer(db, teamerId, eventName, eventDate = null, eventId = null, organizationId = null) {
    return await this.sendWaitlistPromotionToKonfi(db, teamerId, eventName, eventDate, eventId, organizationId);
  }

  /**
   * Event abgesagt - Push an alle angemeldeten Konfis
   *
   * @param {string|null} grund - Freiwilliger Absagegrund (Migration 150).
   *
   * @param {number|null} eventId - Termin-Kennung fuer den Sprung beim Antippen.
   *
   * WARUM DIE KENNUNG FEHLTE UND JETZT DAZUKOMMT: Jeder
   * vergleichbare Termin-Push traegt sie (sendEventChangedToKonfis,
   * sendMandatoryEventCreated, sendEventRegisteredToKonfi) — der Absage-Push
   * als einziger nicht. Ein Tipp auf "Leider abgesagt" landete deshalb auf
   * der Terminliste statt am Termin, und genau dort steht der Grund
   * ausfuehrlich, samt "Abgesagt von ...".
   *
   * OHNE KENNUNG BLEIBT ES BEIM ALTEN: Der Parameter steht am Ende und ist
   * optional; faellt er weg, fehlt der Schluessel im data-Teil und die App
   * landet wie bisher auf der Terminliste. Genau so ruft ihn die Loeschroute,
   * denn einen geloeschten Termin gibt es nicht mehr aufzuschlagen.
   */
  static async sendEventCancellationToKonfis(db, userIds, eventName, eventDate, organizationId = null, grund = null, eventId = null) {
    try {

      let dateInfo = eventDate;
      if (eventDate) {
        const date = new Date(eventDate);
        dateInfo = `${formatDatum(date, { weekday: 'short', day: '2-digit', month: '2-digit' })} um ${formatUhrzeit(date)} Uhr`;
      }

      const grundText = typeof grund === 'string' && grund.trim() !== '' ? grund.trim() : null;

      const notification = {
        title: 'Event abgesagt',
        body: `Leider abgesagt: "${eventName}" am ${dateInfo}`
          + (grundText ? `. ${grundText}` : ''),
        data: {
          type: 'event_cancelled',
          event_name: eventName,
          // Additiv im data-Teil: Alte App-Fassungen lesen den Schluessel
          // nicht und ignorieren ihn. Ohne Grund faellt er ganz weg, statt
          // als leerer String dazustehen.
          ...(grundText ? { cancelled_reason: grundText } : {}),
          // Termin-Kennung fuer den Sprung beim Antippen. Wie beim Grund
          // daneben faellt der Schluessel ganz weg, statt als leerer String
          // dazustehen: Die Loeschroute ruft ohne Kennung, und ein
          // event_id: '' an einem Termin, den es nicht mehr gibt, waere eine
          // Behauptung ueber ein Ziel. Alte App-Fassungen lesen den Schluessel
          // nicht und ignorieren ihn.
          ...(eventId != null ? { event_id: String(eventId) } : {}),
          // Event-Org explizit: unter den Gebuchten können Teamer:innen mit
          // anderer Primär-Org sein.
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToMultipleUsers(db, userIds, notification);
    } catch (error) {
 console.error('sendEventCancellationToKonfis error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Die Absage ist zurueckgenommen — der Termin findet doch statt
   * Das Gegenstueck zu sendEventCancellationToKonfis.
   *
   * Der Hinweis gehoert in den Text, nicht in die App: Wer die Absage gelesen
   * und sich anderweitig verabredet hat, muss die Nachricht als AUFFORDERUNG
   * verstehen, nicht als blosse Mitteilung. Deshalb steht die Rueckfrage
   * ausdruecklich drin — die Anmeldung ist wieder da, ohne dass jemand
   * zugestimmt haette, und wer nicht kann, meldet sich ab.
   *
   * NUR AN DIE WIEDER ANGEMELDETEN (Route: die Rueckgabe von
   * hebeAbsageAbmeldungenAuf). Wer vor der Absage selbst oder von der Leitung
   * abgemeldet war, bleibt abgemeldet und bekommt DIESEN Push nicht: "Du bist
   * wieder angemeldet" waere fuer sie schlicht falsch, und eine Nachricht
   * ueber einen Termin, an dem sie nicht teilnehmen, ist Laerm.
   *
   * KEIN GRUND IM TEXT: Der Absagegrund ("Heizung defekt") beschreibt eine
   * Absage, die es nicht mehr gibt. Ihn hier mitzuschicken wuerde die
   * Nachricht in ihr Gegenteil verkehren.
   *
   * @param {Array<number>} userIds - die wieder Angemeldeten
   * @param {string} eventName
   * @param {string|Date} eventDate - Datum fuer die Zeile im Text
   * @param {number|null} organizationId - Organisation des TERMINS
   * @param {number|null} eventId - Sprungziel beim Antippen
   */
  static async sendEventReactivationToKonfis(db, userIds, eventName, eventDate, organizationId = null, eventId = null) {
    try {
      let dateInfo = eventDate;
      if (eventDate) {
        const date = new Date(eventDate);
        dateInfo = `${formatDatum(date, { weekday: 'short', day: '2-digit', month: '2-digit' })} um ${formatUhrzeit(date)} Uhr`;
      }

      const notification = {
        title: 'Event findet doch statt',
        body: `"${eventName}" am ${dateInfo} findet doch statt.`
          + ' Du bist wieder angemeldet – prüf bitte, ob du Zeit hast, und melde dich sonst ab.',
        data: {
          type: 'event_reactivated',
          event_name: eventName,
          // Wie bei der Absage: faellt ganz weg statt als leerer String
          // dazustehen. Alte App-Fassungen lesen den Schluessel nicht.
          ...(eventId != null ? { event_id: String(eventId) } : {}),
          // Event-Org explizit: unter den Gebuchten können Teamer:innen mit
          // anderer Primär-Org sein.
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToMultipleUsers(db, userIds, notification);
    } catch (error) {
      console.error('sendEventReactivationToKonfis error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Event geändert (Termin/Uhrzeit/Ort) - Push an alle gebuchten Teilnehmer
   * @param {Object} changes - { newDate, newEndTime, newLocation } - nur gesetzte Felder haben sich geändert
   */
  static async sendEventChangedToKonfis(db, userIds, eventName, changes = {}, eventId = null, organizationId = null) {
    try {
      const parts = [];

      if (changes.newDate) {
        const date = new Date(changes.newDate);
        let dateInfo = formatDatum(date, { day: '2-digit', month: '2-digit', year: 'numeric' });
        dateInfo += `, ${formatUhrzeit(date)}`;
        if (changes.newEndTime) {
          const endTime = formatUhrzeit(changes.newEndTime);
          dateInfo += ` - ${endTime} Uhr`;
        } else {
          dateInfo += ' Uhr';
        }
        parts.push(`Neuer Termin: ${dateInfo}`);
      }

      if (changes.newLocation) {
        parts.push(`Neuer Ort: ${changes.newLocation}`);
      }

      const changeText = parts.length > 0 ? parts.join(' | ') : 'Es gibt Änderungen am Event.';

      const notification = {
        title: 'Event geändert',
        body: `"${eventName}" wurde geändert. ${changeText}`,
        data: {
          type: 'event_changed',
          event_name: eventName,
          event_id: eventId?.toString() || '',
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToMultipleUsers(db, userIds, notification);
    } catch (error) {
 console.error('sendEventChangedToKonfis error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Anmeldung geoeffnet ("Neues Event!") - Push an die Konfis, die den Termin
   * in ihrer Terminliste sehen.
   *
   * Der Name bleibt (Aufrufer und Tests rufen ihn so); organizationId bleibt
   * die Gemeinde des Inhalts fuer den Org-Wechsel beim Antippen. Ohne
   * eventId sind die Jahrgaenge unbekannt -- dann geht nichts raus, statt
   * im Zweifel an alle.
   */
  static async sendNewEventToOrgKonfis(db, organizationId, eventName, eventDate, eventId = null) {
    try {
      const konfiIds = await ladeKonfisDieTerminSehen(db, eventId);

      if (konfiIds.length === 0) {
        return { success: true, sent: 0 };
      }

      const dateFormatted = formatDatum(eventDate, {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });

      const notification = {
        title: 'Neues Event!',
        body: `"${eventName}" am ${dateFormatted} - Melde dich jetzt an!`,
        data: {
          type: 'new_event',
          event_name: eventName,
          event_id: eventId?.toString() || '',
          organization_id: String(organizationId)
        }
      };

      return await this.sendToMultipleUsers(db, konfiIds, notification);
    } catch (error) {
 console.error('sendNewEventToOrgKonfis error:', error);
      return { success: false, error: error.message };
    }
  }

  // ====================================================================
  // CHALLENGE NOTIFICATIONS
  // ====================================================================

  /**
   * Challenge gestartet - Push an alle, die mitmachen duerfen.
   *
   * Jede Person einmal; wer die Challenge angelegt hat (created_by), nie --
   * sie startet sie ja.
   *
   * @param {object} db - DB-Pool
   * @param {number} challengeId - Challenge ID
   * @param {string} challengeTitle - Titel der Challenge
   */
  static async sendChallengeStartedToJahrgaenge(db, challengeId, challengeTitle) {
    try {
      const [{ rows: konfis }, team, { rows: [challengeRow] }] = await abfragenBuendeln(db, [
        () => db.query(
          `SELECT DISTINCT kp.user_id
           FROM konfi_profiles kp
           JOIN users u ON kp.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           JOIN challenge_jahrgang_assignments cja ON cja.jahrgang_id = kp.jahrgang_id
           JOIN challenges c ON c.id = cja.challenge_id
           WHERE cja.challenge_id = $1
             AND c.audience <> 'nur_team'
             AND r.name = 'konfi'
             AND u.deleted_at IS NULL`,
          [challengeId]
        ),
        () => ladeTeamDasMitmacht(db, challengeId),
        // Content-Org der Challenge (nicht der Empfaenger) fuer den
        // Org-Wechsel beim Antippen, dazu wer sie angelegt hat.
        () => db.query(
          'SELECT organization_id, created_by FROM challenges WHERE id = $1',
          [challengeId]
        )
      ]);

      const startendePerson = challengeRow && challengeRow.created_by != null
        ? String(challengeRow.created_by)
        : null;
      const empfaenger = [];
      const gesehen = new Set();
      for (const id of [...konfis.map(k => k.user_id), ...team]) {
        const k = String(id);
        if (gesehen.has(k) || k === startendePerson) continue;
        gesehen.add(k);
        empfaenger.push(id);
      }
      if (empfaenger.length === 0) {
        return { success: true, sent: 0 };
      }

      const notification = {
        title: 'Neue Challenge',
        body: `"${challengeTitle}" ist gestartet — schau rein und mach mit!`,
        data: {
          type: 'challenge_started',
          challengeId: challengeId.toString(),
          ...(challengeRow && challengeRow.organization_id != null
            ? { organization_id: String(challengeRow.organization_id) }
            : {})
        }
      };

      return await this.sendToMultipleUsers(db, empfaenger, notification);
    } catch (error) {
      console.error('sendChallengeStartedToJahrgaenge error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stempel einer Challenge erhalten - Push an die einreichende Person.
   * Der Stempel ist abgeleitet (EXISTS eigene APPROVED-Submission, siehe
   * challenges.js) und zählt erst, wenn ein Beitrag wirklich freigegeben ist:
   * Ohne Moderation feuert der Push bei der ersten eigenen Submission (die ist
   * sofort approved), bei moderierten Challenges erst bei der Freigabe durch
   * die Leitung (PUT /admin/submissions/:id/moderate, action 'approve').
   *
   * @param {object} db - DB-Pool
   * @param {number} konfiId - User-ID der einreichenden Person
   * @param {number} challengeId - Challenge ID
   * @param {string} challengeTitle - Titel der Challenge
   */
  /**
   * Ein Beitrag ist im Feed sichtbar geworden -> Mitteilung an die Konfis der
   * zugewiesenen Jahrgaenge (ohne die einreichende Person selbst).
   *
   * WANN: Genau in dem Moment, in dem der Beitrag oeffentlich wird — bei
   * unmoderierten Challenges beim Einreichen, bei moderierten erst mit der
   * Freigabe. Sonst kaeme die Mitteilung, bevor es etwas zu sehen gibt.
   *
   * ANONYMITAET: Bei konfi_consent = 'anonymous' darf der Name NICHT in die
   * Mitteilung. Dann steht dort nur "Neuer Beitrag". Die Sichtbarkeitsregel
   * ist dieselbe wie in der Galerie (PUBLIC_SUBMISSION_SQL in
   * routes/challenges.js) — wer den Beitrag nicht sehen darf, erfaehrt auch
   * nichts von ihm.
   *
   * @param {string|null} konfiName  null oder '' => anonym, kein Name im Text
   * @param {string} medienArt       'image' | 'video' | 'audio' | 'text' ...
   */
  static async sendChallengeFeedToJahrgaenge(db, organizationId, challengeId, challengeTitle, submissionUserId, konfiName, medienArt) {
    try {
      // Empfaenger: Konfis der Jahrgaenge dieser Challenge, ohne die
      // einreichende Person (die weiss es).
      const { rows: konfis } = await db.query(
        `SELECT DISTINCT u.id
         FROM users u
         JOIN roles r ON u.role_id = r.id
         JOIN konfi_profiles kp ON kp.user_id = u.id
         JOIN challenge_jahrgang_assignments cja ON cja.jahrgang_id = kp.jahrgang_id
         WHERE r.name = 'konfi'
           AND u.organization_id = $1
           AND u.deleted_at IS NULL
           AND cja.challenge_id = $2
           AND u.id <> $3`,
        [organizationId, challengeId, submissionUserId]
      );
      if (konfis.length === 0) return;

      const { anhangText } = require('../utils/pushText');
      // Art des Beitrags, damit man sieht, ob sich das Hinsehen lohnt.
      // 'text' hat keinen Anhang -> dann nur der Challenge-Bezug.
      const artText = (medienArt && medienArt !== 'text') ? ` (${anhangText(medienArt)})` : '';
      const titel = konfiName ? `Neuer Beitrag von ${konfiName}` : 'Neuer Beitrag';

      await this.sendToMultipleUsers(db, konfis.map(k => k.id), {
        title: titel,
        body: `bei "${challengeTitle}"${artText}`,
        data: {
          type: 'challenge_started',
          anlass: 'challenge_feed',
          challengeId: challengeId.toString(),
          organization_id: String(organizationId)
        }
      });
    } catch (err) {
      console.error('Fehler beim Feed-Push:', err.message);
    }
  }

  static async sendChallengeBadgeEarnedToKonfi(db, konfiId, challengeId, challengeTitle) {
    try {
      // Content-Org der Challenge (nicht der Empfänger) für den Org-Wechsel
      // beim Antippen (Multi-Org).
      const { rows: [challengeRow] } = await db.query(
        'SELECT organization_id FROM challenges WHERE id = $1',
        [challengeId]
      );

      const notification = {
        title: 'Stempel erhalten',
        body: `Du hast den Stempel für "${challengeTitle}" bekommen!`,
        data: {
          type: 'challenge_badge_earned',
          challengeId: challengeId.toString(),
          ...(challengeRow && challengeRow.organization_id != null
            ? { organization_id: String(challengeRow.organization_id) }
            : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
      console.error('sendChallengeBadgeEarnedToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Challenge-Beitrag ausgeblendet - Push an die einreichende Person, optional
   * mit der Begründung der Leitung. Die Aufrufstelle sendet NICHT, wenn jemand
   * den eigenen Beitrag ausblendet (der weiss es dann ohnehin).
   *
   * @param {object} db - DB-Pool
   * @param {number} userId - User-ID der einreichenden Person
   * @param {number} challengeId - Challenge ID
   * @param {string} challengeTitle - Titel der Challenge
   * @param {string|null} reason - Optionale Begründung der Leitung
   */
  static async sendChallengeSubmissionHiddenToUser(db, userId, challengeId, challengeTitle, reason = null) {
    try {
      // Content-Org der Challenge für den Org-Wechsel beim Antippen (Multi-Org).
      const { rows: [challengeRow] } = await db.query(
        'SELECT organization_id FROM challenges WHERE id = $1',
        [challengeId]
      );

      const notification = {
        title: 'Beitrag nicht veröffentlicht',
        body: reason
          ? `Dein Beitrag zu "${challengeTitle}" wurde ausgeblendet. Begründung: ${reason}`
          : `Dein Beitrag zu "${challengeTitle}" wurde ausgeblendet. Bei Fragen melde dich bei deiner Leitung.`,
        data: {
          type: 'challenge_submission_hidden',
          challengeId: challengeId.toString(),
          ...(challengeRow && challengeRow.organization_id != null
            ? { organization_id: String(challengeRow.organization_id) }
            : {})
        }
      };

      return await this.sendToUser(db, userId, notification);
    } catch (error) {
      console.error('sendChallengeSubmissionHiddenToUser error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * @param {object} db - DB-Pool
   * @param {number} organizationId - Organisation ID
   * @param {number} challengeId - Challenge ID
   * @param {string} challengeTitle - Titel der Challenge
   * @param {string} konfiName - Anzeigename des einreichenden Konfis (die
   *   Leitung sieht IMMER den echten Namen — Anonymitaet gilt nur für die Galerie)
   * @param {boolean} moderated - Ob die Challenge moderiert ist (Freigabe nötig)
   * @param {number|null} einreicherId - Wer eingereicht hat; bekommt keine
   *   Mitteilung ueber den eigenen Beitrag (Team-Challenges)
   */
  static async sendChallengeSubmissionToLeadership(db, organizationId, challengeId, challengeTitle, konfiName, moderated = false, einreicherId = null) {
    try {
      const notification = {
        title: 'Neuer Challenge-Beitrag',
        body: moderated
          ? `${konfiName} hat bei "${challengeTitle}" etwas eingereicht. Wartet auf Freigabe.`
          : `${konfiName} hat bei "${challengeTitle}" etwas eingereicht.`,
        data: {
          type: 'challenge_submission',
          challengeId: challengeId.toString(),
          // Wer eingereicht hat: Die Mitteilung
          // geht mit dem Konto dieser Person (loescheMitteilungenUeberPerson).
          ...(einreicherId != null ? { user_id: String(einreicherId) } : {}),
          organization_id: String(organizationId)
        }
      };

      const { rows: [challengeZeile] } = await db.query(
        'SELECT audience FROM challenges WHERE id = $1',
        [challengeId]
      );
      const audience = challengeZeile?.audience || 'konfis';
      const { rows: jahrgaenge } = await db.query(
        'SELECT jahrgang_id FROM challenge_jahrgang_assignments WHERE challenge_id = $1',
        [challengeId]
      );
      const jahrgangIds = jahrgaenge.map(j => j.jahrgang_id);

      const orgWeit = TEAM_ORGWEITE_AUDIENCES.includes(audience);
      const [orgAdmins, team] = await abfragenBuendeln(db, [
        () => ladeMitgliederDerOrganisation(db, organizationId, ['org_admin']),
        () => orgWeit
          ? ladeMitgliederDerOrganisation(db, organizationId, ['admin', 'teamer'])
          : ladeMitgliederDerOrganisation(db, organizationId, ['admin', 'teamer'], { jahrgangIds })
      ]);

      // Ohne Doppelte, und ohne die Person, die selbst eingereicht hat --
      // wie im Chat die eigene Nachricht (bei Team-Challenges reicht die
      // Leitung selbst ein).
      const empfaenger = [];
      const gesehen = new Set();
      for (const id of [...orgAdmins, ...team]) {
        const k = String(id);
        if (gesehen.has(k) || (einreicherId != null && k === String(einreicherId))) continue;
        gesehen.add(k);
        empfaenger.push(id);
      }

      if (empfaenger.length > 0) {
        await this.sendToMultipleUsers(db, empfaenger, notification);
      }

      return { success: true };
    } catch (error) {
      console.error('sendChallengeSubmissionToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Event-Anwesenheit verbucht - Push an Konfi
   */
  static async sendEventAttendanceToKonfi(db, konfiId, eventName, status, points = 0, eventId = null, organizationId = null) {
    try {

      const isPresent = status === 'present';
      // 'excused' braucht einen EIGENEN Wortlaut. Der Text fuer
      // 'absent' waere hier schlicht falsch: "nicht erschienen" klingt nach
      // unentschuldigtem Fehlen, dabei wurde ordentlich abgemeldet -- meist
      // von den Eltern. Die Konfi soll sehen, dass es angekommen ist, nicht
      // einen Vorwurf lesen.
      const isExcused = status === 'excused';
      const notification = {
        title: isPresent ? 'Teilnahme bestätigt!'
          : isExcused ? 'Abmeldung eingetragen'
          : 'Nicht erschienen',
        body: isPresent
          ? `Deine Teilnahme an "${eventName}" wurde bestätigt.${points > 0 ? ` Du erhältst +${points} Punkte!` : ''}`
          : isExcused
          ? `Deine Abmeldung für "${eventName}" wurde eingetragen.`
          : `Du wurdest als "nicht erschienen" für "${eventName}" markiert.`,
        data: {
          type: 'event_attendance',
          status: status,
          event_name: eventName,
          points: points.toString(),
          event_id: eventId?.toString() || '',
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendEventAttendanceToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Events müssen verbucht werden - Push an die Leitung (für Cron-Job)
   *
   * EMPFAENGER UND ZAHL KOMMEN VOM AUFRUFER: Der Lauf um 09:00
   * zaehlt je Person, was IHR Verbuchen-Reiter zeigt
   * (zaehleWartendeTermineJeLeitung, utils/terminLeitungSicht.js), und ruft
   * diese Methode je Gemeinde und Zahl einmal mit den Personen, die genau
   * diese Zahl haben. Vorher bekam jeder Admin die Zahl der ganzen Gemeinde
   * 
   */
  static async sendEventsPendingApprovalToLeadership(db, organizationId, empfaenger, eventCount) {
    try {
      const notification = {
        title: 'Events warten auf Verbuchung',
        body: `${eventCount} Event${eventCount > 1 ? 's' : ''} warten auf Anwesenheitsverbuchung`,
        data: {
          type: 'events_pending_approval',
          count: eventCount.toString(),
          organization_id: String(organizationId)
        }
      };

      return await this.sendToLeadership(db, organizationId, empfaenger, notification, 'sendEventsPendingApprovalToLeadership');
    } catch (error) {
      console.error('sendEventsPendingApprovalToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * "Letzte Chance"-Warnung an die Leitung des Jahrgangs: ein Jahrgang wird
   * in wenigen Tagen automatisch gelöscht. Wir nennen es bewusst "gelöscht"
   * (das interne Archiv bleibt unerwaehnt). Hinweis aufs Befoerdern der
   * Konfis zu Teamer:innen.
   *
   * EMPFAENGER KOMMEN VON DER AUFRUFSTELLE: Org-Admins und Admins
   * mit Schreibrecht auf den Jahrgang (ladeLeitungZumJahrgang mit
   * schreibrecht, utils/jahrgangLeitungSicht.js) -- Befoerdern verlangt
   * Schreibrecht. Vorher jeder Admin der Gemeinde.
   */
  // jahrgangId optional und am Ende: Die Warnung steht seit dem
  // Postfach als Mitteilung und geht mit dem Jahrgang, sobald er geloescht
  // ist (utils/postfachAufraeumen.js) -- eine Warnung vor etwas, das schon
  // passiert ist, waere Rauschen.
  static async sendJahrgangDeletionWarningToLeadership(db, organizationId, empfaenger, jahrgangName, daysLeft, jahrgangId = null) {
    try {
      const notification = {
        title: 'Jahrgang wird bald gelöscht',
        body: `Der Jahrgang "${jahrgangName}" wird in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'} gelöscht. Letzte Chance, Konfis zu Teamer:innen zu befördern.`,
        data: {
          type: 'jahrgang_deletion_warning',
          jahrgang_name: jahrgangName,
          days_left: String(daysLeft),
          ...(jahrgangId != null ? { jahrgang_id: String(jahrgangId) } : {}),
          organization_id: String(organizationId)
        }
      };

      return await this.sendToLeadership(db, organizationId, empfaenger, notification, 'sendJahrgangDeletionWarningToLeadership');
    } catch (error) {
      console.error('sendJahrgangDeletionWarningToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Neue Konfi-Registrierung - Push an die Leitung des Jahrgangs.
   *
   * EMPFAENGER KOMMEN VON DER AUFRUFSTELLE:
   * ladeLeitungZumJahrgang (utils/jahrgangLeitungSicht.js) -- Org-Admins
   * immer, Admins mit Leserecht auf den Jahrgang, Teamer:innen nie.
   * Vorher verlangte die Abfrage auch von Org-Admins eine Zuweisung (sie
   * fielen heraus, sobald ein Admin zugewiesen war), und ohne zugewiesenen
   * Admin ging die Meldung als Rueckfall an ALLE Admins. Einen
   * Rueckfall gibt es nicht mehr: Ist niemand zugewiesen, bleibt es bei der
   * Gemeindeleitung.
   */
  // konfiId optional und am Ende: Die Mitteilung
  // geht mit dem Konto der Konfi (loescheMitteilungenUeberPerson).
  static async sendNewKonfiRegistrationToLeadership(db, organizationId, empfaenger, jahrgangId, konfiName, jahrgangName, konfiId = null) {
    try {
      const notification = {
        title: 'Neue Registrierung',
        body: `${konfiName} hat sich registriert (${jahrgangName})`,
        data: {
          type: 'new_konfi_registration',
          organization_id: organizationId.toString(),
          jahrgang_id: jahrgangId.toString(),
          ...(konfiId != null ? { konfi_id: String(konfiId) } : {})
        }
      };

      return await this.sendToLeadership(db, organizationId, empfaenger, notification, 'sendNewKonfiRegistrationToLeadership');
    } catch (error) {
      console.error('sendNewKonfiRegistrationToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  // ====================================================================
  // OPT-OUT / OPT-IN NOTIFICATIONS
  // ====================================================================

  // konfiId optional und am Ende, wie bei
  // sendEventUnregistrationToLeadership.
  static async sendEventOptOutToLeadership(db, organizationId, empfaenger, konfiName, eventName, reason, eventId = null, konfiId = null) {
    try {
      const notification = {
        title: `Abmeldung: ${eventName}`,
        body: `${konfiName} hat sich von '${eventName}' abgemeldet. Grund: ${reason}`,
        data: {
          type: 'event_opt_out',
          event_name: eventName,
          ...(eventId != null ? { event_id: String(eventId) } : {}),
          ...(konfiId != null ? { konfi_id: String(konfiId) } : {}),
          konfi_name: konfiName,
          reason: reason,
          organization_id: String(organizationId)
        }
      };

      return await this.sendToLeadership(db, organizationId, empfaenger, notification, 'sendEventOptOutToLeadership');
    } catch (error) {
      console.error('sendEventOptOutToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  // konfiId optional und am Ende.
  static async sendEventOptInToLeadership(db, organizationId, empfaenger, konfiName, eventName, eventId = null, konfiId = null) {
    try {
      const notification = {
        title: `Wieder angemeldet: ${eventName}`,
        body: `${konfiName} hat sich wieder für '${eventName}' angemeldet`,
        data: {
          type: 'event_opt_in',
          event_name: eventName,
          ...(eventId != null ? { event_id: String(eventId) } : {}),
          ...(konfiId != null ? { konfi_id: String(konfiId) } : {}),
          konfi_name: konfiName,
          organization_id: String(organizationId)
        }
      };

      return await this.sendToLeadership(db, organizationId, empfaenger, notification, 'sendEventOptInToLeadership');
    } catch (error) {
      console.error('sendEventOptInToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  // Deshalb gilt jetzt: KEIN Payload ausserhalb dieser Datei. Wer eine neue
  // Meldung braucht, legt hier eine Methode an.
  // ==========================================================================

  /**
   * Neues Pflicht-Event - Push an die Konfis der betroffenen Jahrgaenge.
   */
  static async sendMandatoryEventCreated(db, userIds, eventName, eventDate, eventId, organizationId) {
    try {
      if (!userIds || userIds.length === 0) return { success: true, sent: 0 };

      return await this.sendToMultipleUsers(db, userIds, {
        title: 'Neues Pflicht-Event',
        body: `${eventName} am ${formatDatum(eventDate)}`,
        data: {
          type: 'mandatory_event_created',
          eventId: String(eventId),
          organization_id: String(organizationId)
        }
      });
    } catch (error) {
      console.error('sendMandatoryEventCreated error:', error);
      return { success: false, error: error.message };
    }
  }

  // teamerId optional und am Ende: Die Mitteilung
  // geht mit dem Konto der Teamer:in (loescheMitteilungenUeberPerson).
  static async sendTeamerEventBookingToLeadership(db, organizationId, empfaenger, teamerName, eventName, status, eventId, teamerId = null) {
    try {
      return await this.sendToLeadership(db, organizationId, empfaenger, {
        title: 'Teamer:in angemeldet',
        body: status === 'confirmed'
          ? `${teamerName} hat sich für '${eventName}' angemeldet`
          : `${teamerName} steht auf der Warteliste für '${eventName}'`,
        data: {
          type: 'teamer_event_booking',
          eventId: String(eventId),
          ...(teamerId != null ? { user_id: String(teamerId) } : {}),
          organization_id: String(organizationId)
        }
      }, 'sendTeamerEventBookingToLeadership');
    } catch (error) {
      console.error('sendTeamerEventBookingToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  static async sendTeamerEventCancellationToLeadership(db, organizationId, empfaenger, teamerName, eventName, eventId, reason = null, teamerId = null) {
    try {
      const notification = {
        title: 'Teamer:in abgemeldet',
        body: reason
          ? `${teamerName} hat sich von '${eventName}' abgemeldet. Grund: ${reason}`
          : `${teamerName} hat sich von '${eventName}' abgemeldet`,
        data: {
          type: 'teamer_event_cancellation',
          eventId: String(eventId),
          ...(teamerId != null ? { user_id: String(teamerId) } : {}),
          organization_id: String(organizationId)
        }
      };
      if (reason) notification.data.reason = reason;
      return await this.sendToLeadership(db, organizationId, empfaenger, notification, 'sendTeamerEventCancellationToLeadership');
    } catch (error) {
      console.error('sendTeamerEventCancellationToLeadership error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Zertifikat vergeben - Push an die Teamer:in.
   */
  static async sendCertificateToTeamer(db, userId, certificateName, organizationId) {
    try {
      return await this.sendToUser(db, userId, {
        title: 'Neues Zertifikat',
        body: `Du hast das Zertifikat "${certificateName}" erhalten.`,
        data: {
          type: 'certificate',
          organization_id: String(organizationId)
        }
      });
    } catch (error) {
      console.error('sendCertificateToTeamer error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Jahresrueckblick freigegeben - Push an Konfis oder Teamer:innen.
   * Wird an drei Stellen gebraucht: bei der Freigabe von Hand (Konfi und
   * Team) und im Cron.
   *
   * @param {'konfi'|'teamer'} wrappedType
   * @param {number|string|null} [ausgabeId]
   */
  static async sendWrappedReleased(db, userIds, wrappedType, organizationId, ausgabeId = null) {
    try {
      if (!userIds || userIds.length === 0) return { success: true, sent: 0 };

      const istKonfi = wrappedType === 'konfi';
      const data = {
        type: 'wrapped',
        wrappedType,
        organization_id: String(organizationId)
      };
      if (ausgabeId !== null && ausgabeId !== undefined) {
        data.ausgabe_id = String(ausgabeId);
      }
      return await this.sendToMultipleUsers(db, userIds, {
        title: istKonfi ? 'Deine Konfi-Zeit Wrapped ist da!' : 'Dein Team-Jahr Wrapped ist da!',
        body: 'Schau dir jetzt deinen persönlichen Jahresrückblick an!',
        data
      });
    } catch (error) {
      console.error('sendWrappedReleased error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PushService;
