import { useRef, useState } from 'react';
import { useIonViewDidEnter } from '@ionic/react';
import { Preferences } from '@capacitor/preferences';
import { ermittleAppVersion } from '../utils/appVersion';
import { entscheideNeuerungen } from '../utils/neuerungenGate';

// Version, auf die sich die aktuellen Neuerungs-Texte beziehen. Sie steuert
// NICHT mehr, wann der Hinweis erscheint -- das entscheidet seit 2.2.0 der
// Vergleich der laufenden App-Version gegen die zuletzt gesehene
// (utils/neuerungenGate.ts). Geblieben ist sie als EINE Stelle, an der
// steht, welchen Stand Banner und Walkthrough beschreiben; der Test
// walkthroughVersionEinheitlich.test.ts haengt daran.
//
// So werden kuenftige Neuerungen eingetragen:
// 1. Hier die Version hochsetzen (z.B. '2_3').
// 2. Texte der Banner und den Walkthrough der jeweiligen Rolle anpassen.
// Wann die Anzeige kommt, ergibt sich von selbst aus version.json.
export const NEUERUNGEN_VERSION = '2_2';

// Zuletzt GESEHENE Version, als 'major.minor' ('2.1'). Ein einziger,
// stabiler Schluessel -- er wandert nicht mehr mit jeder Version, sondern
// traegt den Stand als WERT. Nur so laesst sich ueberhaupt vergleichen
// (und eine Neuinstallation von einem Update unterscheiden).
export const NEUERUNGEN_GESEHEN_KEY = 'neuerungen_zuletzt_gesehen';

// Alter Schluessel aus 2.1.1 und davor. Er wird nur noch GELESEN, um
// Bestandsgeraete zu erkennen, die die 2.1-Karte schon weggeklickt haben:
// Steht er, gilt 2.1 als gesehen. Ohne diese Bruecke bekaeme beim Update auf
// 2.2.0 jedes Geraet den Hinweis -- das waere zwar richtig (2.1 -> 2.2 ist
// ein echter Sprung), aber der Merker soll trotzdem sauber starten.
export const UPDATE_WALKTHROUGH_KEY = 'update_walkthrough_2_1_gesehen';

// Fest auf '2_1' verdrahtet, NICHT an NEUERUNGEN_VERSION gehaengt: Der
// Mitmachen-Tab ist seit 2.0 derselbe, an ihm hat sich zu 2.2.0 nichts
// geaendert. Haenge man den Schluessel an die Versionskonstante, erschiene
// die gruene Karte bei jedem Release wieder -- bei Leuten, die den Tab
// laengst kennen und sie einmal weggeklickt haben.
export const MITMACHEN_HINWEIS_KEY = 'mitmachen_hinweis_2_1_gesehen';

// Zeigt eine Onboarding-Tour EINMAL pro Account (geraetelokal via Preferences).
// `keyPrefix` trennt die Rollen (z.B. 'admin_onboarding_seen'), `userId` macht
// den Marker accountspezifisch. Rueckgabe: [show, close] — `show` rendert das
// Tour-Overlay, `close` schließt es. Der Marker wird beim ERSTEN Anzeigen
// gesetzt (nicht erst beim Schliessen), damit die Tour nicht doppelt aufpoppt.
export function useOnboardingOnce(keyPrefix: string, userId?: number | string): [boolean, () => void] {
  const [show, setShow] = useState(false);
  const storageKey = `${keyPrefix}_${userId ?? 'x'}`;

  useIonViewDidEnter(() => {
    if (userId === undefined || userId === null) return;
    Preferences.get({ key: storageKey }).then(({ value }) => {
      if (!value) {
        Preferences.set({ key: storageKey, value: '1' });
        // Kleiner Versatz, damit die Seite erst sauber rendert.
        setTimeout(() => setShow(true), 400);
      }
    }).catch(() => { /* Preferences nicht verfuegbar -> Tour ueberspringen */ });
  });

  return [show, () => setShow(false)];
}

