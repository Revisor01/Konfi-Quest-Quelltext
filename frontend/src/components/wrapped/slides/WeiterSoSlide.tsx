import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_FLAMME, ICON_HERZ } from '../../shared/icons';
import SlideBase from './SlideBase';
import type { SlideProps, KonfiEndspurtSlide } from '../../../types/wrapped';
import { punkteText } from '../../../utils/punkteText';

interface WeiterSoSlideProps extends SlideProps {
  /** Zielwerte des Jahrgangs. Fehlt der Block, bleibt es beim Zuspruch ohne Zahl. */
  endspurt?: KonfiEndspurtSlide | null;
}

/**
 * Der Blick nach vorn WAEHREND der Konfizeit.
 *
 * WAS VORHER STAND: An dieser Stelle kam IMMER die Einladung ins Team
 * ('werde-teamer', eine feste Kachel) -- auch im ersten Konfi-Jahr. Jemanden,
 * der gerade angefangen hat, zu fragen, ob er nicht Teamer:in werden will,
 * geht am Zeitpunkt vorbei. Die Einladung erscheint jetzt erst nach der
 * Konfirmation, davor diese Seite.
 *
 * DREI STUFEN, nach dem, was noch fehlt:
 *
 *   Ziel erreicht    Anerkennung. Kein "weiter so" -- wer da ist, ist da.
 *                    Was jetzt noch kommt, kommt freiwillig.
 *   Kurz davor       Der Endspurt, mit der konkreten Zahl. Sie ist klein
 *                    genug, dass sie anspornt statt zu erdruecken.
 *   Noch ein Stueck  Ermutigung OHNE Zahl. Eine grosse Zahl vor Augen
 *                    entmutigt; hier zaehlt, dass noch Zeit ist.
 *
 * Die Schwelle liegt bei fuenf Punkten: Das ist ungefaehr das, was in
 * wenigen Wochen zusammenkommt -- nah genug, um es sich vorzunehmen.
 */
const NAH_DRAN_AB = 5;

const WeiterSoSlide: React.FC<WeiterSoSlideProps> = ({ isActive, endspurt }) => {
  const ziel = endspurt?.ziel_total ?? 0;
  const fehlend = endspurt?.fehlende_punkte ?? 0;
  // Ohne Zielvorgabe (Jahrgang ohne Ziele, beide Punktarten abgeschaltet)
  // gibt es nichts zu rechnen -- dann bleibt der Zuspruch ohne Zahl.
  const hatZiel = ziel > 0;
  const geschafft = hatZiel && fehlend === 0;
  const nahDran = hatZiel && fehlend > 0 && fehlend <= NAH_DRAN_AB;

  const auge = geschafft ? 'Dein Ziel' : nahDran ? 'Fast geschafft' : 'Und weiter';

  const slogan = geschafft
    ? ['Du hast', 'dein Ziel.']
    : nahDran
      ? ['Der Rest', 'ist ein', 'Katzensprung.']
      : ['Deine Zeit', 'geht', 'weiter.'];

  const nachsatz = geschafft
    ? 'Alles, was jetzt noch kommt, machst du, weil du willst — nicht, weil du musst.'
    : nahDran
      ? `Noch ${punkteText(fehlend)}. Das ist ein Gottesdienst und ein Nachmittag.`
      : 'Es ist noch Zeit. Und es zählt nicht, wie schnell du bist — sondern dass du da bist.';

  return (
    <SlideBase isActive={isActive} className="weiter-so-slide" kachel="weiter-so">
      <div className="kat-auge">{auge}</div>

      <div className="kat-slogan">
        {slogan.map((zeile, i) => (
          <span key={i} style={{ display: 'block' }}>{zeile}</span>
        ))}
      </div>

      <div className="kat-nachsatz">{nachsatz}</div>

      {/* 22px wie auf der Teamer-Einladung -- Wrapped-Feinjustierung
          ausserhalb der Abstands-Skala, bleibt bewusst roh. */}
      <div className="w-einladung" style={{ marginTop: 22 }}>
        <IonIcon icon={geschafft ? ICON_HERZ : ICON_FLAMME} />
        <span>
          {geschafft
            ? 'Schön, dass du dabei bist'
            : 'Jedes Event zählt, auch das kleine'}
        </span>
      </div>
    </SlideBase>
  );
};

export default WeiterSoSlide;
