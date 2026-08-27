import React, { useState } from 'react';
import {
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
import { swapHorizontalOutline, checkmark, businessOutline } from 'ionicons/icons';
import { useApp } from '../../contexts/AppContext';
import { UserOrganization } from '../../contexts/AppContext';

// Kurzname für die Header-Anzeige (Platz neben dem Seitentitel ist knapp).
// Explizites Mapping für die bekannten Orgs; Fallback für kuenftige Orgs ist
// das letzte Slug-Segment, kapitalisiert (z.B. 'kirchengemeinde-heide' -> 'Heide').
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

/**
 * Org-Switcher oben links im Header. Erscheint NUR, wenn der eingeloggte User in
 * mehreren Organisationen Mitglied ist (Multi-Org). Der Button zeigt das Wechsel-
 * Symbol UND den Namen der aktuell aktiven Org (so weiß man immer, wo man ist).
 * Tippen oeffnet ein Popover mit allen Orgs; die aktive ist mit Haekchen markiert.
 * Bei Auswahl wird über den AppContext gewechselt (neues Token, Cache-Reset,
 * org:switched-Event + Root-Navigation -> alle Views laden frisch in der neuen Org).
 *
 * Das Icon hat KEINE Farbklasse -> Standard-Toolbar-Farbe, genau wie die
 * Action-Buttons rechts im selben Header.
 */
const OrgSwitcherButton: React.FC = () => {
  const { organizations, activeOrgId, user, switchOrg } = useApp();
  const router = useIonRouter();
  const [popoverEvent, setPopoverEvent] = useState<MouseEvent | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);

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
        <IonButton onClick={open} className="app-org-switcher-btn">
          <IonIcon slot="start" icon={swapHorizontalOutline} />
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
              <IonLabel>Organisation wechseln</IonLabel>
            </IonListHeader>
            {organizations.map((org) => (
              <IonItem
                key={org.id}
                button
                detail={false}
                onClick={() => handleSelect(org.id)}
              >
                <IonIcon slot="start" icon={businessOutline} />
                <IonLabel>{org.display_name || org.name}</IonLabel>
                {org.id === currentId && (
                  <IonIcon slot="end" icon={checkmark} color="success" />
                )}
              </IonItem>
            ))}
          </IonList>
        </IonContent>
      </IonPopover>
    </>
  );
};

export default OrgSwitcherButton;
