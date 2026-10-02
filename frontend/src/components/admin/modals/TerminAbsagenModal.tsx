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
  ICON_GESPERRT,
  ICON_HAKEN,
  ICON_SCHLIESSEN,
} from '../../shared/icons';
import { useActionGuard } from '../../../hooks/useActionGuard';
import { useApp } from '../../../contexts/AppContext';
import { fehlerText } from '../../../utils/fehler';

// TERMIN ABSAGEN, MIT GRUND
//
// EIN MODAL, KEIN ACTION SHEET -- nach derselben Linie wie bei der Abmeldung
// (siehe AbmeldungNachtragenModal): Wer etwas SCHREIBT, bekommt ein Modal; wer
// nur BESTAETIGT, einen Alert oder ein Sheet. Bis hierher war die Absage eine
// reine Bestaetigung und damit zu Recht ein Action Sheet. Mit dem Freitextfeld
// ist sie keine mehr -- ein Sheet bietet kein mitwachsendes Textfeld und auf
// kleinen Geraeten kaum Platz.
//
// DASSELBE MODAL, KEIN ZWEITES: Beide Wege zeigen genau ein Textfeld mit
// denselben 500 Zeichen, derselben Normalisierung und derselben Folge (alle
// Teilnehmenden lesen mit). Ein eigenes Modal waere eine Kopie, die beim
// naechsten Textwechsel auseinanderliefe. Was sich unterscheidet, ist der
// Rahmen -- Ueberschrift, Hinweistext und die Frage, ob eine Mitteilung
// rausgeht --, und das sind drei Zeichenketten, kein zweites Bauteil.

interface TerminAbsagenModalProps {
  /** Name des Termins — steht im Kopf des Modals. */
  terminName: string;
  terminDatum: string;
  /** Wie viele Konfis angemeldet sind — dieselbe Zahl wie bisher im Sheet. */
  konfiAnzahl: number;
  /**
   * 'absagen' (Vorgabe) sagt den Termin ab, 'grund' aendert nur den Grund
   * eines bereits abgesagten Termins.
   */
  modus?: 'absagen' | 'grund';
  /** Beim Modus 'grund': der Grund, der heute dasteht. Leer = keiner. */
  grundVorgabe?: string;
  /** Speichert. Leerer Grund heisst: kein Grund. */
  onSave: (grund: string) => Promise<void> | void;
  dismiss: () => void;
}

const TerminAbsagenModal: React.FC<TerminAbsagenModalProps> = ({
  terminName,
  terminDatum,
  konfiAnzahl,
  modus = 'absagen',
  grundVorgabe = '',
  onSave,
  dismiss,
}) => {
  const { isOnline, setError } = useApp();
  const istGrundModus = modus === 'grund';
  // Vorgabe nur als Startwert: Wer tippt, soll nicht bei jedem Rendern
  // zurueckgesetzt werden. Das Modal wird pro Oeffnen neu aufgebaut, deshalb
  // reicht der Initialwert.
  const [grundText, setGrundText] = useState(grundVorgabe);
  const { isSubmitting, guard } = useActionGuard();

  // FEHLER VOM SERVER ZEIGEN, STATT STILL STEHENZUBLEIBEN
  //
  // Bis hierher lief onSave() ohne try/catch. useActionGuard raeumt in einem
  // `finally` auf und reicht den Fehler weiter; handleSave haengt als async
  // onClick am Knopf, und React faengt so eine Rejection nicht ab. Lehnte der
  // Server ab, lief `dismiss()` nie: Das Fenster blieb offen, OHNE Meldung,
  // und die Rejection blieb unbehandelt (einen globalen
  // unhandledrejection-Handler gibt es nicht). Man tippte auf Speichern und
  // es passierte sichtbar nichts.
  //
  // Sichtbar wurde das erst, als die Termin-Routen auf requireAdmin
  // umgestellt wurden: Eine Teamer:in mit einer ausgelieferten App-Fassung
  // (Builds 195-197 zeigen ihr den Wisch "Absagegrund bearbeiten" an einem
  // abgesagten Termin) bekommt seither 403. Die Leitungsansicht traegt
  // denselben Fehler -- dort faellt er nur nicht auf, weil ein Admin dieses
  // 403 nie sieht. Der Fix sitzt deshalb HIER, im gemeinsamen Modal, und
  // wirkt fuer beide Rollen und auch fuer alte Apps (das Modal wird
  // mitdeployt).
  //
  // Muster wie in ChangeRoleTitleModal: try/catch INNERHALB des guard,
  // setError(fehlerText(...)), und geschlossen wird nur im Erfolgsfall --
  // wer den Fehler liest, soll seinen Text noch dastehen haben.
  const handleSave = async () => {
    await guard(async () => {
      try {
        await onSave(grundText.trim());
        dismiss();
      } catch (err) {
        setError(fehlerText(err, istGrundModus
          ? 'Fehler beim Speichern des Absagegrundes'
          : 'Fehler beim Absagen des Events'));
      }
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{istGrundModus ? 'Absagegrund' : 'Absagen'}</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Abbrechen" className="app-modal-close-btn" onClick={dismiss} disabled={isSubmitting}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              aria-label={istGrundModus ? 'Absagegrund speichern' : 'Event absagen'}
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
              <IonIcon icon={ICON_GESPERRT} />
            </div>
            <IonLabel>
              {istGrundModus ? `Warum „${terminName}“ ausfällt` : `„${terminName}“ absagen`}
            </IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {/* Dieselben Eckdaten, die vorher im Kopf des Action Sheets
                  standen — damit beim Absagen sichtbar bleibt, um welchen
                  Termin es geht und wie viele Leute es trifft. */}
              <IonNote className="app-hinweis-text">
                {terminDatum} · {konfiAnzahl} {konfiAnzahl === 1 ? 'Konfi angemeldet' : 'Konfis angemeldet'}
                {istGrundModus ? ' · abgesagt' : ''}
              </IonNote>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea
                    label={istGrundModus ? 'Grund' : 'Grund (optional)'}
                    labelPlacement="stacked"
                    value={grundText}
                    onIonInput={(e) => setGrundText(e.detail.value ?? '')}
                    placeholder="z. B. „Heizung im Gemeindehaus defekt“"
                    rows={3}
                    autoGrow={true}
                    maxlength={500}
                    disabled={isSubmitting}
                  />
                </IonItem>
              </IonList>
              <IonNote className="app-hinweis-text">
                {istGrundModus
                  ? 'Alle Angemeldeten sehen den Grund am Event. Es geht keine neue Mitteilung raus — die Absage ist schon gemeldet. Leerst du das Feld, fällt der Grund weg.'
                  : 'Alle Angemeldeten sehen den Grund am Event und bekommen ihn in der Mitteilung. Ohne Grund wird nur die Absage gemeldet.'}
              </IonNote>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default TerminAbsagenModal;
