import React, { useState, useRef } from 'react';
import {
  IonIcon,
  IonItem,
  IonItemGroup,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonCard,
  IonCardContent,
  IonRefresher,
  IonRefresherContent
} from '@ionic/react';
import {
  trash,
  people,
  person,
  personOutline,
  shield,
  createOutline,
  at,
  school,
  time,
  briefcase,
  filterOutline,
  peopleOutline,
  search
} from 'ionicons/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection } from '../shared';
import { AdminUser } from '../../types/user';
import { triggerPullHaptic } from '../../utils/haptics';

interface UsersViewProps {
  users: AdminUser[];
  onUpdate: () => void;
  onAddUserClick: () => void;
  onSelectUser: (user: AdminUser) => void;
  onDeleteUser: (user: AdminUser) => void;
}

const UsersView: React.FC<UsersViewProps> = ({
  users,
  onUpdate,
  onAddUserClick,
  onSelectUser,
  onDeleteUser
}) => {
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('alle');

  const filteredAndSortedUsers = (() => {
    let result = filterBySearchTerm(users, searchTerm, ['username', 'display_name', 'email', 'role_display_name']);

    if (selectedFilter === 'aktiv') {
      result = result.filter(user => user.is_active);
    } else if (selectedFilter === 'inaktiv') {
      result = result.filter(user => !user.is_active);
    } else if (selectedFilter === 'admin') {
      result = result.filter(user => user.role_name === 'admin' || user.role_name === 'org_admin');
    } else if (selectedFilter === 'teamer') {
      result = result.filter(user => user.role_name === 'teamer');
    }

    // Sort: org_admin first, then admin, then teamer, then by name
    result = result.sort((a, b) => {
      const roleOrder: { [key: string]: number } = {
        'org_admin': 1, 'admin': 2, 'teamer': 3
      };
      const orderA = roleOrder[a.role_name] || 99;
      const orderB = roleOrder[b.role_name] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.display_name.localeCompare(b.display_name);
    });

    return result;
  })();

  const getActiveUsers = () => users.filter(user => user.is_active);
  const getAdminUsers = () => users.filter(user => user.role_name === 'admin' || user.role_name === 'org_admin');
  const getTeamerUsers = () => users.filter(user => user.role_name === 'teamer');

  const getRoleColor = (roleName: string) => {
    switch (roleName) {
      case 'org_admin': return '#667eea';
      case 'admin': return '#667eea';
      case 'teamer': return '#be185d';
      default: return '#6b7280';
    }
  };

  const getRoleBadgeColor = (roleName: string) => {
    switch (roleName) {
      case 'org_admin': return 'primary';
      case 'admin': return 'primary';
      case 'teamer': return 'warning';
      default: return 'medium';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

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
        title="Benutzer:innen"
        subtitle="Admins, Teamer:innen und Rollen"
        icon={people}
        preset="users"
        stats={[
          { value: users.length, label: 'Gesamt' },
          { value: getAdminUsers().length, label: 'Admins' },
          { value: getTeamerUsers().length, label: 'Teamer:in' }
        ]}
      />

      {/* Tab Navigation - einfaches IonSegment */}
      <div className="app-segment-wrapper">
        <IonSegment
          value={selectedFilter}
          onIonChange={(e) => setSelectedFilter(e.detail.value as string)}
        >
          <IonSegmentButton value="alle">
            <IonLabel>Alle</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="aktiv">
            <IonLabel>Aktiv</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="admin">
            <IonLabel>Admin</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="teamer">
            <IonLabel>Team</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

      {/* Suche */}
      <IonList inset={true} className="app-segment-wrapper">
        <IonListHeader>
          <div className="app-section-icon app-section-icon--users">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={search} slot="start" className="app-search-bar__icon" />
            <IonInput
              value={searchTerm}
              onIonInput={(e) => setSearchTerm(e.detail.value!)}
              placeholder="Benutzer:in suchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      {/* Benutzer-Liste */}
      <ListSection
        icon={peopleOutline}
        title="Benutzer:innen"
        count={filteredAndSortedUsers.length}
        iconColorClass="users"
        isEmpty={filteredAndSortedUsers.length === 0}
        emptyIcon={personOutline}
        emptyTitle="Keine Benutzer:innen gefunden"
        emptyMessage="Noch keine Teammitglieder angelegt"
        emptyIconColor="#667eea"
      >
        {filteredAndSortedUsers.map((user, index) => {
              const roleColor = getRoleColor(user.role_name);

              return (
              <IonItemSliding
                key={user.id}
                ref={(ref) => {
                  if (ref) slidingRefs.current.set(user.id, ref);
                }}
                style={{ marginBottom: index < filteredAndSortedUsers.length - 1 ? '8px' : '0' }}
              >
                <IonItem
                  button={user.can_edit !== false}
                  detail={false}
                  onClick={() => {
                    if (user.can_edit !== false) {
                      closeAllSlidingItems();
                      onSelectUser(user);
                    }
                  }}
                  lines="none"
                  className="app-item-transparent"
                >
                  <div
                    className="app-list-item app-list-item--users"
                    style={{ borderLeftColor: roleColor, opacity: user.is_active ? 1 : 0.6 }}
                  >
                    {/* Eselsohr-Style Corner Badge */}
                    <div className="app-corner-badges">
                      <div
                        className="app-corner-badge"
                        style={{ backgroundColor: roleColor }}
                      >
                        {user.role_name === 'org_admin' ? 'Org-Admin' : user.role_name === 'admin' ? 'Admin' : 'Teamer:in'}
                      </div>
                    </div>

                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        {/* Role Icon */}
                        <div
                          className="app-icon-circle app-icon-circle--lg"
                          style={{ backgroundColor: roleColor }}
                        >
                          <IonIcon icon={user.role_name === 'org_admin' || user.role_name === 'admin' ? shield : person} />
                        </div>

                        {/* Content */}
                        <div className="app-list-item__content">
                          {/* Zeile 1: Name */}
                          <div
                            className="app-list-item__title"
                            style={!user.is_active ? { color: '#999', paddingRight: '70px' } : { paddingRight: '70px' }}
                          >
                            {user.display_name}
                          </div>

                          {/* Zeile 2: Username + Titel */}
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={at} className={user.is_active ? 'app-icon-color--jahrgang' : ''} style={!user.is_active ? { color: '#999' } : undefined} />
                              {user.username}
                            </span>
                            {user.role_title && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={briefcase} className={user.is_active ? 'app-icon-color--badges' : ''} style={!user.is_active ? { color: '#999' } : undefined} />
                                {user.role_title}
                              </span>
                            )}
                          </div>

                          {/* Zeile 3: Jahrgänge + Login */}
                          <div className="app-list-item__meta">
                            {user.assigned_jahrgaenge_count > 0 && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={school} className={user.is_active ? 'app-icon-color--jahrgang' : ''} style={!user.is_active ? { color: '#999' } : undefined} />
                                {user.assigned_jahrgaenge_count} Jg.
                              </span>
                            )}
                            {user.last_login_at && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={time} className={user.is_active ? 'app-icon-color--success' : ''} style={!user.is_active ? { color: '#999' } : undefined} />
                                {formatDate(user.last_login_at)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                {user.can_edit !== false && (
                  <IonItemOptions side="end" className="app-swipe-actions">
                    <IonItemOption
                      onClick={() => {
                        closeAllSlidingItems();
                        onSelectUser(user);
                      }}
                      className="app-swipe-action"
                    >
                      <div className="app-icon-circle app-icon-circle--lg app-icon-circle--users">
                        <IonIcon icon={createOutline} />
                      </div>
                    </IonItemOption>
                    <IonItemOption
                      onClick={() => {
                        closeAllSlidingItems();
                        onDeleteUser(user);
                      }}
                      className="app-swipe-action"
                    >
                      <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                        <IonIcon icon={trash} />
                      </div>
                    </IonItemOption>
                  </IonItemOptions>
                )}
              </IonItemSliding>
              );
            })}

      </ListSection>
    </>
  );
};

export default UsersView;
