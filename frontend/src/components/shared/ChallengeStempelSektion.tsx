import React, { useMemo, useRef } from 'react';
import { IonCard, IonCardContent, IonIcon, IonLabel, IonList, IonListHeader, useIonPopover } from '@ionic/react';
import { ICON_ABZEICHEN, ICON_CHALLENGE_GEFUELLT } from './icons';
import { getIconFromString } from '../../utils/badgeIcons';
import KachelRaster from './KachelRaster';
import StempelPopoverContent, { StempelPopoverData } from './StempelPopoverContent';
import type { ChallengeMark, OffenerStempel } from '../../types/challenges';

/**
 * Die Challenge-Stempel einer Person — heute in der Detailansicht der Leitung
 * (admin/views/KonfiDetailView.tsx). Unter Challenges selbst steht dieselbe
 * Darstellung, dort baut sie die Ansicht direkt auf (ChallengesView).
 *
 * Bewusst OHNE Zaehler und ohne Fortschritt, wie ueberall bei Challenges: ein
 * Stempel belegt, dass jemand dabei war, er ist keine Sammelmenge.
 *
 * Ein Tipp auf eine Kachel oeffnet den Stempel-Popover, genau wie bei den
 * Abzeichen.
 */
interface ChallengeStempelSektionProps {
  marks: ChallengeMark[];
  /**
   * Noch nicht erhaltene Stempel. Optional: Aeltere Server liefern das Feld
   * nicht, dann bleibt es bei den erhaltenen.
   */
  offeneStempel?: OffenerStempel[];
  /**
   * Ueberschrift des Abschnitts. Im eigenen Profil bleibt es bei "Deine
   * Stempel"; in der Detailansicht der Leitung schaut jemand auf eine ANDERE
   * Person, dort waere "Deine" schlicht falsch.
   */
  titel?: string;
}

const ChallengeStempelSektion: React.FC<ChallengeStempelSektionProps> = ({
  marks,
  offeneStempel,
  titel = 'Deine Stempel',
}) => {
  const popoverRef = useRef<StempelPopoverData | null>({ stempel: null, erhalten: true });
  const [presentStempelPopover] = useIonPopover(StempelPopoverContent, { dataRef: popoverRef });

  const erhaltene = useMemo(() => marks || [], [marks]);
  const offene = useMemo(() => offeneStempel || [], [offeneStempel]);

  // Nachschlagewerk fuer den Klick: die Kachel traegt nur ihren Schluessel.
  // Die erhaltenen zuerst — haette jemand beides zur selben Challenge (was
  // die Route ausschliesst), gewinnt der erhaltene.
  const nachSchluessel = useMemo(() => {
    const karte = new Map<React.Key, StempelPopoverData>();
    for (const offen of offene) karte.set(`offen-${offen.challenge_id}`, { stempel: offen, erhalten: false });
    for (const mark of erhaltene) karte.set(mark.challenge_id, { stempel: mark, erhalten: true });
    return karte;
  }, [erhaltene, offene]);

  if (erhaltene.length === 0 && offene.length === 0) return null;

  const handleKachelClick = (schluessel: React.Key, e: React.MouseEvent) => {
    const daten = nachSchluessel.get(schluessel);
    if (!daten) return;
    popoverRef.current = daten;
    presentStempelPopover({
      event: e.nativeEvent,
      side: 'bottom',
      alignment: 'center',
      cssClass: 'badge-detail-popover badge-popover-auto-width',
    });
  };

  return (
    <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
      <IonListHeader>
        <div className="app-section-icon app-section-icon--challenges">
          <IonIcon icon={ICON_ABZEICHEN} />
        </div>
        <IonLabel>{titel}</IonLabel>
      </IonListHeader>
      <IonCard className="app-card">
        <IonCardContent style={{ padding: 'var(--app-abstand-basis) var(--app-abstand-mittel)' }}>
          <KachelRaster
            onKachelClick={handleKachelClick}
            eintraege={[
              // Erhaltene zuerst — was da ist, steht vorne.
              ...erhaltene.map((mark) => ({
                schluessel: mark.challenge_id,
                icon: getIconFromString(mark.badge_icon, ICON_CHALLENGE_GEFUELLT),
                name: mark.badge_name,
                titel: mark.title,
                // Die Challenge-Farbe statt einer eigenen je Stempel: ein
                // Stempel gehoert zu den Challenges, nicht zu einer Kategorie.
                farbe: 'var(--app-color-challenges)',
              })),
              // ... dann die grauen. `verdient: false` ist derselbe Weg, den
              // die Abzeichen gehen (.app-kachel--gesperrt).
              ...offene.map((offen) => ({
                schluessel: `offen-${offen.challenge_id}`,
                icon: getIconFromString(offen.badge_icon, ICON_CHALLENGE_GEFUELLT),
                name: offen.badge_name,
                titel: offen.title,
                farbe: 'var(--app-color-challenges)',
                verdient: false,
              })),
            ]}
          />
        </IonCardContent>
      </IonCard>
    </IonList>
  );
};

export default ChallengeStempelSektion;
