import React, { useState, useRef } from 'react';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonInput,
  IonItemGroup,
  IonSelect,
  IonSelectOption,
  IonRefresher,
  IonRefresherContent
} from '@ionic/react';
import {
  trash,
  business,
  businessOutline,
  people,
  personOutline,
  createOutline,
  checkmarkCircle,
  closeCircle,
  filterOutline,
  search,
  timeOutline,
  flask
} from 'ionicons/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection } from '../shared';
import { triggerPullHaptic } from '../../utils/haptics';

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
  onAddOrganizationClick: () => void;
  onSelectOrganization: (organization: Organization) => void;
  onDeleteOrganization: (organization: Organization) => void;
}

const OrganizationView: React.FC<OrganizationViewProps> = ({
  organizations,
  onUpdate,
  onAddOrganizationClick,
  onSelectOrganization,
  onDeleteOrganization
}) => {
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());
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

  const getActiveOrganizations = () => organizations.filter(org => org.is_active);
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
        icon={business}
        preset="organizations"
        stats={[
          { value: organizations.length, label: 'Gesamt' },
          { value: getTotalKonfis(), label: 'Konfis' },
          { value: getTotalUsers(), label: 'Team' }
        ]}
      />

      {/* Suche & Filter — identisches Muster wie KonfisView */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--organizations">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          {/* Suchfeld */}
          <IonItem>
            <IonIcon icon={search} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
            <IonInput
              value={searchTerm}
              onIonInput={(e) => setSearchTerm(e.detail.value!)}
              placeholder="Organisation suchen..."
            />
          </IonItem>
          {/* Status-Filter */}
          <IonItem>
            <IonIcon icon={filterOutline} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
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
        icon={businessOutline}
        title="Organisationen"
        count={filteredAndSortedOrganizations.length}
        iconColorClass="organizations"
        isEmpty={filteredAndSortedOrganizations.length === 0}
        emptyIcon={businessOutline}
        emptyTitle="Keine Organisationen gefunden"
        emptyMessage="Noch keine Gemeinden angelegt"
        emptyIconColor="#667eea"
      >
        {filteredAndSortedOrganizations.map((organization, index, arr) => (
              <IonItemSliding
                key={organization.id}
                style={{ marginBottom: index < arr.length - 1 ? '8px' : '0' }}
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
                              backgroundColor: 'var(--app-color-warning, #f59e0b)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px'
                            }}
                            title="Testversion"
                          >
                            <IonIcon icon={flask} style={{ color: '#fff', fontSize: '0.85rem' }} />
                          </div>
                          <div className="app-corner-badges__separator" />
                        </>
                      )}
                      <div
                        className="app-corner-badge"
                        style={{
                          backgroundColor: organization.is_active ? 'var(--app-color-users)' : '#6b7280',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px'
                        }}
                        title={organization.is_active ? 'Aktiv' : 'Inaktiv'}
                      >
                        <IonIcon icon={organization.is_active ? checkmarkCircle : closeCircle} style={{ color: '#fff', fontSize: '0.85rem' }} />
                      </div>
                    </div>

                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--lg app-icon-circle--organizations" style={{ color: 'white', fontWeight: '600' }}>
                          {getInitials(organization.display_name)}
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title">
                            {organization.display_name}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={people} style={{ color: 'var(--app-color-konfis)' }} />
                              {organization.max_konfis != null
                                ? `${organization.konfi_count} / ${organization.max_konfis} Konfis`
                                : `${organization.konfi_count} Konfis`}
                            </span>
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={personOutline} style={{ color: 'var(--app-color-teamer)' }} />
                              {organization.user_count} Team
                            </span>
                            <span className="app-list-item__meta-item">
                              {(() => {
                                if (!organization.trial_ends_at) {
                                  return <><IonIcon icon={timeOutline} style={{ color: '#667eea' }} />unbegrenzt</>;
                                }
                                const end = new Date(organization.trial_ends_at);
                                const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                                return (
                                  <>
                                    <IonIcon icon={timeOutline} style={{ color: days < 0 ? '#dc2626' : '#667eea' }} />
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
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--organizations">
                      <IonIcon icon={createOutline} />
                    </div>
                  </IonItemOption>
                  <IonItemOption
                    onClick={() => {
                      closeAllSlidingItems();
                      onDeleteOrganization(organization);
                    }}
                    className="app-swipe-action"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={trash} />
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
