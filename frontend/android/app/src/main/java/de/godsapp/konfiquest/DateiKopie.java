package de.godsapp.konfiquest;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * Das reine Java hinter DateiAuswahlChromeClient: welche Datei kopiert wird,
 * unter welchem Namen, wie weit hoechstens, und was wieder weg darf
 * Ohne Android-Klassen, damit es sich ohne Geraet pruefen laesst
 * (src/test/.../DateiKopieTest.java).
 */
final class DateiKopie {

    /**
     * Groesser wird nicht kopiert -- die Auswahl geht dann unveraendert weiter,
     * und die App meldet "zu gross" wie bisher (Material 20 MB, Chat 5 MB,
     * services/mediaCompression.ts). Etwas Luft darueber, damit die Meldung
     * dort entsteht und nicht hier still.
     */
    static final long HOECHSTENS_BYTES = 25L * 1024 * 1024;

    /**
     * So lange bleibt eine Kopie liegen. Eine gewaehlte, noch nicht gesendete
     * Datei (Material mit mehreren Dateien, ein liegengelassener Chat-Entwurf)
     * muss so lange lesbar bleiben. Was in die Warteschlange geht, sichert die
     * App ohnehin selbst (services/warteschlangenDatei.ts).
     */
    static final long AUFBEWAHREN_MS = 3L * 24 * 60 * 60 * 1000;

    /** Laengster Dateiname in Zeichen; Umlaute zaehlen in UTF-8 doppelt, 255 Byte ist die Grenze. */
    static final int NAME_HOECHSTENS = 100;

    /** Name, wenn der Anbieter keinen nennt. */
    static final String NAME_OHNE_ANGABE = "Datei";

    private DateiKopie() {}

    /**
     * Wird eine Datei dieses Typs kopiert? Bilder und Videos nicht: Die gingen
     * vom Handy durch (Fotos verkleinert die App ohnehin im Speicher), und
     * Videos koennen gross sein. Alles andere ja -- auch ohne Typangabe.
     */
    static boolean sollKopieren(String typ) {
        if (typ == null) return true;
        String t = typ.toLowerCase(Locale.ROOT);
        return !(t.startsWith("image/") || t.startsWith("video/"));
    }

    /**
     * Der Dateiname der Kopie. Die App zeigt ihn an und bestimmt daraus den
     * Typ, falls das Geraet keinen nennt (utils/dateiTypen.ts) -- er bleibt
     * deshalb so nah am Original wie moeglich. Entfernt wird nur, was im
     * Dateisystem nicht geht (Pfadzeichen, Steuerzeichen, "." und "..").
     * Fehlt eine Endung und ist sie aus dem Typ bekannt, kommt sie dazu.
     *
     * @param anzeigename Name laut Anbieter (OpenableColumns.DISPLAY_NAME), darf null sein
     * @param endung      Endung laut Typ (MimeTypeMap), ohne Punkt, darf null sein
     */
    static String dateiname(String anzeigename, String endung) {
        String name = anzeigename == null ? "" : anzeigename;
        StringBuilder sauber = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char z = name.charAt(i);
            boolean verboten = z < 0x20 || z == 0x7f || "/\\:*?\"<>|".indexOf(z) >= 0;
            sauber.append(verboten ? '_' : z);
        }
        name = sauber.toString().trim();
        while (name.startsWith(".")) name = name.substring(1);
        if (name.isEmpty()) name = NAME_OHNE_ANGABE;

        String sauberEndung = endung == null ? "" : endung.replaceAll("[^A-Za-z0-9]", "");
        if (!sauberEndung.isEmpty() && name.lastIndexOf('.') < 1) {
            name = name + "." + sauberEndung.toLowerCase(Locale.ROOT);
        }

        if (name.length() > NAME_HOECHSTENS) {
            int punkt = name.lastIndexOf('.');
            String hinten = punkt > 0 && name.length() - punkt <= 10 ? name.substring(punkt) : "";
            name = name.substring(0, NAME_HOECHSTENS - hinten.length()) + hinten;
        }
        return name;
    }

    /**
     * Kopiert hoechstens {@code hoechstens} Bytes nach {@code ziel}. Ist die
     * Quelle groesser, wird das Ziel wieder geloescht und false geliefert.
     */
    static boolean kopieren(InputStream quelle, File ziel, long hoechstens) throws IOException {
        long gesamt = 0;
        byte[] puffer = new byte[64 * 1024];
        try (OutputStream aus = new FileOutputStream(ziel)) {
            int gelesen;
            while ((gelesen = quelle.read(puffer)) != -1) {
                gesamt += gelesen;
                if (gesamt > hoechstens) break;
                aus.write(puffer, 0, gelesen);
            }
        } catch (IOException fehler) {
            //noinspection ResultOfMethodCallIgnored
            ziel.delete();
            throw fehler;
        }
        if (gesamt > hoechstens) {
            //noinspection ResultOfMethodCallIgnored
            ziel.delete();
            return false;
        }
        return true;
    }

    /** Entfernt in {@code wurzel} jeden Eintrag, der aelter als {@code alterMs} ist. */
    static void aufraeumen(File wurzel, long jetzt, long alterMs) {
        File[] eintraege = wurzel.listFiles();
        if (eintraege == null) return;
        for (File eintrag : eintraege) {
            if (jetzt - eintrag.lastModified() > alterMs) loeschen(eintrag);
        }
    }

    /** Loescht eine Datei oder einen Ordner samt Inhalt. */
    static void loeschen(File eintrag) {
        File[] kinder = eintrag.listFiles();
        if (kinder != null) {
            for (File kind : kinder) loeschen(kind);
        }
        //noinspection ResultOfMethodCallIgnored
        eintrag.delete();
    }
}
