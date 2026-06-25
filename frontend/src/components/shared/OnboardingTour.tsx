import React, { useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { IonButton, IonIcon } from '@ionic/react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import { arrowForward, checkmarkCircle } from 'ionicons/icons';
import 'swiper/css';
import 'swiper/css/pagination';

// Eine Slide der Onboarding-Tour. `color` = CSS-Farbe (z.B. var(--app-color-konfis)),
// `rgb` = Name der zugehoerigen -rgb-Variable (z.B. '--app-color-konfis-rgb') fuer
// die rgba()-Alphastufen im Hintergrund-Gradient. `${color}d9` (Hex an var()
// anhaengen) ist UNGUELTIGES CSS -> immer ueber rgb + rgba() gehen.
export interface OnboardingSlide {
  icon: string;
  color: string;
  rgb: string;
  title: string;
  text: string;
}

interface OnboardingTourProps {
  slides: OnboardingSlide[];
  onClose: () => void;
  // Optionaler Name, der auf der ERSTEN Slide vor den Text gestellt wird
  // ("Hallo <Name>! ...").
  displayName?: string;
}

// Wechselnde Positionen fuer das grosse Ghost-Logo (Lutherrose) — eine je Slide.
const ROSE_POSITIONS: React.CSSProperties[] = [
  { top: '-14vh', right: '-26vw', transform: 'rotate(-10deg)' },
  { top: '-16vh', left: '-28vw', transform: 'rotate(12deg)' },
  { top: '8vh', right: '-34vw', transform: 'rotate(6deg)' },
  { bottom: '-12vh', left: '-26vw', transform: 'rotate(-14deg)' },
  { bottom: '-10vh', right: '-28vw', transform: 'rotate(10deg)' },
  { top: '-10vh', left: '-18vw', transform: 'rotate(-6deg)' },
];

// Bubble-Sets je Slide — auf der Gegenseite der Rose (Reihenfolge zu ROSE_POSITIONS).
const BUBBLE_SETS: React.CSSProperties[][] = [
  [ { bottom: '9%', left: '-38px', width: '140px', height: '140px' }, { bottom: '26%', left: '44px', width: '46px', height: '46px' },
    { top: '20%', left: '20px', width: '64px', height: '64px' }, { bottom: '6%', right: '26%', width: '34px', height: '34px' },
    { bottom: '30%', right: '-20px', width: '72px', height: '72px' } ],
  [ { bottom: '8%', right: '-36px', width: '150px', height: '150px' }, { bottom: '24%', right: '40px', width: '46px', height: '46px' },
    { top: '20%', right: '20px', width: '60px', height: '60px' }, { bottom: '7%', left: '24%', width: '34px', height: '34px' },
    { bottom: '30%', left: '-20px', width: '70px', height: '70px' } ],
  [ { bottom: '8%', left: '-34px', width: '140px', height: '140px' }, { top: '12%', left: '28px', width: '48px', height: '48px' },
    { bottom: '26%', left: '46px', width: '40px', height: '40px' }, { top: '14%', right: '18%', width: '34px', height: '34px' },
    { bottom: '6%', right: '12%', width: '56px', height: '56px' } ],
  [ { top: '8%', right: '-34px', width: '150px', height: '150px' }, { top: '26%', right: '38px', width: '46px', height: '46px' },
    { bottom: '20%', right: '24px', width: '60px', height: '60px' }, { top: '7%', left: '24%', width: '34px', height: '34px' },
    { top: '32%', left: '-18px', width: '68px', height: '68px' } ],
  [ { top: '8%', left: '-34px', width: '150px', height: '150px' }, { top: '26%', left: '38px', width: '46px', height: '46px' },
    { bottom: '20%', left: '24px', width: '60px', height: '60px' }, { top: '7%', right: '24%', width: '34px', height: '34px' },
    { top: '32%', right: '-18px', width: '68px', height: '68px' } ],
  [ { bottom: '9%', right: '-36px', width: '140px', height: '140px' }, { bottom: '26%', right: '42px', width: '44px', height: '44px' },
    { top: '20%', right: '22px', width: '62px', height: '62px' }, { bottom: '7%', left: '24%', width: '34px', height: '34px' },
    { bottom: '30%', left: '-18px', width: '70px', height: '70px' } ],
];

// Generische Onboarding-Tour (Vollbild-Overlay, KEIN Modal). Stil identisch zur
// urspruenglichen Konfi-Tour: farbiger Vollbild-Gradient pro Slide, wandernde
// Lutherrose + Bubbles, weisser Aktions-Button mit Schrift in Slide-Farbe.
const OnboardingTour: React.FC<OnboardingTourProps> = ({ slides, onClose, displayName }) => {
  const swiperRef = useRef<SwiperType | null>(null);
  const [index, setIndex] = useState(0);
  const isLast = index === slides.length - 1;

  const next = useCallback(() => {
    if (isLast) { onClose(); return; }
    swiperRef.current?.slideNext();
  }, [isLast, onClose]);

  // Deckender farbiger Hintergrund der AKTUELLEN Slide, nach unten abgedunkelt
  // (weisse Schrift bleibt lesbar). rgb()/rgba() ueber die -rgb-Variable.
  const rgb = slides[index].rgb;
  const activeGradient =
    `linear-gradient(165deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.5) 100%), rgb(var(${rgb}))`;

  // Per Portal an document.body -> liegt AUSSERHALB des Tab-Outlets, also auch
  // ueber der Ionic-Tab-Bar.
  return createPortal(
    <div
      className="konfi-onboarding-content"
      style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        background: activeGradient,
        overflow: 'hidden'
      }}
    >
      <style>{`
        .konfi-onboarding-content .swiper,
        .konfi-onboarding-content .swiper-wrapper { height: 100%; }
        .konfi-onboarding-content .swiper-slide { height: 100%; display: flex; }
      `}</style>

      {/* Lutherrose (wandert je Slide), darf bis in die Safe-Area reichen. */}
      <img
        src="/assets/icon/logo-mark-white.png"
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          ...ROSE_POSITIONS[index % ROSE_POSITIONS.length],
          width: '95vw', maxWidth: '460px', height: 'auto',
          objectFit: 'contain', opacity: 0.16,
          pointerEvents: 'none', zIndex: 0
        }}
      />
      {BUBBLE_SETS[index % BUBBLE_SETS.length].map((pos, bi) => (
        <div
          key={bi}
          className={bi === 0 ? 'app-auth-bubble' : 'app-auth-bubble app-auth-bubble--soft'}
          style={{ position: 'absolute', ...pos, zIndex: 0 }}
        />
      ))}

      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', height: '100%',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
          {!isLast && (
            <IonButton fill="clear" size="small" onClick={onClose} style={{ '--color': '#8e8e93' }}>
              Überspringen
            </IonButton>
          )}
        </div>

        <Swiper
          modules={[Pagination]}
          pagination={{ clickable: true }}
          autoHeight={false}
          onSwiper={(s) => { swiperRef.current = s; }}
          onSlideChange={(s) => setIndex(s.activeIndex)}
          style={{ flex: 1, width: '100%', height: '100%', minHeight: 0 }}
        >
          {slides.map((slide, i) => (
            <SwiperSlide
              key={i}
              style={{ height: '100%', minHeight: '100%', alignSelf: 'stretch', background: 'transparent' }}
            >
              <div style={{
                position: 'relative', overflow: 'hidden', flex: 1, width: '100%',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', height: '100%', minHeight: '100%', padding: '24px 32px 56px', boxSizing: 'border-box'
              }}>
                <div style={{
                  position: 'relative', zIndex: 1,
                  width: '110px', height: '110px', borderRadius: '28px',
                  background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(6px)',
                  border: '1px solid rgba(255,255,255,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '28px', boxShadow: '0 10px 28px rgba(0,0,0,0.18)'
                }}>
                  <IonIcon icon={slide.icon} style={{ fontSize: '3.2rem', color: '#fff' }} />
                </div>
                <h1 style={{ position: 'relative', zIndex: 1, fontSize: '1.6rem', fontWeight: 800, color: '#fff', margin: '0 0 12px', textShadow: '0 1px 6px rgba(0,0,0,0.18)' }}>
                  {slide.title}
                </h1>
                <p style={{ position: 'relative', zIndex: 1, fontSize: '1.02rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.95)', margin: 0, maxWidth: '340px', textShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
                  {i === 0 && displayName ? `Hallo ${displayName}! ${slide.text}` : slide.text}
                </p>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>

        <div style={{ padding: '8px 24px 28px' }}>
          <IonButton
            expand="block"
            onClick={next}
            style={{
              '--background': '#ffffff',
              '--background-activated': 'rgba(255,255,255,0.85)',
              '--background-focused': 'rgba(255,255,255,0.9)',
              '--background-hover': '#ffffff',
              '--color': slides[index].color,
              '--ripple-color': slides[index].color,
              '--box-shadow': '0 6px 18px rgba(0,0,0,0.18)',
              '--border-radius': '14px',
              height: '52px', fontWeight: 700
            }}
          >
            {isLast ? 'Los geht’s!' : 'Weiter'}
            <IonIcon slot="end" icon={isLast ? checkmarkCircle : arrowForward} />
          </IonButton>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default OnboardingTour;
