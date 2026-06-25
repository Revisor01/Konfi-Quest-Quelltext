import React, { useState, useEffect } from 'react';
import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonNote,
  IonIcon,
  IonText
} from '@ionic/react';
import { chatbubbles, save } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

const ChatPermissionsSettings: React.FC = () => {
  const { setError, setSuccess } = useApp();
  const [permissions, setPermissions] = useState<string>('admins_only');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    try {
      const response = await api.get('/settings');
      const settings = response.data;
      setPermissions(settings.konfi_chat_permissions || 'admins_only');
    } catch (err) {
 console.error('Error loading settings:', err);
      setError('Fehler beim Laden der Chat-Einstellungen');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    // Offline: Queue-Fallback (fire-and-forget)
    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'PUT',
        url: '/admin/settings',
        body: { konfi_chat_permissions: permissions },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Chat-Berechtigungen' },
      });
      setSuccess('Chat-Berechtigungen werden bei Verbindung gespeichert');
      return;
    }

    setSaving(true);
    try {
      await api.put('/admin/settings', {
        konfi_chat_permissions: permissions
      });
      setSuccess('Chat-Berechtigungen erfolgreich gespeichert');
    } catch (err) {
 console.error('Error saving chat permissions:', err);
      setError('Fehler beim Speichern der Chat-Berechtigungen');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const getPermissionDescription = (value: string) => {
    switch (value) {
      case 'admins_only':
        return 'Konfis können nur mit ihren zugewiesenen Admins chatten (sicherste Einstellung)';
      case 'all_in_jahrgang':
        return 'Konfis können mit allen Personen in ihrem Jahrgang chatten (Admins + andere Konfis)';
      default:
        return '';
    }
  };

  if (loading) {
    return (
      <IonCard>
        <IonCardContent>
          <IonText>Lade Chat-Einstellungen...</IonText>
        </IonCardContent>
      </IonCard>
    );
  }

  return (
    <IonCard>
      <IonCardHeader>
        <IonCardTitle>Chat-Berechtigungen</IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <IonItem>
          <IonIcon icon={chatbubbles} slot="start" color="primary" />
          <IonLabel>
            <h2>Konfi Chat-Berechtigungen</h2>
            <p>Bestimme, welche Art von Chats Konfis erstellen können</p>
          </IonLabel>
        </IonItem>

        <IonItem>
          <IonLabel position="stacked">Berechtigungsstufe</IonLabel>
          <IonSelect
            value={permissions}
            onIonChange={(e) => setPermissions(e.detail.value)}
            interface="action-sheet"
            placeholder="Berechtigungsstufe wählen"
          >
            <IonSelectOption value="admins_only">
              Nur mit Admins chatten
            </IonSelectOption>
            <IonSelectOption value="all_in_jahrgang">
              Mit allen im Jahrgang chatten
            </IonSelectOption>
          </IonSelect>
        </IonItem>

        <IonNote color="medium" style={{ 
          fontSize: '0.9em', 
          marginTop: '8px', 
          display: 'block',
          padding: '8px 16px'
        }}>
          <strong>Aktuelle Einstellung:</strong> {getPermissionDescription(permissions)}
        </IonNote>

        <IonButton
          expand="block"
          onClick={saveSettings}
          disabled={saving}
          style={{ marginTop: '16px' }}
        >
          <IonIcon icon={save} slot="start" />
          {saving ? 'Speichere...' : 'Einstellungen speichern'}
        </IonButton>
      </IonCardContent>
    </IonCard>
  );
};

export default ChatPermissionsSettings;