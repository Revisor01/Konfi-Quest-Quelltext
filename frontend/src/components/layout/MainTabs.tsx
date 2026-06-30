// MainTabs.tsx
import React, { useState, useEffect } from 'react';
import { Redirect, Route, RouteComponentProps, useLocation } from 'react-router-dom'; // useLocation importieren!
import {
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonBadge
} from '@ionic/react';
import {
  people, chatbubbles, star, ellipsisHorizontal,
  person, home, flash, document as documentIcon, calendar, business
} from 'ionicons/icons';
import { useIonRouter, isPlatform } from '@ionic/react';
// useIonRouter: Ionic 8 API - bei Ionic v9 ggf. auf useNavigate migrieren
import { useApp } from '../../contexts/AppContext';
import { useBadge } from '../../contexts/BadgeContext';
import api from '../../services/api';
import { ModalProvider } from '../../contexts/ModalContext'; // Behalten
import AdminKonfisPage from '../admin/pages/AdminKonfisPage';
import AdminActivitiesPage from '../admin/pages/AdminActivitiesPage';
import AdminEventsPage from '../admin/pages/AdminEventsPage';
import AdminCategoriesPage from '../admin/pages/AdminCategoriesPage';
import AdminJahrgaengeePage from '../admin/pages/AdminJahrgaengeePage';
import AdminBadgesPage from '../admin/pages/AdminBadgesPage';
import AdminActivityRequestsPage from '../admin/pages/AdminActivityRequestsPage';
import AdminUsersPage from '../admin/pages/AdminUsersPage';
// AdminRolesPage entfernt - Rollen sind jetzt hardcoded
import AdminOrganizationsPage from '../admin/pages/AdminOrganizationsPage';
import AdminMetricsPage from '../admin/pages/AdminMetricsPage';
import AdminProfilePage from '../admin/pages/AdminProfilePage';
import AdminSettingsPage from '../admin/pages/AdminSettingsPage';
import AdminMaterialPage from '../admin/pages/AdminMaterialPage';
import AdminCertificatesPage from '../admin/pages/AdminCertificatesPage';
import AdminDashboardSettingsPage from '../admin/pages/AdminDashboardSettingsPage';
import AdminLevelsPage from '../admin/pages/AdminLevelsPage';
import AdminInvitePage from '../admin/pages/AdminInvitePage';
import ChatOverviewPage from '../chat/pages/ChatOverviewPage';
import ChatRoomView from '../chat/views/ChatRoomView'; // Diese bleibt!
import PushNotificationSettings from '../common/PushNotificationSettings';
import ChatPermissionsSettings from '../admin/settings/ChatPermissionsSettings';
import KonfiDetailView from '../admin/views/KonfiDetailView';
import EventDetailView from '../admin/views/EventDetailView';
import KonfiDashboardPage from '../konfi/pages/KonfiDashboardPage';
import KonfiEventsPage from '../konfi/pages/KonfiEventsPage';
import KonfiEventDetailPage from '../konfi/pages/KonfiEventDetailPage';
import KonfiBadgesPage from '../konfi/pages/KonfiBadgesPage';
import KonfiRequestsPage from '../konfi/pages/KonfiRequestsPage';
import KonfiProfilePage from '../konfi/pages/KonfiProfilePage';
import TeamerDashboardPage from '../teamer/pages/TeamerDashboardPage';
import TeamerEventsPage from '../teamer/pages/TeamerEventsPage';
import TeamerMaterialPage from '../teamer/pages/TeamerMaterialPage';

import TeamerProfilePage from '../teamer/pages/TeamerProfilePage';
import TeamerRequestsPage from '../teamer/pages/TeamerRequestsPage';
import TeamerBadgesPage from '../teamer/pages/TeamerBadgesPage';
import TeamerKonfiStatsPage from '../teamer/pages/TeamerKonfiStatsPage';

// Wrapper-Komponenten fuer Route render-props (migriert von props.history.goBack())
const KonfiDetailRoute: React.FC<RouteComponentProps<{ id: string }>> = ({ match }) => {
  const router = useIonRouter();
  return <KonfiDetailView konfiId={parseInt(match.params.id)} onBack={() => router.goBack()} />;
};

const AdminEventDetailRoute: React.FC<RouteComponentProps<{ id: string }>> = ({ match }) => {
  const router = useIonRouter();
  return <EventDetailView eventId={parseInt(match.params.id)} onBack={() => router.goBack()} />;
};

