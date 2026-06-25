const admin = require('firebase-admin');

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
        throw new Error('Firebase Service Account not found in file or environment variable');
      }
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
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

    const message = {
      token: deviceToken,
      notification: {
        title: notificationData.title || 'Konfi Quest',
        body: notificationData.body || notificationData.alert,
      },
      data: notificationData.data || {},
      android: {
        // Hohe Prioritaet, damit die Notification auf Android 8+ zuverlaessig
        // und sofort zugestellt wird. Bewusst KEINE feste channelId: das
        // Capacitor-Push-Plugin registriert selbst einen Default-Channel —
        // eine unbekannte channelId wuerde die Zustellung verhindern.
        priority: 'high',
        notification: {
          sound: notificationData.sound || 'default',
          defaultSound: true,
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

    const response = await admin.messaging().send(message);
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
      data: { type: 'badge_update', count: badgeCount.toString() },
    };

    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Firebase silent push error:', error);
    return { success: false, error: error.message, errorCode: error.code || null };
  }
};

module.exports = {
  initializeFirebase,
  sendFirebasePushNotification,
  sendFirebaseSilentPush
};
