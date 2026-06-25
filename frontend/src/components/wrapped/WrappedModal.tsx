import React, { useState, useEffect, useCallback, useRef } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import { closeOutline, shareOutline } from 'ionicons/icons';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination, EffectCreative } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import api from '../../services/api';
import type { KonfiWrappedData, TeamerWrappedData, WrappedResponse } from '../../types/wrapped';
import IntroSlide from './slides/IntroSlide';
import PunkteSlide from './slides/PunkteSlide';
import EventsSlide from './slides/EventsSlide';
import BadgesSlide from './slides/BadgesSlide';
import AktivsterMonatSlide from './slides/AktivsterMonatSlide';
import ChatSlide from './slides/ChatSlide';
import EndspurtSlide from './slides/EndspurtSlide';
import KategorieSlide from './slides/KategorieSlide';
import UeberDasZielSlide from './slides/UeberDasZielSlide';
import AbschlussSlide from './slides/AbschlussSlide';
import KonfirmationsSlide from './slides/KonfirmationsSlide';
import PflichtSlide from './slides/PflichtSlide';
import RankSlide from './slides/RankSlide';
import TeamerIntroSlide from './slides/teamer/TeamerIntroSlide';
import TeamerEventsSlide from './slides/teamer/TeamerEventsSlide';
import TeamerKonfisSlide from './slides/teamer/TeamerKonfisSlide';
import TeamerBadgesSlide from './slides/teamer/TeamerBadgesSlide';
import TeamerZertifikateSlide from './slides/teamer/TeamerZertifikateSlide';
import TeamerJahreSlide from './slides/teamer/TeamerJahreSlide';
import TeamerAbschlussSlide from './slides/teamer/TeamerAbschlussSlide';
import ShareCard from './share/ShareCard';
import { shareSlide } from './share/shareUtils';
import type { ShareTextData } from './share/shareUtils';
import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/effect-creative';
import './WrappedModal.css';
import './share/ShareCard.css';

