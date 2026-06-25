import React, { useState, useEffect } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonPage,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner,
  IonList,
  IonListHeader,
  IonLabel,
  IonItem,
  IonCard,
  IonCardContent
} from '@ionic/react';
import {
  closeOutline,
  calendar,
  documentTextOutline,
  imageOutline,
  chatbubbleEllipsesOutline,
  timeOutline,
  home,
  people,
  checkmarkCircle,
  closeCircle,
  hourglass,
  trophyOutline,
  trashOutline,
  alertCircleOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';

interface ActivityRequest {
  id: number;
  activity_id: number;
  activity_name: string;
  activity_points: number;
  activity_type: 'gottesdienst' | 'gemeinde';
  requested_date: string;
  comment?: string;
  photo_filename?: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment?: string;
  created_at: string;
  updated_at: string;
}

interface RequestDetailModalProps {
  request: ActivityRequest | null;
  onClose: () => void;
  onDelete?: (request: ActivityRequest) => void;
}

const RequestDetailModal: React.FC<RequestDetailModalProps> = ({
  request,
  onClose,
  onDelete
}) => {
  const { setError } = useApp();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);

  useEffect(() => {
    if (request?.photo_filename && request.status === 'pending') {
      loadPhoto(request.id);
    }
    return () => {
      if (photoUrl) {
        URL.revokeObjectURL(photoUrl);
      }
    };
  }, [request]);

  const loadPhoto = async (id: number) => {
    setLoadingPhoto(true);
    try {
      const response = await api.get(`/konfi/activity-requests/${id}/photo`, {
        responseType: 'blob'
      });
      const url = URL.createObjectURL(response.data);
      setPhotoUrl(url);
    } catch (err) {
 console.error('Error loading photo:', err);
    } finally {
      setLoadingPhoto(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!request) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Antrag laden...</IonTitle>
            <IonButtons slot="start">
              <IonButton className="app-modal-close-btn" onClick={onClose}>
                <IonIcon icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <IonSpinner name="crescent" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const isRejected = request.status === 'rejected';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Antragsdetails</IonTitle>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* SEKTION: Antragsdaten */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--requests">
              <IonIcon icon={documentTextOutline} />
            </div>
            <IonLabel>Antragsdaten</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList>
                {/* Aktivität */}
                <IonItem lines="inset">
                  <IonIcon
                    icon={request.activity_type === 'gottesdienst' ? home : people}
                    slot="start"
                    style={{ color: '#8e8e93', fontSize: '1rem' }}
                  />
                  <IonLabel>
                    <p>Aktivität ({request.activity_type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'})</p>
                    <h2>{request.activity_name}</h2>
                  </IonLabel>
                </IonItem>

                {/* Punkte */}
                <IonItem lines="inset">
                  <IonIcon icon={trophyOutline} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
                  <IonLabel>
                    <p>Punkte</p>
                    <h2>{request.activity_points} {request.activity_points === 1 ? 'Punkt' : 'Punkte'}</h2>
                  </IonLabel>
                </IonItem>

                {/* Teilnahmedatum */}
                <IonItem lines="inset">
                  <IonIcon icon={calendar} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
                  <IonLabel>
                    <p>Teilnahmedatum</p>
                    <h2>{formatDate(request.requested_date)}</h2>
                  </IonLabel>
                </IonItem>

                {/* Eingereicht */}
                <IonItem lines="inset">
                  <IonIcon icon={timeOutline} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
                  <IonLabel>
                    <p>Eingereicht</p>
                    <h2>{formatDateTime(request.created_at)}</h2>
                  </IonLabel>
                </IonItem>

                {/* Kommentar */}
                {request.comment && (
                  <IonItem lines="none">
                    <IonIcon icon={chatbubbleEllipsesOutline} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
                    <IonLabel className="ion-text-wrap">
                      <p>Deine Anmerkung</p>
                      <h2 style={{ whiteSpace: 'pre-wrap' }}>{request.comment}</h2>
                    </IonLabel>
                  </IonItem>
                )}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* SEKTION: Foto - nur bei pending anzeigen */}
        {isPending && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--requests">
                <IonIcon icon={imageOutline} />
              </div>
              <IonLabel>Nachweis-Foto</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                {loadingPhoto ? (
                  <div style={{
                    background: '#f5f5f5',
                    borderRadius: '12px',
                    padding: '24px 16px',
                    textAlign: 'center'
                  }}>
                    <IonSpinner name="crescent" />
                    <p style={{ margin: '12px 0 0 0', fontSize: '0.9rem', color: '#666' }}>
                      Lade Foto...
                    </p>
                  </div>
                ) : photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Antragsfoto"
                    style={{
                      maxWidth: '100%',
                      borderRadius: '8px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      display: 'block'
                    }}
                  />
                ) : (
                  <div style={{
                    background: '#f5f5f5',
                    borderRadius: '12px',
                    padding: '24px 16px',
                    textAlign: 'center'
                  }}>
                    <IonIcon
                      icon={imageOutline}
                      style={{ fontSize: '2.5rem', color: '#999', marginBottom: '12px', display: 'block' }}
                    />
                    <p style={{ margin: '0', fontSize: '0.9rem', color: '#666' }}>
                      Kein Foto hochgeladen
                    </p>
                  </div>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* SEKTION: Status */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div
              className="app-section-icon"
              style={{
                backgroundColor: isPending ? '#ff9500' : isApproved ? '#059669' : '#dc3545'
              }}
            >
              <IonIcon icon={isPending ? hourglass : isApproved ? checkmarkCircle : closeCircle} />
            </div>
            <IonLabel>Status</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList>
                <IonItem lines="inset">
                  <IonIcon
                    icon={isPending ? hourglass : isApproved ? checkmarkCircle : closeCircle}
                    slot="start"
                    style={{
                      color: isPending ? '#ff9500' : isApproved ? '#059669' : '#dc3545',
                      fontSize: '1rem'
                    }}
                  />
                  <IonLabel>
                    <p>Bearbeitungsstatus</p>
                    <h2 style={{ color: isPending ? '#ff9500' : isApproved ? '#059669' : '#dc3545' }}>
                      {isPending ? 'Wartend auf Bearbeitung' : isApproved ? 'Genehmigt und verbucht' : 'Abgelehnt'}
                    </h2>
                  </IonLabel>
                </IonItem>

                {/* Ablehnungsgrund */}
                {isRejected && request.admin_comment && (
                  <IonItem lines="none">
                    <IonIcon icon={alertCircleOutline} slot="start" style={{ color: '#dc3545', fontSize: '1rem' }} />
                    <IonLabel className="ion-text-wrap">
                      <p>Grund der Ablehnung</p>
                      <h2 style={{ color: '#dc3545', whiteSpace: 'pre-wrap' }}>{request.admin_comment}</h2>
                    </IonLabel>
                  </IonItem>
                )}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Löschen Button - nur bei pending */}
        {isPending && onDelete && (
          <div style={{ padding: '0 16px 24px 16px' }}>
            <IonButton
              expand="block"
              fill="outline"
              onClick={() => onDelete(request)}
              style={{
                '--border-color': '#dc3545',
                '--color': '#dc3545',
                '--background-hover': 'rgba(220, 53, 69, 0.1)',
                '--border-width': '2px',
                height: '48px',
                fontWeight: '600'
              }}
            >
              <IonIcon icon={trashOutline} slot="start" />
              Antrag löschen
            </IonButton>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default RequestDetailModal;
