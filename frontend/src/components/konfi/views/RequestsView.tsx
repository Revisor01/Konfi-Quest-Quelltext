import React, { useState } from 'react';
import {
  IonIcon,
  IonItem,
  IonLabel,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonSegment,
  IonSegmentButton,
  IonList,
  IonListHeader,
  IonItemGroup,
  IonInput
} from '@ionic/react';
import {
  hourglass,
  checkmarkCircle,
  closeCircle,
  calendar,
  home,
  people,
  trash,
  trophy,
  camera,
  documentTextOutline,
  search,
  filterOutline
} from 'ionicons/icons';
import { SectionHeader, ListSection, StatusBadge } from '../../shared';

interface ActivityRequest {
  id: number;
  activity_id: number;
  activity_name: string;
  activity_points: number;
  activity_type: 'gottesdienst' | 'gemeinde';
  requested_date: string;
  comment?: string;
  photo_filename?: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment?: string;
  created_at: string;
  updated_at: string;
}

interface RequestsViewProps {
  requests: ActivityRequest[];
  onDeleteRequest?: (request: ActivityRequest) => void;
  onSelectRequest?: (request: ActivityRequest) => void;
  activeTab: 'all' | 'pending' | 'approved' | 'rejected';
  onTabChange: (tab: 'all' | 'pending' | 'approved' | 'rejected') => void;
  formatDate: (dateString: string) => string;
  getStatusColor: (status: string) => string;
  getStatusText: (status: string) => string;
  getTypeIcon: (type: string) => string;
  getTypeText: (type: string) => string;
  // Teamer-Aktivitaeten haben keine Gottesdienst/Gemeinde-Punkte-Logik —
  // im Teamer-Modus wird stattdessen "Team" gezeigt und die Punktzahl ausgeblendet.
  teamerMode?: boolean;
}