export interface OnboardingWithUpdate {
  // Normale Rollen-Tour (erster Start eines Accounts).
  showOnboarding: boolean;
  closeOnboarding: () => void;
  // Die Aenderungsanzeige, die sich nach einem Update VON SELBST meldet.
  // Genau einmal je Minor-Version (siehe utils/neuerungenGate.ts).
  showNeuerungen: boolean;
  // Weggeklickt: Anzeige zu, Version dauerhaft als gesehen vermerkt.
  schliesseNeuerungen: () => void;
  // Neuigkeiten-Karte auf der Startseite, NUR für Bestandsnutzer.
  showUpdateHinweis: boolean;
  // Markiert den Hinweis dauerhaft als gesehen (X gedrückt ODER Walkthrough
  // über die Karte geöffnet) und blendet die Karte aus.
  markUpdateHinweisGesehen: () => void;
  // Zweite Karte: Hinweis auf den Mitmachen-Tab (Events + Aktivitäten).
  // Unabhaengig vom Update-Hinweis, eigenes Flag, eigenes X.
  showMitmachenHinweis: boolean;
  markMitmachenHinweisGesehen: () => void;
}

// Entscheidet in EINEM Ablauf, was sich beim Betreten der Startseite meldet.
// Es meldet sich IMMER HOECHSTENS EINES — nie zwei Fenster uebereinander:
//
// - Onboarding-Flag fehlt -> Neuinstallation: volle Tour zeigen. Die aktuelle
//   Version wird dabei STILL als gesehen vermerkt, und beide Karten werden
//   abgehakt. Wer die App zum ersten Mal oeffnet, will loslegen und nicht
//   lesen, was sich gegenueber einer Version geaendert hat, die er nie hatte.
// - Onboarding-Flag gesetzt, laufende Minor-Version neuer als die zuletzt
//   gesehene -> Bestandsnutzer nach einem Update: die Aenderungsanzeige
//   oeffnet sich von selbst. Vermerkt wird erst beim Schliessen
//   (schliesseNeuerungen) — bricht der Start vorher ab, kommt sie wieder.
// - Sonst -> nichts von selbst. Erreichbar bleibt alles ueber die Karten und
//   dauerhaft ueber den "Was ist neu?"-Banner im Profil.
//
// Die Neuigkeiten-KARTEN (Startseite, wegklickbar) haengen weiter an ihren
// eigenen Flags und sind bewusst NICHT an die Anzeige gekoppelt: Sie sind der
// dauerhafte Weg zurueck, die Anzeige der einmalige Weg hin. Solange die
// Anzeige offen ist, bleibt die Update-Karte weg — sonst stuende hinter dem
// Fenster schon die Karte, die auf dasselbe zeigt.
//
// Alles wird in EINEM Promise.all gelesen, damit sich Lese-/Schreibzugriffe
// der Entscheidungen nicht ueberholen.
export function useOnboardingWithUpdateOnce(
  onboardingKeyPrefix: string,
  userId?: number | string
): OnboardingWithUpdate {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showNeuerungen, setShowNeuerungen] = useState(false);
  const [showUpdateHinweis, setShowUpdateHinweis] = useState(false);
  const [showMitmachenHinweis, setShowMitmachenHinweis] = useState(false);
  // Die Version, die beim Schliessen der Anzeige vermerkt wird. Steht erst
  // fest, wenn App.getInfo() geantwortet hat.
  const [zuMerkendeVersion, setZuMerkendeVersion] = useState<string | null>(null);
  // Diese Sitzung hat die Anzeige schon behandelt (gezeigt oder geschlossen).
  //
  // Der Ref ueberlebt Neu-Renderings, aber nicht den App-Neustart -- genau
  // richtig: Bleibt der Merker wegen eines Schreibfehlers aus, kommt die Anzeige
  // beim naechsten Start wieder, innerhalb dieser Sitzung aber nicht.
  const anzeigeBehandelt = useRef(false);
  const onboardingKey = `${onboardingKeyPrefix}_${userId ?? 'x'}`;
  const updateKey = `${UPDATE_WALKTHROUGH_KEY}_${userId ?? 'x'}`;
  const mitmachenKey = `${MITMACHEN_HINWEIS_KEY}_${userId ?? 'x'}`;
  const gesehenKey = `${NEUERUNGEN_GESEHEN_KEY}_${userId ?? 'x'}`;

  useIonViewDidEnter(() => {
    if (userId === undefined || userId === null) return;
    Promise.all([
      Preferences.get({ key: onboardingKey }),
      Preferences.get({ key: updateKey }),
      Preferences.get({ key: mitmachenKey }),
      Preferences.get({ key: gesehenKey }),
      ermittleAppVersion()
    ]).then(([onboarding, update, mitmachen, gesehen, version]) => {
      const istNeuinstallation = !onboarding.value;

      // Bruecke von 2.1.1 und davor: Es gibt noch keinen Merker, aber das
      // alte Update-Flag steht. Dann hat dieses Geraet die 2.1-Neuerungen
      // gesehen -- das ist der Stand, gegen den verglichen wird.
      const zuletztGesehen = gesehen.value ?? (update.value ? '2.1' : null);

      const entscheidung = entscheideNeuerungen(version, zuletztGesehen, istNeuinstallation);

      if (istNeuinstallation) {
        // Frischer Account: die Tour erklaert alles, keine Karten noetig --
        // und die laufende Version gilt still als gesehen.
        Preferences.set({ key: onboardingKey, value: '1' });
        Preferences.set({ key: updateKey, value: '1' });
        Preferences.set({ key: mitmachenKey, value: '1' });
        if (entscheidung.merkeVersion) {
          Preferences.set({ key: gesehenKey, value: entscheidung.merkeVersion });
        }
        setTimeout(() => setShowOnboarding(true), 400);
        return;
      }

      if (entscheidung.art === 'zeigen') {
        // Bestandsnutzer nach einem Update: die Anzeige oeffnet sich selbst --
        // aber nur EINMAL je Sitzung. Beim erneuten Betreten der Seite steht
        // der Merker im Speicher vielleicht noch nicht (er wird asynchron
        // geschrieben), der Ref aber schon: Dann passiert hier nichts mehr,
        // weder Anzeige noch Karte. Wer sie gerade gelesen hat, braucht beides
        // nicht noch einmal.
        if (!anzeigeBehandelt.current) {
          anzeigeBehandelt.current = true;
          // Vermerkt wird erst beim Schliessen; bis dahin nur merken, WAS zu
          // vermerken waere. Die Update-Karte bleibt solange weg (siehe unten).
          setZuMerkendeVersion(entscheidung.merkeVersion);
          // Kleiner Versatz wie bei der Tour, damit die Seite erst rendert.
          setTimeout(() => setShowNeuerungen(true), 400);
        }
      } else {
        // Nichts Neues: die Karten wie bisher unabhaengig voneinander zeigen.
        // Flags werden NICHT gesetzt — erst eine bewusste Aktion (X oder
        // Öffnen) markiert den jeweiligen Hinweis als gesehen.
        if (!update.value) setShowUpdateHinweis(true);
      }
      if (!mitmachen.value) setShowMitmachenHinweis(true);
    }).catch(() => { /* Preferences nicht verfuegbar -> Hinweise ueberspringen */ });
  });

  return {
    showOnboarding,
    closeOnboarding: () => setShowOnboarding(false),
    showNeuerungen,
    schliesseNeuerungen: () => {
      setShowNeuerungen(false);
      // Auch wenn der Merker gleich nicht geschrieben werden kann: In DIESER
      // Sitzung ist die Anzeige erledigt, sie darf beim naechsten Betreten der
      // Seite nicht wieder aufgehen.
      anzeigeBehandelt.current = true;
      // Dieselbe Version darf nicht wiederkommen -- auch nicht nach einem
      // App-Neustart. Zusaetzlich gilt die Update-Karte als erledigt: Wer
      // die Anzeige gerade gelesen hat, braucht daneben keinen Hinweis
      // darauf, dass es Neuerungen gibt.
      if (zuMerkendeVersion) {
        Preferences.set({ key: gesehenKey, value: zuMerkendeVersion })
          .catch(() => { /* Preferences nicht verfuegbar -> beim naechsten Start erneut */ });
      }
      Preferences.set({ key: updateKey, value: '1' })
        .catch(() => { /* s.o. */ });
    },
    showUpdateHinweis,
    markUpdateHinweisGesehen: () => {
      setShowUpdateHinweis(false);
      Preferences.set({ key: updateKey, value: '1' })
        .catch(() => { /* Preferences nicht verfuegbar -> beim naechsten Start erneut */ });
    },
    showMitmachenHinweis,
    markMitmachenHinweisGesehen: () => {
      setShowMitmachenHinweis(false);
      Preferences.set({ key: mitmachenKey, value: '1' })
        .catch(() => { /* Preferences nicht verfuegbar -> beim naechsten Start erneut */ });
    }
  };
}