interface WrappedModalProps {
  onClose: () => void;
  displayName: string;
  jahrgangName?: string;
  wrappedType?: 'konfi' | 'teamer';
  // Fuer Wiederansicht — wenn gesetzt, wird NICHT /api/wrapped/me geladen
  initialData?: KonfiWrappedData | TeamerWrappedData;
  initialYear?: number;
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
  chat_titel: [
    'Im Austausch',
    'Deine Nachrichten',
    'Voll vernetzt!',
    'Chat-Bilanz'
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

const WrappedModal: React.FC<WrappedModalProps> = ({ onClose, displayName, jahrgangName, wrappedType: initialType, initialData, initialYear }) => {
  const [data, setData] = useState<KonfiWrappedData | TeamerWrappedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [year, setYear] = useState<number | null>(null);
  const [wrappedType, setWrappedType] = useState<'konfi' | 'teamer'>(initialType || 'konfi');
  const [isSharing, setIsSharing] = useState(false);
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
        case 'punkte': return { ...base, slideValue: `${k.slides.punkte.total} Punkte gesammelt` };
        case 'events': return { ...base, slideValue: `${k.slides.events.total_attended} Events besucht` };
        case 'badges': return { ...base, slideValue: `${k.slides.badges.total_earned} Badges verdient` };
        case 'aktivster-monat': return { ...base, slideValue: `Aktivster Monat: ${k.slides.aktivster_monat.monat_name}` };
        case 'chat': return { ...base, slideValue: `${k.slides.chat.nachrichten_gesendet} Nachrichten` };
        case 'endspurt': return { ...base, slideValue: `Noch ${k.slides.endspurt.fehlende_punkte} Punkte bis zum Ziel` };
        case 'kategorie': return { ...base, slideValue: `Dein Bereich: ${k.slides.kategorie?.top_kategorie || '-'}` };
        case 'pflicht': return { ...base, slideValue: 'Pflichtveranstaltungen' };
        case 'rank': return { ...base, slideValue: 'Jahrgangs-Ranking' };
        case 'konfirmation': return { ...base, slideValue: `Konfirmation: ${k.slides.zeitraum?.ende || ''}` };
        case 'ueber-das-ziel': return { ...base, slideValue: `${(k.slides.endspurt.aktuell_total - k.slides.endspurt.ziel_total)} Punkte über dem Ziel!` };
        case 'abschluss': return { ...base, slideValue: `${k.slides.punkte.total} Punkte, ${k.slides.events.total_attended} Events, ${k.slides.badges.total_earned} Badges` };
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
        case 'teamer-abschluss': return { ...base, slideValue: `${t.slides.events_geleitet.total} Events, ${t.slides.konfis_betreut.total_konfis} Konfis, ${t.slides.badges.total_earned} Badges` };
        default: return base;
      }
    }
  };

  // Konfi-Slides aufbauen mit Individualisierung (highlight_type + formulierung_seed)
  const buildKonfiSlides = (konfiData: KonfiWrappedData, slideYear: number) => {
    const slideKeys: Array<{ key: string; render: (isActive: boolean) => React.ReactNode }> = [];
    const highlightType = konfiData.highlight_type || 'events_held';
    const seed = konfiData.formulierung_seed || 0;

    // Alle moeglichen Slide-Renderer
    const renderers: Record<string, (isActive: boolean) => React.ReactNode> = {
      'intro': (a) => <IntroSlide isActive={a} displayName={displayName} jahrgangName={jahrgangName || ''} year={slideYear} />,
      'punkte': (a) => <PunkteSlide isActive={a} punkte={konfiData.slides.punkte} />,
      'events': (a) => <EventsSlide isActive={a} events={konfiData.slides.events} />,
      'pflicht': (a) => <PflichtSlide isActive={a} pflichtBesucht={0} pflichtGesamt={0} seed={seed} />,
      'badges': (a) => <BadgesSlide isActive={a} badges={konfiData.slides.badges} />,
      'rank': (a) => <RankSlide isActive={a} rank={0} totalInJahrgang={0} displayName={displayName} />,
      'kategorie': (a) => <KategorieSlide isActive={a} kategorie={konfiData.slides.kategorie} titel={getFormulierung('kategorie_titel', seed)} />,
      'aktivster-monat': (a) => <AktivsterMonatSlide isActive={a} aktivsterMonat={konfiData.slides.aktivster_monat} />,
      'chat': (a) => <ChatSlide isActive={a} chat={konfiData.slides.chat} seed={seed} />,
      'endspurt': (a) => <EndspurtSlide isActive={a} endspurt={konfiData.slides.endspurt} />,
      'ueber-das-ziel': (a) => <UeberDasZielSlide isActive={a} endspurt={konfiData.slides.endspurt} />,
      'konfirmation': (a) => <KonfirmationsSlide isActive={a} zeitraumEnde={konfiData.slides.zeitraum.ende} displayName={displayName} />,
      'abschluss': (a) => <AbschlussSlide isActive={a} data={konfiData} year={slideYear} />,
    };

    const shown = new Set<string>();

    const addSlide = (key: string) => {
      if (shown.has(key)) return;
      shown.add(key);
      slideKeys.push({ key, render: renderers[key] });
    };

    const maybeAdd = (key: string) => addSlide(key);

    // Slide 1: IMMER Intro
    addSlide('intro');

    // Slide 2: Highlight-Slide basierend auf highlight_type
    const highlightKeyMap: Record<string, string> = {
      ueber_das_ziel: 'ueber-das-ziel',
      events_held: 'events',
      badge_collector: 'badges',
      chat_champion: 'chat',
      gottesdienst_treue: 'punkte',
      gemeinde_aktiv: 'punkte',
    };
    addSlide(highlightKeyMap[highlightType] || 'events');

    // Slides 3+: Restliche Slides ohne Duplikation des Highlights
    maybeAdd('punkte');
    maybeAdd('events');

    // PflichtSlide nach Events (Dummy-Daten, wird spaeter vom Backend befuellt)
    maybeAdd('pflicht');

    maybeAdd('badges');

    // RankSlide nach Badges (Dummy-Daten, wird spaeter vom Backend befuellt)
    maybeAdd('rank');

    // Kategorie: IMMER wenn Daten vorhanden
    if (konfiData.slides.kategorie?.verteilung?.length > 0) {
      maybeAdd('kategorie');
    }

    maybeAdd('aktivster-monat');
    maybeAdd('chat');

    // Endspurt / UeberDasZiel Logik
    const endspurt = konfiData.slides.endspurt;
    if (highlightType !== 'ueber_das_ziel') {
      if (endspurt.aktiv) {
        addSlide('endspurt');
      } else if (!endspurt.aktiv && endspurt.aktuell_total >= endspurt.ziel_total && endspurt.ziel_total > 0) {
        maybeAdd('ueber-das-ziel');
      }
    }

    // KonfirmationsSlide: nur wenn zeitraum.ende vorhanden
    if (konfiData.slides.zeitraum?.ende) {
      maybeAdd('konfirmation');
    }

    // Abschluss: IMMER letzter Slide
    shown.delete('abschluss'); // Immer hinzufuegen, auch wenn key schon existiert
    addSlide('abschluss');

    // Konvertiere zu finalen Slides mit korrektem isActive
    return slideKeys.map((s, idx) => ({
      key: s.key,
      content: s.render(activeIndex === idx),
    }));
  };

  // Teamer-Slides aufbauen (7 Slides)
  const buildTeamerSlides = (teamerData: TeamerWrappedData, slideYear: number) => {
    const slides: Array<{ key: string; content: React.ReactNode }> = [];
    let slideIndex = 0;

    slides.push({
      key: 'teamer-intro',
      content: <TeamerIntroSlide isActive={activeIndex === slideIndex} displayName={displayName} year={slideYear} />,
    });
    slideIndex++;

    slides.push({
      key: 'teamer-events',
      content: <TeamerEventsSlide isActive={activeIndex === slideIndex} events={teamerData.slides.events_geleitet} />,
    });
    slideIndex++;

    slides.push({
      key: 'teamer-konfis',
      content: <TeamerKonfisSlide isActive={activeIndex === slideIndex} konfis={teamerData.slides.konfis_betreut} />,
    });
    slideIndex++;

    slides.push({
      key: 'teamer-badges',
      content: <TeamerBadgesSlide isActive={activeIndex === slideIndex} badges={teamerData.slides.badges} />,
    });
    slideIndex++;

    slides.push({
      key: 'teamer-zertifikate',
      content: <TeamerZertifikateSlide isActive={activeIndex === slideIndex} zertifikate={teamerData.slides.zertifikate} />,
    });
    slideIndex++;

    slides.push({
      key: 'teamer-jahre',
      content: <TeamerJahreSlide isActive={activeIndex === slideIndex} engagement={teamerData.slides.engagement} />,
    });
    slideIndex++;

    slides.push({
      key: 'teamer-abschluss',
      content: <TeamerAbschlussSlide isActive={activeIndex === slideIndex} data={teamerData} year={slideYear} />,
    });

    return slides;
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

  // Share-Handler (nach slides-Deklaration)
  const handleShare = async () => {
    if (isSharing || !shareCardRef.current || !data) return;
    setIsSharing(true);
    try {
      const currentKey = slides[activeIndex]?.key || 'intro';
      const textData = getSlideTextData(currentKey);
      await shareSlide(shareCardRef.current, currentKey, wrappedType, textData);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className={`wrapped-overlay${wrappedType === 'teamer' ? ' wrapped-overlay--teamer' : ''}`}>
      <div className="wrapped-header">
        <div className="wrapped-pagination" />
        {data && (
          <button className="wrapped-share-btn" onClick={handleShare} disabled={isSharing} aria-label="Teilen">
            <IonIcon icon={shareOutline} />
          </button>
        )}
        <button className="wrapped-close-btn" onClick={onClose} aria-label="Schließen">
          <IonIcon icon={closeOutline} />
        </button>
      </div>

      {error ? (
        <div className="wrapped-error">{error}</div>
      ) : !data ? (
        <div className="wrapped-loading">
          <IonSpinner />
        </div>
      ) : (
        <Swiper
          modules={[Pagination, EffectCreative]}
          effect="creative"
          creativeEffect={{
            prev: { translate: ['-120%', 0, -500], rotate: [0, 0, -5], scale: 0.8, opacity: 0 },
            next: { translate: ['120%', 0, -500], rotate: [0, 0, 5], scale: 0.8, opacity: 0 },
          }}
          pagination={{ clickable: true, el: '.wrapped-pagination' }}
          onSlideChange={handleSlideChange}
          speed={500}
          className="wrapped-swiper"
        >
          {slides.map((slide) => (
            <SwiperSlide key={slide.key}>{slide.content}</SwiperSlide>
          ))}
        </Swiper>
      )}

      {data && year && (
        <ShareCard
          ref={shareCardRef}
          slideKey={slides[activeIndex]?.key || 'intro'}
          data={data}
          wrappedType={wrappedType}
          displayName={displayName}
          jahrgangName={jahrgangName}
          year={year}
        />
      )}
    </div>
  );
};

export default WrappedModal;