const RequestsView: React.FC<RequestsViewProps> = ({
  requests,
  onDeleteRequest,
  onSelectRequest,
  activeTab,
  onTabChange,
  formatDate,
  getStatusColor,
  getStatusText,
  getTypeIcon,
  getTypeText,
  teamerMode = false
}) => {
  const [searchText, setSearchText] = useState('');

  const filteredRequests = requests.filter(r => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (r.activity_name || '').toLowerCase().includes(q);
  });

  const pendingRequests = requests.filter(r => r.status === 'pending');
  const approvedRequests = requests.filter(r => r.status === 'approved');
  const rejectedRequests = requests.filter(r => r.status === 'rejected');

  // Status-Infos für einen Request
  const getRequestStatusInfo = (request: ActivityRequest) => {
    const isPending = request.status === 'pending';
    const isApproved = request.status === 'approved';
    const isRejected = request.status === 'rejected';

    const statusColor = isPending ? '#ff9500' : isApproved ? '#059669' : '#dc3545';
    const statusText = isPending ? 'Offen' : isApproved ? 'Verbucht' : 'Abgelehnt';
    const statusIcon = isPending ? hourglass : isApproved ? checkmarkCircle : closeCircle;

    return { statusColor, statusText, statusIcon, isPending, isApproved, isRejected };
  };

  const getTypeColor = (type: string) => {
    return type === 'gottesdienst' ? '#007aff' : '#059669';
  };

  return (
    <div>
      <SectionHeader
        title="Deine Aktivitäten"
        subtitle="Anträge und Verbuchungen"
        icon={checkmarkCircle}
        preset="konfi-requests"
        stats={[
          { value: pendingRequests.length, label: 'Offen' },
          { value: approvedRequests.length, label: 'Verbucht' },
          { value: rejectedRequests.length, label: 'Abgelehnt' }
        ]}
      />

      {/* Suche & Filter — wie Chat-Pattern */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--success">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={search} slot="start" className="app-icon-color--system" style={{ fontSize: '1rem' }} />
            <IonInput
              value={searchText}
              onIonInput={(e) => setSearchText(e.detail.value || '')}
              placeholder="Aktivitäten durchsuchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      {/* Tab Navigation */}
      <div className="app-segment-wrapper">
        <IonSegment
          value={activeTab}
          onIonChange={(e) => onTabChange(e.detail.value as any)}
        >
          <IonSegmentButton value="pending">
            <IonLabel>Offen</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="approved">
            <IonLabel>Verbucht</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="rejected">
            <IonLabel>Abgelehnt</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

      {/* Anträge Liste */}
      <ListSection
        icon={documentTextOutline}
        title="Aktivitäten"
        count={filteredRequests.length}
        iconColorClass="success"
        isEmpty={filteredRequests.length === 0}
        emptyIcon={documentTextOutline}
        emptyTitle="Keine Anträge gefunden"
        emptyMessage="Noch keine Anträge gestellt"
        emptyIconColor="#059669"
      >
        {filteredRequests.map((request, index) => {
          const { statusColor, statusText, statusIcon, isPending, isApproved, isRejected } = getRequestStatusInfo(request);

          return (
            <IonItemSliding key={request.id}>
              <IonItem
                button
                onClick={() => onSelectRequest?.(request)}
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
                  className="app-list-item app-list-item--success"
                  style={{
                    width: '100%',
                    borderLeftColor: statusColor,
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  {/* Eselsohr-Style Corner Badge */}
                  <div className="app-corner-badges">
                    <StatusBadge statusText={statusText} statusColor={statusColor} />
                  </div>

                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      {/* Status-Icon (Farbe nach Status: orange/gruen/rot) */}
                      <div
                        className="app-icon-circle app-icon-circle--lg"
                        style={{ backgroundColor: statusColor }}
                      >
                        <IonIcon icon={statusIcon} style={{ color: '#fff' }} />
                      </div>

                      {/* Content */}
                      <div className="app-list-item__content">
                        {/* Zeile 1: Aktivitätsname */}
                        <div
                          className="app-list-item__title"
                          style={{
                            paddingRight: '70px'
                          }}
                        >
                          {request.activity_name}
                        </div>

                        {/* Zeile 2: Datum + Punkte + Typ + Foto */}
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={calendar} className="app-icon-color--gemeinde" />
                            {formatDate(request.requested_date)}
                          </span>
                          {/* Punkte nur fuer Konfis — Teamer-Aktivitaeten geben keine Punkte. */}
                          {!teamerMode && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={trophy} className="app-icon-color--points" />
                              {request.activity_points}P
                            </span>
                          )}
                          <span className="app-list-item__meta-item">
                            {teamerMode ? (
                              <>
                                <IonIcon icon={people} className="app-icon-color--teamer" />
                                Team
                              </>
                            ) : (
                              <>
                                <IonIcon
                                  icon={request.activity_type === 'gottesdienst' ? home : people}
                                  className={request.activity_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde'}
                                />
                                {request.activity_type === 'gottesdienst' ? 'GD' : 'Gem.'}
                              </>
                            )}
                          </span>
                          {request.photo_filename && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={camera} className="app-icon-color--konfis" />
                              Foto
                            </span>
                          )}
                        </div>

                        {/* Zeile 3: Kommentar (falls vorhanden) */}
                        {request.comment && (
                          <div className="app-list-item__subtitle" style={{
                            color: 'var(--app-text-secondary)',
                            fontStyle: 'italic',
                            marginTop: '4px'
                          }}>
                            "{request.comment}"
                          </div>
                        )}

                        {/* Ablehnungsgrund bei rejected */}
                        {isRejected && request.admin_comment && (
                          <div className="app-reason-box app-reason-box--danger" style={{ marginTop: '8px' }}>
                            <div>
                              <span className="app-reason-box__label" style={{
                                fontSize: '0.7rem'
                              }}>
                                Grund der Ablehnung
                              </span>
                              <p style={{
                                margin: '2px 0 0 0',
                                fontSize: '0.8rem',
                                lineHeight: '1.4'
                              }}>
                                {request.admin_comment}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </IonItem>

              {/* Swipe Actions */}
              {isPending && onDeleteRequest && (
                <IonItemOptions side="end" className="app-swipe-actions">
                  <IonItemOption
                    onClick={() => onDeleteRequest(request)}
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
    </div>
  );
};

export default RequestsView;
