import React, { useState, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonList,
  IonItemGroup,
  IonListHeader,
  IonSpinner
} from '@ionic/react';
import {
  closeOutline,
  checkmarkOutline,
  addOutline,
  removeCircleOutline,
  helpCircleOutline,
  listOutline,
  settingsOutline,
  timeOutline,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';

interface PollModalProps {
  onClose: () => void;
  onSuccess: () => void;
  roomId: number;
  dismiss?: () => void;
}

const PollModal: React.FC<PollModalProps> = ({ onClose, onSuccess, roomId, dismiss }) => {
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };
  const { setError, isOnline } = useApp();
  const pageRef = useRef<HTMLElement>(null);

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [exclusiveOptions, setExclusiveOptions] = useState(false);
  const [hasExpiration, setHasExpiration] = useState(false);
  const [expirationHours, setExpirationHours] = useState(24);
  const { isSubmitting: creating, guard } = useActionGuard();

  const resetForm = () => {
    setQuestion('');
    setOptions(['', '']);
    setMultipleChoice(false);
    setAnonymous(true);
    setExclusiveOptions(false);
    setHasExpiration(false);
    setExpirationHours(24);
  };

  const addOption = () => {
    if (options.length < 10) {
      setOptions([...options, '']);
    }
  };

  const removeOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const createPoll = async () => {
    const trimmedQuestion = question.trim();
    const validOptions = options.filter(opt => opt.trim());

    if (!trimmedQuestion) {
      setError('Bitte gib eine Frage ein');
      return;
    }

    if (validOptions.length < 2) {
      setError('Bitte gib mindestens 2 Antwortmöglichkeiten ein');
      return;
    }

    await guard(async () => {
      try {
        const pollData = {
          question: trimmedQuestion,
          options: validOptions,
          // Exklusive Optionen erzwingen Einzelauswahl (Backend setzt das auch durch).
          multiple_choice: exclusiveOptions ? false : multipleChoice,
          anonymous,
          exclusive_options: exclusiveOptions,
          expires_in_hours: hasExpiration ? expirationHours : null
        };

        await api.post(`/chat/rooms/${roomId}/polls`, pollData);

        resetForm();
        onSuccess();
        handleClose();
      } catch (err) {
        setError('Fehler beim Erstellen der Umfrage');
        console.error('Error creating poll:', err);
      }
    });
  };

  const canCreate = () => {
    return question.trim() && options.filter(opt => opt.trim()).length >= 2;
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={handleClose} disabled={creating}>
              <IonIcon icon={closeOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Neue Umfrage</IonTitle>
          <IonButtons slot="end">
            <IonButton className="app-modal-submit-btn app-modal-submit-btn--chat" onClick={createPoll} disabled={!canCreate() || creating || !isOnline}>
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : creating ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} slot="icon-only" />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Frage */}
          <IonList inset={true}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--chat">
                <IonIcon icon={helpCircleOutline} />
              </div>
              <IonLabel>Frage</IonLabel>
            </IonListHeader>
            <IonItemGroup>
              <IonItem>
                <IonTextarea
                  value={question}
                  onIonInput={(e) => setQuestion(e.detail.value!)}
                  placeholder="Deine Frage eingeben..."
                  rows={2}
                  maxlength={500}
                  label="Frage"
                  labelPlacement="stacked"
                  autocapitalize="sentences"
                  autoCorrect="on"
                />
              </IonItem>
            </IonItemGroup>
          </IonList>

          {/* Antwortmoeglichkeiten */}
          <IonList inset={true}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--chat">
                <IonIcon icon={listOutline} />
              </div>
              <IonLabel>Antwortmöglichkeiten</IonLabel>
            </IonListHeader>
            <IonItemGroup>
              {options.map((option, index) => (
                <IonItem key={index}>
                  <IonInput
                    value={option}
                    onIonInput={(e) => updateOption(index, e.detail.value!)}
                    placeholder={`Option ${index + 1}`}
                    maxlength={200}
                    label={`Option ${index + 1}`}
                    labelPlacement="stacked"
                    autocapitalize="sentences"
                    autoCorrect="on"
                  />
                  {options.length > 2 && (
                    <IonButton
                      fill="clear"
                      slot="end"
                      onClick={() => removeOption(index)}
                      style={{ '--color': '#dc3545' }}
                    >
                      <IonIcon icon={removeCircleOutline} />
                    </IonButton>
                  )}
                </IonItem>
              ))}

              {/* Option hinzufügen */}
              {options.length < 10 && (
                <IonItem button onClick={addOption} detail={false}>
                  <IonIcon icon={addOutline} slot="start" style={{ color: '#06b6d4' }} />
                  <IonLabel style={{ color: '#06b6d4' }}>Option hinzufügen</IonLabel>
                </IonItem>
              )}
            </IonItemGroup>
          </IonList>

          {/* Einstellungen */}
          <IonList inset={true}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--chat">
                <IonIcon icon={settingsOutline} />
              </div>
              <IonLabel>Einstellungen</IonLabel>
            </IonListHeader>
            <IonItemGroup>
              <IonItem>
                <IonToggle
                  className="app-toggle--chat"
                  checked={multipleChoice}
                  disabled={exclusiveOptions}
                  onIonChange={(e) => setMultipleChoice(e.detail.checked)}
                >
                  <IonLabel>
                    <h3>Mehrfachauswahl</h3>
                    <p className="app-settings-item__subtitle">
                      {exclusiveOptions ? 'Bei exklusiven Optionen nicht möglich' : 'Mehrere Antworten erlauben'}
                    </p>
                  </IonLabel>
                </IonToggle>
              </IonItem>

              <IonItem>
                <IonToggle
                  className="app-toggle--chat"
                  checked={!anonymous}
                  onIonChange={(e) => setAnonymous(!e.detail.checked)}
                >
                  <IonLabel>
                    <h3>Namen anzeigen</h3>
                    <p className="app-settings-item__subtitle">
                      Sichtbar machen, wer welche Antwort gewählt hat
                    </p>
                  </IonLabel>
                </IonToggle>
              </IonItem>

              <IonItem>
                <IonToggle
                  className="app-toggle--chat"
                  checked={exclusiveOptions}
                  onIonChange={(e) => {
                    setExclusiveOptions(e.detail.checked);
                    if (e.detail.checked) setMultipleChoice(false);
                  }}
                >
                  <IonLabel>
                    <h3>Exklusive Optionen</h3>
                    <p className="app-settings-item__subtitle">
                      Jede Option kann nur von einer Person gewählt werden
                    </p>
                  </IonLabel>
                </IonToggle>
              </IonItem>

              <IonItem>
                <IonToggle
                  className="app-toggle--chat"
                  checked={hasExpiration}
                  onIonChange={(e) => setHasExpiration(e.detail.checked)}
                >
                  <IonLabel>
                    <h3>Ablaufdatum</h3>
                    <p className="app-settings-item__subtitle">
                      Umfrage automatisch schließen
                    </p>
                  </IonLabel>
                </IonToggle>
              </IonItem>

              {hasExpiration && (
                <IonItem>
                  <IonIcon icon={timeOutline} slot="start" style={{ color: '#06b6d4' }} />
                  <IonSelect
                    value={expirationHours}
                    onIonChange={(e) => setExpirationHours(e.detail.value)}
                    interface="popover"
                    label="Ablaufzeit"
                    labelPlacement="start"
                  >
                    <IonSelectOption value={1}>1 Stunde</IonSelectOption>
                    <IonSelectOption value={8}>8 Stunden</IonSelectOption>
                    <IonSelectOption value={24}>1 Tag</IonSelectOption>
                    <IonSelectOption value={168}>7 Tage</IonSelectOption>
                  </IonSelect>
                </IonItem>
              )}
            </IonItemGroup>
          </IonList>

        </div>
      </IonContent>
    </IonPage>
  );
};

export default PollModal;
