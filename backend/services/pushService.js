const { sendFirebasePushNotification, sendFirebaseSilentPush } = require('../push/firebase');

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
 * event_cancelled             | sendEventCancellationToKonfis        | Konfi (multi)   | ja
 * new_event                   | sendNewEventToOrgKonfis              | Org-Konfis      | ja
 * event_attendance            | sendEventAttendanceToKonfi           | Konfi           | ja
 * events_pending_approval     | sendEventsPendingApprovalToAdmins    | Org-Admins      | ja
 * new_konfi_registration      | sendNewKonfiRegistrationToAdmins     | Jahrgangs-Admins| ja
 * event_opt_out               | sendEventOptOutToAdmins              | Org-Admins      | ja
 * event_opt_in                | sendEventOptInToAdmins               | Org-Admins      | ja
 *
 * Helper-Methoden (nicht direkt als Push-Type):
 * - getTokensForUser(db, userId)
 * - sendToUser(db, userId, notification)
 * - sendToMultipleUsers(db, userIds, notification)
 */

class PushService {
  /**
   * Helper: Holt alle Push-Tokens für einen User
   */
  static async getTokensForUser(db, userId) {
    // Master-Schalter: Hat der User Push global deaktiviert, gar keine Tokens
    // zurueckgeben -> es wird nichts gesendet (gilt fuer alle Push-Typen).
    // DISTINCT ON (token): derselbe FCM-Token darf nie mehrfach beliefert werden,
    // auch wenn er (noch) unter mehreren device_ids gespeichert ist (Alt-Daten).
    const query = `
      SELECT DISTINCT ON (pt.token) pt.* FROM push_tokens pt
      JOIN users u ON pt.user_id = u.id
      WHERE pt.user_id = $1
        AND u.push_enabled = true
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
   * Helper: Sendet Push an einen User
   */
  static async sendToUser(db, userId, notification) {
    try {
      const tokens = await this.getTokensForUser(db, userId);

      if (tokens.length === 0) {
 console.warn(`Keine Push-Tokens für User ${userId} gefunden`);
        return { success: false, message: 'No tokens found' };
      }

      let successCount = 0;
      let errorCount = 0;

      for (const token of tokens) {
        const result = await sendFirebasePushNotification(token.token, {
          title: notification.title,
          body: notification.body,
          badge: notification.badge || 1,
          sound: 'default',
          data: notification.data || {}
        });

        if (result.success) {
          successCount++;
          // Error-Count zurücksetzen bei Erfolg (nur wenn vorher > 0)
          if (token.error_count > 0) {
            await db.query(
              'UPDATE push_tokens SET error_count = 0, last_error_at = NULL WHERE id = $1',
              [token.id]
            );
          }
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
    const results = [];
    for (const userId of userIds) {
      const result = await this.sendToUser(db, userId, notification);
      results.push({ userId, ...result });
    }
    return results;
  }

  /**
   * Sendet Chat-Benachrichtigung an alle User-Devices
   */
  static async sendChatNotification(db, userId, notificationData) {
    try {

      // Hole zuerst die Tokens des Senders um sie auszuschließen
      const senderTokensQuery = `SELECT token FROM push_tokens WHERE user_id = $1`;
      const { rows: senderTokens } = await db.query(senderTokensQuery, [notificationData.data?.sender_id]);
      const senderTokenList = senderTokens.map(t => t.token);

      // Neuestes Token pro Device verwenden
      // UND Sender-Tokens ausschließen (für den Fall dass gleicher Token bei verschiedenen Accounts)
      // UND Master-Schalter pruefen (u.push_enabled): bei false keine Tokens.
      // DISTINCT ON (token): nie denselben FCM-Token doppelt beliefern (Alt-Daten
      // mit gleichem Token unter mehreren device_ids).
      let query = `
        SELECT DISTINCT ON (pt.token) pt.* FROM push_tokens pt
        JOIN users u ON pt.user_id = u.id
        WHERE pt.user_id = $1
          AND u.push_enabled = true
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

      // An alle Devices senden
      for (const token of tokens) {
        const result = await sendFirebasePushNotification(token.token, {
          title: notificationData.title || 'Neue Nachricht',
          body: notificationData.body,
          badge: notificationData.badge || 1,
          sound: 'default',
          data: {
            type: 'chat',
            roomId: notificationData.roomId?.toString() || '',
            messageId: notificationData.messageId?.toString() || '',
            sender_id: notificationData.data?.sender_id?.toString() || '',
            sender_name: notificationData.data?.sender_name || '',
            room_name: notificationData.data?.room_name || ''
          }
        });

        if (result.success) {
          successCount++;
          // Error-Count zurücksetzen bei Erfolg (nur wenn vorher > 0)
          if (token.error_count > 0) {
            await db.query(
              'UPDATE push_tokens SET error_count = 0, last_error_at = NULL WHERE id = $1',
              [token.id]
            );
          }
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
   */
  static async sendBadgeUpdate(db, userId, badgeCount) {
    try {

      const tokens = await this.getTokensForUser(db, userId);

      if (tokens.length === 0) {
        return { success: false, message: 'No tokens found' };
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

      return { success: true, sent: successCount, errors: errorCount, total: tokens.length };

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
      return await this.sendToMultipleUsers(db, adminIds, notification);
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
  static async sendActivityRequestStatusToKonfi(db, konfiId, activityName, points, status, adminComment = null, requestId = null) {
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
          request_id: requestId?.toString() || ''
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
  static async sendBadgeEarnedToKonfi(db, konfiId, badgeName, badgeIcon, badgeDescription, badgeId = null) {
    try {

      const notification = {
        title: 'Neues Badge erhalten!',
        body: `Herzlichen Glückwunsch! Du hast das Badge "${badgeName}" erhalten.`,
        data: {
          type: 'badge_earned',
          badge_name: badgeName,
          badge_icon: badgeIcon,
          badge_id: badgeId?.toString() || ''
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
  static async sendEventRegisteredToKonfi(db, konfiId, eventName, eventDate, status, eventId = null, timeslot = null) {
    try {

      const dateFormatted = new Date(eventDate).toLocaleDateString('de-DE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });

      // Build time string - use timeslot time if available, otherwise event time
      let timeString = '';
      if (timeslot && timeslot.start_time) {
        const startTime = new Date(timeslot.start_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const endTime = timeslot.end_time
          ? new Date(timeslot.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
          : null;
        timeString = endTime ? ` von ${startTime} - ${endTime} Uhr` : ` um ${startTime} Uhr`;
      } else {
        const eventTime = new Date(eventDate).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
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
          event_id: eventId?.toString() || ''
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendEventRegisteredToKonfi error:', error);
      return { success: false, error: error.message };
    }
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
          konfi_name: konfiName
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
      // WICHTIG: nur AKTIVIERTE Punkt-Kategorien zaehlen (gemeinde_enabled /
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

      // 3. Hoechstes erreichtes Level berechnen
      let newLevel = null;
      for (const level of levels) {
        if (totalPoints >= level.points_required) {
          newLevel = level;
        }
      }

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
  static async sendEventReminderToKonfi(db, konfiId, eventName, eventDate, eventTime, reminderType) {
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
          event_name: eventName
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
  static async sendWaitlistPromotionToKonfi(db, konfiId, eventName, eventDate = null, eventId = null) {
    try {

      let dateInfo = '';
      if (eventDate) {
        const date = new Date(eventDate);
        dateInfo = ` am ${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} um ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
      }

      const notification = {
        title: 'Platz frei geworden!',
        body: `Du bist für "${eventName}"${dateInfo} nachgerückt und jetzt angemeldet.`,
        data: {
          type: 'waitlist_promotion',
          event_name: eventName,
          event_id: eventId?.toString() || ''
        }
      };

      return await this.sendToUser(db, konfiId, notification);
    } catch (error) {
 console.error('sendWaitlistPromotionToKonfi error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Event abgesagt - Push an alle angemeldeten Konfis
   */
  static async sendEventCancellationToKonfis(db, userIds, eventName, eventDate) {
    try {

      let dateInfo = eventDate;
      if (eventDate) {
        const date = new Date(eventDate);
        dateInfo = `${date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })} um ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
      }

      const notification = {
        title: 'Event abgesagt',
        body: `Leider abgesagt: "${eventName}" am ${dateInfo}`,
        data: {
          type: 'event_cancelled',
          event_name: eventName
        }
      };

      return await this.sendToMultipleUsers(db, userIds, notification);
    } catch (error) {
 console.error('sendEventCancellationToKonfis error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Neues Event erstellt - Push an alle Konfis der Organisation
   */
  static async sendNewEventToOrgKonfis(db, organizationId, eventName, eventDate, eventId = null) {
    try {

      // Hole alle Konfi-IDs der Organisation
      const konfisQuery = `
        SELECT u.id FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.organization_id = $1 AND r.name = 'konfi'
      `;
      const { rows: konfis } = await db.query(konfisQuery, [organizationId]);
      const konfiIds = konfis.map(k => k.id);

      if (konfiIds.length === 0) {
 console.warn('Keine Konfis für Organisation gefunden:', organizationId);
        return { success: true, sent: 0 };
      }

      const dateFormatted = new Date(eventDate).toLocaleDateString('de-DE', {
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
          event_id: eventId?.toString() || ''
        }
      };

      return await this.sendToMultipleUsers(db, konfiIds, notification);
    } catch (error) {
 console.error('sendNewEventToOrgKonfis error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Event-Anwesenheit verbucht - Push an Konfi
   */
  static async sendEventAttendanceToKonfi(db, konfiId, eventName, status, points = 0, eventId = null) {
    try {

      const isPresent = status === 'present';
      const notification = {
        title: isPresent ? 'Teilnahme bestätigt!' : 'Nicht erschienen',
        body: isPresent
          ? `Deine Teilnahme an "${eventName}" wurde bestätigt.${points > 0 ? ` Du erhältst +${points} Punkte!` : ''}`
          : `Du wurdest als "nicht erschienen" für "${eventName}" markiert.`,
        data: {
          type: 'event_attendance',
          status: status,
          event_name: eventName,
          points: points.toString(),
          event_id: eventId?.toString() || ''
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
          count: eventCount.toString()
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
   * automatisch geloescht. Wir nennen es bewusst "geloescht" (das interne Archiv
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
          days_left: String(daysLeft)
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
          reason: reason
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
          konfi_name: konfiName
        }
      };

      return await this.sendToMultipleUsers(db, adminIds, notification);
    } catch (error) {
      console.error('sendEventOptInToAdmins error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PushService;
