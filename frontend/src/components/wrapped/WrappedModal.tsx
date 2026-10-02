import React, { useState, useEffect, useCallback, useRef } from 'react';
import { IonIcon, IonSpinner, IonToast } from '@ionic/react';
import { ICON_SCHLIESSEN, ICON_TEILEN, ICON_WARNHINWEIS } from '../shared/icons';
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCreative } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import api from '../../services/api';
import type { KonfiWrappedData, TeamerWrappedData, WrappedResponse } from '../../types/wrapped';
import IntroSlide from './slides/IntroSlide';
import PunkteSlide from './slides/PunkteSlide';
import EventsSlide from './slides/EventsSlide';
import BadgesSlide from './slides/BadgesSlide';
import AktivsterMonatSlide from './slides/AktivsterMonatSlide';
import ChallengeMomenteSlide from './slides/ChallengeMomenteSlide';
import ChallengesSlide from './slides/ChallengesSlide';
import WartelisteSlide from './slides/WartelisteSlide';
import LangerAtemSlide from './slides/LangerAtemSlide';
import WochentagSlide from './slides/WochentagSlide';
import VielseitigSlide from './slides/VielseitigSlide';
import HighlightSlide, { rendertHighlightSlide } from './slides/HighlightSlide';
import EndspurtSlide from './slides/EndspurtSlide';
import KategorieSlide from './slides/KategorieSlide';
import UeberDasZielSlide from './slides/UeberDasZielSlide';
import AbschlussSlide from './slides/AbschlussSlide';
import KonfirmationsSlide from './slides/KonfirmationsSlide';
import KategorieSeiteSlide from './slides/KategorieSeiteSlide';
import WerdeTeamerSlide from './slides/WerdeTeamerSlide';
import WeiterSoSlide from './slides/WeiterSoSlide';
import Stavanger2026Slide from './slides/Stavanger2026Slide';
import SeltenstesAbzeichenSlide from './slides/SeltenstesAbzeichenSlide';
import TeamerIntroSlide from './slides/teamer/TeamerIntroSlide';
import TeamerChallengesSlide from './slides/teamer/TeamerChallengesSlide';
import TeamerSegenSlide from './slides/teamer/TeamerSegenSlide';
import TeamerSegenAbschlussSlide from './slides/teamer/TeamerSegenAbschlussSlide';
import TeamerEventsSlide from './slides/teamer/TeamerEventsSlide';
import TeamerKonfisSlide from './slides/teamer/TeamerKonfisSlide';
import TeamerBadgesSlide from './slides/teamer/TeamerBadgesSlide';
import TeamerZertifikateSlide from './slides/teamer/TeamerZertifikateSlide';
import TeamerJahreSlide from './slides/teamer/TeamerJahreSlide';
import TeamerTeamSlide from './slides/teamer/TeamerTeamSlide';
import TeamerNeuDabeiSlide from './slides/teamer/TeamerNeuDabeiSlide';
import TeamerAnfangSlide from './slides/teamer/TeamerAnfangSlide';
import TeamerAntwortenSlide from './slides/teamer/TeamerAntwortenSlide';
import TeamerKonfiZeitSlide from './slides/teamer/TeamerKonfiZeitSlide';
import TeamerAbschlussSlide from './slides/teamer/TeamerAbschlussSlide';
import { MotivKontext } from './MotivKontext';
import { verteileMotive } from './hintergrundbilder';
import ShareCard from './share/ShareCard';
import { shareSlide } from './share/shareUtils';
import type { ShareTextData } from './share/shareUtils';
import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/effect-creative';
import './WrappedModal.css';
import './share/ShareCard.css';
import { punkteText } from '../../utils/punkteText';

interface WrappedModalProps {
  onClose: () => void;
  displayName: string;
  jahrgangName?: string;
  wrappedType?: 'konfi' | 'teamer';
  // Für Wiederansicht — wenn gesetzt, wird NICHT /api/wrapped/me geladen
  initialData?: KonfiWrappedData | TeamerWrappedData;
  initialYear?: number;
  /** Name der Ausgabe -- steht auf der ersten Seite. */
  initialTitel?: string | null;
}

