import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon
} from '@ionic/react';
import { ICON_KAMERA, ICON_SCHLIESSEN } from '../../shared/icons';
import QrScanner from 'qr-scanner';
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url';
import api from '../../../services/api';
import { useApp } from '../../../contexts/AppContext';

QrScanner.WORKER_PATH = QrScannerWorkerPath;

interface QRScannerModalProps {
  onClose: () => void;
  onSuccess: (eventId: number, eventName: string) => void;
}

const QRScannerModal: React.FC<QRScannerModalProps> = ({ onClose, onSuccess }) => {
  const { isOnline } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [scanning, setScanning] = useState(false);
  const [banner, setBanner] = useState<{ type: 'error' | 'info'; message: string } | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (!videoRef.current) return;

    const scanner = new QrScanner(
      videoRef.current,
      (result: QrScanner.ScanResult) => {
        handleScanResult(result.data);
      },
      {
        preferredCamera: 'environment',
        maxScansPerSecond: 5,
        highlightScanRegion: true,
        returnDetailedScanResult: true
      }
    );

    scannerRef.current = scanner;

    scanner.start().catch((err: unknown) => {
      console.error('Scanner start error:', err);
      if (String(err).toLowerCase().includes('permission') || String(err).toLowerCase().includes('denied') || String(err).toLowerCase().includes('not allowed')) {
        setPermissionDenied(true);
      } else {
        setBanner({ type: 'error', message: 'Kamera konnte nicht gestartet werden' });
      }
    });

    return () => {
      scanner.destroy();
      scannerRef.current = null;
    };
  }, []);

  const handleScanResult = async (data: string) => {
    if (scanning) return;
    if (!isOnline) {
      setBanner({ type: 'error', message: 'Du bist offline' });
      return;
    }
    setScanning(true);

    if (scannerRef.current) {
      scannerRef.current.stop();
    }

    try {
      const response = await api.post('/events/qr-checkin', { token: data });
      const { event_id, event_name, already_checked_in } = response.data;

      if (already_checked_in) {
        setBanner({ type: 'info', message: 'Du bist bereits eingecheckt' });
        setTimeout(() => {
          setBanner(null);
          setScanning(false);
          scannerRef.current?.start();
        }, 2000);
      } else {
        onSuccess(event_id, event_name);
      }
    } catch (err) {
      const errorMessage = fehlerText(err, 'QR-Code konnte nicht verarbeitet werden');
      setBanner({ type: 'error', message: errorMessage });
      setTimeout(() => {
        setBanner(null);
        setScanning(false);
        scannerRef.current?.start();
      }, 3000);
    }
  };

  if (permissionDenied) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={onClose} aria-label="Schließen">
                <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
              </IonButton>
            </IonButtons>
            <IonTitle>QR-Code scannen</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 'var(--app-abstand-extraweit)',
            textAlign: 'center'
          }}>
            <IonIcon
              icon={ICON_KAMERA}
              style={{ fontSize: 'var(--app-icon-leerzustand)', color: 'var(--ion-color-medium)', marginBottom: 'var(--app-abstand-weit)' }}
            />
            <h2 style={{ margin: '0 0 var(--app-abstand-mittel) 0', fontSize: 'var(--app-text-untertitel)' }}>Kamera-Zugriff verweigert</h2>
            <p style={{ color: 'var(--ion-color-medium)', margin: '0 0 var(--app-abstand-weit) 0', lineHeight: '1.5' }}>
              Um QR-Codes zu scannen, wird Zugriff auf die Kamera ben&ouml;tigt. Bitte erlaube den Kamera-Zugriff in den Einstellungen deines Ger&auml;ts.
            </p>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>QR-Code scannen</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent scrollY={false}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {/* Inline Banner */}
          {banner && (
            <div style={{
              position: 'absolute',
              top: '12px',
              left: '16px',
              right: '16px',
              padding: 'var(--app-abstand-mittel)',
              borderRadius: 'var(--app-radius-klein)',
              zIndex: 10,
              backgroundColor: banner.type === 'error' ? 'var(--ion-color-danger)' : 'var(--ion-color-primary)',
              color: 'white',
              fontWeight: 'var(--app-schrift-halbfett)',
              textAlign: 'center',
              fontSize: 'var(--app-text-betont)'
            }}>
              {banner.message}
            </div>
          )}

          {/* Video Preview */}
          <video
            ref={videoRef}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
          />
        </div>
      </IonContent>
    </IonPage>
  );
};

export default QRScannerModal;
