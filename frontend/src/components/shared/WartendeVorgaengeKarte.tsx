import React from 'react';
import {
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonLabel,
  IonIcon,
  IonButton,
} from '@ionic/react';
import { timeOutline, alertCircleOutline, closeOutline } from 'ionicons/icons';
import { QueueItem, FailedAction } from '../../services/writeQueue';

interface WartendeVorgaengeKarteProps {
  /** Was noch gesendet werden muss. */
  wartend: QueueItem[];
  /** Was endgueltig gescheitert ist. Ohne Angabe wird der Teil nicht gezeigt. */
  gescheitert?: FailedAction[];
  /** Einen gescheiterten Vorgang wegwischen. */
  onVergessen?: (id: string) => void;
}

/**
 * Zeigt an, was noch in der Offline-Warteschlange liegt und was endgueltig
 * gescheitert ist.
 *
 * Vorher lag dieser Block zweimal wortgleich in KonfiEventsPage und
 * TeamerEventsPage und galt nur fuer Antraege. Alle uebrigen Einreih-Stellen
 * — Abmeldungen, Stornierungen, saemtliche Leitungs-Aktionen — zeigten nichts
 * an: Man sah nicht, dass etwas aussteht, und tippte womoeglich ein zweites
 * Mal. Die Darstellung ist absichtlich unveraendert uebernommen, damit die
 * beiden bestehenden Stellen gleich aussehen wie bisher.
 */
const WartendeVorgaengeKarte: React.FC<WartendeVorgaengeKarteProps> = ({
  wartend,
  gescheitert = [],
  onVergessen,
}) => {
  if (wartend.length === 0 && gescheitert.length === 0) return null;

  return (
    <>
      {wartend.length > 0 && (
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--warning">
              <IonIcon icon={timeOutline} />
            </div>
            <IonLabel>Wird gesendet...</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {wartend.map(qi => (
                <div key={qi.id} className="app-list-item app-list-item--warning">
                  <div className="app-corner-badges">
                    <div
                      className="app-corner-badge"
                      style={{ background: 'var(--app-color-warning)', padding: '4px 6px' }}
                      title="Wartend — wird gesendet, sobald du wieder online bist"
                    >
                      <IonIcon icon={timeOutline} style={{ color: '#fff', fontSize: '0.85rem', display: 'block' }} />
                    </div>
                  </div>
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--warning">
                        <IonIcon icon={timeOutline} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title" style={{ paddingRight: '60px' }}>
                          {qi.metadata.label || 'Aktivität'}
                        </div>
                        <div className="app-list-item__subtitle">
                          {qi.body?.description || 'Wird gesendet sobald du online bist'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </IonCardContent>
          </IonCard>
        </IonList>
      )}

      {gescheitert.length > 0 && (
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--danger">
              <IonIcon icon={alertCircleOutline} />
            </div>
            <IonLabel>Nicht gesendet</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {gescheitert.map(f => (
                <div key={f.id} className="app-list-item app-list-item--danger">
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--danger">
                        <IonIcon icon={alertCircleOutline} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title" style={{ paddingRight: '60px' }}>
                          {f.label}
                        </div>
                        <div className="app-list-item__subtitle">
                          {f.error?.message || 'Konnte nicht gesendet werden'}
                        </div>
                      </div>
                    </div>
                    {onVergessen && (
                      <IonButton
                        fill="clear"
                        size="small"
                        aria-label={`${f.label} wegwischen`}
                        onClick={() => onVergessen(f.id)}
                      >
                        <IonIcon icon={closeOutline} slot="icon-only" />
                      </IonButton>
                    )}
                  </div>
                </div>
              ))}
            </IonCardContent>
          </IonCard>
        </IonList>
      )}
    </>
  );
};

export default WartendeVorgaengeKarte;