// Formulierungs-Varianten pro Slide-Typ, Auswahl per seed
const FORMULIERUNGEN: Record<string, string[]> = {
  punkte_titel: [
    'Deine Punkte',
    'So viel geschafft!',
    'Punkte-Bilanz',
    'Dein Punktestand'
  ],
  events_titel: [
    'Deine Events',
    'Dabei gewesen!',
    'Mittendrin!',
    'Event-Bilanz'
  ],
  badges_titel: [
    'Deine Badges',
    'Ausgezeichnet!',
    'Badge-Sammlung',
    'Verdient!'
  ],
  aktivster_monat_titel: [
    'Dein aktivster Monat',
    'Hochphase!',
    'Voll dabei!',
    'Dein Top-Monat'
  ],
  kategorie_titel: [
    'Dein Bereich',
    'Deine Stärke',
    'Das liegt dir!',
    'Dein Schwerpunkt'
  ],
  abschluss_titel: [
    'Dein Konfi-Jahr',
    'Was für ein Jahr!',
    'Starke Leistung!',
    'Dein Rückblick'
  ]
};

function getFormulierung(key: string, seed: number): string {
  const variants = FORMULIERUNGEN[key];
  if (!variants || variants.length === 0) return key;
  return variants[seed % variants.length];
}

/**
 * Der Konfirmationstermin eines Konfi-Snapshots.
 *
 * Alt-Snapshots (ohne das Feld) fallen weiterhin auf `ende` zurueck, damit
 * bereits erzeugte Rueckblicke unveraendert aussehen.
 */
const konfirmationsTermin = (data: KonfiWrappedData): string | null => {
  const z = data.slides.zeitraum;
  if (!z) return null;
  if ('konfirmation' in z) return z.konfirmation || null;
  return z.ende || null;
};

