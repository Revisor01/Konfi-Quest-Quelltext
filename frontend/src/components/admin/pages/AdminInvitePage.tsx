import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect } from 'react';
import { QR_FARBEN } from '../../../theme/colors';
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
  ICON_GRUPPE_GEFUELLT,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_JAHRGANG_GEFUELLT,
  ICON_KOPIEREN,
  ICON_LOESCHEN_GEFUELLT,
  ICON_OFFLINE,
  ICON_QRCODE_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_TEILEN,
  ICON_UHRZEIT_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import QRCode from 'qrcode';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { tageBis } from '../../shared/eventFormatting';

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

  // Offline-Query: Jahrgänge
  const { data: jahrgaenge } = useOfflineQuery<Jahrgang[]>(
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
        width: 256, margin: 2, color: { dark: QR_FARBEN.dunkel, light: QR_FARBEN.hell }
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
    if (offlineBlockiert(isOnline, setError)) return;
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
          dark: QR_FARBEN.dunkel,
          light: QR_FARBEN.hell
        }
      });
      setQrCodeDataUrl(qrDataUrl);

      await refreshInvites(); // Reload to show in existing invites
    } catch (error) {
      setError(fehlerText(error, 'Fehler beim Generieren des Codes'));
    } finally {
      setGeneratingCode(false);
    }
  };

  const extendInvite = async (inviteId: number) => {
    if (offlineBlockiert(isOnline, setError)) return;
    try {
      setExtendingInvite(inviteId);
      await api.post(`/auth/invite-codes/${inviteId}/extend`);
      await refreshInvites();
    } catch (error) {
      setError(fehlerText(error, 'Fehler beim Verlängern des Codes'));
    } finally {
      setExtendingInvite(null);
    }
  };

  const deleteInvite = (invite: ExistingInvite) => {
    if (offlineBlockiert(isOnline, setError)) return;
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
            } catch (err) {
              setError(fehlerText(err, 'Fehler beim Löschen'));
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
      color: { dark: QR_FARBEN.dunkel, light: QR_FARBEN.hell }
    });
    setInviteCode(invite.invite_code);
    setQrCodeDataUrl(qrDataUrl);
    setSelectedJahrgang(invite.jahrgang_id);
  };

  const formatExpiryDate = (dateString: string) => {
    // Kalendertage statt 24-Stunden-Bloecke: Ein Code, der heute Abend
    // ablaeuft, ergab aufgerundet 1 und stand als "Laeuft morgen ab" da.
    const diffDays = tageBis(new Date(dateString));

    if (diffDays < 0) return 'Abgelaufen';
    if (diffDays === 0) return 'Läuft heute ab';
    if (diffDays === 1) return 'Läuft morgen ab';
    return `Noch ${diffDays} Tage gültig`;
  };

  const copyInviteLink = async () => {
    if (!inviteCode) return;

    const registrationUrl = `https://konfi-quest.de/register?code=${inviteCode}`;
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setSuccess('Link kopiert');
    } catch {
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
      } catch {
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
            <IonButton onClick={handleClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Konfis einladen</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-block)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            {/* Jahrgang Auswahl */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--users">
                  <IonIcon icon={ICON_JAHRGANG_GEFUELLT} />
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
                    style={{ marginTop: 'var(--app-abstand-basis)' }}
                  >
                    {generatingCode ? (
                      <IonSpinner name="crescent" />
                    ) : !isOnline ? (
                      <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</>
                    ) : (
                      <>
                        <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} slot="start" />
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
                    <IonIcon icon={ICON_ZUSAGE_GEFUELLT} />
                  </div>
                  <IonLabel>Aktive Einladungscodes</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {(existingInvites || []).map((invite, index) => (
                        <IonItemSliding key={invite.id} style={{ marginBottom: index < (existingInvites || []).length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
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
                                borderLeftColor: 'var(--app-color-success-strong)'
                              }}
                            >
                              {/* Corner Badge - Gültigkeit */}
                              <div className="app-corner-badges">
                                <div className="app-corner-badge" style={{ backgroundColor: 'var(--app-color-success-strong)' }}>
                                  {formatExpiryDate(invite.expires_at)}
                                </div>
                              </div>
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-success-strong)' }}>
                                    <IonIcon icon={ICON_QRCODE_GEFUELLT} />
                                  </div>
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title" style={{ paddingRight: 'var(--app-freiraum-aktion-xxl)' }}>
                                      {invite.jahrgang_name}
                                    </div>
                                    <div className="app-list-item__meta">
                                      <span className="app-list-item__meta-item" style={{ fontFamily: 'monospace', letterSpacing: '1px' }}>
                                        {invite.invite_code}
                                      </span>
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_GRUPPE_GEFUELLT} style={{ color: 'var(--app-color-users)' }} />
                                        {invite.used_count || 0}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </IonItem>
                          <IonItemOptions side="end" className="app-swipe-actions">
                            {/* Solange verlaengert wird, den Spinner zeigen und
                                die Aktion sperren - sonst wischt man ein
                                zweites Mal, weil nichts passiert. */}
                            <IonItemOption
                              onClick={() => { closeOpenSlidingItems(); extendInvite(invite.id); }}
                              aria-label="Einladung verlängern"
                              className="app-swipe-action"
                              disabled={extendingInvite === invite.id}
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--success">
                                {extendingInvite === invite.id
                                  ? <IonSpinner name="crescent" />
                                  : <IonIcon icon={ICON_UHRZEIT_GEFUELLT} />}
                              </div>
                            </IonItemOption>
                            <IonItemOption
                              onClick={() => { closeOpenSlidingItems(); deleteInvite(invite); }}
                              aria-label="Einladung löschen"
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
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
                    <IonIcon icon={ICON_QRCODE_GEFUELLT} />
                  </div>
                  <IonLabel>QR-Code</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent style={{ padding: 'var(--app-abstand-weit)', textAlign: 'center' }}>
                    <img
                      src={qrCodeDataUrl}
                      alt="QR Code für Registrierung"
                      style={{
                        width: '200px',
                        height: '200px',
                        margin: '0 auto var(--app-abstand-basis) auto',
                        display: 'block',
                        borderRadius: 'var(--app-radius-karte)',
                        boxShadow: 'var(--app-schatten-schwebend)'
                      }}
                    />
                    <p className="app-settings-item__subtitle" style={{ fontSize: 'var(--app-text-basis)', margin: '0 0 var(--app-abstand-eng) 0' }}>
                      Konfis scannen diesen Code, um sich selbst zu registrieren.
                    </p>
                    <div style={{
                      background: 'var(--app-surface-muted)',
                      borderRadius: 'var(--app-radius-klein)',
                      padding: 'var(--app-abstand-mittel)',
                      marginBottom: 'var(--app-abstand-basis)'
                    }}>
                      <IonText color="medium">
                        <small>Einladungscode:</small>
                      </IonText>
                      <div style={{
                        fontFamily: 'monospace',
                        fontSize: 'var(--app-text-untertitel)',
                        fontWeight: 'var(--app-schrift-halbfett)',
                        color: 'var(--app-color-info)',
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
                        <IonIcon icon={ICON_KOPIEREN} slot="start" />
                        Link kopieren
                      </IonButton>
                      <IonButton
                        expand="block"
                        onClick={shareInvite}
                      >
                        <IonIcon icon={ICON_TEILEN} slot="start" />
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
