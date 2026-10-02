import React, { useCallback, useState } from 'react';
import {
  IonBadge,
  IonButtons,
  IonButton,
  IonIcon,
  IonPopover,
  IonContent,
  IonList,
  IonListHeader,
  IonItem,
  IonLabel
} from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import { ICON_ORGANISATION, ICON_WECHSEL } from './icons';
import { useApp } from '../../contexts/AppContext';
import { UserOrganization } from '../../contexts/AppContext';
import api from '../../services/api';
import { offenJeOrgAusAntwort } from '../../utils/offenJeGemeinde';

// Kurzname für die Header-Anzeige (Platz neben dem Seitentitel ist knapp).
// Explizites Mapping für die bekannten Orgs; Fallback für kuenftige Orgs ist
// das letzte Slug-Segment, kapitalisiert (z.B. 'kirchengemeinde-heide' -> 'Heide').
// Eine Kurzform in den Organisationsdaten gibt es nicht; die Breite deckelt
// zusaetzlich das CSS (app-org-switcher-btn__name), der volle Name steht im
// aria-label des Knopfs und in der Liste.
const ORG_SHORT_NAMES: Record<string, string> = {
  'test-demo': 'Test'
};

const shortOrgName = (org?: UserOrganization): string => {
  if (!org) return '';
  const slug = org.slug || '';
  if (ORG_SHORT_NAMES[slug]) return ORG_SHORT_NAMES[slug];
  // Fallback: letztes Slug-Segment kapitalisieren, sonst display_name/name.
  const last = slug.split('-').filter(Boolean).pop();
  if (last) return last.charAt(0).toUpperCase() + last.slice(1);
  return org.display_name || org.name || '';
};

// Die Regel, wie die Antwort gelesen wird, steht in utils/offenJeGemeinde.ts:
// Das App-Symbol liest dieselbe Antwort.
export { offenJeOrgAusAntwort };

/**
 * Das Icon hat KEINE Farbklasse -> Standard-Toolbar-Farbe, genau wie die
 * Action-Buttons rechts im selben Header.
 *
 * Abgefragt wird beim Oeffnen, damit die Zahl dann frisch ist. Schlaegt die
 * Abfrage fehl, bleibt die Liste ohne Zahlen benutzbar -- der Indikator ist
 * Beiwerk. Die Summe der Eintraege ist die Zahl am App-Symbol:
 * Server und BadgeContext rechnen sie aus derselben Aufteilung.
 */
const OrgSwitcherButton: React.FC = () => {
  const { organizations, activeOrgId, user, switchOrg } = useApp();
  const router = useIonRouter();
  const [popoverEvent, setPopoverEvent] = useState<MouseEvent | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [offenJeOrg, setOffenJeOrg] = useState<Record<number, number>>({});

  const ladeOffenJeOrg = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/badge-counts/je-organisation');
      setOffenJeOrg(offenJeOrgAusAntwort(data));
    } catch {
      // Ohne Zahl bleibt die Liste, wie sie war -- kein Hinweis, kein Fehler.
    }
  }, []);

  // Nur bei echtem Multi-Org-User anzeigen
  if (!organizations || organizations.length <= 1) {
    return null;
  }

  // Aktuell aktive Org: explizit gesetzte aktive Org, sonst Primaer-Org.
  const currentId = activeOrgId ?? user?.organization_id ?? null;
  const currentOrg = organizations.find(o => o.id === currentId);
  const currentShort = shortOrgName(currentOrg);

  const open = (e: React.MouseEvent) => {
    setPopoverEvent(e.nativeEvent);
    setIsOpen(true);
    void ladeOffenJeOrg();
  };

  const handleSelect = async (orgId: number) => {
    setIsOpen(false);
    if (orgId === currentId) return;

    const target = organizations.find(o => o.id === orgId);
    await switchOrg(orgId);

    // Auf die Startseite der (neuen) Rolle navigieren und dabei den Page-Stack
    // der alten Org leeren (Ionic: direction 'root'). Das stellt sicher, dass im
    // nativen WebView nicht eine gecachte Page der alten Org sichtbar bleibt.
    const role = target?.role_name;
    const home = role === 'konfi' ? '/konfi/dashboard'
      : role === 'teamer' ? '/teamer/dashboard'
      : '/admin/konfis';
    router.push(home, 'root', 'replace');
  };

  return (
    <>
      <IonButtons slot="start">
        {/* Icon + aktiver Org-Name -> man sieht immer, in welcher Org man ist.
            Kein Groessen-/Farb-Override: Standard-Toolbar-Look wie die Buttons rechts. */}
        <IonButton
          onClick={open}
          className="app-org-switcher-btn"
          aria-label={`Gemeinde wechseln, gerade ${currentOrg?.display_name || currentOrg?.name || currentShort}`}
        >
          <IonIcon slot="start" icon={ICON_WECHSEL} />
          <span className="app-org-switcher-btn__name">{currentShort}</span>
        </IonButton>
      </IonButtons>

      <IonPopover
        isOpen={isOpen}
        event={popoverEvent}
        onDidDismiss={() => setIsOpen(false)}
        side="bottom"
        alignment="start"
        // Mehr Hoehe + komfortable Breite für die Org-Liste
        style={{ '--width': '280px', '--max-height': '70vh' } as React.CSSProperties}
      >
        <IonContent>
          <IonList>
            <IonListHeader>
              <IonLabel>Gemeinde wechseln</IonLabel>
            </IonListHeader>
            {organizations.map((org) => {
              const offen = offenJeOrg[org.id] || 0;
              const aktiv = org.id === currentId;
              return (
                <IonItem
                  key={org.id}
                  button
                  detail={false}
                  onClick={() => handleSelect(org.id)}
                  className={aktiv ? 'app-org-switcher__eintrag app-org-switcher__eintrag--aktiv' : 'app-org-switcher__eintrag'}
                  aria-current={aktiv ? 'true' : undefined}
                >
                  <IonIcon slot="start" icon={ICON_ORGANISATION} />
                  <IonLabel>{org.display_name || org.name}</IonLabel>
                  {/* Rote Zahl wie am Reiter (MainTabs): "da liegt etwas". Bei 0
                      nichts -- ruhige Liste, die Zahl ist der Hinweis. */}
                  {offen > 0 && (
                    <IonBadge
                      slot="end"
                      color="danger"
                      className="app-org-switcher__offen"
                      aria-label={`${offen} offen`}
                    >
                      {offen > 99 ? '99+' : offen}
                    </IonBadge>
                  )}
                </IonItem>
              );
            })}
          </IonList>
        </IonContent>
      </IonPopover>
    </>
  );
};

export default OrgSwitcherButton;