const WrappedModal: React.FC<WrappedModalProps> = ({ onClose, displayName, jahrgangName, wrappedType: initialType, initialData, initialYear }) => {
  const [data, setData] = useState<KonfiWrappedData | TeamerWrappedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [year, setYear] = useState<number | null>(null);
  const [wrappedType, setWrappedType] = useState<'konfi' | 'teamer'>(initialType || 'konfi');
  const [isSharing, setIsSharing] = useState(false);
  const [teilenHinweis, setTeilenHinweis] = useState<string | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Wiederansicht: gespeicherte Daten direkt verwenden
    if (initialData && initialYear) {
      setData(initialData);
      setYear(initialYear);
      if (initialType) setWrappedType(initialType);
      return;
    }
    api.get('/wrapped/me')
      .then((res) => {
        const response = res.data as WrappedResponse;
        setData(response.data);
        setYear(response.year);
        setWrappedType(response.wrapped_type);
      })
      .catch((err) => {
        if (err.response?.status === 404) {
          setError('Dein Wrapped wird bald freigeschaltet');
        } else {
          setError('Fehler beim Laden');
        }
      });
  }, []);

  const handleSlideChange = useCallback((swiper: SwiperType) => {
    setActiveIndex(swiper.activeIndex);
  }, []);

  // Text-Fallback-Daten pro Slide zusammenbauen
  const getSlideTextData = (slideKey: string): ShareTextData => {
    const slideYear = year || new Date().getFullYear();
    const base: ShareTextData = { wrappedType, displayName, year: slideYear, slideKey };

    if (!data) return base;

    if (wrappedType === 'konfi') {
      const k = data as KonfiWrappedData;
      switch (slideKey) {
        case 'punkte': return { ...base, slideValue: `${punkteText(k.slides.punkte.total)} gesammelt` };
        case 'events': return { ...base, slideValue: `${k.slides.events.total_attended} Events besucht` };
        case 'badges': return { ...base, slideValue: `${k.slides.badges.total_earned} Badges verdient` };
        case 'aktivster-monat': return { ...base, slideValue: `Aktivster Monat: ${k.slides.aktivster_monat.monat_name}` };
        case 'warteliste': return { ...base, slideValue: `${k.slides.warteliste?.nachgerueckt || 0} Mal nachgerückt` };
        case 'langer-atem': return { ...base, slideValue: `${k.slides.langer_atem?.tage || 0} Tage lang dabei` };
        case 'wochentag': return { ...base, slideValue: `Mein Tag: ${k.slides.wochentag?.name || ''}` };
        case 'vielseitig': return { ...base, slideValue: `Auf ${k.slides.medienarten?.length || 0} Arten geantwortet` };
        case 'challenge-momente': return { ...base, slideValue: 'Meine Challenge-Momente' };
        // Die 14 ist fester Text, keine gerechnete Zahl -- siehe
        // Stavanger2026Slide.
        case 'stavanger-2026': return { ...base, slideValue: '14 unvergessliche Tage in Himmel og Hav' };
        case 'challenges': {
          // Die Zahl vorher herausziehen: Der Feldname `beitraege` ist eine
          // Schnittstelle und bleibt ohne Umlaut -- im angezeigten Satz
          // hat er nichts verloren.
          const anzahl = k.slides.challenges?.beitraege || 0;
          return { ...base, slideValue: `${anzahl} Mal bei Challenges mitgemacht` };
        }
        case 'highlight': {
          const h = k.slides.highlight;
          const highlightTexte: Record<string, string> = {
            chat_star: `${h?.wert || 0} Chat-Nachrichten geschrieben`,
            reaktions_magnet: `${h?.wert || 0} Reaktionen bekommen`,
            challenge_fan: `${h?.wert || 0} Challenge-Beiträge eingereicht`,
            verlaesslich: 'Nie abgesagt — auf mich war Verlass',
          };
          return { ...base, slideValue: highlightTexte[h?.type || ''] || 'Mein Highlight' };
        }
        case 'endspurt': return { ...base, slideValue: `Noch ${punkteText(k.slides.endspurt.fehlende_punkte)} bis zum Ziel` };
        case 'kategorie': return { ...base, slideValue: `Dein Bereich: ${k.slides.kategorie?.top_kategorie || '-'}` };
        case 'konfirmation': return { ...base, slideValue: `Konfirmation: ${konfirmationsTermin(k) || ''}` };
        case 'ueber-das-ziel': return { ...base, slideValue: `${punkteText(k.slides.endspurt.aktuell_total - k.slides.endspurt.ziel_total)} über dem Ziel!` };
        case 'abschluss': return { ...base, slideValue: `${punkteText(k.slides.punkte.total)}, ${k.slides.events.total_attended} Events, ${k.slides.badges.total_earned} Badges` };
        default: return base;
      }
    } else {
      const t = data as TeamerWrappedData;
      switch (slideKey) {
        case 'teamer-events': return { ...base, slideValue: `${t.slides.events_geleitet.total} Events geleitet` };
        case 'teamer-konfis': return { ...base, slideValue: `${t.slides.konfis_betreut.total_konfis} Konfis betreut` };
        case 'teamer-badges': return { ...base, slideValue: `${t.slides.badges.total_earned} Badges verdient` };
        case 'teamer-zertifikate': return { ...base, slideValue: `${t.slides.zertifikate.total} Zertifikate erhalten` };
        case 'teamer-jahre': return { ...base, slideValue: `${t.slides.engagement.jahre_aktiv} Jahre als Teamer:in` };
        case 'teamer-team': return { ...base, slideValue: `Mit ${t.slides.team?.mitstreitende || 0} anderen im Team` };
        case 'teamer-neu-dabei': return { ...base, slideValue: 'Mein erstes Jahr im Team' };
        case 'teamer-anfang': return { ...base, slideValue: `Erstes Event: ${t.slides.anfang?.name || ''}` };
        case 'teamer-antworten': return { ...base, slideValue: `${t.slides.chat?.antworten || 0} Mal geantwortet` };
        case 'teamer-konfi-zeit': return { ...base, slideValue: 'Selbst mal Konfi gewesen — heute im Team' };
        case 'stavanger-2026': return { ...base, slideValue: '14 unvergessliche Tage in Himmel og Hav' };
        case 'teamer-abschluss': return { ...base, slideValue: `${t.slides.events_geleitet.total} Events, ${t.slides.konfis_betreut.total_konfis} Konfis, ${t.slides.badges.total_earned} Badges` };
        default: return base;
      }
    }
  };

  // Konfi-Slides aufbauen.
  //
  // Ab Snapshot-Version 2 gibt es eine FESTE Reihenfolge (Challenge-Momente statt
  // Highlight-Slot). Für aeltere Snapshots (Version 1 aus der History) bleibt die
  // bisherige highlight_type-Logik als Fallback erhalten — allerdings ohne die
  // entfernten Slides rank/chat/pflicht. Alte JSONB-Felder dieser Slides werden
  // dabei einfach ignoriert und fuehren zu keinem Fehler.
  const buildKonfiSlides = (konfiData: KonfiWrappedData, slideYear: number) => {
    const slideKeys: Array<{ key: string; render: (isActive: boolean) => React.ReactNode }> = [];

    // Wie viel Inhalt steckt hinter einer Kategorie-/Datums-Seite?
    // Fuer 'kategorie:freizeit' die Zahl aus der Verteilung, fuer
    // 'datum:advent' die Zahl der Termine in diesem Fenster.
    const kategorieZahl = (kachel: string) => {
      const verteilung = konfiData.slides.kategorie?.verteilung || [];
      if (kachel.startsWith('datum:')) {
        const fenster = (konfiData.slides as { datums_fenster?: Record<string, number> }).datums_fenster || {};
        return fenster[kachel.slice('datum:'.length)] || 0;
      }
      if (kachel === 'kategorie-allgemein') {
        return verteilung[0]?.count || 0;
      }
      // Der Schluessel traegt den Seitennamen, die Verteilung den echten
      // Kategorienamen -- die Zuordnung hat das Backend schon gemacht,
      // hier zaehlen wir nur zusammen, was auf dieselbe Seite zeigt.
      // `seite` liefert das Backend mit (wrapped.js) -- die Zuordnung
      // Name -> Seite wird bewusst NICHT hier nachgebaut.
      const treffer = verteilung.filter(v => (v as { seite?: string | null }).seite === kachel);
      return treffer.reduce((n, v) => n + (v.count || 0), 0);
    };
    const kategorieTermine = (kachel: string) => {
      const verteilung = konfiData.slides.kategorie?.verteilung || [];
      return verteilung
        .filter(v => (v as { seite?: string }).seite === kachel)
        .reduce((n, v) => n + ((v as { aus_terminen?: number }).aus_terminen || 0), 0);
    };
    const highlightType = konfiData.highlight_type || 'events_held';
    const seed = konfiData.formulierung_seed || 0;
    const version = konfiData.version || 1;

    // Beide Werte kommen aus dem SNAPSHOT, nicht aus der Uhr: `ende` ist der
    // Tag, an dem der Rueckblick erzeugt wurde. Ein im Mai erzeugter
    // Zwischenstand traegt seinen Nachsatz auch dann noch, wenn man ihn im
    // November wieder oeffnet. `konfirmation` fehlt bei Snapshots vor
    // Version 2.1 -- dann steht schlicht "Deine Konfi-Zeit" da.
    const konfiZeitraum = konfiData.slides.zeitraum;
    const konfiKonfirmation = konfiZeitraum && 'konfirmation' in konfiZeitraum
      ? (konfiZeitraum.konfirmation || null)
      : null;
    const konfiStand = konfiZeitraum?.ende || null;

    // Alle moeglichen Slide-Renderer
    const renderers: Record<string, (isActive: boolean) => React.ReactNode> = {
      'intro': (a) => <IntroSlide isActive={a} displayName={displayName} jahrgangName={jahrgangName || ''} year={slideYear} konfirmation={konfiKonfirmation} stand={konfiStand} ausgabeTitel={konfiData.titel} />,
      'highlight': (a) => <HighlightSlide isActive={a} data={konfiData} />,
      'challenge-momente': (a) => <ChallengeMomenteSlide isActive={a} momente={konfiData.slides.challenge_momente || []} />,
      'challenges': (a) => (
        konfiData.slides.challenges
          ? <ChallengesSlide isActive={a} challenges={konfiData.slides.challenges} />
          : null
      ),
      'punkte': (a) => <PunkteSlide isActive={a} punkte={konfiData.slides.punkte} />,
      'events': (a) => <EventsSlide isActive={a} events={konfiData.slides.events} />,
      'badges': (a) => <BadgesSlide isActive={a} badges={konfiData.slides.badges} />,
      'kategorie': (a) => <KategorieSlide isActive={a} kategorie={konfiData.slides.kategorie} titel={getFormulierung('kategorie_titel', seed)} />,
      'aktivster-monat': (a) => <AktivsterMonatSlide isActive={a} aktivsterMonat={konfiData.slides.aktivster_monat} />,
      'warteliste': (a) => (
        konfiData.slides.warteliste
          ? <WartelisteSlide isActive={a} warteliste={konfiData.slides.warteliste} />
          : null
      ),
      'langer-atem': (a) => (
        konfiData.slides.langer_atem
          ? <LangerAtemSlide isActive={a} langerAtem={konfiData.slides.langer_atem} />
          : null
      ),
      'wochentag': (a) => (
        konfiData.slides.wochentag
          ? <WochentagSlide isActive={a} wochentag={konfiData.slides.wochentag} />
          : null
      ),
      'vielseitig': (a) => (
        (konfiData.slides.medienarten?.length || 0) > 0
          ? <VielseitigSlide isActive={a} medienarten={konfiData.slides.medienarten as string[]} />
          : null
      ),
      'endspurt': (a) => <EndspurtSlide isActive={a} endspurt={konfiData.slides.endspurt} />,
      'ueber-das-ziel': (a) => <UeberDasZielSlide isActive={a} endspurt={konfiData.slides.endspurt} />,
      'konfirmation': (a) => <KonfirmationsSlide isActive={a} zeitraumEnde={konfirmationsTermin(konfiData) || ''} />,
      'abschluss': (a) => <AbschlussSlide isActive={a} data={konfiData} year={slideYear} konfirmation={konfiKonfirmation} />,
      'werde-teamer': (a) => <WerdeTeamerSlide isActive={a} />,
      // Das Gegenstueck waehrend der Konfizeit. Das Backend
      // liefert immer nur EINE der beiden Kacheln.
      'weiter-so': (a) => <WeiterSoSlide isActive={a} endspurt={konfiData.slides.endspurt} />,
      // Die Sonderseite zur Sommerfreizeit 2026 (Stavanger). Der Schluessel
      // traegt BEWUSST KEIN 'kategorie:'- oder 'datum:'-Praefix: Der
      // ausgelieferte Build 176 behandelt diese beiden Praefixe als MUSTER
      // und schiebt jeden so beginnenden Schluessel in die Seitenliste --
      // auch einen, den er nicht kennt. Dort faende KategorieSeiteSlide
      // keinen Text, gaebe null zurueck, und im Rueckblick staende eine
      // leere weisse Seite. Ohne Praefix faellt der Schluessel dort sauber
      // durch `if (renderers[kachel])` und verschwindet spurlos.
      'stavanger-2026': (a) => <Stavanger2026Slide isActive={a} />,
      'seltenstes': (a) => {
        const selt = (konfiData.slides.badges as { seltenstes?: { name: string; icon: string; color: string; haben_es: number; konfis: number; prozent: number } })?.seltenstes;
        return selt ? <SeltenstesAbzeichenSlide isActive={a} abzeichen={selt} /> : null;
      },
    };

    const kachelListe = (konfiData as { kacheln?: string[] }).kacheln;

    const shown = new Set<string>();

    const addSlide = (key: string) => {
      if (shown.has(key)) return;
      shown.add(key);
      slideKeys.push({ key, render: renderers[key] });
    };

    const maybeAdd = (key: string) => addSlide(key);

    const endspurt = konfiData.slides.endspurt;
    const hatKategorien = (konfiData.slides.kategorie?.verteilung?.length || 0) > 0;
    const hatKonfirmation = !!konfirmationsTermin(konfiData);

    if (Array.isArray(kachelListe) && kachelListe.length > 0) {
      // --- Ab Version 3: das Backend bestimmt die Seiten ---
      for (const kachel of kachelListe) {
        if (kachel.startsWith('kategorie:') || kachel.startsWith('datum:') || kachel === 'kategorie-allgemein') {
          const anzahl = kategorieZahl(kachel);
          if (anzahl <= 0) continue; // Eine Seite mit einer Null ist keine Erinnerung.
          if (shown.has(kachel)) continue;
          shown.add(kachel);
          slideKeys.push({
            key: kachel,
            render: (a: boolean) => (
              <KategorieSeiteSlide isActive={a} kachel={kachel} anzahl={anzahl} ausTerminen={kategorieTermine(kachel)} />
            )
          });
          continue;
        }
        if (renderers[kachel]) addSlide(kachel);
      }
    } else if (version >= 2) {
      // --- Version 2: feste Reihenfolge ---
      addSlide('intro');

      // Persoenliches Highlight (ab Version 3): Direkt nach dem Intro kommt
      // die Seite, die DIESE Person besonders macht -- aber nur fuer die
      // neuen Typen (chat_star, reaktions_magnet, challenge_fan,
      // verlaesslich). Die klassischen Typen haben ihre eigenen Slides
      // weiter unten; sie hier zu doppeln braechte nichts Neues.
      // Version-2-Snapshots ohne highlight-Feld ueberspringen die Seite.
      if (rendertHighlightSlide(konfiData)) {
        addSlide('highlight');
      }

      // Challenge-Momente nur, wenn der Konfi tatsaechlich etwas beigetragen hat.
      if ((konfiData.slides.challenge_momente?.length || 0) > 0) {
        addSlide('challenge-momente');
      }

      addSlide('events');

      if (hatKategorien) {
        addSlide('kategorie');
      }

      addSlide('aktivster-monat');

      // "Dein Weg": Punkte, danach Endspurt ODER (bei erreichtem Ziel) Über-das-Ziel.
      addSlide('punkte');
      if (endspurt?.aktiv) {
        addSlide('endspurt');
      } else if (endspurt && endspurt.aktuell_total >= endspurt.ziel_total && endspurt.ziel_total > 0) {
        addSlide('ueber-das-ziel');
      }

      addSlide('badges');

      if (hatKonfirmation) {
        addSlide('konfirmation');
      }

      addSlide('abschluss');
    } else {
      // --- Version 1 (Alt-Snapshots): bisherige highlight_type-Logik ---
      addSlide('intro');

      // Slide 2: Highlight-Slide basierend auf highlight_type.
      // 'chat_champion' hat keinen Renderer mehr und fällt auf 'events' zurück.
      const highlightKeyMap: Record<string, string> = {
        ueber_das_ziel: 'ueber-das-ziel',
        events_held: 'events',
        badge_collector: 'badges',
        gottesdienst_treue: 'punkte',
        gemeinde_aktiv: 'punkte',
      };
      addSlide(highlightKeyMap[highlightType] || 'events');

      // Slides 3+: Restliche Slides ohne Duplikation des Highlights
      maybeAdd('punkte');
      maybeAdd('events');
      maybeAdd('badges');

      if (hatKategorien) {
        maybeAdd('kategorie');
      }

      maybeAdd('aktivster-monat');

      // Endspurt / UeberDasZiel Logik
      if (highlightType !== 'ueber_das_ziel') {
        if (endspurt?.aktiv) {
          addSlide('endspurt');
        } else if (endspurt && !endspurt.aktiv && endspurt.aktuell_total >= endspurt.ziel_total && endspurt.ziel_total > 0) {
          maybeAdd('ueber-das-ziel');
        }
      }

      if (hatKonfirmation) {
        maybeAdd('konfirmation');
      }

      // Abschluss: IMMER letzter Slide
      shown.delete('abschluss'); // Immer hinzufuegen, auch wenn key schon existiert
      addSlide('abschluss');
    }

    // Konvertiere zu finalen Slides mit korrektem isActive
    return slideKeys.map((s, idx) => ({
      key: s.key,
      content: s.render(activeIndex === idx),
    }));
  };

  // Teamer-Slides aufbauen.
  //
  // Ab Snapshot-Version 3 waehlt das Backend die Seiten
  // (utils/wrappedKacheln.js, waehleTeamerKacheln) und legt sie als
  // `kacheln` in den Snapshot. Aeltere Snapshots haben das Feld nicht und
  // laufen weiter ueber die feste Siebener-Reihenfolge unten -- an bereits
  // erzeugten Rueckblicken aendert sich dadurch nichts.
  const buildTeamerSlides = (teamerData: TeamerWrappedData, slideYear: number) => {
    const renderers: Record<string, (isActive: boolean) => React.ReactNode> = {
      'teamer-intro': (a) => <TeamerIntroSlide isActive={a} displayName={displayName} year={slideYear} />,
      'teamer-challenge-beitraege': (a) => (
        teamerData.slides.challenges
          ? <ChallengesSlide isActive={a} challenges={teamerData.slides.challenges} />
          : null
      ),
      'teamer-challenges': (a) => (
        teamerData.slides.challenges_gestellt
          ? <TeamerChallengesSlide isActive={a} gestellt={teamerData.slides.challenges_gestellt.total} titel={teamerData.slides.challenges_gestellt.titel} />
          : null
      ),
      // DER ZUSPRUCH statt eines leeren Rueckblicks.
      // Das Backend liefert diese beiden Schluessel nur, wenn fuer die
      // Person im Jahr nichts zusammenkam; `segen` steht dann daneben.
      'teamer-segen': (a) => (
        teamerData.slides.segen
          ? <TeamerSegenSlide isActive={a} text={teamerData.slides.segen.text} quelle={teamerData.slides.segen.quelle} />
          : null
      ),
      'teamer-segen-abschluss': (a) => <TeamerSegenAbschlussSlide isActive={a} year={slideYear} />,
      'teamer-events': (a) => <TeamerEventsSlide isActive={a} events={teamerData.slides.events_geleitet} />,
      'teamer-konfis': (a) => <TeamerKonfisSlide isActive={a} konfis={teamerData.slides.konfis_betreut} />,
      'teamer-badges': (a) => <TeamerBadgesSlide isActive={a} badges={teamerData.slides.badges} />,
      'teamer-zertifikate': (a) => <TeamerZertifikateSlide isActive={a} zertifikate={teamerData.slides.zertifikate} />,
      'teamer-jahre': (a) => <TeamerJahreSlide isActive={a} engagement={teamerData.slides.engagement} />,
      'teamer-team': (a) => (
        teamerData.slides.team
          ? <TeamerTeamSlide isActive={a} team={teamerData.slides.team} />
          : null
      ),
      'teamer-neu-dabei': (a) => <TeamerNeuDabeiSlide isActive={a} />,
      'teamer-anfang': (a) => (
        teamerData.slides.anfang
          ? <TeamerAnfangSlide isActive={a} anfang={teamerData.slides.anfang} />
          : null
      ),
      'teamer-antworten': (a) => (
        teamerData.slides.chat
          ? <TeamerAntwortenSlide isActive={a} chat={teamerData.slides.chat} />
          : null
      ),
      'teamer-konfi-zeit': (a) => (
        teamerData.slides.konfi_zeit
          ? <TeamerKonfiZeitSlide isActive={a} konfiZeit={teamerData.slides.konfi_zeit} />
          : null
      ),
      'teamer-abschluss': (a) => <TeamerAbschlussSlide isActive={a} data={teamerData} year={slideYear} />,
      'stavanger-2026': (a) => <Stavanger2026Slide isActive={a} />,
    };

    const kachelListe = (teamerData as { kacheln?: string[] }).kacheln;

    const gewaehlt: string[] = (Array.isArray(kachelListe) && kachelListe.length > 0)
      // --- Ab Version 3: das Backend bestimmt die Seiten ---
      ? kachelListe.filter(k => renderers[k])
      // --- Alt-Snapshots: die bisherige feste Reihenfolge ---
      : [
          'teamer-intro',
          'teamer-events',
          'teamer-konfis',
          'teamer-badges',
          'teamer-zertifikate',
          // Die einzige Bedingung, die es hier schon gab: Ohne
          // Eintrittsdatum rechnet das Backend 0 und die Seite sagte
          // "0 Jahre als Teamer:in" -- eine Aussage ueber eine fehlende
          // Angabe, nicht ueber die Person.
          ...(teamerData.slides.engagement.teamer_seit ? ['teamer-jahre'] : []),
          'teamer-abschluss',
        ];

    // Doppelte raus, Reihenfolge bleibt.
    const ohneDoppelte = gewaehlt.filter((k, i, arr) => arr.indexOf(k) === i);

    return ohneDoppelte.map((key, idx) => ({
      key,
      content: renderers[key](activeIndex === idx),
    }));
  };

  // Slides dynamisch aufbauen basierend auf wrappedType
  const buildSlides = () => {
    if (!data || !year) return [];

    if (wrappedType === 'teamer') {
      return buildTeamerSlides(data as TeamerWrappedData, year);
    }
    return buildKonfiSlides(data as KonfiWrappedData, year);
  };

  const slides = data ? buildSlides() : [];

  const seitenfolge = slides.map(s => s.key).join('|');
  const motive = React.useMemo(
    () => verteileMotive(slides.map(s => s.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bewusst nur die
    // Seitenfolge: `slides` ist bei jedem Rendern ein neues Array, haenge der
    // Memo daran, verteilte er die Motive bei jedem Blaettern neu.
    [seitenfolge]
  );

  // Share-Handler (nach slides-Deklaration)
  const handleShare = async () => {
    if (isSharing || !shareCardRef.current || !data) return;
    setIsSharing(true);
    try {
      const currentKey = slides[activeIndex]?.key || 'intro';
      const textData = getSlideTextData(currentKey);
      const ergebnis = await shareSlide(shareCardRef.current, currentKey, wrappedType, textData);

      // ABGEBROCHEN BLEIBT STILL: Wer das Teilen-Blatt zuschiebt, hat sich
      // entschieden -- eine Meldung darauf waere Bevormundung.
      if (ergebnis.art === 'nur-text') {
        setTeilenHinweis('Das Bild hat nicht geklappt — geteilt wurde nur der Text.');
      } else if (ergebnis.art === 'fehler') {
        setTeilenHinweis('Teilen hat nicht geklappt. Versuch es noch einmal.');
      }
    } catch {
      // shareSlide faengt selbst ab; hier landet nur das Unerwartete.
      setTeilenHinweis('Teilen hat nicht geklappt. Versuch es noch einmal.');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    // Name des Dialogs fuer Vorlesehilfen -- die Folien haben keine
    // Kopfzeile mit ion-title (siehe utils/modalNamen.ts).
    <div
      className={`wrapped-overlay${wrappedType === 'teamer' ? ' wrapped-overlay--teamer' : ''}`}
      data-dialogname={wrappedType === 'teamer' ? 'Team-Rückblick' : 'Konfi-Rückblick'}
    >
      <div className="wrapped-header">
        {slides.length > 0 ? (
          <div className="wrapped-fortschritt">
            {slides.map((s, i) => (
              <span key={s.key} className={i <= activeIndex ? 'ist-aktiv' : undefined} />
            ))}
          </div>
        ) : (
          <div className="wrapped-pagination" />
        )}
        {data && (
          <button
            className="wrapped-share-btn"
            onClick={handleShare}
            disabled={isSharing}
            aria-label={isSharing ? 'Bild wird erstellt' : 'Teilen'}
            aria-busy={isSharing}
          >
            {/* Das Erzeugen des Bildes dauert einen Moment (gemessen rund
                300-800 ms). Ohne sichtbaren Ladezustand wirkt der Knopf in
                dieser Zeit tot, und es wird ein zweites Mal getippt. */}
            {isSharing
              ? <IonSpinner name="crescent" className="wrapped-share-spinner" />
              : <IonIcon icon={ICON_TEILEN} />}
          </button>
        )}
        <button className="wrapped-close-btn" onClick={onClose} aria-label="Schließen">
          <IonIcon icon={ICON_SCHLIESSEN} />
        </button>
      </div>

      {error ? (
        <div className="wrapped-error">{error}</div>
      ) : !data ? (
        <div className="wrapped-loading">
          <IonSpinner />
        </div>
      ) : (
        <MotivKontext.Provider value={motive}>
        <Swiper
          modules={[EffectCreative]}
          effect="creative"
          creativeEffect={{
            prev: { translate: ['-120%', 0, -500], rotate: [0, 0, -5], scale: 0.8, opacity: 0 },
            next: { translate: ['120%', 0, -500], rotate: [0, 0, 5], scale: 0.8, opacity: 0 },
          }}
          onSlideChange={handleSlideChange}
          speed={500}
          className="wrapped-swiper"
        >
          {slides.map((slide) => (
            <SwiperSlide key={slide.key}>{slide.content}</SwiperSlide>
          ))}
        </Swiper>
        </MotivKontext.Provider>
      )}

      {/* Die Meldung gehoert IN das Overlay: Der Rueckblick liegt als
          eigene Ebene ueber der App, ein Hinweis aus dem gewoehnlichen
          Toast-Bereich laege darunter und waere nicht zu sehen. */}
      <IonToast
        isOpen={!!teilenHinweis}
        message={teilenHinweis || ''}
        duration={4000}
        position="top"
        color="danger"
        icon={ICON_WARNHINWEIS}
        swipeGesture="vertical"
        onDidDismiss={() => setTeilenHinweis(null)}
      />

      {data && year && (
        <ShareCard
          ref={shareCardRef}
          slideKey={slides[activeIndex]?.key || 'intro'}
          data={data}
          wrappedType={wrappedType}
          displayName={displayName}
          jahrgangName={jahrgangName}
          year={year}
          // Dasselbe Motiv wie die Seite auf dem Bildschirm: Die Verteilung
          // sorgt dafuer, dass sich in einem Rueckblick kein Bild
          // wiederholt -- die feste Zuordnung allein wuerde ein anderes
          // Foto liefern als das, was die Konfi gerade sieht.
          motiv={motive[slides[activeIndex]?.key || 'intro']?.haupt}
        />
      )}
    </div>
  );
};

export default WrappedModal;
