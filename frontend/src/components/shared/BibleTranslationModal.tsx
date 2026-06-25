import React from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons,
  IonIcon, IonList, IonListHeader, IonLabel, IonCard, IonCardContent,
} from '@ionic/react';
import { closeOutline, bookOutline, checkmark } from 'ionicons/icons';

export const BIBLE_TRANSLATIONS = [
  { code: 'LUT', name: 'Lutherbibel 2017', description: 'Die klassische deutsche Standardübersetzung, nah am Originaltext mit der Sprachkraft Martin Luthers. Weit verbreitet in evangelischen Gottesdiensten.' },
  { code: 'ELB', name: 'Elberfelder Bibel', description: 'Besonders wörtliche Übersetzung, die sich eng an den hebräischen und griechischen Grundtext hält. Ideal zum genauen Bibelstudium.' },
  { code: 'GNB', name: 'Gute Nachricht Bibel', description: 'Leicht verständliche Übersetzung in modernem Deutsch. Gut geeignet für Einsteiger:innen und den Konfi-Unterricht.' },
  { code: 'BIGS', name: 'Bibel in gerechter Sprache', description: 'Übersetzung mit Fokus auf Gerechtigkeit, Inklusion und die Vielfalt biblischer Gottesbilder. Gendersensibel und theologisch reflektiert.' },
  { code: 'NIV', name: 'New International Version', description: 'Die meistgelesene englische Bibelübersetzung. Gute Balance zwischen Wörtlichkeit und Verständlichkeit. Für alle die Englisch bevorzugen.' },
  { code: 'LSG', name: 'Louis Segond 1910', description: 'Französische Standardübersetzung, vergleichbar mit der Lutherbibel im deutschen Sprachraum. Klassisch und weit verbreitet.' },
];

export const getTranslationName = (code: string): string =>
  BIBLE_TRANSLATIONS.find(t => t.code === code)?.name || code;

interface BibleTranslationModalProps {
  onClose: () => void;
  currentTranslation: string;
  onSelect: (code: string) => void;
  // Akzentfarbe (Hex) + app-list-item-Variante. Default = Konfi-Lila.
  accentColor?: string;
  itemVariant?: string;     // z.B. 'purple' oder 'teamer'
  sectionIconVariant?: string; // z.B. 'purple' (fuer app-section-icon--X)
}

// Geteilte Bibeluebersetzungs-Auswahl (Tageslosung) — von Konfi- und Teamer-Profil
// genutzt. Inhalt identisch, nur die Akzentfarbe ist pro Rolle einstellbar.
const BibleTranslationModal: React.FC<BibleTranslationModalProps> = ({
  onClose, currentTranslation, onSelect,
  accentColor = '#5b21b6', itemVariant = 'purple', sectionIconVariant = 'purple',
}) => (
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>Bibelübersetzung</IonTitle>
        <IonButtons slot="start">
          <IonButton className="app-modal-close-btn" onClick={onClose}>
            <IonIcon icon={closeOutline} />
          </IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent className="app-gradient-background">
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className={`app-section-icon app-section-icon--${sectionIconVariant}`}>
            <IonIcon icon={bookOutline} />
          </div>
          <IonLabel>Übersetzung wählen</IonLabel>
        </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent style={{ padding: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {BIBLE_TRANSLATIONS.map((t) => {
                const isSelected = currentTranslation === t.code;
                return (
                  <div
                    key={t.code}
                    className={`app-list-item app-list-item--${itemVariant} ${isSelected ? 'app-list-item--selected' : ''}`}
                    onClick={() => onSelect(t.code)}
                    style={{
                      cursor: 'pointer', position: 'relative', overflow: 'hidden',
                      // Hintergrund kommt aus der CSS-Klasse app-list-item--<variant>--selected
                      // (rollenrichtige Farbe) — KEIN inline-Background, der das ueberschreiben wuerde.
                    }}
                  >
                    {isSelected && (
                      <div className="app-corner-badges">
                        <div
                          className="app-corner-badge"
                          style={{ backgroundColor: accentColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                          title="Ausgewählt"
                        >
                          <IonIcon icon={checkmark} style={{ color: '#fff', fontSize: '0.85rem' }} />
                        </div>
                      </div>
                    )}
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-list-item__content">
                          <div className="app-list-item__title" style={{ paddingRight: isSelected ? '40px' : '0' }}>{t.name}</div>
                          <div className="app-list-item__subtitle" style={{ whiteSpace: 'normal', lineHeight: '1.4' }}>{t.description}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </IonCardContent>
        </IonCard>
      </IonList>
    </IonContent>
  </IonPage>
);

export default BibleTranslationModal;
