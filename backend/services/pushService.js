const { sendFirebasePushNotification, sendFirebaseSilentPush } = require('../push/firebase');
const { appIconSummeOderNull } = require('../utils/appIconBadge');
const { berechneLevelFortschritt } = require('../utils/levelFortschritt');
const { formatUhrzeit, formatDatum } = require('../utils/zeitformat');

/**
 * Push Notification Type Registry
 *
 * Alle Push-Types werden durch statische Methoden in dieser Klasse definiert.
 * Zum Deaktivieren eines Types: Aufruf in der jeweiligen Route auskommentieren.
 *
 * Type                        | Methode                              | Empfaenger      | Enabled
 * ----------------------------|--------------------------------------|-----------------|--------
 * chat                        | sendChatNotification                 | User            | ja
 * badge_update                | sendBadgeUpdate                      | User            | ja
 * new_activity_request        | sendNewActivityRequestToAdmins       | Org-Admins      | ja
 * activity_request_status     | sendActivityRequestStatusToKonfi     | Konfi           | ja
 * badge_earned                | sendBadgeEarnedToKonfi               | Konfi           | ja
 * activity_assigned           | sendActivityAssignedToKonfi          | Konfi           | ja
 * bonus_points                | sendBonusPointsToKonfi               | Konfi           | ja
 * event_registered            | sendEventRegisteredToKonfi           | Konfi           | ja
 * event_unregistered          | sendEventUnregisteredToKonfi         | Konfi           | ja
 * event_unregistration        | sendEventUnregistrationToAdmins      | Org-Admins      | ja
 * level_up                    | sendLevelUpToKonfi                   | Konfi           | ja
 * event_reminder              | sendEventReminderToKonfi             | Konfi           | ja
 * waitlist_promotion          | sendWaitlistPromotionToKonfi         | Konfi           | ja
 * event_registered            | sendEventRegisteredToTeamer          | Teamer:in       | ja
 * waitlist_promotion          | sendWaitlistPromotionToTeamer        | Teamer:in       | ja
 * event_cancelled             | sendEventCancellationToKonfis        | Konfi (multi)   | ja
 * event_reactivated           | sendEventReactivationToKonfis        | Konfi (multi)   | ja
 * event_changed               | sendEventChangedToKonfis             | Konfi (multi)   | ja
 * new_event                   | sendNewEventToOrgKonfis              | Org-Konfis      | ja
 * event_attendance            | sendEventAttendanceToKonfi           | Konfi           | ja
 * events_pending_approval     | sendEventsPendingApprovalToAdmins    | Org-Admins      | ja
 * new_konfi_registration      | sendNewKonfiRegistrationToAdmins     | Jahrgangs-Admins| ja
 * event_opt_out               | sendEventOptOutToAdmins              | Org-Admins      | ja
 * event_opt_in                | sendEventOptInToAdmins               | Org-Admins      | ja
 * teamer_event_booking        | sendTeamerEventBookingToAdmins       | Org-Admins      | ja
 * teamer_event_cancellation   | sendTeamerEventCancellationToAdmins  | Org-Admins      | ja
 * challenge_started           | sendChallengeStartedToJahrgaenge     | Jahrgangs-Konfis| ja
 * challenge_submission        | sendChallengeSubmissionToLeadership  | Leitung         | ja
 * challenge_started (Feed)    | sendChallengeFeedToJahrgaenge        | Jahrgangs-Konfis| ja
 * challenge_badge_earned      | sendChallengeBadgeEarnedToKonfi      | Konfi           | ja
 * challenge_submission_hidden | sendChallengeSubmissionHiddenToUser  | Einreichende:r  | ja
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
 */

