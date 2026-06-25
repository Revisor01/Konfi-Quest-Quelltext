import React from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
  IonList,
  IonItem,
  IonLabel,
  IonCard,
  IonCardContent,
  IonListHeader
} from '@ionic/react';
import {
  closeOutline,
  people,
  person,
  chatbubbles,
  informationCircle
} from 'ionicons/icons';

interface ChatOptionsModalProps {
  onClose: () => void;
  onSelectOption: (option: 'group' | 'direct' | 'jahrgang') => void;
  dismiss?: () => void;
}

const ChatOptionsModal: React.FC<ChatOptionsModalProps> = ({ onClose, onSelectOption, dismiss }) => {
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  const chatOptions = [
    {
      type: 'group' as const,
      title: 'Gruppenchat erstellen',
      subtitle: 'Chat mit ausgewählten Teilnehmern',
      icon: people,
      color: '#2dd36f'
    },
    {
      type: 'direct' as const,
      title: 'Direktnachricht',
      subtitle: '1-zu-1 Unterhaltung starten',
      icon: person,
      color: '#17a2b8'
    }
  ];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Neuen Chat erstellen</IonTitle>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={handleClose}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Chat-Optionen */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--chat">
              <IonIcon icon={chatbubbles} />
            </div>
            <IonLabel>Chat-Optionen</IonLabel>
          </IonListHeader>

        <IonCard className="app-card">
          <IonCardContent style={{ padding: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {chatOptions.map((option) => (
                <div
                  key={option.type}
                  className="app-list-item app-list-item--chat"
                  onClick={() => {
                    onSelectOption(option.type);
                    handleClose();
                  }}
                  style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--lg" style={{ backgroundColor: option.color }}>
                        <IonIcon icon={option.icon} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">{option.title}</div>
                        <div className="app-list-item__subtitle">{option.subtitle}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </IonCardContent>
        </IonCard>
        </IonList>

        {/* Hinweis */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--chat">
              <IonIcon icon={informationCircle} />
            </div>
            <IonLabel>Jahrgangschats</IonLabel>
          </IonListHeader>

        <IonCard className="app-card">
          <IonCardContent style={{ padding: '16px' }}>
            <p style={{
              margin: '0',
              fontSize: '0.9rem',
              color: '#666',
              lineHeight: '1.5'
            }}>
              Jahrgangschats werden automatisch für alle Jahrgänge erstellt und sind in der Chat-Übersicht verfügbar.
            </p>
          </IonCardContent>
        </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default ChatOptionsModal;
