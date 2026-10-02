import React, { useState, useRef } from 'react';
import { IonIcon, IonItem, IonItemGroup, IonLabel, IonList, IonListHeader, IonItemSliding, IonItemOptions, IonItemOption, IonInput, IonSegment, IonSegmentButton, IonRefresher, IonRefresherContent } from '@ionic/react';
import {
  ICON_AKTENTASCHE_GEFUELLT,
  ICON_AT_ZEICHEN,
  ICON_FILTER,
  ICON_GRUPPE,
  ICON_GRUPPE_GEFUELLT,
  ICON_JAHRGANG_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_ORGANISATION_GEFUELLT,
  ICON_PERSON,
  ICON_PERSON_GEFUELLT,
  ICON_SCHILD_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
} from '../shared/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection } from '../shared';
import { AdminUser } from '../../types/user';
import { triggerPullHaptic } from '../../utils/haptics';
import { datumKurz } from '../../utils/dateUtils';
import { rollenName, rollenFarbeVar } from '../../utils/rollenNamen';

// Ionic 9 gibt bei ref an IonItemSliding die React-Komponente zurueck, nicht
// mehr das DOM-Element. Gebraucht wird hier nur close() — das haben beide.
type SlidingRef = { close: () => Promise<void> };

interface UsersViewProps {
  users: AdminUser[];
  onUpdate: () => void;
  onSelectUser: (user: AdminUser) => void;
  onDeleteUser: (user: AdminUser) => void;
  darfVerwalten: boolean;
}

const UsersView: React.FC<UsersViewProps> = ({
  users,
  onUpdate,
  onSelectUser,
  darfVerwalten,
  onDeleteUser
}) => {
  const slidingRefs = useRef<Map<number, SlidingRef>>(new Map());
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

  const getAdminUsers = () => users.filter(user => user.role_name === 'admin' || user.role_name === 'org_admin');
  const getTeamerUsers = () => users.filter(user => user.role_name === 'teamer');

  const getRoleColor = (roleName: string) => rollenFarbeVar(roleName);


  const formatDate = (dateString: string) => {
    return datumKurz(dateString);
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
        subtitle="Leitung, Team und Rollen"
        icon={ICON_GRUPPE_GEFUELLT}
        preset="users"
        stats={[
          // Die Kacheln entsprechen den Reitern; "Aktiv" hat keine Kachel.
          { value: users.length, label: 'Gesamt', onClick: () => setSelectedFilter('alle'), active: selectedFilter === 'alle' },
          { value: getAdminUsers().length, label: 'Leitung', onClick: () => setSelectedFilter('admin'), active: selectedFilter === 'admin' },
          { value: getTeamerUsers().length, label: 'Team', onClick: () => setSelectedFilter('teamer'), active: selectedFilter === 'teamer' }
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
            <IonLabel>Leitung</IonLabel>
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
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" className="app-search-bar__icon" />
            <IonInput aria-label="Benutzer:in suchen"
              value={searchTerm}
              onIonInput={(e) => setSearchTerm(e.detail.value!)}
              placeholder="Benutzer:in suchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      {/* Benutzer-Liste */}
      <ListSection
        icon={ICON_GRUPPE}
        title="Benutzer:innen"
        count={filteredAndSortedUsers.length}
        iconColorClass="users"
        isEmpty={filteredAndSortedUsers.length === 0}
        emptyIcon={ICON_PERSON}
        emptyTitle="Keine Benutzer:innen gefunden"
        emptyMessage="Noch keine Teammitglieder angelegt"
        emptyIconColor="var(--app-color-users)"
      >
        {filteredAndSortedUsers.map((user, index) => {
              const roleColor = getRoleColor(user.role_name);
              const rolleText = rollenName(user.role_name);
              const rolleIcon = user.role_name === 'org_admin' ? ICON_ORGANISATION_GEFUELLT : user.role_name === 'admin' ? ICON_SCHILD_GEFUELLT : ICON_PERSON_GEFUELLT;

              return (
              <IonItemSliding
                key={user.id}
                ref={(ref) => {
                  if (ref) slidingRefs.current.set(user.id, ref);
                }}
                style={{ marginBottom: index < filteredAndSortedUsers.length - 1 ? 'var(--app-abstand-eng)' : '0' }}
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
                        style={{ backgroundColor: roleColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                        title={rolleText}
                        role="img"
                        aria-label={rolleText}
                      >
                        <IonIcon icon={rolleIcon} aria-hidden="true" style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                      </div>
                    </div>

                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        {/* Role Icon */}
                        <div
                          className="app-icon-circle app-icon-circle--lg"
                          style={{ backgroundColor: roleColor }}
                        >
                          <IonIcon icon={user.role_name === 'org_admin' || user.role_name === 'admin' ? ICON_SCHILD_GEFUELLT : ICON_PERSON_GEFUELLT} />
                        </div>

                        {/* Content */}
                        <div className="app-list-item__content">
                          {/* Zeile 1: Name */}
                          <div
                            className="app-list-item__title"
                            style={!user.is_active ? { color: 'var(--app-text-muted)', paddingRight: 'var(--app-freiraum-aktion-l)' } : { paddingRight: 'var(--app-freiraum-aktion-l)' }}
                          >
                            {user.display_name}
                          </div>

                          {/* Zeile 2: Username + Titel */}
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_AT_ZEICHEN} className={user.is_active ? 'app-icon-color--jahrgang' : ''} style={!user.is_active ? { color: 'var(--app-text-muted)' } : undefined} />
                              {user.username}
                            </span>
                            {user.role_title && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_AKTENTASCHE_GEFUELLT} className={user.is_active ? 'app-icon-color--badges' : ''} style={!user.is_active ? { color: 'var(--app-text-muted)' } : undefined} />
                                {user.role_title}
                              </span>
                            )}
                            {/* Ueber eine Gemeinde-Einladung dabei: Konto und
                                Stamm-Gemeinde liegen woanders, hier gibt es
                                nur Rolle und Jahrgaenge. */}
                            {user.mitgliedschaft === 'weitere' && (
                              <span className="app-list-item__meta-item">
                                zuhause in einer anderen Gemeinde
                              </span>
                            )}
                          </div>

                          {/* Zeile 3: Jahrgänge + Login */}
                          <div className="app-list-item__meta">
                            {user.assigned_jahrgaenge_count > 0 && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_JAHRGANG_GEFUELLT} className={user.is_active ? 'app-icon-color--jahrgang' : ''} style={!user.is_active ? { color: 'var(--app-text-muted)' } : undefined} />
                                {user.assigned_jahrgaenge_count} Jg.
                              </span>
                            )}
                            {user.last_login_at && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={ICON_UHRZEIT_GEFUELLT} className={user.is_active ? 'app-icon-color--success' : ''} style={!user.is_active ? { color: 'var(--app-text-muted)' } : undefined} />
                                {formatDate(user.last_login_at)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                {/* Konvention wie in allen anderen Verwaltungslisten:
                    Tippen = bearbeiten, Wischen = löschen. Der frühere
                    Bearbeiten-Wisch rief exakt dieselbe Funktion wie der
                    Tap auf und war damit reine Doppelung. */}
                {darfVerwalten && user.can_edit !== false && (
                  <IonItemOptions side="end" className="app-swipe-actions">
                    <IonItemOption
                      onClick={() => {
                        closeAllSlidingItems();
                        onDeleteUser(user);
                      }}
                      className="app-swipe-action"
                      aria-label="Benutzer:in löschen"
                    >
                      <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                        <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
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
