import React, { useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonItem,
  IonLabel,
  IonNote,
  IonTextarea,
  IonIcon,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonSpinner,
} from '@ionic/react';
import {
  ICON_ENTFERNEN_GEFUELLT,
  ICON_HAKEN,
  ICON_SCHLIESSEN,
  ICON_TEXTDOKUMENT,
} from '../../shared/icons';
import { useActionGuard } from '../../../hooks/useActionGuard';
import { useApp } from '../../../contexts/AppContext';

// ABMELDUNG NACHTRAGEN
//
// EIN MODAL, KEIN ALERT — aus demselben Grund wie bei der Notiz (siehe
// AnwesenheitNotizModal). Die Abmeldung blieb beim Umbau der Notiz als
// useIonAlert stehen; das war inkonsequent, denn die Begruendung traegt hier
// genauso: Eine Texteingabe der Leitung ist in dieser App ein Modal, ein
// Alert bietet kein mitwachsendes Textfeld und auf kleinen Geraeten kaum
// Platz — und mit ZWEI Textfeldern erst recht nicht.
//
// ZWEI MODALS, NICHT EINS MIT UMSCHALTER: Notiz und Abmeldung teilen sich
// zwar das Aussehen, nicht aber das Verhalten. Die Notiz laesst sich loeschen
// (leerer String = weg) und ruehrt den Status nicht an; die Abmeldung SETZT
// den Status auf 'excused' und kennt kein Loeschen — man nimmt sie zurueck,
// indem man einen anderen Status waehlt. Ein gemeinsames Modal muesste beide
// Zwecke an einem Schalter auseinanderhalten: anderer Titel, anderes
// Speichern-Verhalten, Loeschknopf nur im einen Fall, Pflichtfeldlogik nur im
// anderen. Das waere mehr Verzweigung als Ersparnis. Gemeinsam ist das
// Aussehen, und das kommt ohnehin aus den geteilten Klassen
// (app-modal-section, app-card, app-modal-submit-btn).

interface AbmeldungNachtragenModalProps {
  /** Name der Person, um die es geht — steht im Kopf des Modals. */
  teilnehmerName: string;
  /** Der vorhandene Grund, falls die Abmeldung schon eingetragen ist. */
  grund?: string | null;
  /** Die vorhandene Notiz, falls es eine gibt. */
  notiz?: string | null;
  /** Traegt die Abmeldung ein: Status 'excused' mit Grund und Notiz. */
  onSave: (grund: string, notiz: string) => Promise<void> | void;
  dismiss: () => void;
}

const AbmeldungNachtragenModal: React.FC<AbmeldungNachtragenModalProps> = ({
  teilnehmerName,
  grund,
  notiz,
  onSave,
  dismiss,
}) => {
  const { isOnline } = useApp();
  const [grundText, setGrundText] = useState(grund || '');
  const [notizText, setNotizText] = useState(notiz || '');
  const { isSubmitting, guard } = useActionGuard();

  const handleSave = async () => {
    await guard(async () => {
      await onSave(grundText.trim(), notizText.trim());
      dismiss();
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Abmeldung</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={dismiss} disabled={isSubmitting}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              aria-label="Abmeldung speichern"
              className="app-modal-submit-btn app-modal-submit-btn--events"
              onClick={handleSave}
              disabled={isSubmitting || !isOnline}
            >
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_ENTFERNEN_GEFUELLT} />
            </div>
            <IonLabel>Abmeldung von {teilnehmerName}</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea
                    label="Grund"
                    labelPlacement="stacked"
                    value={grundText}
                    onIonInput={(e) => setGrundText(e.detail.value ?? '')}
                    placeholder="z. B. „krank, Mutter hat angerufen“"
                    rows={3}
                    autoGrow={true}
                    maxlength={500}
                    disabled={isSubmitting}
                  />
                </IonItem>
              </IonList>
              {/* Kurz und richtig: die Folge, die in diesem Moment eintritt.
                  Der Erklaertext zur Abmeldung steht im Handbuch. */}
              <IonNote className="app-hinweis-text">
                Keine Punkte. Die Konfi bekommt eine Mitteilung, dass die Abmeldung eingetragen wurde.
              </IonNote>
            </IonCardContent>
          </IonCard>
        </IonList>

        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--events">
              <IonIcon icon={ICON_TEXTDOKUMENT} />
            </div>
            <IonLabel>Notiz</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea
                    label="Notiz (optional)"
                    labelPlacement="stacked"
                    value={notizText}
                    onIonInput={(e) => setNotizText(e.detail.value ?? '')}
                    placeholder="z. B. „Attest liegt vor“"
                    rows={3}
                    autoGrow={true}
                    maxlength={500}
                    disabled={isSubmitting}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default AbmeldungNachtragenModal;