class PushService {
  /**
   * Helper: Holt alle Push-Tokens für einen User
   */
  static async getTokensForUser(db, userId) {
    // Master-Schalter: Hat der User Push global deaktiviert, gar keine Tokens
    // zurueckgeben -> es wird nichts gesendet (gilt für alle Push-Typen).
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
    const { rows: tokens } = await db.query(query, [userId]);
    return tokens || [];
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
   * Der Push-Weg kennt nur die userId — fuer die Summe braucht es aber auch
   * Rolle und (bei Teamer:innen) die zugewiesenen Jahrgaenge, weil sich die
   * Zaehler je Rolle unterscheiden.
   *
   * Gibt null zurueck, wenn der User nicht auffindbar ist; der Aufrufer
   * laesst den Badge dann weg.
   */
  static async ladeEmpfaengerFuerBadge(db, userId) {
    try {
      const { rows: [row] } = await db.query(
        `SELECT u.id, u.organization_id, r.name AS role_name
           FROM users u
           JOIN roles r ON u.role_id = r.id
          WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [userId]
      );
      if (!row) return null;

      // user_type wie im Token: konfi bleibt konfi, teamer bleibt teamer,
      // alle Leitungsrollen zaehlen als 'admin'.
      const type = row.role_name === 'konfi'
        ? 'konfi'
        : (row.role_name === 'teamer' ? 'teamer' : 'admin');

      let assigned_jahrgaenge = [];
      // Jahrgaenge fuer Teamer:innen UND die Rolle 'admin':
      // Beide sind gebunden, ihre App-Icon-Summe haengt an der Zuweisung.
      // org_admin braucht keine (zaehlt org-weit).
      if (type === 'teamer' || row.role_name === 'admin') {
        const { rows } = await db.query(
          'SELECT jahrgang_id AS id, can_view FROM user_jahrgang_assignments WHERE user_id = $1',
          [userId]
        );
        assigned_jahrgaenge = rows;
      }

      return {
        id: row.id,
        type,
        role_name: row.role_name,
        organization_id: row.organization_id,
        assigned_jahrgaenge
      };
    } catch (err) {
      console.error('ladeEmpfaengerFuerBadge error:', err);
      return null;
    }
  }

  /**
   * Fehlertolerant: Bei einem Fehler kommt null zurueck und der Badge wird
   * weggelassen — eine Nachricht darf nicht daran scheitern, dass eine Zahl
   * fehlt.
   */
  // Die Zahl am App-Icon ueber ALLE Organisationen einer Person.
  //
  // Die aktive Organisation steht nur im Token des Clients, nicht in der
  // Datenbank -- der Push kann sie also nicht kennen. Deshalb die Summe ueber
  // alle: Das Icon beantwortet die Frage "wie viel liegt fuer mich an?",
  // nicht "wie viel liegt in der gerade geoeffneten Ansicht an?".
  //
  // Fuer Konfis aendert sich nichts, sie sind immer Single-Org.
  static async berechneBadge(db, userId) {
    const empfaenger = await this.ladeEmpfaengerFuerBadge(db, userId);
    if (!empfaenger) return null;

    const orgIds = await this.ladeOrganisationenFuerBadge(db, userId, empfaenger.organization_id);
    if (orgIds.length <= 1) {
      return appIconSummeOderNull(db, empfaenger);
    }

    let summe = 0;
    let hatWert = false;
    for (const orgId of orgIds) {
      const teil = await appIconSummeOderNull(db, { ...empfaenger, organization_id: orgId });
      if (teil != null) { summe += teil; hatWert = true; }
    }
    return hatWert ? summe : null;
  }

  // Alle Organisationen, in denen die Person Mitglied ist. Die Primaer-Org ist
  // immer dabei, auch wenn user_organizations sie (noch) nicht fuehrt.
  static async ladeOrganisationenFuerBadge(db, userId, primaerOrgId) {
    try {
      const { rows } = await db.query(
        'SELECT organization_id FROM user_organizations WHERE user_id = $1',
        [userId]
      );
      const ids = new Set(rows.map(r => r.organization_id));
      if (primaerOrgId != null) ids.add(primaerOrgId);
      return [...ids];
    } catch (err) {
      console.error('ladeOrganisationenFuerBadge error:', err.message);
      return primaerOrgId != null ? [primaerOrgId] : [];
    }
  }

  /**
   * Helper: Sendet Push an einen User
   */
  static async sendToUser(db, userId, notification) {
    try {
      const tokens = await this.getTokensForUser(db, userId);

      if (tokens.length === 0) {
 console.warn(`Keine Push-Tokens für User ${userId} gefunden`);
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
        const recipientOrgId = await this.resolveRecipientOrgId(db, userId);
        if (recipientOrgId) data.organization_id = recipientOrgId;
      }

      const berechneterBadge = notification.badge != null
        ? notification.badge
        : await this.berechneBadge(db, userId);

      // Tokens PARALLEL abarbeiten: vorher lief je
      // Token ein FCM-Roundtrip nacheinander — bei mehreren Geraeten summierte
      // sich das auf. Die Tokens sind voneinander unabhaengig, ihre DB-Updates
      // betreffen jeweils nur die eigene Zeile.
      const results = await Promise.all(tokens.map(async (token) => {
        const result = await sendFirebasePushNotification(token.token, {
          title: notification.title,
          body: notification.body,
          badge: berechneterBadge != null ? berechneterBadge : 1,
          sound: 'default',
          data: data
        });

        if (result.success) {
          // Erfolgreiche Zustellung frischt `updated_at` auf.
          // Die Bereinigung wirft Tokens weg, die 30 Tage nicht
          // aktualisiert wurden — und aktualisiert wurden sie bis dahin NUR,
          // wenn jemand die App oeffnete. Wer ueber die Ferien pausierte,
          // verlor stillschweigend die Zustellung und merkte es nicht, obwohl
          // sein Geraet die ganze Zeit erreichbar war. Ein angekommener Push
          // ist der bessere Beleg dafuer als ein App-Start.
          await this.markiereTokenErreichbar(db, token);
          return true;
        }

        // Fatale Errors: Token sofort löschen
        const fatalCodes = [
          'messaging/registration-token-not-registered',
          'messaging/invalid-registration-token'
        ];
        if (fatalCodes.includes(result.errorCode)) {
          await db.query('DELETE FROM push_tokens WHERE id = $1', [token.id]);
          console.warn(`Token ${token.id} gelöscht (${result.errorCode})`);
        } else {
          // Sonstige Errors: Counter erhöhen
          await db.query(
            'UPDATE push_tokens SET error_count = error_count + 1, last_error_at = NOW() WHERE id = $1',
            [token.id]
          );
          console.error('Push failed for token:', result.error);
        }
        return false;
      }));

      const successCount = results.filter(Boolean).length;
      const errorCount = results.length - successCount;

      return { success: true, sent: successCount, errors: errorCount, total: tokens.length };
    } catch (error) {
 console.error('PushService.sendToUser error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Helper: Sendet Push an mehrere User (z.B. alle Admins)
   */
  static async sendToMultipleUsers(db, userIds, notification) {
    // Empfaenger PARALLEL: vorher wurde jeder User
    // nacheinander abgearbeitet, und in sendToUser wiederum jedes Geraet — bei
    // 5 Admins mit je 2 Geraeten also 10 FCM-Roundtrips in Reihe.
    return Promise.all(
      userIds.map(async (userId) => {
        const result = await this.sendToUser(db, userId, notification);
        return { userId, ...result };
      })
    );
  }

  /**
   * Sendet Chat-Benachrichtigung an alle User-Devices
   */
  static async sendChatNotification(db, userId, notificationData) {
    try {

      // Content-Org des Chat-Raums (Multi-Org: der Tap wechselt in die
      // Organisation des Raums, NICHT in die Primär-Org des Empfängers).
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

      // Hole zuerst die Tokens des Senders um sie auszuschließen
      const senderTokensQuery = `SELECT token FROM push_tokens WHERE user_id = $1`;
      const { rows: senderTokens } = await db.query(senderTokensQuery, [notificationData.data?.sender_id]);
      const senderTokenList = senderTokens.map(t => t.token);

      // Neuestes Token pro Device verwenden
      // UND Sender-Tokens ausschließen (für den Fall dass gleicher Token bei verschiedenen Accounts)
      // UND Master-Schalter prüfen (u.push_enabled): bei false keine Tokens.
      // UND gesperrte/geloeschte Konten ausschliessen — gleiche Bedingung wie
      // in getTokensForUser, das diese Abfrage bewusst nicht nutzt (Sender-
      // Ausschluss). Beide muessen zusammen gepflegt werden.
      // DISTINCT ON (token): nie denselben FCM-Token doppelt beliefern (Alt-Daten
      // mit gleichem Token unter mehreren device_ids).
      let query = `
        SELECT DISTINCT ON (pt.token) pt.* FROM push_tokens pt
        JOIN users u ON pt.user_id = u.id
        WHERE pt.user_id = $1
          AND u.push_enabled = true
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND pt.id IN (
            SELECT MAX(id)
            FROM push_tokens
            WHERE user_id = $2
            GROUP BY device_id, platform
          )
      `;

      // Sender-Tokens ausschliessen wenn vorhanden
      if (senderTokenList.length > 0) {
        query += ` AND pt.token NOT IN (${senderTokenList.map((_, i) => `$${i + 3}`).join(', ')})`;
      }
      query += ` ORDER BY pt.token, pt.id DESC`;

      const queryParams = [userId, userId, ...senderTokenList];
      const { rows: tokens } = await db.query(query, queryParams);

      if (!tokens || tokens.length === 0) {
 console.warn('Keine Push-Tokens für User gefunden:', userId);
        return { success: false, message: 'No tokens found' };
      }

      let successCount = 0;
      let errorCount = 0;

      // Anders als in sendToUser wird der uebergebene Wert deshalb bewusst
      // ERSETZT, nicht bevorzugt: Er ist per Definition zu niedrig. Nur wenn
      // die Zaehlung fehlschlaegt, gilt er als Rueckfall.
      const gesamtBadge = await this.berechneBadge(db, userId);
      const badgeWert = gesamtBadge != null
        ? gesamtBadge
        : (notificationData.badge || 1);

      // An alle Devices senden
      for (const token of tokens) {
        const result = await sendFirebasePushNotification(token.token, {
          title: notificationData.title || 'Neue Nachricht',
          body: notificationData.body,
          badge: badgeWert,
          sound: 'default',
          data: {
            type: 'chat',
            roomId: notificationData.roomId?.toString() || '',
            messageId: notificationData.messageId?.toString() || '',
            sender_id: notificationData.data?.sender_id?.toString() || '',
            sender_name: notificationData.data?.sender_name || '',
            room_name: notificationData.data?.room_name || '',
            organization_id: chatOrgId
          }
        });

        if (result.success) {
          successCount++;
          await this.markiereTokenErreichbar(db, token);
        } else {
          // Fatale Errors: Token sofort löschen
          const fatalCodes = [
            'messaging/registration-token-not-registered',
            'messaging/invalid-registration-token'
          ];
          if (fatalCodes.includes(result.errorCode)) {
            await db.query('DELETE FROM push_tokens WHERE id = $1', [token.id]);
            console.warn(`Token ${token.id} gelöscht (${result.errorCode})`);
          } else {
            // Sonstige Errors: Counter erhöhen
            await db.query(
              'UPDATE push_tokens SET error_count = error_count + 1, last_error_at = NOW() WHERE id = $1',
              [token.id]
            );
            console.error('Push failed for token:', result.error);
          }
          errorCount++;
        }
      }

      return {
        success: true,
        sent: successCount,
        errors: errorCount,
        total: tokens.length
      };

    } catch (error) {
 console.error('PushService.sendChatNotification error:', error);
      throw error;
    }
  }

  /**
   * Sendet Badge Update (für Background App Badge Count)
   *
   * Die Zahl wird HIER gerechnet, nicht vom Aufrufer uebernommen.
   * Der Hintergrunddienst uebergab bisher seinen eigenen
   * Wert, und der zaehlte NUR ungelesene Chat-Nachrichten
   * (`backgroundService.js:162`). Am App-Icon steht aber dieselbe Zahl, die
   * jeder Push aus `appIconSummeOderNull` setzt — Chat PLUS Antraege, Termine
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

      const badgeCount = await this.berechneBadge(db, userId);
      if (badgeCount == null) {
        return { success: false, message: 'Badge nicht ermittelbar' };
      }

      let successCount = 0;
      let errorCount = 0;

      for (const token of tokens) {
        const result = await sendFirebaseSilentPush(token.token, badgeCount);

        if (result.success) {
          successCount++;
          if (token.error_count > 0) {
            await db.query(
              'UPDATE push_tokens SET error_count = 0, last_error_at = NULL WHERE id = $1',
              [token.id]
            );
          }
        } else {
          const fatalCodes = [
            'messaging/registration-token-not-registered',
            'messaging/invalid-registration-token'
          ];
          if (fatalCodes.includes(result.errorCode)) {
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
      return { success: true, sent: successCount, errors: errorCount, total: tokens.length, badge: badgeCount };

    } catch (error) {
 console.error('PushService.sendBadgeUpdate error:', error);
      throw error;
    }
  }

  // ====================================================================
  // ACTIVITY REQUEST NOTIFICATIONS
  // ====================================================================

  /**
   * Neuer Antrag eingereicht - Push an alle Admins der Organisation
   */
  /**
   * Generische Push-Notification an alle Admins einer Organisation
   * @param {object} db - DB-Pool
   * @param {number} organizationId - Organisation ID
   * @param {object} notification - { title, body, data? }
   */
  static async sendToOrgAdmins(db, organizationId, notification) {
    try {
      const { rows: admins } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1`,
        [organizationId]
      );
      if (admins.length === 0) {
        return { success: false, message: 'No admins found' };
      }
      const adminIds = admins.map(a => a.id);
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

  static async sendNewActivityRequestToAdmins(db, organizationId, konfiName, activityName, points) {
    try {

      // Hole alle Admins der Organisation
      const { rows: admins } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1`,
        [organizationId]
      );

      if (admins.length === 0) {
 console.warn('Keine Admins für Organisation gefunden');
        return { success: false, message: 'No admins found' };
      }

      const adminIds = admins.map(a => a.id);
      const notification = {
        title: 'Neuer Antrag',
        body: `${konfiName} hat einen Antrag für "${activityName}" (${points}P) eingereicht`,
        data: {
          type: 'new_activity_request',
          organization_id: organizationId.toString()
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
 console.error('sendNewActivityRequestToAdmins error:', error);
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
  static async sendEventUnregisteredToKonfi(db, konfiId, eventName) {
    try {

      const notification = {
        title: 'Abmeldung bestätigt',
        body: `Du hast dich von "${eventName}" abgemeldet.`,
        data: {
          type: 'event_unregistered',
          event_name: eventName
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendEventUnregisteredToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Konfi hat sich von Event abgemeldet - Push an alle Admins der Organisation
   */
  static async sendEventUnregistrationToAdmins(db, organizationId, konfiName, eventName, reason = null) {
    try {

      // Hole alle Admins der Organisation
      const { rows: admins } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1`,
        [organizationId]
      );

      if (admins.length === 0) {
 console.warn('Keine Admins für Organisation gefunden');
        return { success: false, message: 'No admins found' };
      }

      const adminIds = admins.map(a => a.id);
      const notification = {
        title: 'Event-Abmeldung',
        body: reason
          ? `${konfiName} hat sich von "${eventName}" abgemeldet. Grund: ${reason}`
          : `${konfiName} hat sich von "${eventName}" abgemeldet.`,
        data: {
          type: 'event_unregistration',
          event_name: eventName,
          konfi_name: konfiName,
          organization_id: String(organizationId)
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
 console.error('sendEventUnregistrationToAdmins error:', error);
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
  static async sendEventReminderToKonfi(db, konfiId, eventName, eventDate, eventTime, reminderType, organizationId = null) {
    try {

      const isOneDay = reminderType === '1_day';
      const notification = {
        title: isOneDay ? 'Morgen: Event!' : 'Gleich: Event!',
        body: isOneDay
          ? `Morgen: ${eventName}${eventTime ? ` um ${eventTime} Uhr` : ''}`
          : `In 1 Stunde: ${eventName}`,
        data: {
          type: 'event_reminder',
          reminder_type: reminderType,
          event_name: eventName,
          ...(organizationId != null ? { organization_id: String(organizationId) } : {})
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendEventReminderToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Von Warteliste aufgerückt - Push an Konfi
   */
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
        title: 'Termin findet doch statt',
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
   * Neues Event erstellt - Push an alle Konfis der Organisation
   */
  static async sendNewEventToOrgKonfis(db, organizationId, eventName, eventDate, eventId = null) {
    try {

      const konfisQuery = `
        SELECT u.id FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.organization_id = $1 AND r.name = 'konfi'
          AND u.deleted_at IS NULL
          AND u.is_active = true
      `;
      const { rows: konfis } = await db.query(konfisQuery, [organizationId]);
      const konfiIds = konfis.map(k => k.id);

      if (konfiIds.length === 0) {
 console.warn('Keine Konfis für Organisation gefunden:', organizationId);
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
   * Challenge gestartet - Push an alle Konfis der zugewiesenen Jahrgänge.
   * Empfaenger kommen über challenge_jahrgang_assignments, NICHT über die
   * ganze Organisation: eine Challenge läuft immer nur für bestimmte
   * Jahrgänge.
   *
   * @param {object} db - DB-Pool
   * @param {number} challengeId - Challenge ID
   * @param {string} challengeTitle - Titel der Challenge
   */
  static async sendChallengeStartedToJahrgaenge(db, challengeId, challengeTitle) {
    try {
      const { rows: konfis } = await db.query(
        `SELECT DISTINCT kp.user_id
         FROM konfi_profiles kp
         JOIN users u ON kp.user_id = u.id
         JOIN roles r ON u.role_id = r.id
         JOIN challenge_jahrgang_assignments cja ON cja.jahrgang_id = kp.jahrgang_id
         WHERE cja.challenge_id = $1
           AND r.name = 'konfi'
           AND u.deleted_at IS NULL`,
        [challengeId]
      );

      const konfiIds = konfis.map(k => k.user_id);
      if (konfiIds.length === 0) {
        return { success: true, sent: 0 };
      }

      // Content-Org der Challenge (nicht der Empfänger) für den Org-Wechsel
      // beim Antippen.
      const { rows: [challengeRow] } = await db.query(
        'SELECT organization_id FROM challenges WHERE id = $1',
        [challengeId]
      );

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

      return await this.sendToMultipleUsers(db, konfiIds, notification);
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
   * Neuer Challenge-Beitrag - Push an die Leitung (Org-Admins + die Teamer der
   * zugewiesenen Jahrgänge). Wird bei JEDER Challenge gesendet (auch wenn der
   * Beitrag sofort oeffentlich ist) — bei moderierten Challenges mit Zusatz-
   * Hinweis, dass eine Freigabe noch aussteht.
   *
   * @param {object} db - DB-Pool
   * @param {number} organizationId - Organisation ID
   * @param {number} challengeId - Challenge ID
   * @param {string} challengeTitle - Titel der Challenge
   * @param {string} konfiName - Anzeigename des einreichenden Konfis (die
   *   Leitung sieht IMMER den echten Namen — Anonymitaet gilt nur für die Galerie)
   * @param {boolean} moderated - Ob die Challenge moderiert ist (Freigabe nötig)
   */
  static async sendChallengeSubmissionToLeadership(db, organizationId, challengeId, challengeTitle, konfiName, moderated = false) {
    try {
      const notification = {
        title: 'Neuer Challenge-Beitrag',
        body: moderated
          ? `${konfiName} hat bei "${challengeTitle}" etwas eingereicht. Wartet auf Freigabe.`
          : `${konfiName} hat bei "${challengeTitle}" etwas eingereicht.`,
        data: {
          type: 'challenge_submission',
          challengeId: challengeId.toString(),
          organization_id: String(organizationId)
        }
      };

      await this.sendToOrgAdmins(db, organizationId, notification);

      // Teamer hängen über user_jahrgang_assignments an den Jahrgängen der
      // Challenge und werden von sendToOrgAdmins nicht erfasst.
      const { rows: teamers } = await db.query(
        `SELECT DISTINCT u.id
         FROM users u
         JOIN roles r ON u.role_id = r.id
         JOIN user_jahrgang_assignments uja ON uja.user_id = u.id
         JOIN challenge_jahrgang_assignments cja ON cja.jahrgang_id = uja.jahrgang_id
         WHERE r.name = 'teamer'
           AND u.organization_id = $1
           AND u.deleted_at IS NULL
           AND cja.challenge_id = $2`,
        [organizationId, challengeId]
      );

      if (teamers.length > 0) {
        await this.sendToMultipleUsers(db, teamers.map(t => t.id), notification);
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
   * Events müssen verbucht werden - Push an Admins (für Cron-Job)
   */
  static async sendEventsPendingApprovalToAdmins(db, organizationId, eventCount) {
    try {

      const { rows: admins } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1`,
        [organizationId]
      );

      if (admins.length === 0) {
        return { success: false, message: 'No admins found' };
      }

      const adminIds = admins.map(a => a.id);
      const notification = {
        title: 'Events warten auf Verbuchung',
        body: `${eventCount} Event${eventCount > 1 ? 's' : ''} warten auf Anwesenheitsverbuchung`,
        data: {
          type: 'events_pending_approval',
          count: eventCount.toString(),
          organization_id: String(organizationId)
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
 console.error('sendEventsPendingApprovalToAdmins error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * "Letzte Chance"-Warnung an Org-Admins: ein Jahrgang wird in wenigen Tagen
   * automatisch gelöscht. Wir nennen es bewusst "gelöscht" (das interne Archiv
   * bleibt unerwaehnt). Hinweis aufs Befoerdern der Konfis zu Teamer:innen.
   */
  static async sendJahrgangDeletionWarningToAdmins(db, organizationId, jahrgangName, daysLeft) {
    try {
      const { rows: admins } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1 AND u.is_active = true`,
        [organizationId]
      );

      if (admins.length === 0) {
        return { success: false, message: 'No admins found' };
      }

      const adminIds = admins.map(a => a.id);
      const notification = {
        title: 'Jahrgang wird bald gelöscht',
        body: `Der Jahrgang "${jahrgangName}" wird in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'} gelöscht. Letzte Chance, Konfis zu Teamer:innen zu befördern.`,
        data: {
          type: 'jahrgang_deletion_warning',
          jahrgang_name: jahrgangName,
          days_left: String(daysLeft),
          organization_id: String(organizationId)
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
      console.error('sendJahrgangDeletionWarningToAdmins error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Neue Konfi-Registrierung - Push an Jahrgangs-Admins (Fallback: alle Org-Admins)
   */
  static async sendNewKonfiRegistrationToAdmins(db, organizationId, jahrgangId, konfiName, jahrgangName) {
    try {
      // Admins des Jahrgangs finden
      const { rows: admins } = await db.query(`
        SELECT DISTINCT u.id FROM users u
        JOIN roles r ON u.role_id = r.id
        JOIN user_jahrgang_assignments uja ON u.id = uja.user_id
        WHERE r.name IN ('admin', 'org_admin')
          AND u.organization_id = $1
          AND uja.jahrgang_id = $2
      `, [organizationId, jahrgangId]);

      // Fallback: Alle Org-Admins wenn kein Jahrgangs-Admin
      let adminIds;
      if (admins.length === 0) {
        const { rows: allAdmins } = await db.query(`
          SELECT u.id FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1
        `, [organizationId]);
        adminIds = allAdmins.map(a => a.id);
      } else {
        adminIds = admins.map(a => a.id);
      }

      if (adminIds.length === 0) return { success: false, message: 'No admins found' };

      const notification = {
        title: 'Neue Registrierung',
        body: `${konfiName} hat sich registriert (${jahrgangName})`,
        data: {
          type: 'new_konfi_registration',
          organization_id: organizationId.toString(),
          jahrgang_id: jahrgangId.toString()
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
      console.error('sendNewKonfiRegistrationToAdmins error:', error);
      return { success: false, error: error.message };
    }
  }

  // ====================================================================
  // OPT-OUT / OPT-IN NOTIFICATIONS
  // ====================================================================

  /**
   * Konfi hat sich von Pflicht-Event abgemeldet (Opt-out) - Push an alle Admins der Organisation
   */
  static async sendEventOptOutToAdmins(db, organizationId, konfiName, eventName, reason) {
    try {
      const { rows: admins } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1`,
        [organizationId]
      );

      if (admins.length === 0) {
        console.warn('Keine Admins für Organisation gefunden');
        return { success: false, message: 'No admins found' };
      }

      const adminIds = admins.map(a => a.id);
      const notification = {
        title: `Abmeldung: ${eventName}`,
        body: `${konfiName} hat sich von '${eventName}' abgemeldet. Grund: ${reason}`,
        data: {
          type: 'event_opt_out',
          event_name: eventName,
          konfi_name: konfiName,
          reason: reason,
          organization_id: String(organizationId)
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
      console.error('sendEventOptOutToAdmins error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Konfi hat Opt-out zurückgenommen (wieder angemeldet) - Push an alle Admins der Organisation
   */
  static async sendEventOptInToAdmins(db, organizationId, konfiName, eventName) {
    try {
      const { rows: admins } = await db.query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name IN ('admin', 'org_admin') AND u.organization_id = $1`,
        [organizationId]
      );

      if (admins.length === 0) {
        console.warn('Keine Admins für Organisation gefunden');
        return { success: false, message: 'No admins found' };
      }

      const adminIds = admins.map(a => a.id);
      const notification = {
        title: `Wieder angemeldet: ${eventName}`,
        body: `${konfiName} hat sich wieder für '${eventName}' angemeldet`,
        data: {
          type: 'event_opt_in',
          event_name: eventName,
          konfi_name: konfiName,
          organization_id: String(organizationId)
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
      console.error('sendEventOptInToAdmins error:', error);
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

  /**
   * Teamer:in hat sich zu einem Event angemeldet - Push an die Leitung.
   * @param {string} status 'confirmed' oder 'waitlist'
   */
  static async sendTeamerEventBookingToAdmins(db, organizationId, teamerName, eventName, status, eventId) {
    try {
      return await this.sendToOrgAdmins(db, organizationId, {
        title: 'Teamer:in angemeldet',
        body: status === 'confirmed'
          ? `${teamerName} hat sich für '${eventName}' angemeldet`
          : `${teamerName} steht auf der Warteliste für '${eventName}'`,
        data: {
          type: 'teamer_event_booking',
          eventId: String(eventId),
          organization_id: String(organizationId)
        }
      });
    } catch (error) {
      console.error('sendTeamerEventBookingToAdmins error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Teamer:in hat sich von einem Event abgemeldet - Push an die Leitung.
   */
  static async sendTeamerEventCancellationToAdmins(db, organizationId, teamerName, eventName, eventId, reason = null) {
    try {
      const notification = {
        title: 'Teamer:in abgemeldet',
        body: reason
          ? `${teamerName} hat sich von '${eventName}' abgemeldet. Grund: ${reason}`
          : `${teamerName} hat sich von '${eventName}' abgemeldet`,
        data: {
          type: 'teamer_event_cancellation',
          eventId: String(eventId),
          organization_id: String(organizationId)
        }
      };
      if (reason) notification.data.reason = reason;
      return await this.sendToOrgAdmins(db, organizationId, notification);
    } catch (error) {
      console.error('sendTeamerEventCancellationToAdmins error:', error);
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
   * Wird an zwei Stellen gebraucht: bei der Freigabe von Hand und im Cron.
   * @param {'konfi'|'teamer'} wrappedType
   */
  static async sendWrappedReleased(db, userIds, wrappedType, organizationId) {
    try {
      if (!userIds || userIds.length === 0) return { success: true, sent: 0 };

      const istKonfi = wrappedType === 'konfi';
      return await this.sendToMultipleUsers(db, userIds, {
        title: istKonfi ? 'Deine Konfi-Zeit Wrapped ist da!' : 'Dein Team-Jahr Wrapped ist da!',
        body: 'Schau dir jetzt deinen persönlichen Jahresrückblick an!',
        data: {
          type: 'wrapped',
          wrappedType,
          organization_id: String(organizationId)
        }
      });
    } catch (error) {
      console.error('sendWrappedReleased error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PushService;
