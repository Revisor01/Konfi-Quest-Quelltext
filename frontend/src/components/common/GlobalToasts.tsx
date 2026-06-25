import React from 'react';
import { IonToast } from '@ionic/react';
import { alertCircleOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { useApp } from '../../contexts/AppContext';

// Globale Anzeige für setError/setSuccess aus dem AppContext.
// Die Auth-Seiten (Login, Registrierung, Passwort) zeigen Fehler inline
// und sind nicht betroffen — diese Komponente hängt nur im eingeloggten Bereich.
const GlobalToasts: React.FC = () => {
  const { error, success, setError, setSuccess } = useApp();

  return (
    <>
      <IonToast
        isOpen={!!error}
        message={error}
        duration={4000}
        position="top"
        color="danger"
        icon={alertCircleOutline}
        swipeGesture="vertical"
        onDidDismiss={() => setError('')}
      />
      <IonToast
        isOpen={!!success}
        message={success}
        duration={2500}
        position="top"
        color="success"
        icon={checkmarkCircleOutline}
        swipeGesture="vertical"
        onDidDismiss={() => setSuccess('')}
      />
    </>
  );
};

export default GlobalToasts;
