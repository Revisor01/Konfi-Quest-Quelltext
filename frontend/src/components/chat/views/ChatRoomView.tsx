// ChatRoomView.tsx

import React from 'react';
import { useAppLocation } from '../../../navigation/useAppLocation';
import {
  IonPage,
  IonContent,
  IonButton,
} from '@ionic/react';
import AppKopfzeile from '../../shared/AppKopfzeile';
import { useModalPage } from '../../../contexts/ModalContext';
import ChatRoom from '../ChatRoom';
import api from '../../../services/api';
import LoadingSpinner from '../../common/LoadingSpinner';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
// Derselbe Raum-Typ, den ChatRoom erwartet. Der fruehere eigene Typ kannte
// als user_type nur 'admin' | 'konfi' -- Teamer:innen fehlten.
import type { ChatRoomBase } from '../../../types/chat';

interface ChatRoomViewProps {
  roomId: number;
  onBack: () => void;
}

const ChatRoomView: React.FC<ChatRoomViewProps> = ({ roomId, onBack }) => {
  // Raum-Metadaten per Offline-Cache laden: offline (oder bei Reconnect) zeigt
  // der Cache sofort den Raum, sodass ChatRoom mit seinem Nachrichten-Cache
  // gerendert wird. Vorher war das ein ungecachter api.get -> offline blieb der
  // Raum null -> "Chat wird geladen" / Fehlerseite, OBWOHL Nachrichten im Cache lagen.
  const { data: room, loading, isOffline } = useOfflineQuery<ChatRoomBase>(
    'chat:room:' + roomId,
    () => api.get(`/chat/rooms/${roomId}`).then(r => r.data),
    { ttl: CACHE_TTL.CHAT_ROOMS, enabled: !!roomId }
  );

  // 2. Den useModalPage-Hook HIER aufrufen
  const location = useAppLocation();
  const tabId = location.pathname.startsWith('/admin') ? 'admin-chat' : 'chat';
  const { pageRef, presentingElement } = useModalPage(tabId);

  // Fehler nur dann zeigen, wenn weder Cache noch Netz einen Raum liefern konnten.
  const showError = !loading && !room;

  if (showError) {
    // 3. Wichtig: Die Fehlerseite muss auch eine IonPage mit dem Ref sein
    return (
      <IonPage ref={pageRef}>
        {/* Wie im Chatraum selbst opak (translucent={false}): der Inhalt
            darunter ist nicht fullscreen, siehe ChatHeader. */}
        <AppKopfzeile titel="Fehler" onZurueck={onBack} translucent={false} gemeindeUmschalter={false} />
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