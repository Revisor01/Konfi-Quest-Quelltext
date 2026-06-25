import React, { useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonList,
  IonListHeader,
  IonLabel,
  IonCard,
  IonCardContent,
  IonItem,
  IonRadioGroup,
  IonRadio,
  IonInput,
  IonDatetimeButton,
  IonDatetime,
  IonModal,
  IonSpinner,
  IonRange
} from '@ionic/react';
import {
  closeOutline,
  checkmarkOutline,
  ribbonOutline,
  ribbon,
  trophy,
  medal,
  star,
  checkmarkCircle,
  diamond,
  shield,
  flame,
  flash,
  rocket,
  sparkles,
  thumbsUp,
  heart,
  people,
  personAdd,
  chatbubbles,
  gift,
  book,
  school,
  construct,
  brush,
  colorPalette,
  sunny,
  moon,
  leaf,
  rose,
  calendar,
  today,
  time,
  timer,
  stopwatch,
  restaurant,
  fitness,
  bicycle,
  car,
  airplane,
  boat,
  camera,
  image,
  musicalNote,
  balloon,
  home,
  business,
  location,
  navigate,
  compass,
  pin,
  flag,
  informationCircle,
  helpCircle,
  alertCircle,
  hammer
} from 'ionicons/icons';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';

const CERT_ICONS: Record<string, { icon: any; name: string; category: string }> = {
  ribbon: { icon: ribbon, name: 'Band', category: 'Erfolg' },
  trophy: { icon: trophy, name: 'Pokal', category: 'Erfolg' },
  medal: { icon: medal, name: 'Medaille', category: 'Erfolg' },
  star: { icon: star, name: 'Stern', category: 'Erfolg' },
  checkmarkCircle: { icon: checkmarkCircle, name: 'Bestanden', category: 'Erfolg' },
  diamond: { icon: diamond, name: 'Diamant', category: 'Erfolg' },
  shield: { icon: shield, name: 'Schild', category: 'Erfolg' },
  flame: { icon: flame, name: 'Flamme', category: 'Engagement' },
  flash: { icon: flash, name: 'Blitz', category: 'Engagement' },
  rocket: { icon: rocket, name: 'Rakete', category: 'Engagement' },
  sparkles: { icon: sparkles, name: 'Funken', category: 'Engagement' },
  thumbsUp: { icon: thumbsUp, name: 'Daumen hoch', category: 'Engagement' },
  heart: { icon: heart, name: 'Herz', category: 'Gemeinschaft' },
  people: { icon: people, name: 'Gruppe', category: 'Gemeinschaft' },
  personAdd: { icon: personAdd, name: 'Neue Person', category: 'Gemeinschaft' },
  chatbubbles: { icon: chatbubbles, name: 'Chat', category: 'Gemeinschaft' },
  gift: { icon: gift, name: 'Geschenk', category: 'Gemeinschaft' },
  book: { icon: book, name: 'Buch', category: 'Lernen' },
  school: { icon: school, name: 'Schule', category: 'Lernen' },
  construct: { icon: construct, name: 'Werkzeug', category: 'Lernen' },
  brush: { icon: brush, name: 'Pinsel', category: 'Lernen' },
  colorPalette: { icon: colorPalette, name: 'Farbpalette', category: 'Lernen' },
  sunny: { icon: sunny, name: 'Sonne', category: 'Natur' },
  moon: { icon: moon, name: 'Mond', category: 'Natur' },
  leaf: { icon: leaf, name: 'Blatt', category: 'Natur' },
  rose: { icon: rose, name: 'Rose', category: 'Natur' },
  calendar: { icon: calendar, name: 'Kalender', category: 'Zeit' },
  today: { icon: today, name: 'Heute', category: 'Zeit' },
  time: { icon: time, name: 'Uhr', category: 'Zeit' },
  timer: { icon: timer, name: 'Timer', category: 'Zeit' },
  stopwatch: { icon: stopwatch, name: 'Stoppuhr', category: 'Zeit' },
  restaurant: { icon: restaurant, name: 'Restaurant', category: 'Aktivitäten' },
  fitness: { icon: fitness, name: 'Fitness', category: 'Aktivitäten' },
  bicycle: { icon: bicycle, name: 'Fahrrad', category: 'Aktivitäten' },
  car: { icon: car, name: 'Auto', category: 'Aktivitäten' },
  airplane: { icon: airplane, name: 'Flugzeug', category: 'Aktivitäten' },
  boat: { icon: boat, name: 'Boot', category: 'Aktivitäten' },
  camera: { icon: camera, name: 'Kamera', category: 'Aktivitäten' },
  image: { icon: image, name: 'Bild', category: 'Aktivitäten' },
  musicalNote: { icon: musicalNote, name: 'Musik', category: 'Aktivitäten' },
  balloon: { icon: balloon, name: 'Ballon', category: 'Aktivitäten' },
  home: { icon: home, name: 'Zuhause', category: 'Orte' },
  business: { icon: business, name: 'Gebäude', category: 'Orte' },
  location: { icon: location, name: 'Standort', category: 'Orte' },
  navigate: { icon: navigate, name: 'Navigation', category: 'Orte' },
  compass: { icon: compass, name: 'Kompass', category: 'Orte' },
  pin: { icon: pin, name: 'Pin', category: 'Orte' },
  flag: { icon: flag, name: 'Flagge', category: 'Orte' },
  informationCircle: { icon: informationCircle, name: 'Info', category: 'Sonstiges' },
  helpCircle: { icon: helpCircle, name: 'Hilfe', category: 'Sonstiges' },
  alertCircle: { icon: alertCircle, name: 'Warnung', category: 'Sonstiges' },
  hammer: { icon: hammer, name: 'Hammer', category: 'Sonstiges' }
};

