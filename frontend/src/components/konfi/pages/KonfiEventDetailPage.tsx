import React from 'react';
import { useParams } from 'react-router-dom';
import { useIonRouter } from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import EventDetailView from '../views/EventDetailView';

interface RouteParams {
  id: string;
}

const KonfiEventDetailPage: React.FC = () => {
  const { id } = useParams<RouteParams>();
  const router = useIonRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.goBack();
    } else {
      router.push('/konfi/events', 'back', 'pop');
    }
  };

  return (
    <EventDetailView
      eventId={parseInt(id, 10)}
      onBack={handleBack}
    />
  );
};

export default KonfiEventDetailPage;