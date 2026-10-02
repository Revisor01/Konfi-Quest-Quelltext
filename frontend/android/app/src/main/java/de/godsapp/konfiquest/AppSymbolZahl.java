package de.godsapp.konfiquest;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import me.leolin.shortcutbadger.ShortcutBadger;

/**
 * Die Zahl am App-Symbol auf Android.
 *
 * Android hat keine Schnittstelle fuer eine Zahl am Symbol; es haengt am
 * Startbildschirm. Diese Klasse ist die EINE Stelle, die sie setzt: aus der
 * offenen App (AppSymbolZahlPlugin, BadgeContext) und bei geschlossener App
 * aus dem stillen badge_update (KonfiMessagingService). Welcher Weg zum
 * Startbildschirm passt, bestimmt weg() -- die App meldet ihn bei der
 * Token-Anmeldung an den Server (backend/utils/appSymbolWeg.js):
 *
 * Alles hier faengt seine Fehler selbst: Eine Zahl, die nicht ankommt, ist
 * ungleich harmloser als ein Push-Dienst, der abstuerzt.
 */
final class AppSymbolZahl {

    static final String WEG_ANBIETER = "anbieter";
    static final String WEG_MITTEILUNGEN = "mitteilungen";
    static final String WEG_PUNKT = "punkt";

    /** Art des stillen Pakets mit der Zahl (backend/push/firebase.js, sendFirebaseSilentPush). */
    static final String ART_ZAHL = "badge_update";

    /**
     * Kennung (tag), unter der Mitteilungen auf Geraeten mit Weg
     * "mitteilungen" liegen. Dieselbe Zeichenkette schickt der Server mit
     * (backend/utils/appSymbolWeg.js, MITTEILUNG_TAG); FCM legt die Mitteilung
     * damit unter diesem tag ab, und jede neue ersetzt die vorige.
     */
    static final String MITTEILUNG_TAG = "konfi_app_symbol";

    static final int MITTEILUNG_ID = 0;

    /** Sonys Zahl-Anbieter; muss im Manifest unter queries stehen, sonst sieht die App ihn nicht. */
    static final String SONY_ANBIETER = "com.sonymobile.home.resourceprovider";
    private static final Uri SONY_ZAHL = Uri.parse("content://" + SONY_ANBIETER + "/badge");

    /** Huaweis Startbildschirm und Zahl-Anbieter, wie ShortcutBadger (HuaweiHomeBadger) sie nutzt. */
    static final String HUAWEI_STARTBILDSCHIRM = "com.huawei.android.launcher";
    static final String HUAWEI_ANBIETER = "com.huawei.android.launcher.settings";

