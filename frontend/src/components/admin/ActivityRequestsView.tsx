import React, { useState } from 'react';
import {
  IonIcon,
  IonItem,
  IonLabel,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonSegment,
  IonSegmentButton
} from '@ionic/react';
import {
  checkmarkCircle,
  closeCircle,
  hourglass,
  documentOutline,
  calendar,
  home,
  people,
  trophy,
  returnUpBack
} from 'ionicons/icons';
import { SectionHeader, ListSection, StatusBadge } from '../shared';

interface ActivityRequest {
  id: number;
  konfi_id: number;
  konfi_name: string;
  jahrgang_name?: string;
  activity_id: number;
  activity_name: string;
  activity_type?: string;
  activity_points?: number;
  requested_date: string;
  comment?: string;
  photo_filename?: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_comment?: string;
  approved_by?: number;
  approved_by_name?: string;
  activity_target_role?: 'konfi' | 'teamer';
  created_at: string;
  updated_at: string;
}

interface ActivityRequestsViewProps {
  requests: ActivityRequest[];
  onUpdate: () => void;
  onSelectRequest: (request: ActivityRequest) => void;
  onResetRequest: (request: ActivityRequest) => void;
}

const ActivityRequestsView: React.FC<ActivityRequestsViewProps> = ({
  requests: requestsRaw,
  onUpdate,
  onSelectRequest,
  onResetRequest
}) => {
  // Defensive: bei kaputten/gecachten Responses (Object statt Array) auf [] fallen
  const requests: ActivityRequest[] = Array.isArray(requestsRaw) ? requestsRaw : [];

  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  const filteredAndSortedRequests = (() => {
    let result = [...requests];

    if (statusFilter !== 'all') {
      result = result.filter(r => r.status === statusFilter);
    }

    result = result.sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  })();

  const getPendingCount = () => requests.filter(r => r.status === 'pending').length;
  const getApprovedCount = () => requests.filter(r => r.status === 'approved').length;
  const getRejectedCount = () => requests.filter(r => r.status === 'rejected').length;

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getTypeIcon = (type: string) => {
    return type === 'gottesdienst' ? home : people;
  };

  const getTypeColor = (type: string) => {
    return type === 'gottesdienst' ? '#007aff' : '#059669';
  };

  return (
    <>
      <SectionHeader
        title="Anträge"
        subtitle="Aktivitäts-Anträge verwalten"
        icon={documentOutline}
        preset="activities"
        stats={[
          { value: getPendingCount(), label: 'Offen' },
          { value: getApprovedCount(), label: 'Genehmigt' },
          { value: getRejectedCount(), label: 'Abgelehnt' }
        ]}
      />

      {/* Tab Filter - wie bei Events */}
      <div style={{ margin: '16px 16px 8px 16px' }}>
        <IonSegment
          value={statusFilter}
          onIonChange={(e) => setStatusFilter(e.detail.value as any)}
        >
          <IonSegmentButton value="pending">
            <IonLabel>Offen</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="approved">
            <IonLabel>Genehmigt</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="rejected">
            <IonLabel>Abgelehnt</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>
      {/* Anträge Liste */}
      <ListSection
        icon={documentOutline}
        title="Anträge"
        count={filteredAndSortedRequests.length}
        iconColorClass="success"
        isEmpty={filteredAndSortedRequests.length === 0}
        emptyIcon={documentOutline}
        emptyTitle="Keine Anträge vorhanden"
        emptyMessage="Konfirmand:innen können Aktivitäten beantragen"
        emptyIconColor="#059669"
      >
        {filteredAndSortedRequests.map((request, index) => {
                  const isPending = request.status === 'pending';
                  const isApproved = request.status === 'approved';
                  const isRejected = request.status === 'rejected';

                  // Status-Farbe und Text
                  const statusColor = isPending ? '#ff9500' : isApproved ? '#059669' : '#dc3545';
                  const statusText = isPending ? 'Offen' : isApproved ? 'Genehmigt' : 'Abgelehnt';

                  return (
                    <IonItemSliding key={request.id} style={{ marginBottom: index < filteredAndSortedRequests.length - 1 ? '8px' : '0' }}>
                      <IonItem
                        button
                        onClick={() => onSelectRequest(request)}
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
                            opacity: (isApproved || isRejected) ? 0.7 : 1,
                            position: 'relative',
                            overflow: 'hidden'
                          }}
                        >
                          {/* Eselsohr-Style Corner Badges - Team links innen, Status in der Ecke */}
                          <div className="app-corner-badges">
                            {request.activity_target_role === 'teamer' && (
                              <>
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: 'var(--app-color-teamer)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                  title="Team-Antrag"
                                >
                                  <IonIcon icon={people} style={{ color: '#fff', fontSize: '0.85rem' }} />
                                </div>
                                <div className="app-corner-badges__separator" />
                              </>
                            )}
                            <StatusBadge statusText={statusText} statusColor={statusColor} />
                          </div>
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              {/* Status Icon */}
                              <div
                                className="app-icon-circle app-icon-circle--lg"
                                style={{ backgroundColor: statusColor }}
                              >
                                <IonIcon icon={isPending ? hourglass : isApproved ? checkmarkCircle : closeCircle} />
                              </div>

                              {/* Content */}
                              <div className="app-list-item__content">
                                {/* Zeile 1: Konfi-Name */}
                                <div
                                  className="app-list-item__title"
                                  style={{
                                    color: (isApproved || isRejected) ? '#999' : undefined,
                                    paddingRight: '70px'
                                  }}
                                >
                                  {request.konfi_name}
                                </div>

                                {/* Zeile 2: Aktivitätsname */}
                                <div className="app-list-item__subtitle" style={{
                                  color: (isApproved || isRejected) ? '#999' : '#666',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {request.activity_name}
                                </div>

                                {/* Zeile 3: Meta-Infos */}
                                <div className="app-list-item__meta">
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={calendar} style={{ color: (isApproved || isRejected) ? '#999' : '#059669' }} />
                                    {formatDate(request.requested_date)}
                                  </span>
                                  {/* Teamer-Antraege sind reiner Nachweis -> KEINE Punkte und KEIN
                                      Punkte-Typ (GD/Gem.) anzeigen; stattdessen "Team"-Kennzeichnung. */}
                                  {request.activity_target_role === 'teamer' ? (
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={people} style={{ color: (isApproved || isRejected) ? '#999' : 'var(--app-color-teamer)' }} />
                                      Team
                                    </span>
                                  ) : (
                                    <>
                                      {request.activity_points && (
                                        <span className="app-list-item__meta-item">
                                          <IonIcon icon={trophy} style={{ color: (isApproved || isRejected) ? '#999' : '#ff9500' }} />
                                          {request.activity_points}P
                                        </span>
                                      )}
                                      <span className="app-list-item__meta-item">
                                        <IonIcon
                                          icon={getTypeIcon(request.activity_type || 'gemeinde')}
                                          style={{ color: (isApproved || isRejected) ? '#999' : getTypeColor(request.activity_type || 'gemeinde') }}
                                        />
                                        {request.activity_type === 'gottesdienst' ? 'GD' : 'Gem.'}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </IonItem>

                      {/* Swipe Actions: Admins loeschen Antraege NICHT (nur ablehnen ueber
                          die Detail-Ansicht). Loeschen duerfen nur Konfi/Teamer ihre eigenen. */}
                      {!isPending && (
                        <IonItemOptions side="end" className="app-swipe-actions">
                          {/* Reset-Button für approved/rejected */}
                          <IonItemOption
                            onClick={() => onResetRequest(request)}
                            className="app-swipe-action"
                          >
                            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--warning">
                              <IonIcon icon={returnUpBack} />
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

export default ActivityRequestsView;
