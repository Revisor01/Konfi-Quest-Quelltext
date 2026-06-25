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

const ChatOverviewPage: React.FC = () => {
  const { user } = useApp();
  const router = useIonRouter();
  const overviewRef = useRef<ChatOverviewRef>(null);

  const handleSelectRoom = (room: ChatRoomData) => {
    // Navigate to room view with proper routing
    const basePath = user?.type === 'admin' ? '/admin' : user?.type === 'teamer' ? '/teamer' : '/konfi';
    router.push(`${basePath}/chat/room/${room.id}`);
  };

  return (
    <ChatOverview 
      ref={overviewRef}
      onSelectRoom={handleSelectRoom}
    />
  );
};

export default ChatOverviewPage;