// ChatRoomView.tsx

// 1. Benötigte Imports hinzufügen
import React, { useState, useEffect, useRef } from 'react'; // useRef hinzufügen
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonIcon,
} from '@ionic/react';
import { arrowBack } from 'ionicons/icons';
import { useLocation } from 'react-router-dom'; // Hinzufügen
import { useModalPage } from '../../../contexts/ModalContext'; // Hinzufügen
import ChatRoom from '../ChatRoom';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';

interface ChatRoomData {
  id: number;
  name: string;
  type: 'group' | 'direct' | 'jahrgang' | 'admin';
  participants?: Array<{ user_id: number; user_type: 'admin' | 'konfi'; name: string; display_name?: string; }>;
}

interface ChatRoomViewProps {
  roomId: number;
  onBack: () => void;
}

const ChatRoomView: React.FC<ChatRoomViewProps> = ({ roomId, onBack }) => {
  // Raum-Metadaten per Offline-Cache laden: offline (oder bei Reconnect) zeigt
  // der Cache sofort den Raum, sodass ChatRoom mit seinem Nachrichten-Cache
  // gerendert wird. Vorher war das ein ungecachter api.get -> offline blieb der
  // Raum null -> "Chat wird geladen" / Fehlerseite, OBWOHL Nachrichten im Cache lagen.
  const { data: room, loading, isOffline } = useOfflineQuery<ChatRoomData>(
    'chat:room:' + roomId,
    () => api.get(`/chat/rooms/${roomId}`).then(r => r.data),
    { ttl: CACHE_TTL.CHAT_ROOMS, enabled: !!roomId }
  );

  // 2. Den useModalPage-Hook HIER aufrufen
  const location = useLocation();
  const tabId = location.pathname.startsWith('/admin') ? 'admin-chat' : 'chat';
  const { pageRef, presentingElement } = useModalPage(tabId);

  // Fehler nur dann zeigen, wenn weder Cache noch Netz einen Raum liefern konnten.
  const showError = !loading && !room;

  if (showError) {
    // 3. Wichtig: Die Fehlerseite muss auch eine IonPage mit dem Ref sein
    return (
      <IonPage ref={pageRef}>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={onBack}>
                <IonIcon icon={arrowBack} />
              </IonButton>
            </IonButtons>
            <IonTitle>Fehler</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding" style={{ textAlign: 'center' }}>
          <p>{isOffline
            ? 'Dieser Chat ist offline noch nicht verfügbar. Sobald du wieder online bist, wird er geladen.'
            : 'Fehler beim Laden des Chat-Raums.'}</p>
          <IonButton onClick={onBack}>Zurück zur Übersicht</IonButton>
        </IonContent>
      </IonPage>
    );
  }

  // Erstes Laden ohne Cache (online): Spinner zeigen statt ChatRoom mit room=null.
  if (loading && !room) {
    return (
      <IonPage ref={pageRef}>
        <IonContent className="app-gradient-background">
          <LoadingSpinner />
        </IonContent>
      </IonPage>
    );
  }

  // 4. ChatRoom bekommt jetzt das `presentingElement` als Prop
  //    und wird innerhalb der IonPage von ChatRoomView gerendert.
  return (
    <IonPage ref={pageRef}>
      <ChatRoom
        room={room}
        onBack={onBack}
        presentingElement={presentingElement} // <-- HIER wird es durchgereicht
      />
    </IonPage>
  );
};

export default ChatRoomView;