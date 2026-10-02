import React from 'react';
import { IonCard, IonCardContent, IonIcon, IonLabel, IonList, IonListHeader } from '@ionic/react';
import { ICON_TERMIN, ICON_TERMIN_GEFUELLT } from './icons';
import { datumKurz } from '../../utils/dateUtils';
import { konfiZeitTerminStatus } from '../../utils/konfiZeit';
import type { KonfiZeitTermin } from '../../types/konfiZeit';
import { punkteText } from '../../utils/punkteText';

/**
 * Die Befoerderung loescht die Buchungen, das Loeschen des alten Jahrgangs
 * spaeter die Termine selbst. Was bleibt, ist diese Liste: wo die Person
 * dabei war, wo abgemeldet, und welche Punkte es dafuer gab. Eine Stelle fuer
 * beide Ansichten -- die eigene Konfi-Historie der Teamer:in und die
 * Detailansicht der Leitung.
 *
 * Schlicht gehalten: kein Antippen, denn den Termin gibt es womoeglich nicht
 * mehr. Ohne Termine faellt der Abschnitt weg.
 */
interface KonfiZeitTermineProps {
  termine: KonfiZeitTermin[];
  /** Ueberschrift, vorbelegt mit "Events der Konfi-Zeit". */
  titel?: string;
}

const KonfiZeitTermine: React.FC<KonfiZeitTermineProps> = ({ termine, titel = 'Events der Konfi-Zeit' }) => {
  const liste = Array.isArray(termine) ? termine : [];
  if (liste.length === 0) return null;

  return (
    <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
      <IonListHeader>
        <div className="app-section-icon app-section-icon--events">
          <IonIcon icon={ICON_TERMIN_GEFUELLT} />
        </div>
        <IonLabel>{titel} ({liste.length})</IonLabel>
      </IonListHeader>
      <IonCard className="app-card">
        <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-kompakt)' }}>
            {liste.map((termin) => (
              <div key={termin.event_id} className="app-list-item app-list-item--events">
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--events">
                      <IonIcon icon={ICON_TERMIN_GEFUELLT} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title">{termin.name}</div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">
                          <IonIcon icon={ICON_TERMIN} className="app-icon-color--events" />
                          {datumKurz(termin.datum)}
                        </span>
                        <span className="app-list-item__meta-item">{konfiZeitTerminStatus(termin)}</span>
                        {(termin.punkte ?? 0) > 0 && (
                          <span className="app-list-item__meta-item">
                            {punkteText(termin.punkte ?? 0)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </IonCardContent>
      </IonCard>
    </IonList>
  );
};

export default KonfiZeitTermine;
