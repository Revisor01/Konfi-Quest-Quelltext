import React, { useEffect, useState } from 'react';
import {
  IonItem,
  IonLabel,
  IonButton,
  IonIcon,
  IonNote,
  IonCard,
  IonCardContent,
  IonToggle,
  IonSpinner
} from '@ionic/react';
import { notifications } from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { useApp } from '../../contexts/AppContext';
import api from '../../services/api';

const PushNotificationSettings: React.FC = () => {
  const { pushNotificationsPermission, requestPushPermissions } = useApp();

  // Master-Schalter: globaler Push an/aus fuer diesen User (Backend users.push_enabled)
  const [pushEnabled, setPushEnabled] = useState<boolean>(true);
  const [prefLoading, setPrefLoading] = useState<boolean>(true);
  const [prefSaving, setPrefSaving] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get('/notifications/preferences');
        if (active) setPushEnabled(res.data?.push_enabled !== false);
      } catch {
        // Bei Fehler optimistisch auf true lassen
      } finally {
        if (active) setPrefLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const handleToggle = async (value: boolean) => {
    const previous = pushEnabled;
    setPushEnabled(value); // optimistisch
    setPrefSaving(true);
    try {
      await api.put('/notifications/preferences', { push_enabled: value });
    } catch {
      setPushEnabled(previous); // Rollback bei Fehler
    } finally {
      setPrefSaving(false);
    }
  };

  const getPermissionText = () => {
    switch (pushNotificationsPermission) {
      case 'granted':
        return 'Aktiviert';
      case 'denied':
        return 'Deaktiviert';
      case 'prompt':
        return 'Nicht gefragt';
      default:
        return 'Unbekannt';
    }
  };

  const getPermissionColor = () => {
    switch (pushNotificationsPermission) {
      case 'granted':
        return 'success';
      case 'denied':
        return 'danger';
      default:
        return 'warning';
    }
  };

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '12px'
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          backgroundColor: '#ff9500',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(255, 149, 0, 0.3)',
          flexShrink: 0
        }}>
          <IonIcon icon={notifications} style={{ fontSize: '1rem', color: 'white' }} />
        </div>
        <h2 style={{
          fontWeight: '600',
          fontSize: '1.1rem',
          margin: '0',
          color: '#333'
        }}>
          Push Notifications
        </h2>
      </div>
      <IonCard style={{
        borderRadius: '12px',
        background: 'white',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        border: '1px solid #e0e0e0',
        margin: '0'
      }}>
        <IonCardContent style={{ padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <IonItem
              lines="none"
              style={{
                '--min-height': '56px',
                '--padding-start': '16px',
                '--background': '#fbfbfb',
                '--border-radius': '12px',
                margin: '6px 0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: '1px solid #e0e0e0',
                borderRadius: '12px'
              }}
            >
              <div slot="start" style={{
                width: '40px',
                height: '40px',
                backgroundColor: '#ff9500',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: '12px'
              }}>
                <IonIcon icon={notifications} style={{ fontSize: '1.2rem', color: 'white' }} />
              </div>
              <IonLabel>
                <h2 style={{ fontWeight: '500', fontSize: '0.95rem' }}>Chat-Benachrichtigungen</h2>
                <p style={{ fontSize: '0.8rem', color: '#666' }}>Erhalte Push-Benachrichtigungen für neue Chat-Nachrichten</p>
              </IonLabel>
              <IonNote slot="end" color={getPermissionColor()}>
                {getPermissionText()}
              </IonNote>
            </IonItem>

            {pushNotificationsPermission === 'granted' && (
              <IonItem
                lines="none"
                style={{
                  '--min-height': '56px',
                  '--padding-start': '16px',
                  '--background': '#fbfbfb',
                  '--border-radius': '12px',
                  margin: '6px 0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  border: '1px solid #e0e0e0',
                  borderRadius: '12px'
                }}
              >
                <div slot="start" style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: '#34c759',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: '12px'
                }}>
                  <IonIcon icon={notifications} style={{ fontSize: '1.2rem', color: 'white' }} />
                </div>
                <IonLabel>
                  <h2 style={{ fontWeight: '500', fontSize: '0.95rem' }}>Alle Benachrichtigungen</h2>
                  <p style={{ fontSize: '0.8rem', color: '#666' }}>Schalte sämtliche Push-Benachrichtigungen für dein Konto an oder aus</p>
                </IonLabel>
                {prefLoading ? (
                  <IonSpinner slot="end" name="crescent" />
                ) : (
                  <IonToggle
                    slot="end"
                    className="app-toggle--green"
                    checked={pushEnabled}
                    disabled={prefSaving}
                    onIonChange={(e) => handleToggle(e.detail.checked)}
                  />
                )}
              </IonItem>
            )}
          </div>

          {pushNotificationsPermission !== 'granted' && (
            <IonButton
              expand="block"
              fill="outline"
              onClick={requestPushPermissions}
              style={{ marginTop: '16px' }}
            >
              Push-Benachrichtigungen aktivieren
            </IonButton>
          )}

          {pushNotificationsPermission === 'denied' && (
            <>
              <IonNote color="medium" style={{ fontSize: '0.9em', marginTop: '8px', display: 'block' }}>
                Push-Benachrichtigungen wurden deaktiviert.
                Du kannst sie in den Geräteeinstellungen wieder aktivieren.
              </IonNote>
              <IonButton
                expand="block"
                fill="clear"
                size="small"
                onClick={() => {
                  // iOS Settings Link
                  if (Capacitor.getPlatform() === 'ios') {
                    window.open('app-settings:', '_system');
                  } else {
                    // Fallback für andere Plattformen
 console.warn('Bitte Benachrichtigungen in den Geräteeinstellungen aktivieren');
                  }
                }}
                style={{ marginTop: '8px' }}
              >
                Zu den Einstellungen
              </IonButton>
            </>
          )}
        </IonCardContent>
      </IonCard>
    </div>
  );
};

export default PushNotificationSettings;