interface CertificateAssignModalProps {
  konfiId: number;
  availableTypes: Array<{ id: number; name: string; icon?: string }>;
  onClose: () => void;
  onSuccess: () => void;
}

const CertificateAssignModal: React.FC<CertificateAssignModalProps> = ({
  konfiId,
  availableTypes,
  onClose,
  onSuccess
}) => {
  const { setError } = useApp();
  const { isSubmitting, guard } = useActionGuard();

  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(
    availableTypes.length > 0 ? availableTypes[0].id : null
  );
  const [issuedDate, setIssuedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [durationMonths, setDurationMonths] = useState<string>('');

  const selectedType = availableTypes.find(t => t.id === selectedTypeId);
  const selectedIconKey = selectedType?.icon || '';
  const selectedIconData = CERT_ICONS[selectedIconKey];

  const handleSave = async () => {
    if (!selectedTypeId) {
      setError('Bitte wähle einen Zertifikat-Typ aus');
      return;
    }

    await guard(async () => {
      let expiryDate: string | null = null;
      if (durationMonths && parseInt(durationMonths) > 0) {
        const start = new Date(issuedDate);
        start.setMonth(start.getMonth() + parseInt(durationMonths));
        expiryDate = start.toISOString().split('T')[0];
      }

      try {
        await api.post(`/teamer/${konfiId}/certificates`, {
          certificate_type_id: selectedTypeId,
          issued_date: issuedDate,
          expiry_date: expiryDate
        });
        onSuccess();
      } catch (err: any) {
        setError(err.response?.data?.error || 'Fehler beim Zuweisen');
      }
    });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>Zertifikat zuweisen</IonTitle>
          <IonButtons slot="end">
            <IonButton
              onClick={handleSave}
              disabled={!selectedTypeId || isSubmitting}
            >
              {isSubmitting ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={checkmarkOutline} />
              )}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Sektion 1: Zertifikat-Typ */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--teamer">
              <IonIcon icon={ribbonOutline} />
            </div>
            <IonLabel>Zertifikat-Typ</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {availableTypes.map((ct, index) => {
                  const iconData = ct.icon ? CERT_ICONS[ct.icon] : null;
                  const isSelected = selectedTypeId === ct.id;
                  return (
                    <div
                      key={ct.id}
                      className="app-list-item"
                      onClick={() => setSelectedTypeId(ct.id)}
                      style={{
                        borderLeftColor: '#db2777',
                        cursor: 'pointer',
                        marginBottom: index < availableTypes.length - 1 ? '8px' : '0',
                        background: isSelected ? 'rgba(219, 39, 119, 0.1)' : undefined
                      }}
                    >
                      <div className="app-list-item__row">
                        <div className="app-list-item__main">
                          <div className="app-icon-circle" style={{ backgroundColor: '#db2777' }}>
                            <IonIcon icon={iconData?.icon || ribbonOutline} />
                          </div>
                          <div className="app-list-item__content">
                            <div className="app-list-item__title">
                              {ct.name}
                            </div>
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

        {/* Sektion 2: Zeitraum */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--teamer">
              <IonIcon icon={calendar} />
            </div>
            <IonLabel>Zeitraum</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <p className="app-text-sub" style={{ marginBottom: '4px' }}>Erhalten</p>
              <IonDatetimeButton datetime="cert-start-date" style={{ justifyContent: 'flex-start' }} />
              <IonModal keepContentsMounted={true}>
                <IonDatetime
                  id="cert-start-date"
                  presentation="date"
                  firstDayOfWeek={1}
                  value={issuedDate}
                  onIonChange={(e) => {
                    const val = e.detail.value;
                    if (typeof val === 'string') {
                      setIssuedDate(val.split('T')[0]);
                    }
                  }}
                  locale="de-DE"
                />
              </IonModal>
              <p className="app-text-sub" style={{ marginTop: '12px', marginBottom: '4px' }}>Laufzeit (Monate): {durationMonths || '0'}</p>
              <div style={{ padding: '0 16px' }}>
                <IonRange
                  min={0}
                  max={36}
                  step={1}
                  value={parseInt(durationMonths) || 0}
                  onIonInput={(e) => setDurationMonths(String(e.detail.value))}
                  style={{ '--bar-background': 'rgba(219, 39, 119, 0.2)', '--bar-background-active': '#db2777', '--knob-background': '#db2777' }}
                />
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default CertificateAssignModal;
