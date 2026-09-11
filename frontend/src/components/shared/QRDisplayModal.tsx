import { fehlerText } from '../../utils/fehler';
import React, { useState, useEffect, useRef } from 'react';
import { QR_FARBEN } from '../../theme/colors';
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
import { ICON_DRUCKEN, ICON_OFFLINE, ICON_SCHLIESSEN } from './icons';
import QRCode from 'qrcode';
import api from '../../services/api';
import { useApp } from '../../contexts/AppContext';

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
        color: { dark: QR_FARBEN.dunkel, light: QR_FARBEN.hell }
      });
      setQrDataUrl(dataUrl);

      // Start polling
      fetchAttendance();
      pollRef.current = setInterval(fetchAttendance, 10000);
    } catch (err) {
      setError(fehlerText(err, 'QR-Code konnte nicht generiert werden'));
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendance = async () => {
    try {
      const response = await api.get(`/events/${eventId}/attendance-count`);
      setCheckedIn(response.data.checked_in);
      setTotal(response.data.total);
    } catch {
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
            <IonButton onClick={onClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>QR-Code</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handlePrint} disabled={!qrDataUrl} aria-label="QR-Code drucken">
              <IonIcon icon={ICON_DRUCKEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent style={{ '--background': 'white' }}>
        <div className="qr-display-container" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100%',
          padding: 'var(--app-abstand-weit)'
        }}>
          {loading ? (
            <IonSpinner name="crescent" />
          ) : error ? (
            <div style={{ textAlign: 'center', color: 'var(--ion-color-danger)' }}>
              <p>{error}</p>
              <IonButton fill="outline" disabled={!isOnline} onClick={loadQR}>{!isOnline ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</> : 'Erneut versuchen'}</IonButton>
            </div>
          ) : (
            <>
              {/* Event Name */}
              <div className="qr-display-event-name" style={{
                fontSize: 'var(--app-text-titel-gross)',
                fontWeight: 'var(--app-schrift-fett)',
                textAlign: 'center',
                marginBottom: 'var(--app-abstand-eng)',
                color: 'var(--app-text-emphasis)'
              }}>
                {eventName}
              </div>

              {/* Event Datum/Uhrzeit */}
              <div className="qr-display-event-date" style={{
                fontSize: 'var(--app-text-standard)',
                color: 'var(--app-text-secondary)',
                textAlign: 'center',
                marginBottom: 'var(--app-abstand-weit)'
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
                    border: '2px solid var(--app-border)',
                    borderRadius: 'var(--app-radius-karte)',
                    padding: 'var(--app-abstand-basis)',
                    backgroundColor: 'white'
                  }}
                />
              )}

              {/* Live-Zaehler */}
              <div className="qr-display-counter" style={{
                fontSize: 'var(--app-anzeige-basis)',
                fontWeight: 'var(--app-schrift-fett)',
                marginTop: 'var(--app-abstand-weit)',
                color: 'var(--app-text-emphasis)'
              }}>
                {checkedIn} / {total} eingecheckt
              </div>

              {/* Hinweistext */}
              <div className="qr-display-hint" style={{
                color: 'var(--app-text-muted)',
                fontSize: 'var(--app-text-basis)',
                marginTop: 'var(--app-abstand-basis)',
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
