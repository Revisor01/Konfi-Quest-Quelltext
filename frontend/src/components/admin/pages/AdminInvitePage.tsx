import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonButtons,
  IonIcon,
  IonSpinner,
  IonText,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  useIonAlert
} from '@ionic/react';
import {
  closeOutline,
  qrCode,
  school,
  copyOutline,
  shareOutline,
  add,
  time,
  checkmarkCircle,
  people,
  trash,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import QRCode from 'qrcode';

interface Jahrgang {
  id: number;
  name: string;
}

interface ExistingInvite {
  id: number;
  invite_code: string;
  jahrgang_id: number;
  jahrgang_name: string;
  expires_at: string;
  used_count: number;
}

interface AdminInviteModalProps {
  onClose: () => void;
  dismiss?: () => void;
}

const AdminInvitePage: React.FC<AdminInviteModalProps> = ({ onClose, dismiss }) => {
  const { user, setSuccess, setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  // Offline-Query: Jahrgaenge
  const { data: jahrgaenge, refresh: refreshJahrgaenge } = useOfflineQuery<Jahrgang[]>(
    'admin:jahrgaenge:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  // Offline-Query: Invite Codes
  const { data: existingInvites, loading, refresh: refreshInvites } = useOfflineQuery<ExistingInvite[]>(
    'admin:invite-codes:' + user?.organization_id,
    async () => {
      try {
        const res = await api.get('/auth/invite-codes');
        return res.data || [];
      } catch {
        return [];
      }
    },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  const [selectedJahrgang, setSelectedJahrgang] = useState<number | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [extendingInvite, setExtendingInvite] = useState<number | null>(null);
  const [initialQrShown, setInitialQrShown] = useState(false);

  // Initialen Jahrgang und QR-Code setzen wenn Daten geladen
  useEffect(() => {
    if (initialQrShown || !jahrgaenge || !existingInvites) return;
    if (jahrgaenge.length > 0 && !selectedJahrgang) {
      setSelectedJahrgang(jahrgaenge[0].id);
    }
    const validInvites = (existingInvites || []).filter((invite: ExistingInvite) => {
      return new Date(invite.expires_at).getTime() > Date.now();
    });
    if (validInvites.length > 0) {
      const firstValid = validInvites[0];
      const registrationUrl = `https://konfi-quest.de/register?code=${firstValid.invite_code}`;
      QRCode.toDataURL(registrationUrl, {
        width: 256, margin: 2, color: { dark: '#000000', light: '#ffffff' }
      }).then(qrDataUrl => {
        setInviteCode(firstValid.invite_code);
        setQrCodeDataUrl(qrDataUrl);
        setSelectedJahrgang(firstValid.jahrgang_id);
        setInitialQrShown(true);
      });
    } else {
      setInitialQrShown(true);
    }
  }, [jahrgaenge, existingInvites, initialQrShown, selectedJahrgang]);

  const generateInviteCode = async () => {
    if (!isOnline) return;
    if (!selectedJahrgang) {
      setError('Bitte wähle einen Jahrgang aus');
      return;
    }

    try {
      setGeneratingCode(true);
      const response = await api.post('/auth/invite-code', {
        jahrgang_id: selectedJahrgang
      });

      const code = response.data.invite_code;
      setInviteCode(code);

      // Generate QR Code - immer https://konfi-quest.de verwenden
      const registrationUrl = `https://konfi-quest.de/register?code=${code}`;
      const qrDataUrl = await QRCode.toDataURL(registrationUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(qrDataUrl);

      await refreshInvites(); // Reload to show in existing invites
    } catch (error: any) {
      setError(error.response?.data?.error || 'Fehler beim Generieren des Codes');
    } finally {
      setGeneratingCode(false);
    }
  };

  const extendInvite = async (inviteId: number) => {
    if (!isOnline) return;
    try {
      setExtendingInvite(inviteId);
      await api.post(`/auth/invite-codes/${inviteId}/extend`);
      await refreshInvites();
    } catch (error: any) {
      setError(error.response?.data?.error || 'Fehler beim Verlängern des Codes');
    } finally {
      setExtendingInvite(null);
    }
  };

  const deleteInvite = (invite: ExistingInvite) => {
    if (!isOnline) return;
    presentAlert({
      header: 'Code löschen',
      message: `Einladungscode "${invite.invite_code}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/auth/invite-codes/${invite.id}`);
              if (inviteCode === invite.invite_code) {
                setInviteCode(null);
                setQrCodeDataUrl(null);
              }
              await refreshInvites();
            } catch (err: any) {
              setError(err.response?.data?.error || 'Fehler beim Löschen');
            }
          }
        }
      ]
    });
  };

  const showExistingInviteQR = async (invite: ExistingInvite) => {
    const registrationUrl = `https://konfi-quest.de/register?code=${invite.invite_code}`;
    const qrDataUrl = await QRCode.toDataURL(registrationUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
    setInviteCode(invite.invite_code);
    setQrCodeDataUrl(qrDataUrl);
    setSelectedJahrgang(invite.jahrgang_id);
  };

  const formatExpiryDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Abgelaufen';
    if (diffDays === 1) return 'Läuft morgen ab';
    return `Noch ${diffDays} Tage gültig`;
  };

  const copyInviteLink = async () => {
    if (!inviteCode) return;

    const registrationUrl = `https://konfi-quest.de/register?code=${inviteCode}`;
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setSuccess('Link kopiert');
    } catch (error) {
      setError('Fehler beim Kopieren');
    }
  };

  const shareInvite = async () => {
    if (!inviteCode) return;

    const registrationUrl = `https://konfi-quest.de/register?code=${inviteCode}`;
    const jahrgangName = (jahrgaenge || []).find(j => j.id === selectedJahrgang)?.name || 'Konfi';

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Konfi Quest - Einladung',
          text: `Registriere dich für ${jahrgangName} bei Konfi Quest!`,
          url: registrationUrl
        });
      } catch (error) {
        // User cancelled share
      }
    } else {
      copyInviteLink();
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={handleClose}>
              <IonIcon icon={closeOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Konfis einladen</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            {/* Jahrgang Auswahl */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--users">
                  <IonIcon icon={school} />
                </div>
                <IonLabel>Jahrgang auswählen</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <IonItem lines="none" className="app-item-transparent">
                      <IonLabel position="stacked">Jahrgang *</IonLabel>
                      <IonSelect
                        value={selectedJahrgang}
                        onIonChange={(e) => {
                          setSelectedJahrgang(e.detail.value);
                          setInviteCode(null);
                          setQrCodeDataUrl(null);
                        }}
                        placeholder="Jahrgang wählen"
                        interface="popover"
                      >
                        {(jahrgaenge || []).map((jahrgang) => (
                          <IonSelectOption key={jahrgang.id} value={jahrgang.id}>
                            {jahrgang.name}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonItem>
                  </div>
                  <IonButton
                    expand="block"
                    fill="outline"
                    onClick={generateInviteCode}
                    disabled={generatingCode || !selectedJahrgang || !isOnline}
                    style={{ marginTop: '16px' }}
                  >
                    {generatingCode ? (
                      <IonSpinner name="crescent" />
                    ) : !isOnline ? (
                      <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</>
                    ) : (
                      <>
                        <IonIcon icon={add} slot="start" />
                        Einladungslink generieren
                      </>
                    )}
                  </IonButton>
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* Bestehende Einladungscodes */}
            {(existingInvites || []).length > 0 && (
              <IonList inset={true} className="app-segment-wrapper">
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--users">
                    <IonIcon icon={checkmarkCircle} />
                  </div>
                  <IonLabel>Aktive Einladungscodes</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {(existingInvites || []).map((invite, index) => (
                        <IonItemSliding key={invite.id} style={{ marginBottom: index < (existingInvites || []).length - 1 ? '8px' : '0' }}>
                          <IonItem
                            button
                            onClick={() => showExistingInviteQR(invite)}
                            detail={false}
                            lines="none"
                            style={{
                              '--background': 'transparent',
                              '--padding-start': '0',
                              '--padding-end': '0',
                              '--inner-padding-end': '0',
                              '--inner-border-width': '0',
                              '--border-style': 'none',
                              '--min-height': 'auto'
                            }}
                          >
                            <div
                              className="app-list-item"
                              style={{
                                width: '100%',
                                position: 'relative',
                                overflow: 'hidden',
                                borderLeftColor: '#059669'
                              }}
                            >
                              {/* Corner Badge - Gültigkeit */}
                              <div className="app-corner-badges">
                                <div className="app-corner-badge" style={{ backgroundColor: '#059669' }}>
                                  {formatExpiryDate(invite.expires_at)}
                                </div>
                              </div>
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  <div className="app-icon-circle" style={{ backgroundColor: '#059669' }}>
                                    <IonIcon icon={qrCode} />
                                  </div>
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title" style={{ paddingRight: '100px' }}>
                                      {invite.jahrgang_name}
                                    </div>
                                    <div className="app-list-item__meta">
                                      <span className="app-list-item__meta-item" style={{ fontFamily: 'monospace', letterSpacing: '1px' }}>
                                        {invite.invite_code}
                                      </span>
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={people} style={{ color: '#667eea' }} />
                                        {invite.used_count || 0}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </IonItem>
                          <IonItemOptions side="end" className="app-swipe-actions">
                            <IonItemOption
                              onClick={() => extendInvite(invite.id)}
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--success">
                                <IonIcon icon={time} />
                              </div>
                            </IonItemOption>
                            <IonItemOption
                              onClick={() => deleteInvite(invite)}
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                <IonIcon icon={trash} />
                              </div>
                            </IonItemOption>
                          </IonItemOptions>
                        </IonItemSliding>
                      ))}
                    </div>
                  </IonCardContent>
                </IonCard>
              </IonList>
            )}

            {/* QR Code Anzeige */}
            {qrCodeDataUrl && inviteCode && (
              <IonList inset={true} className="app-segment-wrapper">
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--users">
                    <IonIcon icon={qrCode} />
                  </div>
                  <IonLabel>QR-Code</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent style={{ padding: '24px', textAlign: 'center' }}>
                    <img
                      src={qrCodeDataUrl}
                      alt="QR Code für Registrierung"
                      style={{
                        width: '200px',
                        height: '200px',
                        margin: '0 auto 16px auto',
                        display: 'block',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }}
                    />
                    <p className="app-settings-item__subtitle" style={{ fontSize: '0.9rem', margin: '0 0 8px 0' }}>
                      Konfis scannen diesen Code, um sich selbst zu registrieren.
                    </p>
                    <div style={{
                      background: '#f5f5f5',
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '16px'
                    }}>
                      <IonText color="medium">
                        <small>Einladungscode:</small>
                      </IonText>
                      <div style={{
                        fontFamily: 'monospace',
                        fontSize: '1.2rem',
                        fontWeight: '600',
                        color: '#007aff',
                        letterSpacing: '2px'
                      }}>
                        {inviteCode}
                      </div>
                    </div>
                    <div className="app-button-row">
                      <IonButton
                        expand="block"
                        fill="outline"
                        onClick={copyInviteLink}
                      >
                        <IonIcon icon={copyOutline} slot="start" />
                        Link kopieren
                      </IonButton>
                      <IonButton
                        expand="block"
                        onClick={shareInvite}
                      >
                        <IonIcon icon={shareOutline} slot="start" />
                        Teilen
                      </IonButton>
                    </div>
                  </IonCardContent>
                </IonCard>
              </IonList>
            )}

            {/* Info */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonCard className="app-card app-info-box--blue">
                <IonCardContent className="app-info-box">
                  <p style={{ margin: 0 }}>
                    Einladungscodes sind 7 Tage gültig und können von beliebig vielen Konfis verwendet werden. Konfis werden automatisch dem gewählten Jahrgang zugeordnet.
                  </p>
                </IonCardContent>
              </IonCard>
            </IonList>
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminInvitePage;
