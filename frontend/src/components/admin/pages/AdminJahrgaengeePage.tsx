import {
  ICON_ABSAGE,
  ICON_EINSTELLUNGEN,
  ICON_FUNKELN,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_JAHRGANG,
  ICON_JAHRGANG_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import AppKopfzeile, { AppKopfzeileGross } from '../../shared/AppKopfzeile';
import { fehlerDaten, fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
  useIonModal,
  useIonAlert,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonInput,
  IonSpinner,
  IonToggle,
  IonRange
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { jahrgangLoeschHinweis, istLoeschVorschau, type JahrgangLoeschVorschau } from '../../../utils/jahrgangLoeschen';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader, ListSection } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';
import { sendenOderEinreihen } from '../../../utils/sendenOderEinreihen';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { tastaturKlick } from '../../../utils/tastatur';
import { datumKurz } from '../../../utils/dateUtils';
import { rollenName } from '../../../utils/rollenNamen';

// Ionic 9 gibt bei ref an IonItemSliding die React-Komponente zurueck, nicht
// mehr das DOM-Element. Gebraucht wird hier nur close() — das haben beide.
type SlidingRef = { close: () => Promise<void> };

interface Jahrgang {
  id: number;
  name: string;
  created_at: string;
  gottesdienst_enabled?: boolean;
  gemeinde_enabled?: boolean;
  target_gottesdienst?: number;
  target_gemeinde?: number;
  konfspruch_enabled?: boolean;
  wrapped_released_at?: string | null;
  konfi_count?: number;
  gottesdienst_points_total?: number;
  gemeinde_points_total?: number;
}

interface ZuweisbarePerson {
  id: number;
  display_name: string;
  role_name: string;
}

interface JahrgangModalProps {
  jahrgang?: Jahrgang | null;
  onClose: () => void;
  onSuccess: () => void;
  onRefresh?: () => void;
  dismiss?: () => void;
}

const JahrgangModal: React.FC<JahrgangModalProps> = ({
  jahrgang,
  onClose,
  onSuccess,
  // onRefresh wird von aussen uebergeben (Z. 513), hier drin aber nicht
  // gebraucht -- die Liste aktualisiert onSuccess. Bewusst nicht
  // destrukturiert, damit der Lint nicht ueber eine tote Bindung stolpert;
  // die Schnittstelle bleibt unveraendert.
  dismiss
}) => {
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };
  const { user, setSuccess, setError } = useApp();
  const [loading, setLoading] = useState(false);

  // Direkt-Zuweisung beim Anlegen: Auswahl der Personen, die Zugriff auf den
  // neuen Jahrgang bekommen. Optional — niemand MUSS zugewiesen werden.
  // Nur im Anlege-Modus relevant (beim Bearbeiten laeuft die Zuweisung wie
  // gehabt ueber Mehr > Benutzer:innen).
  const [zuweisbare, setZuweisbare] = useState<ZuweisbarePerson[]>([]);
  const [ausgewaehlt, setAusgewaehlt] = useState<{ [id: number]: boolean }>({});
  const [formData, setFormData] = useState({
    name: '',
    gottesdienst_enabled: true,
    gemeinde_enabled: true,
    target_gottesdienst: 10,
    target_gemeinde: 10,
    konfspruch_enabled: true
  });

  useEffect(() => {
    if (jahrgang) {
      setFormData({
        name: jahrgang.name,
        gottesdienst_enabled: jahrgang.gottesdienst_enabled ?? true,
        gemeinde_enabled: jahrgang.gemeinde_enabled ?? true,
        // `|| 10` wie ueberall: eine 0 aus frueheren Tagen heisst 10.
        target_gottesdienst: jahrgang.target_gottesdienst || 10,
        target_gemeinde: jahrgang.target_gemeinde || 10,
        konfspruch_enabled: jahrgang.konfspruch_enabled ?? true
      });
    } else {
      setFormData({
        name: '',
        gottesdienst_enabled: true,
        gemeinde_enabled: true,
        target_gottesdienst: 10,
        target_gemeinde: 10,
        konfspruch_enabled: true
      });
    }
    // Auswahl der Direkt-Zuweisung gehoert zum Anlege-Vorgang — beim Wechsel
    // des bearbeiteten Jahrgangs darf keine alte Auswahl haengen bleiben.
    setAusgewaehlt({});
  }, [jahrgang]);

  // Personenliste nur laden, wenn wirklich angelegt wird und der Aufrufer
  // org_admin ist — nur er darf anlegen und zuweisen. Fehler hier blockieren
  // das Anlegen nicht; die Zuweisung ist optional und geht auch spaeter.
  useEffect(() => {
    if (jahrgang || user?.role_name !== 'org_admin' || !networkMonitor.isOnline) return;
    let aktiv = true;
    (async () => {
      try {
        const res = await api.get('/users');
        if (!aktiv) return;
        const personen = (res.data as ZuweisbarePerson[]).filter(
          (p) => p.role_name === 'admin' || p.role_name === 'teamer'
        );
        setZuweisbare(personen);
      } catch {
        // still: Abschnitt bleibt leer, das Anlegen funktioniert trotzdem
      }
    })();
    return () => { aktiv = false; };
  }, [jahrgang, user?.role_name]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setError('Name ist erforderlich');
      return;
    }

    const payload: Record<string, unknown> = {
      name: formData.name.trim(),
      gottesdienst_enabled: formData.gottesdienst_enabled,
      gemeinde_enabled: formData.gemeinde_enabled,
      target_gottesdienst: formData.target_gottesdienst,
      target_gemeinde: formData.target_gemeinde,
      konfspruch_enabled: formData.konfspruch_enabled
    };

    // Direkt-Zuweisung nur beim Anlegen und nur, wenn jemand ausgewaehlt ist —
    // ohne Auswahl bleibt das Feld weg und der Server verhaelt sich wie bisher.
    // view+edit wie bei der Zuweisung ueber die Benutzerverwaltung
    // (UserManagementModal schickt dort ebenfalls beide Rechte).
    const zugewieseneIds = Object.entries(ausgewaehlt)
      .filter(([, gewaehlt]) => gewaehlt)
      .map(([id]) => parseInt(id, 10));
    if (!jahrgang && zugewieseneIds.length > 0) {
      payload.user_assignments = zugewieseneIds.map((id) => ({
        user_id: id,
        can_view: true,
        can_edit: true
      }));
    }

    setLoading(true);
    try {
      // Bearbeiten (PUT) faellt auch bei einem Netzabbruch im Online-Zweig in
      // die Warteschlange; Anlegen (POST ohne Idempotenzschluessel) nur
      // offline -- nach einem Abbruch bleibt es dort beim Fehler, sonst
      // entstuende der Eintrag womoeglich doppelt.
      const { weg } = await sendenOderEinreihen({
        online: networkMonitor.isOnline,
        methode: jahrgang ? 'PUT' : 'POST',
        senden: () => (jahrgang ? api.put(`/admin/jahrgaenge/${jahrgang.id}`, payload) : api.post('/admin/jahrgaenge', payload)),
        einreihen: () => writeQueue.enqueue({
          method: jahrgang ? 'PUT' : 'POST',
          url: jahrgang ? `/admin/jahrgaenge/${jahrgang.id}` : '/admin/jahrgaenge',
          body: payload,
          maxRetries: 5,
          hasFileUpload: false,
          metadata: {
            type: 'admin',
            clientId: safeUUID(),
            label: jahrgang ? 'Jahrgang bearbeiten' : 'Jahrgang erstellen'
          }
        }),
      });
      if (weg === 'eingereiht') setSuccess('Wird gespeichert sobald du wieder online bist');
      onSuccess();
      handleClose();
    } catch (error) {
      setError(fehlerText(error, 'Fehler beim Speichern des Jahrgangs'));
    } finally {
      setLoading(false);
    }
  };



  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            {jahrgang ? 'Jahrgang bearbeiten' : 'Neuer Jahrgang'}
          </IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={handleClose} disabled={loading}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Jahrgang speichern"
              onClick={handleSubmit}
              disabled={!formData.name.trim() || loading}
            >
              {loading ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={ICON_HAKEN} />
              )}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Jahrgang Details - iOS26 Pattern */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--jahrgang">
              <IonIcon icon={ICON_JAHRGANG_GEFUELLT} />
            </div>
            <IonLabel>Jahrgang Details</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Name *</IonLabel>
                  <IonInput aria-label="Name" aria-required="true"
                    value={formData.name}
                    onIonInput={(e) => setFormData({ ...formData, name: e.detail.value! })}
                    placeholder="z.B. Jahrgang 2024/2025"
                    disabled={loading}
                    clearInput={true}
                  />
                </IonItem>
              </IonList>
              <p style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)', margin: 'var(--app-abstand-eng) var(--app-abstand-mini) 0', lineHeight: 1.4 }}>
                Hier steuerst du diesen Jahrgang zentral: Punkteziele und die Freischaltung der Konfispruch-Auswahl.
              </p>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Punkte-Konfiguration */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--jahrgang">
              <IonIcon icon={ICON_EINSTELLUNGEN} />
            </div>
            <IonLabel>Punkte-Konfiguration</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel>Gottesdienst-Punkte aktiviert</IonLabel>
                  <IonToggle aria-label="Gottesdienst-Punkte aktiviert"
                    slot="end"
                    className="app-toggle--jahrgang"
                    checked={formData.gottesdienst_enabled}
                    onIonChange={(e) => setFormData({ ...formData, gottesdienst_enabled: e.detail.checked })}
                    disabled={loading || (!formData.gemeinde_enabled)}
                  />
                </IonItem>
                {!formData.gemeinde_enabled && formData.gottesdienst_enabled && (
                  <div style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-badges)', marginTop: 'var(--app-abstand-mini)', paddingLeft: 'var(--app-abstand-basis)' }}>
                    Mindestens ein Punkt-Typ muss aktiv bleiben.{jahrgang?.konfi_count ? ` ${jahrgang.konfi_count} Konfis haben bereits Gottesdienst-Punkte.` : ''}
                  </div>
                )}
                {formData.gottesdienst_enabled && (
                  <IonItem lines="full" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Ziel Gottesdienst <span style={{ fontWeight: 'var(--app-schrift-fett)', color: 'var(--ion-color-primary)' }}>{formData.target_gottesdienst}</span></IonLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', width: '100%' }}>
                      <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>1</span>
                      <IonRange aria-label="Ziel Gottesdienst"
                        min={1} max={20} step={1}
                        pin={true} pinFormatter={(value: number) => `${value}`}
                        value={formData.target_gottesdienst}
                        onIonChange={(e) => setFormData({ ...formData, target_gottesdienst: e.detail.value as number })}
                        disabled={loading}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>20</span>
                    </div>
                  </IonItem>
                )}
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel>Gemeinde-Punkte aktiviert</IonLabel>
                  <IonToggle aria-label="Gemeinde-Punkte aktiviert"
                    slot="end"
                    className="app-toggle--jahrgang"
                    checked={formData.gemeinde_enabled}
                    onIonChange={(e) => setFormData({ ...formData, gemeinde_enabled: e.detail.checked })}
                    disabled={loading || (!formData.gottesdienst_enabled)}
                  />
                </IonItem>
                {!formData.gottesdienst_enabled && formData.gemeinde_enabled && (
                  <div style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-badges)', marginTop: 'var(--app-abstand-mini)', paddingLeft: 'var(--app-abstand-basis)' }}>
                    Mindestens ein Punkt-Typ muss aktiv bleiben.{jahrgang?.konfi_count ? ` ${jahrgang.konfi_count} Konfis haben bereits Gemeinde-Punkte.` : ''}
                  </div>
                )}
                {formData.gemeinde_enabled && (
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Ziel Gemeinde <span style={{ fontWeight: 'var(--app-schrift-fett)', color: 'var(--ion-color-primary)' }}>{formData.target_gemeinde}</span></IonLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)', width: '100%' }}>
                      <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>1</span>
                      <IonRange aria-label="Ziel Gemeinde"
                        min={1} max={20} step={1}
                        pin={true} pinFormatter={(value: number) => `${value}`}
                        value={formData.target_gemeinde}
                        onIonChange={(e) => setFormData({ ...formData, target_gemeinde: e.detail.value as number })}
                        disabled={loading}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)', minWidth: '24px', textAlign: 'center' }}>20</span>
                    </div>
                  </IonItem>
                )}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Konfispruch */}
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--jahrgang">
              <IonIcon icon={ICON_FUNKELN} />
            </div>
            <IonLabel>Konfispruch</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines={jahrgang ? 'full' : 'none'} style={{ '--background': 'transparent' }}>
                  <IonLabel>
                    <h3 style={{ margin: 0 }}>Konfispruch-Auswahl</h3>
                    <p style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)', whiteSpace: 'normal' }}>
                      Konfis dieses Jahrgangs können ihren Konfispruch wählen.
                    </p>
                  </IonLabel>
                  <IonToggle aria-label="Konfispruch-Auswahl"
                    slot="end"
                    className="app-toggle--jahrgang"
                    checked={formData.konfspruch_enabled}
                    onIonChange={(e) => setFormData({ ...formData, konfspruch_enabled: e.detail.checked })}
                    disabled={loading}
                  />
                </IonItem>
                {/*
                    Warum: Ein Schalter kann nur EINEN Zustand abbilden, an
                    oder aus. Seit es mehrere Ausgaben je Jahrgang gibt
                    ("Zwischenstand", "Dein Abschluss"), passt das nicht mehr --
                    er koennte weder benennen noch eine einzelne Ausgabe
                    loeschen. Das liegt jetzt unter Mehr > Jahresrueckblick
                    (AdminWrappedPage). */}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Direkt-Zuweisung beim Anlegen (nur Org-Admin, nur im Anlege-Modus).
            Optional: Ohne Auswahl entsteht der Jahrgang wie bisher ohne
            Zuweisungen — nachtraeglich geht es weiter ueber die
            Benutzerverwaltung. */}
        {!jahrgang && user?.role_name === 'org_admin' && zuweisbare.length > 0 && (
          <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--jahrgang">
                <IonIcon icon={ICON_GRUPPE_GEFUELLT} />
              </div>
              <IonLabel>Zugriff für Leitung & Team</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {zuweisbare.map((person, index) => {
                    const istGewaehlt = ausgewaehlt[person.id] || false;
                    return (
                      <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
                        key={person.id}
                        className="app-list-item app-list-item--jahrgang"
                        onClick={() => !loading && setAusgewaehlt(prev => ({ ...prev, [person.id]: !istGewaehlt }))}
                        style={{
                          cursor: loading ? 'default' : 'pointer',
                          opacity: loading ? 0.6 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: index < zuweisbare.length - 1 ? 'var(--app-abstand-eng)' : '0',
                          background: istGewaehlt ? 'rgba(var(--app-color-users-rgb), 0.08)' : undefined
                        }}
                      >
                        <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>{person.display_name}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)' }}>
                          <span style={{ fontSize: 'var(--app-text-klein)', color: 'var(--app-text-system)' }}>
                            {rollenName(person.role_name)}
                          </span>
                          {istGewaehlt && <IonIcon icon={ICON_ZUSAGE_GEFUELLT} style={{ color: 'var(--app-color-success)' }} />}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)', margin: 'var(--app-abstand-mittel) var(--app-abstand-mini) 0', lineHeight: 1.4 }}>
                  Ausgewählte Personen sehen und bearbeiten den neuen Jahrgang sofort. Ohne Auswahl kannst du die Zuweisung später unter „Benutzer:innen" vergeben.
                </p>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

const AdminJahrgaengeePage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('admin-jahrgaenge');
  const { user, setError, isOnline } = useApp();

  // Offline-Query: Jahrgänge
  const { data: jahrgaenge, loading, refresh: refreshJahrgaenge, refreshLive: refreshJahrgaengeLive } = useOfflineQuery<Jahrgang[]>(
    'admin:jahrgaenge-detail:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  const [editJahrgang, setEditJahrgang] = useState<Jahrgang | null>(null);
  const slidingRefs = useRef<Map<number, SlidingRef>>(new Map());

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  const [presentJahrgangModalHook, dismissJahrgangModalHook] = useIonModal(JahrgangModal, {
    jahrgang: editJahrgang,
    onClose: () => dismissJahrgangModalHook(),
    onSuccess: () => {
      dismissJahrgangModalHook();
      refreshJahrgaenge();
    },
    // Aktualisiert die Liste, ohne das Modal zu schliessen.
    onRefresh: () => refreshJahrgaenge()
  });

  // Subscribe to live updates for jahrgaenge
  useLiveRefresh('jahrgaenge', refreshJahrgaengeLive);

  const handleRefresh = async (event: CustomEvent) => {
    await refreshJahrgaenge();
    (event.target as HTMLIonRefresherElement).complete();
  };

  const handleDeleteWithSlideClose = async (jahrgang: Jahrgang, forceDelete = false) => {
    if (offlineBlockiert(isOnline, setError)) return;
    const performDelete = async () => {
      const slidingElement = slidingRefs.current.get(jahrgang.id);
      try {
        const url = forceDelete ? `/admin/jahrgaenge/${jahrgang.id}?force=true` : `/admin/jahrgaenge/${jahrgang.id}`;
        await api.delete(url);
        refreshJahrgaenge();
      } catch (error) {
        if (slidingElement) {
          await slidingElement.close();
        }

        if (fehlerDaten(error)?.canForceDelete) {
          // Wer den Jahrgang loeschen darf, darf es auch mit Chat-Nachrichten
          // (jahrgaenge.js setzt canForceDelete fuer alle mit Loeschrecht).
          presentAlert({
            header: 'Chat-Nachrichten vorhanden',
            message: `${fehlerText(error, 'Der Jahrgang enthält Chat-Nachrichten.')}\n\nDu kannst den Jahrgang trotzdem löschen. Dadurch werden ALLE Chat-Nachrichten unwiderruflich gelöscht!`,
            buttons: [
              { text: 'Abbrechen', role: 'cancel' },
              {
                text: 'Dennoch löschen',
                role: 'destructive',
                handler: () => handleDeleteWithSlideClose(jahrgang, true)
              }
            ]
          });
        } else {
          setError(fehlerText(error, 'Fehler beim Löschen des Jahrgangs'));
        }
      }
    };

    if (forceDelete) {
      await performDelete();
    } else {
      // Was mitgeht, mit Zahlen: Seit das Loeschen die Events
      // und Challenges des Jahrgangs mitnimmt, fragt die Rueckfrage vorher
      // beim Server nach -- dieselbe Regel-Stelle wie das Loeschen selbst.
      // Ohne Antwort (aelterer Server, Netzfehler) steht die allgemeine
      // Fassung da (utils/jahrgangLoeschen.ts).
      let vorschau: JahrgangLoeschVorschau | null = null;
      try {
        const res = await api.get(`/admin/jahrgaenge/${jahrgang.id}/loeschvorschau`);
        if (istLoeschVorschau(res.data)) vorschau = res.data;
      } catch {
        // Keine Vorschau: die allgemeine Fassung der Rueckfrage.
      }
      presentAlert({
        header: 'Jahrgang löschen',
        message: jahrgangLoeschHinweis(jahrgang.name, vorschau),
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          {
            text: 'Löschen',
            role: 'destructive',
            handler: performDelete
          }
        ]
      });
    }
  };

  const openCreateModal = () => {
    setEditJahrgang(null);
    presentJahrgangModalHook({ presentingElement });
  };

  const openEditModal = (jahrgang: Jahrgang) => {
    setEditJahrgang(jahrgang);
    presentJahrgangModalHook({ presentingElement });
  };

  const isAdmin = ['org_admin', 'admin'].includes(user?.role_name || '');
  const canCreate = user?.role_name === 'org_admin';
  const canEdit = isAdmin;
  const canDelete = isAdmin;


  return (
    <IonPage ref={pageRef}>
      <AppKopfzeile
        titel="Jahrgänge"
        onZurueck={() => window.history.back()}
        gemeindeUmschalter={false}
        rechts={canCreate ? (
          <IonButton aria-label="Neuen Jahrgang anlegen" onClick={openCreateModal}>
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
          </IonButton>
        ) : undefined}
      />

      <IonContent className="app-gradient-background" fullscreen>
        <AppKopfzeileGross titel="Jahrgänge" />
        
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Jahrgänge werden geladen..." />
        ) : (
          <>
            <SectionHeader
              title="Jahrgänge"
              subtitle="Konfirmand:innen verwalten"
              icon={ICON_JAHRGANG_GEFUELLT}
              preset="jahrgang"
              stats={[
                { value: (jahrgaenge || []).length, label: 'GESAMT' }
              ]}
            />

        {/* Jahrgaenge List */}
        <ListSection
          icon={ICON_JAHRGANG}
          title="Jahrgänge"
          count={(jahrgaenge || []).length}
          iconColorClass="jahrgang"
          emptyIcon={ICON_JAHRGANG_GEFUELLT}
          emptyTitle="Keine Jahrgänge gefunden"
          emptyMessage="Noch keine Jahrgänge angelegt"
          emptyIconColor="var(--app-color-jahrgang)"
        >
                  {(jahrgaenge || []).map((jahrgang, index) => (
                    <IonItemSliding
                      key={jahrgang.id}
                      ref={(el) => {
                        if (el) {
                          slidingRefs.current.set(jahrgang.id, el);
                        } else {
                          slidingRefs.current.delete(jahrgang.id);
                        }
                      }}
                      style={{ marginBottom: index < (jahrgaenge || []).length - 1 ? 'var(--app-abstand-eng)' : '0' }}
                    >
                      <IonItem
                        button={canEdit}
                        onClick={canEdit ? () => openEditModal(jahrgang) : undefined}
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
                          className="app-list-item app-list-item--jahrgang"
                          style={{ width: '100%' }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--jahrgang">
                                <IonIcon icon={ICON_JAHRGANG_GEFUELLT} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">
                                  {jahrgang.name}
                                </div>
                                <div className="app-list-item__meta">
                                  {jahrgang.gottesdienst_enabled !== false && (
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={ICON_GOTTESDIENST_GEFUELLT} className="app-icon-color--gottesdienst" />
                                      {`GD-Ziel ${jahrgang.target_gottesdienst || 10}`}
                                    </span>
                                  )}
                                  {jahrgang.gemeinde_enabled !== false && (
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-icon-color--gemeinde" />
                                      {`Gem-Ziel ${jahrgang.target_gemeinde || 10}`}
                                    </span>
                                  )}
                                  <span className="app-list-item__meta-item">
                                    <IonIcon
                                      icon={jahrgang.konfspruch_enabled !== false ? ICON_ZUSAGE_GEFUELLT : ICON_ABSAGE}
                                      style={{ color: jahrgang.konfspruch_enabled !== false ? 'var(--app-color-success)' : 'var(--app-text-system)' }}
                                    />
                                    {jahrgang.konfspruch_enabled !== false ? 'Spruch frei' : 'Spruch gesperrt'}
                                  </span>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon
                                      icon={ICON_POKAL_GEFUELLT}
                                      style={{ color: jahrgang.wrapped_released_at ? 'var(--app-color-warning)' : 'var(--app-text-system)' }}
                                    />
                                    {jahrgang.wrapped_released_at
                                      ? `Rückblick gestartet am ${datumKurz(jahrgang.wrapped_released_at)}`
                                      : 'Noch kein Rückblick'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </IonItem>

                      {canDelete && (
                        <IonItemOptions side="end" className="app-swipe-actions">
                          <IonItemOption
                            onClick={() => { closeOpenSlidingItems(); handleDeleteWithSlideClose(jahrgang); }}
                            aria-label="Jahrgang löschen"
                            className="app-swipe-action"
                          >
                            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                              <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                            </div>
                          </IonItemOption>
                        </IonItemOptions>
                      )}
                    </IonItemSliding>
                  ))}
        </ListSection>
          </>
        )}

      </IonContent>
    </IonPage>
  );
};

export default AdminJahrgaengeePage;