    /**
     * Startbildschirme, die die Zahl aus den liegenden Mitteilungen rechnen.
     * Samsung One UI Home zeigt sie mit der Einstellung "Zahl" (sonst einen
     * Punkt); Xiaomi (MIUI, HyperOS) und der POCO-Launcher zeigen die Zahl
     * ihrer Mitteilungen. Beleg und offene Fragen: Handbuch "Die Zahl am
     * App-Symbol auf Android lesen".
     */
    static final Set<String> ZAHL_AUS_MITTEILUNGEN = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "com.sec.android.app.launcher",
        "com.miui.home",
        "com.mi.android.globallauncher"
    )));

    /**
     * Topf und Schluessel des Badge-Plugins (@capawesome/capacitor-badge,
     * Badge.STORAGE_KEY). Das Plugin stellt beim Start die dort gemerkte Zahl
     * wieder her (persist: true in capacitor.config.ts); steht dort nicht der
     * letzte Stand, setzte es beim Oeffnen kurz eine alte Zahl.
     */
    static final String BADGE_TOPF = "capacitor.badge";
    static final String BADGE_SCHLUESSEL = "capacitor.badge";

    private static final String LOG = "KonfiAppSymbol";

    private AppSymbolZahl() {}

    /** Paketname des Startbildschirms, oder null, wenn keiner festgelegt ist. */
    static String startbildschirm(Context context) {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo info = context.getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        if (info == null || info.activityInfo == null) return null;
        return info.activityInfo.packageName;
    }

    /** Gibt es diesen Anbieter auf dem Geraet (und darf die App ihn sehen)? */
    static boolean anbieterDa(Context context, String kennung) {
        return context.getPackageManager().resolveContentProvider(kennung, 0) != null;
    }

    /** Welcher Weg zur Zahl passt zu diesem Geraet? */
    static String weg(Context context) {
        if (anbieterDa(context, SONY_ANBIETER)) return WEG_ANBIETER;
        String start = startbildschirm(context);
        if (HUAWEI_STARTBILDSCHIRM.equals(start) && anbieterDa(context, HUAWEI_ANBIETER)) return WEG_ANBIETER;
        if (start != null && ZAHL_AUS_MITTEILUNGEN.contains(start)) return WEG_MITTEILUNGEN;
        return WEG_PUNKT;
    }

    /**
     * Setzt die Zahl am App-Symbol. Sony ueber den Zahl-Anbieter, alle anderen
     * ueber ShortcutBadger -- das ist genau der Aufruf, den das Badge-Plugin
     * bisher machte; wo der Startbildschirm ihn nicht versteht, bleibt er
     * folgenlos. Auf Geraeten mit Weg "mitteilungen" traegt ausserdem die
     * liegende Mitteilung die neue Zahl (mitteilungNachfuehren).
     */
    static void setzen(Context context, int zahl) {
        Context app = context.getApplicationContext();
        int ganz = Math.max(0, zahl);
        merken(app, ganz);
        if (anbieterDa(app, SONY_ANBIETER)) {
            sonySetzen(app, ganz);
        } else {
            ShortcutBadger.applyCount(app, ganz);
        }
        if (WEG_MITTEILUNGEN.equals(weg(app))) {
            mitteilungNachfuehren(app, ganz);
        }
    }

    /**
     * Weg "mitteilungen" (Samsung, Xiaomi): Der Startbildschirm zaehlt die
     * Zahlen der liegenden Mitteilungen zusammen (Notification.number, bei 0
     * zaehlt eine Mitteilung als 1). Der Server schickt deshalb jede
     * Mitteilung mit festem tag und der Gesamtzahl -- es liegt immer nur eine,
     * und sie traegt die Zahl.
     *
     * Sinkt die Zahl, weil etwas gelesen oder erledigt ist, bekommt diese
     * Mitteilung hier die neue Zahl, still (setOnlyAlertOnce), mit Titel,
     * Text und Ziel wie zuvor (recoverBuilder).
     */
    static void mitteilungNachfuehren(Context context, int zahl) {
        NotificationManager verwalter = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (verwalter == null) return;
        for (StatusBarNotification liegend : verwalter.getActiveNotifications()) {
            if (!MITTEILUNG_TAG.equals(liegend.getTag()) || liegend.getId() != MITTEILUNG_ID) continue;
            Notification alt = liegend.getNotification();
            if (alt == null || alt.number == zahl) continue;
            if (zahl == 0) {
                verwalter.cancel(MITTEILUNG_TAG, MITTEILUNG_ID);
                continue;
            }
            Notification neu = Notification.Builder.recoverBuilder(context, alt)
                .setNumber(zahl)
                .setOnlyAlertOnce(true)
                .build();
            verwalter.notify(MITTEILUNG_TAG, MITTEILUNG_ID, neu);
        }
    }

    static void beimOeffnen(Context context) {
        try {
            Context app = context.getApplicationContext();
            if (!WEG_MITTEILUNGEN.equals(weg(app))) return;
            NotificationManager verwalter = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (verwalter == null) return;
            int gemerkt = gemerkt(app);
            for (StatusBarNotification liegend : verwalter.getActiveNotifications()) {
                if (!MITTEILUNG_TAG.equals(liegend.getTag()) || liegend.getId() != MITTEILUNG_ID) continue;
                Notification n = liegend.getNotification();
                if (n != null && AppSymbolNull.beimOeffnenWegnehmen(n.number, gemerkt)) {
                    verwalter.cancel(MITTEILUNG_TAG, MITTEILUNG_ID);
                }
            }
        } catch (Throwable fehler) {
            Log.w(LOG, "Mitteilung mit 0 nicht weggeraeumt", fehler);
        }
    }

    /**
     * Aus einer Push-Nachricht: Ist sie ein stilles badge_update mit gueltiger
     * Zahl, wird die Zahl gesetzt. Alles andere bleibt unberuehrt.
     */
    static void ausNachricht(Context context, Map<String, String> daten) {
        if (daten == null || !ART_ZAHL.equals(daten.get("type"))) return;
        Integer zahl = zahlAus(daten.get("count"));
        if (zahl == null) return;
        try {
            setzen(context, zahl);
        } catch (Throwable fehler) {
            Log.w(LOG, "Zahl am App-Symbol nicht gesetzt", fehler);
        }
    }

    /** FCM-Daten sind Text: "7" -> 7; leer, negativ oder keine Zahl -> null. */
    static Integer zahlAus(String text) {
        if (text == null) return null;
        try {
            int zahl = Integer.parseInt(text.trim());
            return zahl < 0 ? null : zahl;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Die zuletzt gesetzte Zahl, oder -1, wenn keine bekannt ist. */
    private static int gemerkt(Context context) {
        try {
            return context.getSharedPreferences(BADGE_TOPF, Context.MODE_PRIVATE)
                .getInt(BADGE_SCHLUESSEL, -1);
        } catch (ClassCastException fehler) {
            return -1;
        }
    }

    private static void merken(Context context, int zahl) {
        context.getSharedPreferences(BADGE_TOPF, Context.MODE_PRIVATE)
            .edit()
            .putInt(BADGE_SCHLUESSEL, zahl)
            .apply();
    }

    /**
     * Sonys Zahl-Anbieter, wie ShortcutBadger ihn anspricht
     * (SonyHomeBadger.executeBadgeByContentProvider): Zahl, Paket und die
     * Activity mit dem LAUNCHER-Eintrag. Die Berechtigung PROVIDER_INSERT_BADGE
     * steht im Manifest.
     */
    private static void sonySetzen(Context context, int zahl) {
        Intent start = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        ComponentName ziel = start != null ? start.getComponent() : null;
        if (ziel == null) return;
        ContentValues werte = new ContentValues();
        werte.put("badge_count", zahl);
        werte.put("package_name", ziel.getPackageName());
        werte.put("activity_name", ziel.getClassName());
        context.getContentResolver().insert(SONY_ZAHL, werte);
    }
}
