package de.godsapp.konfiquest;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Auf iOS reicht dafuer eine Abdeckung im WebView, weil dort die Momentaufnahme
 * vom eingefrorenen Bild gemacht wird. Android schiesst das Vorschaubild am
 * WebView vorbei -- eine HTML-Flaeche kann dort grundsaetzlich zu spaet kommen.
 * Der verlaessliche Weg ist FLAG_SECURE: Das System zeigt die App im Umschalter
 * dann als leere Flaeche.
 *
 * WARUM DAS FLAG NICHT DAUERHAFT GESETZT IST -- die eigentliche Entscheidung:
 * FLAG_SECURE verbietet JEDE Bildschirmaufnahme in der ganzen App, nicht nur
 * das Vorschaubild. Wer einen Termin, einen QR-Code oder seinen Punktestand
 * abfotografieren will, kann das dann nicht mehr. Das waere eine spuerbare
 * Einschraenkung fuer ALLE -- auch fuer die grosse Mehrheit, die die Sperre gar
 * nicht nutzt (Voreinstellung ist 'aus'). Deshalb haengt das Flag an genau
 * derselben Einstellung wie die Sperre selbst: eingeschaltet -> Flag gesetzt,
 * 'aus' -> kein Flag und damit keine Verhaltensaenderung.
 *
 * WARUM DIREKT AUS DEN SharedPreferences UND NICHT UEBER DIE BRUECKE:
 * Das Flag muss stehen, BEVOR das erste Bild existiert. Ein Weg ueber
 * JavaScript kaeme erst, wenn der WebView laeuft -- also moeglicherweise nach
 * der ersten Momentaufnahme. Gelesen wird deshalb genau der Topf, in den das
 * Preferences-Plugin schreibt (group "CapacitorStorage", Schluessel wie in
 * services/appSperre.ts). Bleibt die Stelle leer, gilt 'aus' -- dieselbe
 * Voreinstellung wie im JavaScript.
 */
public class MainActivity extends BridgeActivity {

    /** Topf des Capacitor-Preferences-Plugins (PreferencesConfiguration.DEFAULTS.group). */
    private static final String TOPF = "CapacitorStorage";

    /** Schluessel der Sperr-Einstellung, identisch zu services/appSperre.ts. */
    private static final String SCHLUESSEL = "konfi_app_sperre_verzoegerung";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppSymbolZahlPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.getWebView().setWebChromeClient(new DateiAuswahlChromeClient(bridge));
    }

    @Override
    public void onResume() {
        super.onResume();
        // Bei jeder Rueckkehr neu bewerten: Die Einstellung kann im Profil
        // geaendert worden sein, seit die Activity zuletzt sichtbar war.
        // onResume laeuft vor dem ersten Bild und ist damit frueh genug.
        sichtschutzAnwenden();
        AppSymbolZahl.beimOeffnen(this);
    }

    /** Setzt oder entfernt FLAG_SECURE nach der aktuellen Einstellung. */
    private void sichtschutzAnwenden() {
        if (sperreEingeschaltet()) {
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            );
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    /**
     * Ist die App-Sperre eingeschaltet?
     * Jeder andere Wert als ein bekannter Sperrwert gilt als 'aus' -- inklusive
     * fehlendem Eintrag. Lieber kein Flag als eines, das niemand bestellt hat.
     */
    private boolean sperreEingeschaltet() {
        try {
            SharedPreferences topf = getSharedPreferences(TOPF, MODE_PRIVATE);
            String wert = topf.getString(SCHLUESSEL, null);
            return "sofort".equals(wert)
                || "1min".equals(wert)
                || "5min".equals(wert)
                || "15min".equals(wert);
        } catch (Exception e) {
            // Nicht lesbar -> wie 'aus' behandeln. Ein Absturz beim Start waere
            // ungleich schlimmer als ein fehlender Sichtschutz.
            return false;
        }
    }
}
