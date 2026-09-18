import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  SperrVerzoegerung,
  sperreLesen,
  sperreVerfuegbar,
  mussSperren,
  mussBeimStartSperren,
  laeuftAusflug
} from '../services/appSperre';

// ---------------------------------------------------------------------------
// Der Lebenszyklus der App-Sperre: Zeitstempel beim Wechsel in den Hintergrund,
// Vergleich beim Zurückkommen, Sperre beim Kaltstart.
//
// BEWUSST EIN EIGENER HOOK neben dem vorhandenen appStateChange-Listener in
// AppContext: Dieser hier muss SOFORT beim Start laufen und darf an nichts
// hängen, was noch lädt. Der Listener in AppContext hängt an [user] und wird
// bei jedem Nutzerwechsel ab- und neu angemeldet — die Sperre darf in genau
// diesem Fenster nicht blind sein. Zwei getrennte Listener auf dasselbe
// Ereignis sind in Capacitor unproblematisch.
// ---------------------------------------------------------------------------

export interface AppSperrZustand {
  /** true, solange der Sperrbildschirm die App verdecken muss. */
  gesperrt: boolean;
  /**
   * false, solange beim Start noch nicht feststeht, ob gesperrt werden muss.
   *
   * WOFUER: "Er flickert kurz, wenn
   * die App aus dem ganz aus Zustand kommt." Die Einstellung wird beim Start
   * ASYNCHRON gelesen — erst die Verfuegbarkeit der Biometrie ueber die
   * Capacitor-Bruecke, dann der gespeicherte Wert. Bis beides zurueck ist,
   * stand `gesperrt` auf false, und das heisst: Inhalt. Erst danach sprang der
   * Sperrbildschirm davor. Genau dieses Aufblitzen war zu sehen.
   *
   * DIE REGEL LAUTET DESHALB: Vor der ersten Antwort wird gar nicht erst
   * entschieden, sondern gewartet — dieselbe Ordnung wie beim Seitenbaum in
   * navigation/useSeitenBereit.ts ("warten oder rendern" faellt VOR dem
   * Rendern, nicht danach als Austausch).
   *
   * WARUM NICHT EINFACH `gesperrt` AUF true STARTEN: Das waere die andere
   * Fehlerrichtung. Die Sperre steht in der Voreinstellung auf 'aus' — die
   * grosse Mehrheit bekaeme beim Start einen Sperrbildschirm zu sehen, den sie
   * nie bestellt hat und der gleich darauf wieder verschwindet. Ein
   * Aufblitzen weniger, ein anderes dafuer. Deshalb ein eigener Zustand, der
   * nur sagt "noch nicht bekannt", und die Oberflaeche zeigt solange den
   * neutralen Ladebildschirm, den sie beim Kaltstart ohnehin zeigt.
   *
   * IM BROWSER GIBT ES NICHTS ZU KLAEREN: Ohne native Plattform kann die
   * Sperre nie greifen (sperreVerfuegbar() prueft das als Erstes). Der Wert
   * startet dort deshalb sofort auf true — kein Warten, wo nichts zu warten
   * ist.
   */
  startGeklaert: boolean;
  /**
   * true, solange die App im Hintergrund ist UND die Sperre eingeschaltet ist.
   *
   * WARUM DAS NICHT DASSELBE IST WIE `gesperrt`:
   * Im App-Umschalter war die App MIT INHALT zu sehen, obwohl
   * sie gesperrt war — Namen, Punkte und Beitraege lesbar, ohne die Sperre zu
   * ueberwinden.
   *
   * Der Grund ist die Reihenfolge: iOS macht die Momentaufnahme fuer den
   * Umschalter beim WEGWECHSELN (willResignActive). `gesperrt` wird aber erst
   * beim ZURUECKKOMMEN berechnet — da ist das Bild laengst gemacht. Eine
   * Abdeckung, die an `gesperrt` haengt, kommt also grundsaetzlich zu spaet.
   *
   * Deshalb dieser zweite Zustand: Er kippt im SELBEN Ereignis, das die
   * Momentaufnahme ausloest, und braucht dafuer keine Rechnung ueber
   * Wartezeiten — beim Wegwechseln steht noch gar nicht fest, ob die Rueckkehr
   * spaeter sperren wird. Verdeckt wird deshalb IMMER, sobald die Sperre
   * ueberhaupt eingeschaltet ist. Das ist die konservative Richtung: lieber
   * eine Abdeckung zu viel im Umschalter (dort sieht man ohnehin nur ein
   * Vorschaubild) als ein lesbares Bild zu wenig.
   */
  verdeckt: boolean;
  /** Vom Sperrbildschirm nach erfolgreicher Biometrie aufzurufen. */
  entsperren: () => void;
}

