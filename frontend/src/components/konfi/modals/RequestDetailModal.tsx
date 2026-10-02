import React from 'react';
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
  ICON_ABSAGE,
  ICON_KAMERA_GEFUELLT,
  ICON_LOESCHEN,
  ICON_SCHLIESSEN,
  ICON_TEXTDOKUMENT,
  ICON_WARTEND_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import NachweisFoto from '../../shared/NachweisFoto';
import { datumKurz, datumUhrzeit } from '../../../utils/dateUtils';
import { punkteText } from '../../../utils/punkteText';

export interface ActivityRequest {
  id: number;
  activity_id: number;
  activity_name: string;
  // Punkte und Typ gibt es NUR bei Konfi-Aktivitäten. Bei Teamer-Anträgen
  // ist points 0 und type NULL — deshalb hier nullable, sonst zeigt die
  // Ansicht "(Gemeinde)" und "0 Punkte" (User-Hinweis 11.08.).
  activity_points?: number | null;
  activity_type?: 'gottesdienst' | 'gemeinde' | null;
  activity_target_role?: 'konfi' | 'teamer' | null;
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
  // Dieses Modal wird auch von der Teamer-Seite genutzt (TeamerEventsPage).
  // Teamer-Anträge haben weder Punkte noch Gottesdienst/Gemeinde — die Rolle
  // kommt aus den Daten, damit die Aufrufer nichts setzen müssen.
  const isTeamerRequest = request?.activity_target_role === 'teamer';


  const formatDate = (dateString: string) => {
    return datumKurz(dateString);
  };

  const formatDateTime = (dateString: string) => {
    return datumUhrzeit(dateString);
  };

  if (!request) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Aktivität laden...</IonTitle>
            <IonButtons slot="start">
              <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose}>
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

  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const isRejected = request.status === 'rejected';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Deine Meldung</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* SEKTION: Worum geht es */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--requests">
              <IonIcon icon={ICON_TEXTDOKUMENT} />
            </div>
            <IonLabel>Worum geht es</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList>
                {/* Aktivität — Gottesdienst/Gemeinde nur bei Konfis */}
                <IonItem lines="inset">
                  <IonLabel>
                    <p>Aktivität{!isTeamerRequest && ` (${request.activity_type === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde'})`}</p>
                    <h2>{request.activity_name}</h2>
                  </IonLabel>
                </IonItem>

                {/* Punkte — bei Teamer:innen gibt es keine */}
                {!isTeamerRequest && (
                  <IonItem lines="inset">
                    <IonLabel>
                      <p>Punkte</p>
                      <h2>{punkteText(request.activity_points ?? 0)}</h2>
                    </IonLabel>
                  </IonItem>
                )}

                {/* Wann war das */}
                <IonItem lines="inset">
                  <IonLabel>
                    <p>Wann war das?</p>
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
                <IonIcon icon={ICON_KAMERA_GEFUELLT} />
              </div>
              <IonLabel>Dein Foto</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                {request.photo_filename ? (
                  <NachweisFoto key={request.id} antragId={request.id} />
                ) : (
                  <div style={{
                    background: 'var(--app-surface-muted)',
                    borderRadius: 'var(--app-radius-karte)',
                    padding: 'var(--app-abstand-weit) var(--app-abstand-basis)',
                    textAlign: 'center'
                  }}>
                    <IonIcon
                      icon={ICON_KAMERA_GEFUELLT}
                      style={{ fontSize: 'var(--app-anzeige-gross)', color: 'var(--app-text-muted)', marginBottom: 'var(--app-abstand-mittel)', display: 'block' }}
                    />
                    <p style={{ margin: '0', fontSize: 'var(--app-text-basis)', color: 'var(--app-text-secondary)' }}>
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
                backgroundColor: isPending ? 'var(--app-color-warning)' : isApproved ? 'var(--app-color-success-strong)' : 'var(--app-color-danger)'
              }}
            >
              <IonIcon icon={isPending ? ICON_WARTEND_GEFUELLT : isApproved ? ICON_ZUSAGE_GEFUELLT : ICON_ABSAGE} />
            </div>
            <IonLabel>Status</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList>
                <IonItem lines="inset">
                  <IonLabel>
                    <p>Stand</p>
                    <h2 style={{ color: isPending ? 'var(--app-color-warning)' : isApproved ? 'var(--app-color-success-strong)' : 'var(--app-color-danger)' }}>
                      {isPending ? 'Dein Team schaut es sich an'
                        : isApproved ? (isTeamerRequest ? 'Angerechnet' : 'Punkte sind da')
                        : 'Abgelehnt'}
                    </h2>
                  </IonLabel>
                </IonItem>

                {/* Ablehnungsgrund */}
                {isRejected && request.admin_comment && (
                  <IonItem lines="none">
                    <IonLabel className="ion-text-wrap">
                      <p>Grund der Ablehnung</p>
                      <h2 style={{ color: 'var(--app-color-danger)', whiteSpace: 'pre-wrap' }}>{request.admin_comment}</h2>
                    </IonLabel>
                  </IonItem>
                )}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Löschen Button - nur bei pending */}
        {isPending && onDelete && (
          <div style={{ padding: '0 var(--app-abstand-basis) var(--app-abstand-weit) var(--app-abstand-basis)' }}>
            <IonButton
              expand="block"
              fill="outline"
              onClick={() => onDelete(request)}
              style={{
                '--border-color': 'var(--app-color-danger)',
                '--color': 'var(--app-color-danger)',
                '--background-hover': 'rgba(var(--app-color-danger-rgb), 0.1)',
                '--border-width': '2px',
                height: '48px',
                fontWeight: 'var(--app-schrift-halbfett)'
              }}
            >
              <IonIcon icon={ICON_LOESCHEN} slot="start" />
              Aktivität löschen
            </IonButton>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default RequestDetailModal;
