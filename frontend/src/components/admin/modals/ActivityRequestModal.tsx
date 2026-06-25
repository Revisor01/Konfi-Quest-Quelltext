import React, { useState, useEffect } from 'react';
import { useActionGuard } from '../../../hooks/useActionGuard';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonPage,
  IonButtons,
  IonButton,
  IonItem,
  IonLabel,
  IonTextarea,
  IonIcon,
  IonSpinner,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
} from '@ionic/react';
import {
  closeOutline,
  documentTextOutline,
  imageOutline,
  checkmarkCircle,
  checkmarkOutline,
  closeCircle,
  personOutline,
  trophyOutline,
  calendarOutline,
  timeOutline,
  chatbubbleOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
// triggerRefresh nicht direkt nutzen — Modal rendert via useIonModal ausserhalb des Provider-Trees
// Stattdessen onSuccess Callback nutzen, Parent-Page hat useLiveRefresh

interface ActivityRequest {
  id: number;
  konfi_id: number;
  konfi_name: string;
  jahrgang_name?: string;
  activity_id: number;
  activity_name: string;
  activity_type?: string;
  activity_points?: number;
  activity_target_role?: 'konfi' | 'teamer';
  requested_date: string;
  comment?: string;
  photo_filename?: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment?: string;
  approved_by?: number;
  approved_by_name?: string;
  created_at: string;
  updated_at: string;
}

interface ActivityRequestModalProps {
  requestId?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

const ActivityRequestModal: React.FC<ActivityRequestModalProps> = ({
  requestId,
  onClose,
  onSuccess
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState<ActivityRequest | null>(null);
  const [adminComment, setAdminComment] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    if (requestId) {
      loadRequest();
    }
  }, [requestId]);

  const loadRequest = async () => {
    if (!requestId) return;

    setLoading(true);
    try {
      const response = await api.get('/admin/activities/requests');
      const requests = response.data;
      const foundRequest = requests.find((r: ActivityRequest) => r.id === requestId);

      if (foundRequest) {
        setRequest(foundRequest);
        setAdminComment(foundRequest.admin_comment || '');

        if (foundRequest.photo_filename && foundRequest.status === 'pending') {
          loadPhoto(foundRequest.id);
        }
      } else {
        setError('Antrag nicht gefunden');
      }
    } catch (err) {
      setError('Fehler beim Laden des Antrags');
 console.error('Error loading request:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadPhoto = async (id: number) => {
    try {
      const response = await api.get(`/admin/activities/requests/${id}/photo`, {
        responseType: 'blob'
      });
      const url = URL.createObjectURL(response.data);
      setPhotoUrl(url);
    } catch (err) {
 console.error('Error loading photo:', err);
    }
  };

  const handleSubmit = async () => {
    if (!request || !selectedAction) return;

    if (selectedAction === 'reject' && !adminComment.trim()) {
      setError('Bitte gib einen Grund für die Ablehnung an');
      return;
    }

    await guard(async () => {
      const body = {
        status: selectedAction === 'approve' ? 'approved' : 'rejected',
        admin_comment: adminComment
      };

      if (networkMonitor.isOnline) {
        try {
          await api.put(`/admin/activities/requests/${request.id}`, body);
          // Parent-Page refresht via onSuccess + useLiveRefresh
          onSuccess();
          onClose();
        } catch (err: any) {
          setError(err.response?.data?.error || `Fehler beim ${selectedAction === 'approve' ? 'Genehmigen' : 'Ablehnen'} des Antrags`);
        }
      } else {
        await writeQueue.enqueue({
          method: 'PUT',
          url: `/admin/activities/requests/${request.id}`,
          body,
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'admin',
            clientId: safeUUID(),
            label: `Antrag ${selectedAction === 'approve' ? 'genehmigen' : 'ablehnen'}`
          }
        });
        setSuccess('Wird gespeichert sobald du wieder online bist');
        // Parent-Page refresht via onSuccess + useLiveRefresh
        onSuccess();
        onClose();
      }
    });
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

  const isPending = request?.status === 'pending';
  const isApproved = request?.status === 'approved';
  const isRejected = request?.status === 'rejected';

  if (!request) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Antrag laden...</IonTitle>
            <IonButtons slot="start">
              <IonButton onClick={onClose} className="app-modal-close-btn">
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

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Antrag prüfen</IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={onClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          {isPending && selectedAction && (
            <IonButtons slot="end">
              <IonButton onClick={handleSubmit} disabled={isSubmitting || (selectedAction === 'reject' && !adminComment.trim())} className="app-modal-submit-btn app-modal-submit-btn--activities">
                {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
              </IonButton>
            </IonButtons>
          )}
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
                {/* Konfi */}
                <IonItem lines="inset">
                  <IonIcon icon={personOutline} slot="start" style={{ color: 'var(--app-color-konfis)', fontSize: '1.2rem' }} />
                  <IonLabel>
                    <p>Konfi</p>
                    <h2>
                      {request.konfi_name}
                      {request.jahrgang_name && (
                        <span style={{ color: '#666', fontWeight: '400', marginLeft: '8px' }}>
                          ({request.jahrgang_name})
                        </span>
                      )}
                    </h2>
                  </IonLabel>
                </IonItem>

                {/* Aktivität — bei Teamer-Antraegen kein Punkte-Typ (reiner Nachweis) */}
                <IonItem lines="inset">
                  <IonIcon icon={documentTextOutline} slot="start" style={{ color: '#047857', fontSize: '1.2rem' }} />
                  <IonLabel>
                    <p>{request.activity_target_role === 'teamer'
                      ? 'Aktivität (Team)'
                      : `Aktivität (${request.activity_type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'})`}</p>
                    <h2>{request.activity_name}</h2>
                  </IonLabel>
                </IonItem>

                {/* Punkte — nur fuer Konfi-Antraege; Teamer-Aktivitaeten geben keine Punkte */}
                {request.activity_target_role !== 'teamer' && request.activity_points && (
                  <IonItem lines="inset">
                    <IonIcon icon={trophyOutline} slot="start" style={{ color: 'var(--app-color-badges)', fontSize: '1.2rem' }} />
                    <IonLabel>
                      <p>Punkte</p>
                      <h2>{request.activity_points} {request.activity_points === 1 ? 'Punkt' : 'Punkte'}</h2>
                    </IonLabel>
                  </IonItem>
                )}

                {/* Teilnahmedatum */}
                <IonItem lines="inset">
                  <IonIcon icon={calendarOutline} slot="start" style={{ color: '#007aff', fontSize: '1.2rem' }} />
                  <IonLabel>
                    <p>Teilnahmedatum</p>
                    <h2>{formatDate(request.requested_date)}</h2>
                  </IonLabel>
                </IonItem>

                {/* Eingereicht */}
                <IonItem lines="inset">
                  <IonIcon icon={timeOutline} slot="start" style={{ color: '#8e8e93', fontSize: '1.2rem' }} />
                  <IonLabel>
                    <p>Eingereicht</p>
                    <h2>{formatDateTime(request.created_at)}</h2>
                  </IonLabel>
                </IonItem>

                {/* Kommentar */}
                {request.comment && (
                  <IonItem lines="none">
                    <IonIcon icon={chatbubbleOutline} slot="start" style={{ color: '#06b6d4', fontSize: '1.2rem' }} />
                    <IonLabel className="ion-text-wrap">
                      <p>Kommentar vom Konfi</p>
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
              <IonCardContent style={{ padding: '16px' }}>
                {photoUrl ? (
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
                ) : request.photo_filename ? (
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

        {/* SEKTION: Bearbeitungsstatus für approved/rejected */}
        {!isPending && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div
                className="app-section-icon"
                style={{ backgroundColor: isApproved ? '#059669' : '#dc3545' }}
              >
                <IonIcon icon={isApproved ? checkmarkCircle : closeCircle} />
              </div>
              <IonLabel>Bearbeitungsstatus</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                <IonList>
                  <IonItem lines="inset">
                    <IonLabel className="ion-text-wrap">
                      <p>Status</p>
                      <h2 style={{ color: isApproved ? '#059669' : '#dc3545' }}>
                        {isApproved ? 'Genehmigt' : 'Abgelehnt'} {request.approved_by_name ? `von ${request.approved_by_name}` : ''} am {formatDateTime(request.updated_at)}
                      </h2>
                    </IonLabel>
                  </IonItem>

                  {/* Begründung */}
                  {request.admin_comment && (
                    <IonItem lines="none">
                      <IonLabel className="ion-text-wrap">
                        <p>{isApproved ? 'Kommentar' : 'Begründung'}</p>
                        <h2 style={{ color: isApproved ? '#333' : '#dc3545', whiteSpace: 'pre-wrap' }}>
                          {request.admin_comment}
                        </h2>
                      </IonLabel>
                    </IonItem>
                  )}
                </IonList>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* SEKTION: Aktion - NUR bei pending */}
        {isPending && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--requests">
                <IonIcon icon={checkmarkCircle} />
              </div>
              <IonLabel>Entscheidung</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '16px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <IonButton
                    fill="outline"
                    expand="block"
                    onClick={() => !loading && setSelectedAction('approve')}
                    disabled={loading}
                    style={{
                      flex: 1,
                      '--border-color': '#059669',
                      '--color': selectedAction === 'approve' ? 'white' : '#059669',
                      '--background': selectedAction === 'approve' ? '#059669' : 'transparent',
                      '--border-width': '2px',
                      '--border-radius': '12px',
                      fontWeight: '600'
                    }}
                  >
                    <IonIcon icon={checkmarkCircle} slot="start" />
                    Genehmigen
                  </IonButton>
                  <IonButton
                    fill="outline"
                    expand="block"
                    onClick={() => !loading && setSelectedAction('reject')}
                    disabled={loading}
                    style={{
                      flex: 1,
                      '--border-color': '#dc3545',
                      '--color': selectedAction === 'reject' ? 'white' : '#dc3545',
                      '--background': selectedAction === 'reject' ? '#dc3545' : 'transparent',
                      '--border-width': '2px',
                      '--border-radius': '12px',
                      fontWeight: '600'
                    }}
                  >
                    <IonIcon icon={closeCircle} slot="start" />
                    Ablehnen
                  </IonButton>
                </div>

                {/* Ablehnungsgrund - nur wenn Ablehnen gewählt */}
                {selectedAction === 'reject' && (
                  <div style={{ marginTop: '16px' }}>
                    <IonLabel style={{ fontSize: '0.85rem', color: '#666', marginBottom: '8px', display: 'block' }}>
                      Grund für die Ablehnung *
                    </IonLabel>
                    <IonTextarea
                      value={adminComment}
                      onIonInput={(e) => setAdminComment(e.detail.value!)}
                      placeholder="Bitte gib einen Grund für die Ablehnung an..."
                      rows={3}
                      disabled={loading}
                      style={{
                        width: '100%',
                        background: '#f5f5f5',
                        borderRadius: '8px',
                        padding: '8px',
                        '--padding-start': '12px',
                        '--padding-end': '12px'
                      }}
                    />
                  </div>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default ActivityRequestModal;