export const useAppSperre = (): AppSperrZustand => {
  const [gesperrt, setGesperrt] = useState(false);
  const [verdeckt, setVerdeckt] = useState(false);
  // Siehe AppSperrZustand.startGeklaert. Synchron beim ersten Rendern
  // entschieden, nicht in einem Effekt: Ein Effekt liefe erst NACH dem ersten
  // Rendern — und genau dieses eine Bild ist das Aufblitzen.
  const [startGeklaert, setStartGeklaert] = useState(() => !Capacitor.isNativePlatform());

  // Refs statt State: der appStateChange-Listener wird EINMAL angemeldet und
  // liest hier immer den aktuellen Stand. Als State im Dependency-Array müsste
  // der Listener bei jeder Änderung neu angemeldet werden — und genau dabei
  // gingen in dieser App schon Ereignisse verloren.
  const verzoegerungRef = useRef<SperrVerzoegerung>('aus');
  const hintergrundSeitRef = useRef<number | null>(null);

  // Einstellung laden und beim Kaltstart entscheiden.
  useEffect(() => {
    let abgemeldet = false;
    (async () => {
      try {
        // Erst Verfügbarkeit: wer die Biometrie am Gerät nachträglich entfernt
        // hat, darf nicht vor einem Sperrbildschirm stehen, den er nicht mehr
        // öffnen kann. Der Abmelden-Knopf wäre dann der einzige Weg — er ist da,
        // aber niemanden ohne Not dorthin zwingen.
        const verfuegbar = await sperreVerfuegbar();
        if (abgemeldet) return;
        if (!verfuegbar) {
          verzoegerungRef.current = 'aus';
          return;
        }

        const gelesen = await sperreLesen();
        if (abgemeldet) return;
        verzoegerungRef.current = gelesen;

        // Kaltstart: eingeschaltet heißt gesperrt, unabhängig von der Wartezeit.
        // Eine App, die frisch startet, war beliebig lange aus.
        if (mussBeimStartSperren(gelesen)) setGesperrt(true);
      } catch {
        // Kein Hard-Fail, dieselbe Linie wie in services/appSperre.ts und
        // services/biometrics.ts: Ohne verlaessliche Auskunft gilt 'aus'.
        // Ungefangen waere es eine unbehandelte Ablehnung im Start —
        // schlimmstenfalls eine Fehlerseite statt der App.
        verzoegerungRef.current = 'aus';
      } finally {
        // IN JEDEM AUSGANG, und deshalb in einem `finally`: Solange dieser
        // Merker nicht faellt, zeigt die App den Ladebildschirm. Bliebe er bei
        // einem geworfenen Fehler stehen, haette ein streikendes
        // Biometrie-Plugin die App dauerhaft unerreichbar gemacht — ein
        // Startproblem waere schlimmer als das Flackern, das hier behoben wird.
        // Nach dem Abmelden (abgemeldet) wird NICHT mehr gesetzt: die
        // Komponente ist weg, ein setState darauf ist nur Rauschen.
        if (!abgemeldet) setStartGeklaert(true);
      }
    })();
    return () => { abgemeldet = true; };
  }, []);

  // Die Einstellung kann sich im Profil ändern, während die App läuft. Ohne
  // dieses Ereignis griffe eine gerade eingeschaltete Sperre erst beim nächsten
  // Start — und eine gerade ausgeschaltete sperrte noch einmal.
  useEffect(() => {
    const hoeren = () => {
      sperreLesen().then((wert) => { verzoegerungRef.current = wert; });
    };
    window.addEventListener('app-sperre:geaendert', hoeren);
    return () => window.removeEventListener('app-sperre:geaendert', hoeren);
  }, []);

  useEffect(() => {
    let listener: PluginListenerHandle | null = null;
    let abgemeldet = false;

    (async () => {
      const angemeldet = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          // ABDECKUNG ZUERST — vor jeder anderen Entscheidung in diesem Zweig.
          //
          // Dieses Ereignis IST der Moment der Momentaufnahme: Das App-Plugin
          // meldet `isActive: false` auf UIApplication.willResignActiveNotification
          // (nachgesehen in @capacitor/app, ios/Sources/AppPlugin/AppPlugin.swift),
          // und genau dann friert iOS das Bild fuer den Umschalter ein. Was
          // hier nicht sofort passiert, ist im Vorschaubild nicht zu sehen.
          //
          // Deshalb steht das VOR der Ausflug-Pruefung: Auch waehrend eines
          // Systemdialogs (Foto, Teilen) kann der Umschalter aufgerufen werden,
          // und dann darf dort genauso wenig stehen. Der Ausflug-Merker regelt,
          // ob spaeter GESPERRT wird — nicht, ob jetzt verdeckt wird. Das sind
          // zwei verschiedene Fragen, und sie hier zu vermischen war der
          // Fehler.
          //
          // Nur bei eingeschalteter Sperre: Wer sie auf 'aus' stehen hat (die
          // Voreinstellung), darf ueberhaupt keine Verhaltensaenderung merken.
          if (verzoegerungRef.current !== 'aus') setVerdeckt(true);

          // Läuft gerade ein Systemdialog (Foto, Teilen, Face ID), wird KEIN
          // Zeitstempel gesetzt — ohne Zeitstempel kann beim Zurückkommen
          // nichts sperren, egal wie lange der Dialog offen steht.
          if (laeuftAusflug()) return;
          hintergrundSeitRef.current = Date.now();
          return;
        }

        if (mussSperren(verzoegerungRef.current, hintergrundSeitRef.current, Date.now())) {
          setGesperrt(true);
        }
        // Die Abdeckung faellt beim Zurueckkommen IMMER. Ist die Rueckkehr
        // sperrpflichtig, steht der Sperrbildschirm schon darunter und
        // uebernimmt; war es nur ein kurzer Abstecher, gibt sie die App wieder
        // frei. Bliebe sie stehen, haetten wir aus einem Sichtschutz eine
        // zweite, unbedienbare Sperre gemacht.
        setVerdeckt(false);
        // In jedem Fall zurücksetzen: ein verbrauchter Zeitstempel darf nicht
        // stehen bleiben und beim nächsten Wechsel ein zweites Mal zählen.
        hintergrundSeitRef.current = null;
      });
      if (abgemeldet) {
        angemeldet.remove();
        return;
      }
      listener = angemeldet;
    })();

    return () => {
      abgemeldet = true;
      listener?.remove();
    };
  }, []);

  const entsperren = useCallback(() => {
    hintergrundSeitRef.current = null;
    setGesperrt(false);
    // Auch die Abdeckung faellt. Nach erfolgreicher Biometrie darf nichts mehr
    // vor der App stehen — weder Sperrbildschirm noch Sichtschutz.
    setVerdeckt(false);
  }, []);

  return { gesperrt, startGeklaert, verdeckt, entsperren };
};

export default useAppSperre;