const AdminChatRoomRoute: React.FC<RouteComponentProps<{ roomId: string }>> = ({ match }) => {
  const router = useIonRouter();
  return <ChatRoomView roomId={parseInt(match.params.roomId)} onBack={() => router.goBack()} />;
};

const TeamerChatRoomRoute: React.FC<RouteComponentProps<{ roomId: string }>> = ({ match }) => {
  const router = useIonRouter();
  return <ChatRoomView roomId={parseInt(match.params.roomId)} onBack={() => router.goBack()} />;
};

const KonfiChatRoomRoute: React.FC<RouteComponentProps<{ roomId: string }>> = ({ match }) => {
  const router = useIonRouter();
  return <ChatRoomView roomId={parseInt(match.params.roomId)} onBack={() => router.goBack()} />;
};

const MainTabs: React.FC = () => {
  const { user } = useApp();
  const { chatUnreadTotal, pendingRequestsCount, pendingEventsCount } = useBadge();
  // super_admin bekommt eine eigene, reduzierte Navigation
  const isSuperAdmin = user?.role_name === 'super_admin';
  const [newBadgesCount, setNewBadgesCount] = useState(0);
  const location = useLocation(); // Hook, um den aktuellen Pfad zu erhalten

  // iOS26 Tab-Bar Liquid-Glass-Animation (rdlabo registerTabBarEffect)
  useEffect(() => {
    if (!isPlatform('ios')) return;
    if (!user) return;

    let cleanupFns: Array<() => void> = [];
    let cancelled = false;

    const setup = async () => {
      try {
        const mod = await import('@rdlabo/ionic-theme-ios26');
        if (cancelled) return;
        const register = mod.registerTabBarEffect;
        if (typeof register !== 'function') return;

        let attempts = 0;
        const tryRegister = () => {
          if (cancelled) return;
          const bars = document.querySelectorAll<HTMLElement>('ion-tab-bar');
          if (bars.length > 0) {
            bars.forEach((bar) => {
              try {
                const reg = register(bar);
                if (reg && typeof reg.destroy === 'function') {
                  cleanupFns.push(() => {
                    try { reg.destroy(); } catch {}
                  });
                }
              } catch (e) {
                console.warn('registerTabBarEffect skip:', e);
              }
            });
          } else if (++attempts < 20) {
            setTimeout(tryRegister, 150);
          }
        };
        tryRegister();
      } catch (e) {
        console.warn('TabBar effect import failed:', e);
      }
    };

    setup();

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => fn());
      cleanupFns = [];
    };
  }, [user?.role_name, user?.type]);

  // Load new badges count for konfi (badges not yet seen)
  useEffect(() => {
    const loadNewBadgesCount = async () => {
      if (user?.type === 'konfi') {
        try {
          const response = await api.get('/konfi/badges');
          // earned array contains badges with the seen flag
          const newCount = response.data.earned?.filter((badge: any) => !badge.seen)?.length || 0;
          setNewBadgesCount(newCount);
        } catch (error) {
 console.warn('Badges konnten nicht geladen werden:', error);
        }
      }
    };

    loadNewBadgesCount();

    // Refresh every 60 seconds
    const interval = setInterval(loadNewBadgesCount, 60000);
    return () => clearInterval(interval);
  }, [user]);


  if (!user) {
    return null;
  }

  // Funktion, um zu prüfen, ob die Tab-Bar angezeigt werden soll
  const isTabBarHidden = (path: string) => {
    // Verstecke die Tab-Bar, wenn der Pfad ein Chat-Raum ist
    return path.startsWith('/admin/chat/room/') || path.startsWith('/konfi/chat/room/') || path.startsWith('/teamer/chat/room/');
  };

  return isSuperAdmin ? (
    // Super-Admin: Nur Organisationen-View ohne TabBar
    <ModalProvider>
      <IonRouterOutlet>
        <Route exact path="/admin" render={() => <Redirect to="/admin/organizations" />} />
        <Route exact path="/admin/organizations" component={AdminOrganizationsPage} />
        <Route exact path="/admin/metrics" component={AdminMetricsPage} />
        <Route exact path="/login" render={() => <Redirect to="/admin/organizations" />} />
        <Route exact path="/" render={() => <Redirect to="/admin/organizations" />} />
      </IonRouterOutlet>
    </ModalProvider>
  ) : user.type === 'admin' ? (
    // Admin Tabs (org_admin / teamer)
    <ModalProvider>
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/admin" render={() => <Redirect to="/admin/konfis" />} />
          <Route exact path="/admin/konfis" component={AdminKonfisPage} />
          <Route path="/admin/konfis/:id" component={KonfiDetailRoute} />

          {/* CHAT ROUTEN - Nach Konfis-Pattern */}
          <Route exact path="/admin/chat" component={ChatOverviewPage} />
          <Route path="/admin/chat/room/:roomId" component={AdminChatRoomRoute} />

          <Route exact path="/admin/activities" component={AdminActivitiesPage} />
          <Route path="/admin/events/:id" component={AdminEventDetailRoute} />
          <Route exact path="/admin/events" component={AdminEventsPage} />
          <Route exact path="/admin/settings/categories" component={AdminCategoriesPage} />
          <Route exact path="/admin/settings/jahrgaenge" component={AdminJahrgaengeePage} />
          <Route exact path="/admin/settings/levels" component={AdminLevelsPage} />
          <Route exact path="/admin/settings/invite" component={AdminInvitePage} />
          <Route exact path="/admin/badges" component={AdminBadgesPage} />
          <Route exact path="/admin/requests" component={AdminActivityRequestsPage} />
          <Route exact path="/admin/users" component={AdminUsersPage} />
          <Route exact path="/admin/organizations" component={AdminOrganizationsPage} />
          <Route exact path="/admin/material" component={AdminMaterialPage} />
          <Route exact path="/admin/settings/certificates" component={AdminCertificatesPage} />

          <Route exact path="/admin/settings/dashboard" component={AdminDashboardSettingsPage} />
          <Route exact path="/admin/settings" component={AdminSettingsPage} />
          <Route exact path="/admin/profile" component={AdminProfilePage} />
          {/* Performance/Metrics — auch im normalen Admin-Outlet, da super_admins
              meist role_name=org_admin haben (is_super_admin=true). Die Seite selbst
              prueft die Berechtigung serverseitig (403 fuer nicht-super-admins). */}
          <Route exact path="/admin/metrics" component={AdminMetricsPage} />
          <Route exact path="/login" render={() => <Redirect to="/admin/konfis" />} />
          <Route exact path="/" render={() => <Redirect to="/admin/konfis" />} />
        </IonRouterOutlet>

        {/* Die IonTabBar wird bedingt gerendert (nur in Chat-Räumen versteckt) */}
        {!isTabBarHidden(location.pathname) && (
          <IonTabBar slot="bottom">
            <IonTabButton tab="admin-konfis" href="/admin/konfis">
              <IonIcon icon={people} />
              <IonLabel>Konfis</IonLabel>
            </IonTabButton>
            <IonTabButton tab="admin-chat" href="/admin/chat">
              <IonIcon icon={chatbubbles} />
              <IonLabel>Chat</IonLabel>
              {chatUnreadTotal > 0 && (
                <IonBadge color="danger">
                  {chatUnreadTotal > 9 ? '9+' : chatUnreadTotal}
                </IonBadge>
              )}
            </IonTabButton>
            <IonTabButton tab="admin-events" href="/admin/events">
              <IonIcon icon={flash} />
              <IonLabel>Events</IonLabel>
              {pendingEventsCount > 0 && (
                <IonBadge color="danger">
                  {pendingEventsCount > 9 ? '9+' : pendingEventsCount}
                </IonBadge>
              )}
            </IonTabButton>
            <IonTabButton tab="admin-requests" href="/admin/requests">
              <IonIcon icon={documentIcon} />
              <IonLabel>Anträge</IonLabel>
              {pendingRequestsCount > 0 && (
                <IonBadge color="danger">
                  {pendingRequestsCount > 9 ? '9+' : pendingRequestsCount}
                </IonBadge>
              )}
            </IonTabButton>
            <IonTabButton tab="admin-settings" href="/admin/settings">
              <IonIcon icon={ellipsisHorizontal} />
              <IonLabel>Mehr</IonLabel>
            </IonTabButton>
          </IonTabBar>
        )}
      </IonTabs>
    </ModalProvider>
  ) : user.type === 'teamer' ? (
    // Teamer Tabs
    <ModalProvider>
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/teamer" render={() => <Redirect to="/teamer/dashboard" />} />
          <Route exact path="/teamer/dashboard" component={TeamerDashboardPage} />
          <Route exact path="/teamer/chat" component={ChatOverviewPage} />
          <Route path="/teamer/chat/room/:roomId" component={TeamerChatRoomRoute} />
          <Route exact path="/teamer/events" component={TeamerEventsPage} />
          <Route exact path="/teamer/material" component={TeamerMaterialPage} />
          <Route exact path="/teamer/badges" component={TeamerBadgesPage} />
          <Route exact path="/teamer/requests" component={TeamerRequestsPage} />

          <Route exact path="/teamer/profile" component={TeamerProfilePage} />
          <Route exact path="/teamer/profile/badges" component={TeamerBadgesPage} />
          <Route exact path="/teamer/profile/material" component={TeamerMaterialPage} />
          <Route exact path="/teamer/profile/konfi-stats" component={TeamerKonfiStatsPage} />
          <Route exact path="/login" render={() => <Redirect to="/teamer/dashboard" />} />
          <Route exact path="/" render={() => <Redirect to="/teamer/dashboard" />} />
        </IonRouterOutlet>
        {!isTabBarHidden(location.pathname) && (
          <IonTabBar slot="bottom">
            <IonTabButton tab="teamer-dashboard" href="/teamer/dashboard">
              <IonIcon icon={home} />
              <IonLabel>Start</IonLabel>
            </IonTabButton>
            <IonTabButton tab="teamer-chat" href="/teamer/chat">
              <IonIcon icon={chatbubbles} />
              <IonLabel>Chat</IonLabel>
              {chatUnreadTotal > 0 && (
                <IonBadge color="danger">
                  {chatUnreadTotal > 9 ? '9+' : chatUnreadTotal}
                </IonBadge>
              )}
            </IonTabButton>
            <IonTabButton tab="teamer-events" href="/teamer/events">
              <IonIcon icon={calendar} />
              <IonLabel>Events</IonLabel>
            </IonTabButton>
            <IonTabButton tab="teamer-badges" href="/teamer/badges">
              <IonIcon icon={star} />
              <IonLabel>Badges</IonLabel>
            </IonTabButton>
            <IonTabButton tab="teamer-requests" href="/teamer/requests">
              <IonIcon icon={flash} />
              <IonLabel>Aktivitäten</IonLabel>
            </IonTabButton>
          </IonTabBar>
        )}
      </IonTabs>
    </ModalProvider>
  ) : (
    // Konfi Tabs
    <ModalProvider>
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/konfi" render={() => <Redirect to="/konfi/dashboard" />} />
          <Route exact path="/konfi/dashboard" component={KonfiDashboardPage} />
          <Route exact path="/konfi/events" component={KonfiEventsPage} />
          <Route exact path="/konfi/events/:id" component={KonfiEventDetailPage} />
          <Route exact path="/konfi/badges" component={KonfiBadgesPage} />

          {/* CHAT ROUTEN - Nach Konfis-Pattern */}
          <Route exact path="/konfi/chat" component={ChatOverviewPage} />
          <Route path="/konfi/chat/room/:roomId" component={KonfiChatRoomRoute} />

          <Route exact path="/konfi/requests" component={KonfiRequestsPage} />
          <Route exact path="/konfi/profile" component={KonfiProfilePage} />
          <Route exact path="/login" render={() => <Redirect to="/konfi/dashboard" />} />
          <Route exact path="/" render={() => <Redirect to="/konfi/dashboard" />} />
        </IonRouterOutlet>

        {/* Die IonTabBar wird bedingt gerendert */}
        {!isTabBarHidden(location.pathname) && (
          <IonTabBar slot="bottom">
            <IonTabButton tab="dashboard" href="/konfi/dashboard">
              <IonIcon icon={home} />
              <IonLabel>Start</IonLabel>
            </IonTabButton>
            <IonTabButton tab="chat" href="/konfi/chat"> {/* HIER IST DER CHAT-TAB-BUTTON */}
              <IonIcon icon={chatbubbles} />
              <IonLabel>Chat</IonLabel>
              {chatUnreadTotal > 0 && (
                <IonBadge color="danger">
                  {chatUnreadTotal > 9 ? '9+' : chatUnreadTotal}
                </IonBadge>
              )}
            </IonTabButton>
            <IonTabButton tab="events" href="/konfi/events">
              <IonIcon icon={calendar} />
              <IonLabel>Events</IonLabel>
            </IonTabButton>
            <IonTabButton tab="badges" href="/konfi/badges">
              <IonIcon icon={star} />
              <IonLabel>Badges</IonLabel>
              {newBadgesCount > 0 && (
                <IonBadge color="danger">
                  {newBadgesCount > 9 ? '9+' : newBadgesCount}
                </IonBadge>
              )}
            </IonTabButton>
            <IonTabButton tab="requests" href="/konfi/requests">
              <IonIcon icon={documentIcon} />
              <IonLabel>Aktivitäten</IonLabel>
            </IonTabButton>
          </IonTabBar>
        )}
      </IonTabs>
    </ModalProvider>
  );
};

export default MainTabs;