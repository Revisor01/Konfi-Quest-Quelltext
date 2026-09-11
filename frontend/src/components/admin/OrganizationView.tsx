import React, { useState, useRef } from 'react';
import { IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonItemSliding, IonItemOptions, IonItemOption, IonInput, IonItemGroup, IonSelect, IonSelectOption, IonRefresher, IonRefresherContent } from '@ionic/react';
import {
  ICON_ABSAGE,
  ICON_BEARBEITEN,
  ICON_EXPERIMENT,
  ICON_FILTER,
  ICON_GRUPPE_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_ORGANISATION,
  ICON_ORGANISATION_GEFUELLT,
  ICON_PERSON,
  ICON_SUCHE_GEFUELLT,
  ICON_UHRZEIT,
  ICON_ZUSAGE_GEFUELLT,
} from '../shared/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection } from '../shared';
import { triggerPullHaptic } from '../../utils/haptics';
import { tageBis } from '../shared/eventFormatting';

// Ionic 9 gibt bei ref an IonItemSliding die React-Komponente zurueck, nicht
// mehr das DOM-Element. Gebraucht wird hier nur close() — das haben beide.
type SlidingRef = { close: () => Promise<void> };

interface Organization {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  contact_email?: string;
  website_url?: string;
  is_active: boolean;
  max_konfis?: number | null;
  trial_ends_at?: string | null;
  is_trial?: boolean;
  created_at: string;
  updated_at: string;
  // Statistics
  user_count: number;
  konfi_count: number;
  activity_count: number;
  event_count: number;
  badge_count: number;
}

interface OrganizationViewProps {
  organizations: Organization[];
  onUpdate: () => void;
  onSelectOrganization: (organization: Organization) => void;
  onDeleteOrganization: (organization: Organization) => void;
}

