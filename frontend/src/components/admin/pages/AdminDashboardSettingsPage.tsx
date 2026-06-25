import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonToggle,
  IonSegment,
  IonSegmentButton,
  IonRefresher,
  IonRefresherContent,
  IonReorder,
  IonReorderGroup
} from '@ionic/react';
import { arrowBack, appsOutline, reorderThreeOutline } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { SectionHeader } from '../../shared';
import LoadingSpinner from '../../common/LoadingSpinner';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

interface DashboardConfig {
  show_konfirmation: boolean;
  show_events: boolean;
  show_losung: boolean;
  show_badges: boolean;
  show_ranking: boolean;
}

interface TeamerDashboardConfig {
  show_zertifikate: boolean;
  show_events: boolean;
  show_badges: boolean;
  show_losung: boolean;
}

const KONFI_LABELS: Record<string, string> = {
  konfirmation: 'Countdown',
  events: 'Events',
  losung: 'Tageslosung',
  badges: 'Badges',
  ranking: 'Ranking'
};

const TEAMER_LABELS: Record<string, string> = {
  zertifikate: 'Zertifikate',
  events: 'Events',
  badges: 'Badges',
  losung: 'Tageslosung'
};

const DEFAULT_KONFI_ORDER = ['konfirmation', 'events', 'losung', 'badges', 'ranking'];
const DEFAULT_TEAMER_ORDER = ['zertifikate', 'events', 'badges', 'losung'];


