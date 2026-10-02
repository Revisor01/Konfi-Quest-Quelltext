package de.godsapp.konfiquest;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Der EINE Empfaenger fuer Push-Nachrichten der App.
 *
 * WARUM EIN EIGENER DIENST: Auf dem iPhone setzt aps.badge die Zahl am
 * App-Symbol auch bei geschlossener App. Auf Android muss die App das selbst
 * tun -- dafuer schickt der Server ein reines Datenpaket (type
 * "badge_update", count). Solche Pakete weckt FCM auch bei geschlossener App,
 * aber nur in einem Messaging-Dienst, nicht in der WebView. Dieser Dienst
 * setzt die Zahl (AppSymbolZahl.ausNachricht) und reicht danach JEDE
 * Nachricht unveraendert weiter.
 *
 * WARUM ABGELEITET VOM DIENST DES PUSH-PLUGINS: super.onMessageReceived und
 * das geerbte onNewToken sind genau der Code von @capacitor/push-notifications
 * (PushNotificationsPlugin.sendRemoteMessage und .onNewToken). Damit bleiben
 * die JS-Ereignisse, an denen AppContext haengt, wie sie waren:
 * 'pushNotificationReceived' (Zaehler neu laden, bei offener App die
 * Mitteilung anzeigen), 'registration' bei neuem Token. Das Antippen einer
 * Mitteilung ('pushNotificationActionPerformed') laeuft ueber die Activity,
 * nicht ueber einen Dienst.
 *
 * NEUER TOKEN BEI GESCHLOSSENER APP: onNewToken erreicht die WebView nur, wenn
 * sie laeuft -- das war mit dem Dienst des Plugins genauso. Den Token holt die
 * App beim naechsten Start ohnehin aktiv (AppContext, tokenAktivHolen ueber
 * FirebaseMessaging.getToken()).
 *
 * GENAU EIN DIENST: Die Dienste von @capacitor/push-notifications und
 * @capacitor-firebase/messaging sind im Manifest per tools:node="remove"
 * abgemeldet. FCM stellt jede Nachricht nur einem Dienst zu (resolveService,
 * bei gleicher Prioritaet der erste im gemergten Manifest); mit mehreren
 * haengt es an der Reihenfolge der Bibliotheken, wer sie bekommt.
 */
public class KonfiMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage nachricht) {
        AppSymbolZahl.ausNachricht(this, nachricht.getData());
        super.onMessageReceived(nachricht);
    }
}