const OrganizationView: React.FC<OrganizationViewProps> = ({
  organizations,
  onUpdate,
  onSelectOrganization,
  onDeleteOrganization
}) => {
  const slidingRefs = useRef<Map<number, SlidingRef>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('alle');

  const filteredAndSortedOrganizations = (() => {
    let result = filterBySearchTerm(organizations, searchTerm, ['name', 'display_name', 'description', 'contact_email']);

    if (selectedFilter === 'aktiv') {
      result = result.filter(org => org.is_active);
    } else if (selectedFilter === 'inaktiv') {
      result = result.filter(org => !org.is_active);
    } else if (selectedFilter === 'gross') {
      result = result.filter(org => org.konfi_count > 10);
    } else if (selectedFilter === 'klein') {
      result = result.filter(org => org.konfi_count <= 10);
    }

    result = result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return result;
  })();

  const getTotalKonfis = () => organizations.reduce((sum, org) => sum + org.konfi_count, 0);
  const getTotalUsers = () => organizations.reduce((sum, org) => sum + org.user_count, 0);

  const getInitials = (displayName: string) => {
    return displayName
      .split(' ')
      .map(name => name.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const closeAllSlidingItems = () => {
    slidingRefs.current.forEach(ref => ref?.close());
  };

  const handleRefresh = (event: CustomEvent) => {
    onUpdate();
    setTimeout(() => event.detail.complete(), 500);
  };

  return (
    <>
      <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
        <IonRefresherContent />
      </IonRefresher>

      <SectionHeader
        title="Organisationen"
        subtitle="Gemeinden verwalten"
        icon={ICON_ORGANISATION_GEFUELLT}
        preset="organizations"
        stats={[
          { value: organizations.length, label: 'Gesamt' },
          { value: getTotalKonfis(), label: 'Konfis' },
          { value: getTotalUsers(), label: 'Team' }
        ]}
      />

      {/* Suche & Filter — identisches Muster wie KonfisView */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--organizations">
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          {/* Suchfeld */}
          <IonItem>
            <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
            <IonInput
              value={searchTerm}
              onIonInput={(e) => setSearchTerm(e.detail.value!)}
              placeholder="Organisation suchen..."
            />
          </IonItem>
          {/* Status-Filter */}
          <IonItem>
            <IonIcon icon={ICON_FILTER} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
            <IonSelect
              value={selectedFilter}
              onIonChange={(e) => setSelectedFilter(e.detail.value)}
              interface="popover"
              placeholder="Status"
              style={{ width: '100%' }}
            >
              <IonSelectOption value="alle">Alle</IonSelectOption>
              <IonSelectOption value="aktiv">Aktiv</IonSelectOption>
              <IonSelectOption value="inaktiv">Inaktiv</IonSelectOption>
            </IonSelect>
          </IonItem>
        </IonItemGroup>
      </IonList>

      {/* Organisationen-Liste */}
      <ListSection
        icon={ICON_ORGANISATION}
        title="Organisationen"
        count={filteredAndSortedOrganizations.length}
        iconColorClass="organizations"
        isEmpty={filteredAndSortedOrganizations.length === 0}
        emptyIcon={ICON_ORGANISATION}
        emptyTitle="Keine Organisationen gefunden"
        emptyMessage="Noch keine Gemeinden angelegt"
        emptyIconColor="var(--app-color-users)"
      >
        {filteredAndSortedOrganizations.map((organization, index, arr) => (
              <IonItemSliding
                key={organization.id}
                style={{ marginBottom: index < arr.length - 1 ? 'var(--app-abstand-eng)' : '0' }}
                ref={(ref) => {
                  if (ref) slidingRefs.current.set(organization.id, ref);
                }}
              >
                <IonItem
                  button
                  detail={false}
                  lines="none"
                  onClick={() => {
                    closeAllSlidingItems();
                    onSelectOrganization(organization);
                  }}
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
                    className="app-list-item app-list-item--organizations"
                    style={{ width: '100%', position: 'relative', overflow: 'hidden', opacity: organization.is_active ? 1 : 0.7 }}
                  >
                    {/* Corner-Badges: Testversion (innen) + Aktiv/Inaktiv-Status */}
                    <div className="app-corner-badges">
                      {organization.is_trial && (
                        <>
                          <div
                            className="app-corner-badge"
                            style={{
                              backgroundColor: 'var(--app-color-warning)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)'
                            }}
                            title="Testversion"
                          >
                            <IonIcon icon={ICON_EXPERIMENT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                          </div>
                          <div className="app-corner-badges__separator" />
                        </>
                      )}
                      <div
                        className="app-corner-badge"
                        style={{
                          backgroundColor: organization.is_active ? 'var(--app-color-users)' : 'var(--app-color-neutral)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)'
                        }}
                        title={organization.is_active ? 'Aktiv' : 'Inaktiv'}
                      >
                        <IonIcon icon={organization.is_active ? ICON_ZUSAGE_GEFUELLT : ICON_ABSAGE} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                      </div>
                    </div>

                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--organizations" style={{ color: 'white', fontWeight: 'var(--app-schrift-halbfett)' }}>
                          {getInitials(organization.display_name)}
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">
                            {organization.display_name}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_GRUPPE_GEFUELLT} style={{ color: 'var(--app-color-konfis)' }} />
                              {organization.max_konfis != null
                                ? `${organization.konfi_count} / ${organization.max_konfis} Konfis`
                                : `${organization.konfi_count} Konfis`}
                            </span>
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_PERSON} style={{ color: 'var(--app-color-teamer)' }} />
                              {organization.user_count} Team
                            </span>
                            <span className="app-list-item__meta-item">
                              {(() => {
                                if (!organization.trial_ends_at) {
                                  return <><IonIcon icon={ICON_UHRZEIT} style={{ color: 'var(--app-color-users)' }} />unbegrenzt</>;
                                }
                                const end = new Date(organization.trial_ends_at);
                                const days = tageBis(end); // Kalendertage, siehe eventFormatting.ts
                                return (
                                  <>
                                    <IonIcon icon={ICON_UHRZEIT} style={{ color: days < 0 ? 'var(--app-color-events)' : 'var(--app-color-users)' }} />
                                    {end.toLocaleDateString('de-DE')} {days >= 0 ? `(${days} Tag${days === 1 ? '' : 'e'})` : '(abgelaufen)'}
                                  </>
                                );
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                <IonItemOptions side="end" className="app-swipe-actions">
                  <IonItemOption
                    onClick={() => {
                      closeAllSlidingItems();
                      onSelectOrganization(organization);
                    }}
                    className="app-swipe-action"
                    aria-label="Organisation bearbeiten"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--organizations">
                      <IonIcon icon={ICON_BEARBEITEN} />
                    </div>
                  </IonItemOption>
                  <IonItemOption
                    onClick={() => {
                      closeAllSlidingItems();
                      onDeleteOrganization(organization);
                    }}
                    className="app-swipe-action"
                    aria-label="Organisation löschen"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                    </div>
                  </IonItemOption>
                </IonItemOptions>
              </IonItemSliding>
            ))}

      </ListSection>
    </>
  );
};

export default OrganizationView;
