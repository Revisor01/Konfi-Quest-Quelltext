import React from 'react';
import { useParams } from 'react-router-dom';
import { useIonRouter } from '@ionic/react';
import EventDetailView from '../views/EventDetailView';

const KonfiEventDetailPage: React.FC = () => {
  // react-router 6 typisiert Parameter als `string | undefined` — sie koennen
  // fehlen, wenn die Route ohne sie aufgerufen wird. Der Fallback haelt die
  // Seite stabil, statt sie mit NaN rechnen zu lassen.
  const { id } = useParams<{ id: string }>();
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
      eventId={parseInt(id ?? '0', 10)}
      onBack={handleBack}
    />
  );
};

export default KonfiEventDetailPage;