const AdminDashboardSettingsPage: React.FC = () => {
  const { user, setSuccess, setError } = useApp();
  const [dashboardSegment, setDashboardSegment] = useState<'konfi' | 'teamer'>('konfi');

  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>({
    show_konfirmation: true,
    show_events: true,
    show_losung: true,
    show_badges: true,
    show_ranking: true
  });

  const [teamerDashboardConfig, setTeamerDashboardConfig] = useState<TeamerDashboardConfig>({
    show_zertifikate: true,
    show_events: true,
    show_badges: true,
    show_losung: true
  });

  const [konfiOrder, setKonfiOrder] = useState<string[]>(DEFAULT_KONFI_ORDER);
  const [teamerOrder, setTeamerOrder] = useState<string[]>(DEFAULT_TEAMER_ORDER);

  const handleSaveOrder = async (key: string, value: string) => {
    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'PUT',
        url: '/settings',
        body: { [key]: value },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Dashboard-Reihenfolge' },
      });
      return;
    }
    try {
      await api.put('/settings', { [key]: value });
    } catch {
      setError('Fehler beim Speichern der Reihenfolge');
    }
  };

  // Offline-Query: Settings
  const { loading, refresh: refreshSettings } = useOfflineQuery<any>(
    'admin:settings:' + user?.organization_id,
    async () => { const res = await api.get('/settings'); return res.data; },
    {
      ttl: CACHE_TTL.SETTINGS,
      onSuccess: (data: any) => {
        setDashboardConfig({
          show_konfirmation: data.dashboard_show_konfirmation ?? true,
          show_events: data.dashboard_show_events ?? true,
          show_losung: data.dashboard_show_losung ?? true,
          show_badges: data.dashboard_show_badges ?? true,
          show_ranking: data.dashboard_show_ranking ?? true
        });
        setTeamerDashboardConfig({
          show_zertifikate: data.teamer_dashboard_show_zertifikate ?? true,
          show_events: data.teamer_dashboard_show_events ?? true,
          show_badges: data.teamer_dashboard_show_badges ?? true,
          show_losung: data.teamer_dashboard_show_losung ?? true
        });
        setKonfiOrder(data.dashboard_section_order || DEFAULT_KONFI_ORDER);
        setTeamerOrder(data.teamer_dashboard_section_order || DEFAULT_TEAMER_ORDER);
      }
    }
  );

  const handleDashboardToggle = async (key: keyof DashboardConfig, value: boolean) => {
    // Optimistic UI zuerst
    setDashboardConfig(prev => ({ ...prev, [key]: value }));

    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'PUT',
        url: '/settings',
        body: { [`dashboard_${key}`]: value },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Dashboard-Einstellung' },
      });
      return;
    }

    try {
      await api.put('/settings', { [`dashboard_${key}`]: value });
    } catch {
      // Revert bei Fehler
      setDashboardConfig(prev => ({ ...prev, [key]: !value }));
      setError('Fehler beim Speichern');
    }
  };

  const handleTeamerDashboardToggle = async (key: keyof TeamerDashboardConfig, value: boolean) => {
    // Optimistic UI zuerst
    setTeamerDashboardConfig(prev => ({ ...prev, [key]: value }));

    if (!networkMonitor.isOnline) {
      writeQueue.enqueue({
        method: 'PUT',
        url: '/settings',
        body: { [`teamer_dashboard_${key}`]: value },
        maxRetries: 3,
        hasFileUpload: false,
        metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Teamer-Dashboard-Einstellung' },
      });
      return;
    }

    try {
      await api.put('/settings', { [`teamer_dashboard_${key}`]: value });
    } catch {
      // Revert bei Fehler
      setTeamerDashboardConfig(prev => ({ ...prev, [key]: !value }));
      setError('Fehler beim Speichern');
    }
  };

  if (loading) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Dashboard</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <LoadingSpinner fullScreen message="Einstellungen werden geladen..." />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Dashboard</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Dashboard</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refreshSettings();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        <SectionHeader
          title="Dashboard"
          subtitle="Sichtbare Bereiche konfigurieren"
          icon={appsOutline}
          colors={{ primary: '#667eea', secondary: '#5a67d8' }}
          stats={[
            { value: Object.values(dashboardConfig).filter(Boolean).length, label: 'Konfi' },
            { value: Object.values(teamerDashboardConfig).filter(Boolean).length, label: 'Team' }
          ]}
        />

        <div className="app-segment-wrapper">
          <IonSegment
            value={dashboardSegment}
            onIonChange={(e) => setDashboardSegment(e.detail.value as 'konfi' | 'teamer')}
          >
            <IonSegmentButton value="konfi">
              <IonLabel>Konfi</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="teamer">
              <IonLabel>Teamer:innen</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </div>

        {dashboardSegment === 'konfi' && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--settings">
                <IonIcon icon={appsOutline} />
              </div>
              <IonLabel>Konfi-Dashboard</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                <IonList style={{ background: 'transparent', padding: '0' }}>
                  <IonReorderGroup disabled={false} onIonItemReorder={(e) => {
                    const newOrder = [...konfiOrder];
                    const [moved] = newOrder.splice(e.detail.from, 1);
                    newOrder.splice(e.detail.to, 0, moved);
                    setKonfiOrder(newOrder);
                    e.detail.complete();
                    handleSaveOrder('dashboard_section_order', JSON.stringify(newOrder));
                  }}>
                    {konfiOrder.map((key, index) => (
                      <IonItem
                        key={key}
                        lines={index < konfiOrder.length - 1 ? 'full' : 'none'}
                        className="app-dashboard-settings-item"
                      >
                        <IonReorder slot="start" />
                        <IonLabel>{KONFI_LABELS[key]}</IonLabel>
                        <IonToggle
                          slot="end"
                          className="app-toggle--users"
                          checked={dashboardConfig[`show_${key}` as keyof DashboardConfig]}
                          onIonChange={(e) => handleDashboardToggle(`show_${key}` as keyof DashboardConfig, e.detail.checked)}
                        />
                      </IonItem>
                    ))}
                  </IonReorderGroup>
                </IonList>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {dashboardSegment === 'teamer' && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--settings">
                <IonIcon icon={appsOutline} />
              </div>
              <IonLabel>Teamer:innen-Dashboard</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                <IonList style={{ background: 'transparent', padding: '0' }}>
                  <IonReorderGroup disabled={false} onIonItemReorder={(e) => {
                    const newOrder = [...teamerOrder];
                    const [moved] = newOrder.splice(e.detail.from, 1);
                    newOrder.splice(e.detail.to, 0, moved);
                    setTeamerOrder(newOrder);
                    e.detail.complete();
                    handleSaveOrder('teamer_dashboard_section_order', JSON.stringify(newOrder));
                  }}>
                    {teamerOrder.map((key, index) => (
                      <IonItem
                        key={key}
                        lines={index < teamerOrder.length - 1 ? 'full' : 'none'}
                        className="app-dashboard-settings-item"
                      >
                        <IonReorder slot="start" />
                        <IonLabel>{TEAMER_LABELS[key]}</IonLabel>
                        <IonToggle
                          slot="end"
                          className="app-toggle--users"
                          checked={teamerDashboardConfig[`show_${key}` as keyof TeamerDashboardConfig]}
                          onIonChange={(e) => handleTeamerDashboardToggle(`show_${key}` as keyof TeamerDashboardConfig, e.detail.checked)}
                        />
                      </IonItem>
                    ))}
                  </IonReorderGroup>
                </IonList>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        <div className="ion-padding-bottom" />
      </IonContent>
    </IonPage>
  );
};

export default AdminDashboardSettingsPage;
