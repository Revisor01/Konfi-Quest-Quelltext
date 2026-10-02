package de.godsapp.konfiquest;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Dateiauswahl im WebView: Dokumente kommen als Kopie im Cache der App an
 * 
 *
 * WAS AUF ANDROID ANDERS IST: Capacitor (BridgeWebChromeClient.showFilePicker)
 * reicht die content://-Adressen aus der Auswahl unveraendert ans WebView. Das
 * WebView liest die Datei erst beim Senden -- und prueft dabei, ob sich Groesse
 * und Aenderungszeit seit der Auswahl geaendert haben. Manche Anbieter melden
 * bei jeder Abfrage eine andere Zeit (Google Drive, der Photo Picker ab
 * Android 13); das WebView bricht den Upload dann mit ERR_UPLOAD_FILE_CHANGED
 * ab, ohne dass eine Anfrage den Server erreicht (Chromium-Fehler 40123366).
 * Die App sah nur "keine Antwort": Das Material meldete "Fehler beim
 * Speichern", der Chat reihte die Nachricht ein. Auf dem iPhone kopiert
 * WKWebView die Auswahl selbst, dort trat das nie auf. Fotos gingen auch auf
 * Android, weil die App sie zum Verkleinern ohnehin in den Speicher liest.
 *
 * WAS HIER PASSIERT: Die Auswahl laeuft unveraendert ueber Capacitor
 * (Kamera, Mehrfachauswahl, Rechte). Nur das Ergebnis wird abgefangen: Jedes
 * Dokument -- alles ausser Bildern und Videos (DateiKopie.sollKopieren) --
 * wird in den Cache der App kopiert und dem WebView ueber den FileProvider der
 * App gereicht, denselben Weg, auf dem Capacitor Kamerafotos uebergibt. Name
 * und Typ bleiben (der FileProvider nennt den Dateinamen), Groesse und Zeit
 * aendern sich nicht mehr. Scheitert die Kopie, geht die Auswahl unveraendert
 * weiter -- schlechter als vorher wird es nie.
 *
 * Eingesetzt in MainActivity.onCreate; die Logik ohne Android-Klassen steht in
 * DateiKopie (mit Tests).
 */
public class DateiAuswahlChromeClient extends BridgeWebChromeClient {

    private static final String LOG = "DateiAuswahl";

    /** Unterordner im Cache; file_paths.xml gibt den ganzen Cache frei (cache-path "."). */
    static final String ORDNER = "dateiauswahl";

    private final Context context;
    private final ExecutorService kopierer = Executors.newSingleThreadExecutor();
    private final Handler hauptfaden = new Handler(Looper.getMainLooper());

    public DateiAuswahlChromeClient(Bridge bridge) {
        super(bridge);
        this.context = bridge.getContext();
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> rueckruf, FileChooserParams parameter) {
        ValueCallback<Uri[]> stabilisierend = (gewaehlt) -> {
            if (gewaehlt == null || gewaehlt.length == 0) {
                rueckruf.onReceiveValue(gewaehlt);
                return;
            }
            // Kopieren liest die ganze Datei -- nicht im Hauptfaden. Das
            // WebView wartet, bis der Rueckruf kommt; genau einmal, auch im
            // Fehlerfall.
            kopierer.execute(() -> {
                Uri[] ergebnis = gewaehlt;
                try {
                    ergebnis = stabilisieren(gewaehlt);
                } catch (Throwable fehler) {
                    Log.w(LOG, "Auswahl nicht kopiert, sie geht unveraendert weiter", fehler);
                }
                final Uri[] fertig = ergebnis;
                hauptfaden.post(() -> rueckruf.onReceiveValue(fertig));
            });
        };
        return super.onShowFileChooser(webView, stabilisierend, parameter);
    }

    private Uri[] stabilisieren(Uri[] gewaehlt) {
        File wurzel = new File(context.getCacheDir(), ORDNER);
        DateiKopie.aufraeumen(wurzel, System.currentTimeMillis(), DateiKopie.AUFBEWAHREN_MS);
        Uri[] ergebnis = new Uri[gewaehlt.length];
        for (int i = 0; i < gewaehlt.length; i++) {
            ergebnis[i] = gewaehlt[i];
            File ordner = new File(wurzel, System.nanoTime() + "-" + i);
            try {
                Uri kopie = kopie(gewaehlt[i], ordner);
                if (kopie != null) ergebnis[i] = kopie;
            } catch (Throwable fehler) {
                DateiKopie.loeschen(ordner);
                Log.w(LOG, "Datei nicht kopiert, sie geht unveraendert weiter", fehler);
            }
        }
        return ergebnis;
    }

    /** Die Kopie als FileProvider-Adresse, oder null, wenn die Auswahl bleiben soll. */
    private Uri kopie(Uri quelle, File ordner) throws IOException {
        if (quelle == null || !ContentResolver.SCHEME_CONTENT.equals(quelle.getScheme())) return null;
        ContentResolver resolver = context.getContentResolver();
        String typ = resolver.getType(quelle);
        if (!DateiKopie.sollKopieren(typ)) return null;

        String anzeigename = null;
        long groesse = -1;
        try (Cursor zeile = resolver.query(quelle,
                new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (zeile != null && zeile.moveToFirst()) {
                int n = zeile.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int g = zeile.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && !zeile.isNull(n)) anzeigename = zeile.getString(n);
                if (g >= 0 && !zeile.isNull(g)) groesse = zeile.getLong(g);
            }
        }
        if (groesse > DateiKopie.HOECHSTENS_BYTES) return null;

        // Die Endung aus dem Typ nur, wenn der Typ etwas sagt: Zu
        // application/octet-stream kennt Android ".bin", und das waere falsch.
        String endung = typ == null || "application/octet-stream".equals(typ)
            ? null
            : MimeTypeMap.getSingleton().getExtensionFromMimeType(typ);
        File ziel = new File(ordner, DateiKopie.dateiname(anzeigename, endung));
        if (!ordner.mkdirs() && !ordner.isDirectory()) return null;

        try (InputStream ein = resolver.openInputStream(quelle)) {
            if (ein == null || !DateiKopie.kopieren(ein, ziel, DateiKopie.HOECHSTENS_BYTES)) {
                DateiKopie.loeschen(ordner);
                return null;
            }
        }
        return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", ziel);
    }
}
