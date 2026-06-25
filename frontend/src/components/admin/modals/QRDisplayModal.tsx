import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner
} from '@ionic/react';
import { closeOutline, printOutline, cloudOfflineOutline } from 'ionicons/icons';
import QRCode from 'qrcode';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';

interface QRDisplayModalProps {
  eventId: number;
  eventName: string;
  eventDate: string;
  onClose: () => void;
}

const QRDisplayModal: React.FC<QRDisplayModalProps> = ({ eventId, eventName, eventDate, onClose }) => {
  const { isOnline } = useApp();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(0);
  const [total, setTotal] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  useEffect(() => {
    loadQR();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  const loadQR = async () => {
    try {
      setLoading(true);
      const response = await api.post(`/events/${eventId}/generate-qr`);
      const token = response.data.qr_token;

      const dataUrl = await QRCode.toDataURL(token, {
        width: 512,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' }
      });
      setQrDataUrl(dataUrl);

      // Start polling
      fetchAttendance();
      pollRef.current = setInterval(fetchAttendance, 10000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'QR-Code konnte nicht generiert werden');
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendance = async () => {
    try {
      const response = await api.get(`/events/${eventId}/attendance-count`);
      setCheckedIn(response.data.checked_in);
      setTotal(response.data.total);
    } catch (err) {
      // Polling-Fehler still ignorieren
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <IonPage>
      <IonHeader className="qr-display-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose}>
              <IonIcon icon={closeOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>QR-Code</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handlePrint} disabled={!qrDataUrl}>
              <IonIcon icon={printOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent style={{ '--background': '#ffffff' }}>
        <div className="qr-display-container" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100%',
          padding: '24px'
        }}>
          {loading ? (
            <IonSpinner name="crescent" />
          ) : error ? (
            <div style={{ textAlign: 'center', color: 'var(--ion-color-danger)' }}>
              <p>{error}</p>
              <IonButton fill="outline" disabled={!isOnline} onClick={loadQR}>{!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</> : 'Erneut versuchen'}</IonButton>
            </div>
          ) : (
            <>
              {/* Event Name */}
              <div className="qr-display-event-name" style={{
                fontSize: '1.4rem',
                fontWeight: '700',
                textAlign: 'center',
                marginBottom: '8px',
                color: '#1a1a1a'
              }}>
                {eventName}
              </div>

              {/* Event Datum/Uhrzeit */}
              <div className="qr-display-event-date" style={{
                fontSize: '1rem',
                color: '#666',
                textAlign: 'center',
                marginBottom: '24px'
              }}>
                {formatDate(eventDate)} - {formatTime(eventDate)}
              </div>

              {/* QR Code */}
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="QR-Code zum Einchecken"
                  className="qr-display-image"
                  style={{
                    maxWidth: '300px',
                    width: '100%',
                    border: '2px solid var(--border-color, #e0e0e0)',
                    borderRadius: '12px',
                    padding: '16px',
                    backgroundColor: '#ffffff'
                  }}
                />
              )}

              {/* Live-Zaehler */}
              <div className="qr-display-counter" style={{
                fontSize: '1.8rem',
                fontWeight: '700',
                marginTop: '24px',
                color: '#1a1a1a'
              }}>
                {checkedIn} / {total} eingecheckt
              </div>

              {/* Hinweistext */}
              <div className="qr-display-hint" style={{
                color: 'var(--text-secondary, #999)',
                fontSize: '0.9rem',
                marginTop: '16px',
                textAlign: 'center'
              }}>
                Konfis scannen diesen QR-Code mit der App zum Einchecken
              </div>
            </>
          )}
        </div>
      </IonContent>

      {/* Print Styles */}
      <style>{`
        @media print {
          .qr-display-header,
          ion-header,
          ion-toolbar,
          .qr-display-counter,
          ion-tab-bar {
            display: none !important;
          }
          .qr-display-container {
            padding: 40px !important;
          }
          .qr-display-image {
            max-width: 80vw !important;
          }
          .qr-display-event-name,
          .qr-display-event-date,
          .qr-display-hint {
            display: block !important;
          }
          body, ion-content {
            background: white !important;
            color: black !important;
          }
        }
      `}</style>
    </IonPage>
  );
};

export default QRDisplayModal;
