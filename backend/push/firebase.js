const { initializeApp, cert } = require('firebase-admin/app');
// Gleiches gilt für admin.messaging() — in v14 nur noch über getMessaging().
const { getMessaging } = require('firebase-admin/messaging');

// ---------------------------------------------------------------------------
// Android-Benachrichtigungskanäle
//
// Die Kanaele werden in der App angelegt (frontend/src/services/
// pushChannels.ts). Wer hier einen Kanal ergaenzt, muss ihn DORT ebenfalls
// anlegen — sonst landet er auf dem Geraet wieder unter "Sonstiges".
// ---------------------------------------------------------------------------

const { GRUPPE_JE_ART, GRUPPE_STANDARD, gruppeFuerArt } = require('../utils/pushGruppen');
const KANAL_JE_TYP = GRUPPE_JE_ART;
const KANAL_STANDARD = GRUPPE_STANDARD;
const kanalFuerTyp = gruppeFuerArt;
const { APP_SYMBOL_WEGE, MITTEILUNG_TAG } = require('../utils/appSymbolWeg');
const { mitteilungsKennung } = require('../utils/mitteilungsKennung');

// Firebase Admin initialisieren (Service Account wird später hinzugefügt)
let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Service Account Key wird aus Datei geladen (bevorzugt) oder Environment Variable
    let serviceAccount;
    try {
      serviceAccount = require('./firebase-service-account.json');
    } catch (fileError) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } else {
        throw new Error('Firebase Service Account not found in file or environment variable', { cause: fileError });
      }
    }

    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
    });

    return firebaseApp;
  } catch (error) {
    console.error('Firebase initialization failed:', error.message);
    return null;
  }
};

const sendFirebasePushNotification = async (deviceToken, notificationData) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      throw new Error('Firebase not initialized');
    }

    const zahlInDerMitteilung = notificationData.appSymbolWeg === APP_SYMBOL_WEGE.MITTEILUNGEN;

    const message = {
      token: deviceToken,
      notification: {
        title: notificationData.title || 'Konfi Quest',
        body: notificationData.body || notificationData.alert,
      },
      data: notificationData.data || {},
      android: {
        // Hohe Prioritaet, damit die Notification auf Android 8+ zuverlaessig
        // und sofort zugestellt wird.
        priority: 'high',
        notification: {
          // Kanal nach Art der Mitteilung (siehe KANAL_JE_TYP oben). Kennt das
          // Geraet den Kanal nicht — aeltere App-Fassung —, faellt das
          // FCM-SDK auf den Notfallkanal zurueck und stellt normal zu.
          channelId: kanalFuerTyp((notificationData.data || {}).type),
          sound: notificationData.sound || 'default',
          defaultSound: true,
          // notificationCount NUR zusammen mit dem festen tag (oben,
          // zahlInDerMitteilung). Das Feld heisst "the number of items this
          // notification represents", und der Launcher addiert es ueber alle
          // liegenden Mitteilungen der App (AOSP Launcher3, DotInfo). Mit der
          // iOS-Zahl in JEDER liegenden Mitteilung ergaeben drei Pushes mit
          // 3, 4 und 5 offenen Dingen am Symbol 12. Ohne das Feld zaehlt jede
          // Mitteilung als eine; die Zahl der App selbst setzt auf Android
          // die App (AppSymbolZahl). Test: pushKanaele.test.js.
          ...(zahlInDerMitteilung
            ? { tag: MITTEILUNG_TAG, notificationCount: Math.max(0, Math.floor(Number(notificationData.badge) || 0)) }
            : { tag: mitteilungsKennung(notificationData.data || {}) }),
        },
      },
      apns: {
        payload: {
          aps: {
            badge: notificationData.badge || 0,
            sound: notificationData.sound || 'default',
          },
        },
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
        },
      },
    };

    const response = await getMessaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Firebase notification error:', error);
    return { success: false, error: error.message, errorCode: error.code || null };
  }
};

const sendFirebaseSilentPush = async (deviceToken, badgeCount) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      throw new Error('Firebase not initialized');
    }

    // ALTE APPS (Store 2.2.x, kein eigener Dienst; nachgesehen am Tag 2.2.0):
    // Das Paket hat keinen notification-Block, das Push-Plugin zeigt deshalb
    // nichts an und reicht es nur als 'pushNotificationReceived' weiter; die
    // App laedt daraufhin ihre Zaehler neu. Sichtbar wird nichts.
    const message = {
      token: deviceToken,
      apns: {
        payload: {
          aps: {
            badge: badgeCount,
            'content-available': 1,
          },
        },
        headers: {
          'apns-push-type': 'background',
          'apns-priority': '5',
        },
      },
      android: {
        priority: 'high',
        // Bewusst ohne notification-Block: Das hier soll nichts anzeigen,
        // sondern nur die Zahl nachfuehren.
      },
      data: { type: 'badge_update', count: badgeCount.toString() },
    };

    const response = await getMessaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Firebase silent push error:', error);
    return { success: false, error: error.message, errorCode: error.code || null };
  }
};

module.exports = {
  initializeFirebase,
  sendFirebasePushNotification,
  sendFirebaseSilentPush,
  kanalFuerTyp,
  KANAL_JE_TYP,
  KANAL_STANDARD
};
