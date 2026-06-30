import React, { useRef } from 'react';
import { useIonRouter } from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { useApp } from '../../../contexts/AppContext';
import ChatOverview from '../ChatOverview';

interface ChatOverviewRef {
  loadChatRooms: () => void;
}

interface ChatRoomData {
  id: number;
  name: string;
  type: 'group' | 'direct' | 'jahrgang' | 'admin';
}

interface ChatOverviewPageProps {
  // Im iPad-Split-View setzt der Master die Auswahl als State (statt zu
  // navigieren). Fehlt der Callback (iPhone/Portrait), wird wie bisher per
  // Route auf die Raum-Ansicht navigiert.
  onSelectRoom?: (roomId: number) => void;
  selectedRoomId?: number | null;
}

const ChatOverviewPage: React.FC<ChatOverviewPageProps> = ({ onSelectRoom, selectedRoomId }) => {
  const { user } = useApp();
  const router = useIonRouter();
  const overviewRef = useRef<ChatOverviewRef>(null);

  const handleSelectRoom = (room: ChatRoomData) => {
    if (onSelectRoom) {
      onSelectRoom(room.id);
    } else {
      // Navigate to room view with proper routing
      const basePath = user?.type === 'admin' ? '/admin' : user?.type === 'teamer' ? '/teamer' : '/konfi';
      router.push(`${basePath}/chat/room/${room.id}`);
    }
  };

  return (
    <ChatOverview
      ref={overviewRef}
      onSelectRoom={handleSelectRoom}
      selectedRoomId={selectedRoomId}
    />
  );
};

export default ChatOverviewPage;