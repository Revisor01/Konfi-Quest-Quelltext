package de.godsapp.konfiquest;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bruecke zur Zahl am App-Symbol fuer die offene App.
 *
 * Auf Android ruft BadgeContext hierueber statt ueber das Badge-Plugin
 * (frontend/src/services/appSymbolZahl.ts), damit offene und geschlossene
 * App dieselbe Stelle benutzen: AppSymbolZahl. art() liefert den Weg und den
 * Startbildschirm fuer die Token-Anmeldung.
 *
 * Angemeldet in MainActivity (registerPlugin). Die keep-Regeln fuer
 * Capacitor-Plugins in proguard-rules.pro greifen auch hier: Klasse mit
 * CapacitorPlugin-Annotation, Methoden mit PluginMethod.
 */
@CapacitorPlugin(name = "AppSymbolZahl")
public class AppSymbolZahlPlugin extends Plugin {

    @PluginMethod
    public void art(PluginCall call) {
        try {
            JSObject antwort = new JSObject();
            antwort.put("weg", AppSymbolZahl.weg(getContext()));
            String start = AppSymbolZahl.startbildschirm(getContext());
            if (start != null) antwort.put("startbildschirm", start);
            call.resolve(antwort);
        } catch (Exception fehler) {
            call.reject("Startbildschirm nicht bestimmbar", fehler);
        }
    }

    @PluginMethod
    public void setzen(PluginCall call) {
        Integer zahl = call.getInt("zahl");
        if (zahl == null || zahl < 0) {
            call.reject("zahl fehlt oder ist negativ");
            return;
        }
        try {
            AppSymbolZahl.setzen(getContext(), zahl);
            call.resolve();
        } catch (Exception fehler) {
            call.reject("Zahl am App-Symbol nicht gesetzt", fehler);
        }
    }
}
