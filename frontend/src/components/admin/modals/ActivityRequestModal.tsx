import { fehlerText } from '../../../utils/fehler';
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
  ICON_ABSAGE,
  ICON_HAKEN,
  ICON_KAMERA_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_TEXTDOKUMENT_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import api, { DATEI_TIMEOUT_MS } from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
// triggerRefresh nicht direkt nutzen — Modal rendert via useIonModal außerhalb des Provider-Trees
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
  const { setSuccess, setError } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState<ActivityRequest | null>(null);
  const [adminComment, setAdminComment] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<'approve' | 'reject' | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState(false);

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

        // Admins sehen das Nachweisfoto in jedem Status (auch verbucht/abgelehnt)
        if (foundRequest.photo_filename) {
          loadPhoto(foundRequest.id);
        }
      } else {
        setError('Aktivität nicht gefunden');
      }
    } catch (err) {
      setError('Fehler beim Laden der Aktivität');
 console.error('Error loading request:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadPhoto = async (id: number) => {
    try {
      const response = await api.get(`/admin/activities/requests/${id}/photo`, {
        responseType: 'blob',
        timeout: DATEI_TIMEOUT_MS
      });
      const url = URL.createObjectURL(response.data);
      setPhotoUrl(url);
    } catch (err) {
 console.error('Error loading photo:', err);
    }
  };

  useEffect(() => {
    if (requestId) {
      loadRequest();
    }
  }, [requestId]);

  useEffect(() => {
    if (!photoUrl) return;
    return () => {
      URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);


  const handleDeletePhoto = async () => {
    if (!request) return;
    setDeletingPhoto(true);
    try {
      await api.delete(`/admin/activities/requests/${request.id}/photo`);
      // Freigabe der Blob-URL uebernimmt der photoUrl-Effekt beim Wechsel auf null.
      setPhotoUrl(null);
      setRequest({ ...request, photo_filename: undefined });
      setSuccess('Foto erfolgreich gelöscht');
    } catch (err) {
      setError('Fehler beim Löschen des Fotos');
 console.error('Error deleting photo:', err);
    } finally {
      setDeletingPhoto(false);
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
        } catch (err) {
          setError(fehlerText(err, `Fehler beim ${selectedAction === 'approve' ? 'Genehmigen' : 'Ablehnen'} der Aktivität`));
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
            label: `Aktivität ${selectedAction === 'approve' ? 'genehmigen' : 'ablehnen'}`
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

  if (!request) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Aktivität laden...</IonTitle>
            <IonButtons slot="start">
              <IonButton aria-label="Schließen" onClick={onClose} className="app-modal-close-btn">
                <IonIcon icon={ICON_SCHLIESSEN} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <div style={{ padding: 'var(--app-abstand-riesig) var(--app-abstand-gross)', textAlign: 'center' }}>
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
          <IonTitle>Aktivität prüfen</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={onClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          {isPending && selectedAction && (
            <IonButtons slot="end">
              <IonButton aria-label="Entscheidung speichern" onClick={handleSubmit} disabled={isSubmitting || (selectedAction === 'reject' && !adminComment.trim())} className="app-modal-submit-btn app-modal-submit-btn--activities">
                {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* SEKTION: Daten zur Aktivität */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--requests">
              <IonIcon icon={ICON_TEXTDOKUMENT_GEFUELLT} />
            </div>
            <IonLabel>Daten zur Aktivität</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList>
                {/* Konfi */}
                <IonItem lines="inset">
                  <IonLabel>
                    <p>Konfi</p>
                    <h2>
                      {request.konfi_name}
                      {request.jahrgang_name && (
                        <span style={{ color: 'var(--app-text-secondary)', fontWeight: 'var(--app-schrift-normal)', marginLeft: 'var(--app-abstand-eng)' }}>
                          ({request.jahrgang_name})
                        </span>
                      )}
                    </h2>
                  </IonLabel>
                </IonItem>

                {/* Aktivität — bei Teamer-Antraegen kein Punkte-Typ (reiner Nachweis) */}
                <IonItem lines="inset">
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
                    <IonLabel>
                      <p>Punkte</p>
                      <h2>{request.activity_points} {request.activity_points === 1 ? 'Punkt' : 'Punkte'}</h2>
                    </IonLabel>
                  </IonItem>
                )}

                {/* Teilnahmedatum */}
                <IonItem lines="inset">
                  <IonLabel>
                    <p>Teilnahmedatum</p>
                    <h2>{formatDate(request.requested_date)}</h2>
                  </IonLabel>
                </IonItem>

                {/* Eingereicht */}
                <IonItem lines="inset">
                  <IonLabel>
                    <p>Eingereicht</p>
                    <h2>{formatDateTime(request.created_at)}</h2>
                  </IonLabel>
                </IonItem>

                {/* Kommentar */}
                {request.comment && (
                  <IonItem lines="none">
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

        {/* SEKTION: Foto - sobald ein Foto vorhanden ist (auch verbucht/abgelehnt) */}
        {request.photo_filename && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--requests">
                <IonIcon icon={ICON_KAMERA_GEFUELLT} />
              </div>
              <IonLabel>Nachweis-Foto</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Foto zur Aktivität"
                    style={{
                      maxWidth: '100%',
                      borderRadius: 'var(--app-radius-klein)',
                      boxShadow: 'var(--app-schatten-karte)',
                      display: 'block'
                    }}
                  />
                ) : (
                  <div style={{
                    background: 'var(--app-surface-muted)',
                    borderRadius: 'var(--app-radius-karte)',
                    padding: 'var(--app-abstand-weit) var(--app-abstand-basis)',
                    textAlign: 'center'
                  }}>
                    <IonSpinner name="crescent" />
                    <p style={{ margin: 'var(--app-abstand-mittel) 0 0 0', fontSize: 'var(--app-text-basis)', color: 'var(--app-text-secondary)' }}>
                      Lade Foto...
                    </p>
                  </div>
                )}

                <IonButton
                  expand="block"
                  fill="outline"
                  onClick={handleDeletePhoto}
                  disabled={deletingPhoto}
                  style={{
                    marginTop: 'var(--app-abstand-basis)',
                    '--border-color': 'var(--app-color-danger)',
                    '--color': 'var(--app-color-danger)',
                    '--border-width': '2px',
                    fontWeight: 'var(--app-schrift-halbfett)'
                  }}
                >
                  <IonIcon icon={ICON_LOESCHEN_GEFUELLT} slot="start" />
                  {deletingPhoto ? 'Lösche...' : 'Foto löschen'}
                </IonButton>
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
                style={{ backgroundColor: isApproved ? 'var(--app-color-success-strong)' : 'var(--app-color-danger)' }}
              >
                <IonIcon icon={isApproved ? ICON_ZUSAGE_GEFUELLT : ICON_ABSAGE} />
              </div>
              <IonLabel>Bearbeitungsstatus</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                <IonList>
                  <IonItem lines="inset">
                    <IonLabel className="ion-text-wrap">
                      <p>Status</p>
                      <h2 style={{ color: isApproved ? 'var(--app-color-success-strong)' : 'var(--app-color-danger)' }}>
                        {isApproved ? 'Verbucht' : 'Abgelehnt'} {request.approved_by_name ? `von ${request.approved_by_name}` : ''} am {formatDateTime(request.updated_at)}
                      </h2>
                    </IonLabel>
                  </IonItem>

                  {/* Begründung */}
                  {request.admin_comment && (
                    <IonItem lines="none">
                      <IonLabel className="ion-text-wrap">
                        <p>{isApproved ? 'Kommentar' : 'Begründung'}</p>
                        <h2 style={{ color: isApproved ? 'var(--app-text-primary)' : 'var(--app-color-danger)', whiteSpace: 'pre-wrap' }}>
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
                <IonIcon icon={ICON_ZUSAGE_GEFUELLT} />
              </div>
              <IonLabel>Entscheidung</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                <div style={{ display: 'flex', gap: 'var(--app-abstand-mittel)' }}>
                  <IonButton
                    fill="outline"
                    onClick={() => !loading && setSelectedAction('approve')}
                    disabled={loading}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      '--border-color': 'var(--app-color-success-strong)',
                      '--color': selectedAction === 'approve' ? 'white' : 'var(--app-color-success-strong)',
                      '--background': selectedAction === 'approve' ? 'var(--app-color-success-strong)' : 'transparent',
                      '--border-width': '2px',
                      '--border-radius': '12px',
                      fontWeight: 'var(--app-schrift-halbfett)'
                    }}
                  >
                    <IonIcon icon={ICON_ZUSAGE_GEFUELLT} slot="start" />
                    Genehmigen
                  </IonButton>
                  <IonButton
                    fill="outline"
                    onClick={() => !loading && setSelectedAction('reject')}
                    disabled={loading}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      '--border-color': 'var(--app-color-danger)',
                      '--color': selectedAction === 'reject' ? 'white' : 'var(--app-color-danger)',
                      '--background': selectedAction === 'reject' ? 'var(--app-color-danger)' : 'transparent',
                      '--border-width': '2px',
                      '--border-radius': '12px',
                      fontWeight: 'var(--app-schrift-halbfett)'
                    }}
                  >
                    <IonIcon icon={ICON_ABSAGE} slot="start" />
                    Ablehnen
                  </IonButton>
                </div>

                {/* Ablehnungsgrund - nur wenn Ablehnen gewählt */}
                {selectedAction === 'reject' && (
                  <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
                    <IonLabel style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-secondary)', marginBottom: 'var(--app-abstand-eng)', display: 'block' }}>
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
                        background: 'var(--app-surface-muted)',
                        borderRadius: 'var(--app-radius-klein)',
                        padding: 'var(--app-abstand-eng)',
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
