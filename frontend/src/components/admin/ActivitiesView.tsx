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
  IonSegment,
  IonSegmentButton
} from '@ionic/react';
import {
  trash,
  calendar,
  home,
  people,
  ribbon,
  flash,
  pricetag,
  flashOutline,
  filterOutline,
  search
} from 'ionicons/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection } from '../shared';

interface Activity {
  id: number;
  name: string;
  description?: string;
  points: number;
  type: 'gottesdienst' | 'gemeinde' | null;
  target_role?: 'konfi' | 'teamer';
  categories?: {id: number, name: string}[];
  created_at: string;
}

interface ActivitiesViewProps {
  activities: Activity[];
  onUpdate: () => void;
  onAddActivityClick: () => void;
  onSelectActivity: (activity: Activity) => void;
  onDeleteActivity: (activity: Activity) => void;
  canEdit: boolean;
  canDelete: boolean;
  targetRole?: 'konfi' | 'teamer';
  onRoleChange?: (role: 'konfi' | 'teamer') => void;
}

const ActivitiesView: React.FC<ActivitiesViewProps> = ({
  activities,
  onUpdate,
  onAddActivityClick,
  onSelectActivity,
  onDeleteActivity,
  canEdit,
  canDelete,
  targetRole = 'konfi',
  onRoleChange
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('alle');
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());

  const filteredAndSortedActivities = (() => {
    let result = filterBySearchTerm(activities, searchTerm, ['name', 'description']);
    
    // Filter by type
    if (selectedType !== 'alle') {
      result = result.filter(activity => activity.type === selectedType);
    }
    
    // Sort by name
    result = result.sort((a, b) => a.name.localeCompare(b.name));
    
    return result;
  })();

  const getGottesdienstActivities = () => {
    return activities.filter(activity => activity.type === 'gottesdienst');
  };

  const getGemeindeActivities = () => {
    return activities.filter(activity => activity.type === 'gemeinde');
  };


  const getTypeColor = (type: string | null) => {
    switch (type) {
      case 'gottesdienst': return 'primary';
      case 'gemeinde': return 'primary';
      default: return 'medium';
    }
  };

  const getTypeIcon = (type: string | null) => {
    switch (type) {
      case 'gottesdienst': return home;
      case 'gemeinde': return people;
      default: return calendar;
    }
  };

  const getTypeText = (type: string | null) => {
    switch (type) {
      case 'gottesdienst': return 'Gottesdienst';
      case 'gemeinde': return 'Gemeinde';
      default: return 'Unbekannt';
    }
  };

  const handleDeleteWithSlideClose = async (activity: Activity) => {
    const slidingElement = slidingRefs.current.get(activity.id);
    
    try {
      await onDeleteActivity(activity);
      // Bei erfolgreichem Löschen schließt sich das Sliding automatisch durch den Re-render
    } catch (error) {
      // Bei Fehler: Sliding automatisch schließen für bessere UX
      if (slidingElement) {
        await slidingElement.close();
      }
      // Der Fehler wird bereits im Parent (AdminActivitiesPage) behandelt und angezeigt
    }
  };

  return (
    <>
      <SectionHeader
        title="Aktivitäten"
        subtitle={targetRole === 'teamer' ? 'Teamer:innen-Aktivitäten' : 'Punkte und Aufgaben'}
        icon={flash}
        preset="activities"
        stats={targetRole === 'teamer' ? [
          { value: activities.length, label: 'Gesamt' }
        ] : [
          { value: activities.length, label: 'Gesamt' },
          { value: getGemeindeActivities().length, label: 'Gemeinde' },
          { value: getGottesdienstActivities().length, label: 'Godi' }
        ]}
      />

      {/* Konfis / Teamer:innen Segment */}
      {onRoleChange && (
        <IonSegment
          value={targetRole}
          onIonChange={(e) => onRoleChange(e.detail.value as 'konfi' | 'teamer')}
          style={{ margin: '0 16px 8px', maxWidth: 'calc(100% - 32px)' }}
        >
          <IonSegmentButton value="konfi">
            <IonLabel>Konfis</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="teamer">
            <IonLabel>Teamer:innen</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      )}

      {/* Suche & Filter */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--activities">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonCard className="app-card">
          <IonCardContent style={{ padding: '8px 16px' }}>
            <div className="app-search-bar" style={{ padding: 0 }}>
              <IonIcon icon={search} className="app-search-bar__icon" />
              <IonInput
                value={searchTerm}
                onIonInput={(e) => setSearchTerm(e.detail.value!)}
                placeholder="Aktivität suchen..."
                clearInput={true}
                style={{ '--padding-start': '0' }}
              />
            </div>
          </IonCardContent>
        </IonCard>
      </IonList>

      {/* Typ-Filter - nur bei Konfis (Teamer haben keinen Typ) */}
      {targetRole !== 'teamer' && (
      <div className="app-segment-wrapper">
        <IonSegment
          value={selectedType}
          onIonChange={(e) => setSelectedType(e.detail.value as string)}
        >
          <IonSegmentButton value="alle">
            <IonLabel>Alle</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="gemeinde">
            <IonLabel>Gemeinde</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="gottesdienst">
            <IonLabel>GoDi</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>
      )}

      {/* Aktivitäten Liste */}
      <ListSection
        icon={flashOutline}
        title="Aktivitäten"
        count={filteredAndSortedActivities.length}
        iconColorClass="activities"
        isEmpty={filteredAndSortedActivities.length === 0}
        emptyIcon={flash}
        emptyTitle="Keine Aktivitäten gefunden"
        emptyMessage="Noch keine Aktivitäten angelegt"
        emptyIconColor="#059669"
      >
        {filteredAndSortedActivities.map((activity, index) => {
              // Teamer:innen-Aktivitaeten haben keine Kategorie/keinen Typ und
              // keine Punkte -> einheitlich Teamer-Farbe (nicht Gemeinde-Gruen).
              const isTeamerActivity = activity.target_role === 'teamer';
              const typeColor = isTeamerActivity
                ? 'var(--app-color-teamer)'
                : (activity.type === 'gottesdienst' ? '#007aff' : '#059669');

              return (
              <IonItemSliding
                key={activity.id}
                ref={(el) => {
                  if (el) {
                    slidingRefs.current.set(activity.id, el);
                  } else {
                    slidingRefs.current.delete(activity.id);
                  }
                }}
                style={{ marginBottom: index < filteredAndSortedActivities.length - 1 ? '8px' : '0' }}
              >
                <IonItem
                  button={canEdit}
                  onClick={canEdit ? () => onSelectActivity(activity) : undefined}
                  detail={false}
                  lines="none"
                  style={{
                    '--background': 'transparent',
                    '--padding-start': '0',
                    '--padding-end': '0',
                    '--inner-padding-end': '0',
                    '--inner-border-width': '0',
                    '--border-style': 'none',
                    '--min-height': 'auto',
                    opacity: canEdit ? 1 : 0.6,
                    cursor: canEdit ? 'pointer' : 'default'
                  }}
                >
                  <div
                    className="app-list-item app-list-item--activities"
                    style={{
                      width: '100%',
                      borderLeftColor: typeColor,
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Eselsohr-Style Corner Badge — nur bei Konfi-Aktivitaeten
                        (Teamer:innen-Aktivitaeten haben keine Punkte) */}
                    {!isTeamerActivity && (
                      <div className="app-corner-badges">
                        <div
                          className="app-corner-badge"
                          style={{ backgroundColor: typeColor }}
                        >
                          +{activity.points}P
                        </div>
                      </div>
                    )}

                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        {/* Activity Icon */}
                        <div
                          className="app-icon-circle app-icon-circle--lg"
                          style={{ backgroundColor: typeColor }}
                        >
                          <IonIcon icon={isTeamerActivity ? ribbon : getTypeIcon(activity.type)} />
                        </div>

                        {/* Content */}
                        <div className="app-list-item__content">
                          {/* Zeile 1: Name */}
                          <div
                            className="app-list-item__title"
                            style={{ paddingRight: '60px' }}
                          >
                            {activity.name}
                          </div>

                          {/* Zeile 2: Kategorien */}
                          <div className="app-list-item__meta">
                            {activity.categories && activity.categories.length > 0 && (
                              <span className="app-list-item__meta-item">
                                <IonIcon icon={pricetag} style={{ color: '#0ea5e9' }} />
                                {activity.categories.map(cat => cat.name).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>

                {canDelete && (
                  <IonItemOptions side="end" className="app-swipe-actions">
                    <IonItemOption
                      onClick={() => handleDeleteWithSlideClose(activity)}
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

export default ActivitiesView;