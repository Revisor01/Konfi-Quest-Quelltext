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
  ICON_ABSAGE,
  ICON_FILTER,
  ICON_GEMEINDE_GEFUELLT,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_KAMERA_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN_GEFUELLT,
  ICON_TEXTDOKUMENT,
  ICON_WARTEND_GEFUELLT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { SectionHeader, ListSection, StatusBadge } from '../../shared';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
// Gemeinsamer Typ statt eigener Kopie — siehe RequestDetailModal. Sieben
// gleichnamige ActivityRequest-Definitionen lagen in der App verstreut, mit
// unterschiedlicher Nullbarkeit; Ionic 9 typisiert useIonModal strenger und
// hat die Widersprueche aufgedeckt.
import type { ActivityRequest } from '../modals/RequestDetailModal';


interface RequestsViewProps {
  requests: ActivityRequest[];
  onDeleteRequest?: (request: ActivityRequest) => void;
  onSelectRequest?: (request: ActivityRequest) => void;
  activeTab: 'all' | 'pending' | 'approved' | 'rejected';
  onTabChange: (tab: 'all' | 'pending' | 'approved' | 'rejected') => void;
  formatDate: (dateString: string) => string;
  // Teamer-Aktivitäten haben keine Gottesdienst/Gemeinde-Punkte-Logik —
  // im Teamer-Modus wird stattdessen "Team" gezeigt und die Punktzahl ausgeblendet.
  teamerMode?: boolean;
  // Haupt-Segment der Page (Events | Anträge) - wird direkt unter dem
  // Grafik-Header gerendert, damit die Seitenstruktur zu den anderen Tabs passt.
  headerSlot?: React.ReactNode;
}

const RequestsView: React.FC<RequestsViewProps> = ({
  requests,
  onDeleteRequest,
  onSelectRequest,
  activeTab,
  onTabChange,
  formatDate,
  teamerMode = false,
  headerSlot
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

    const statusColor = isPending ? 'var(--app-color-warning)' : isApproved ? 'var(--app-color-success-strong)' : 'var(--app-color-danger)';
    const statusText = isPending ? 'Offen' : isApproved ? 'Angerechnet' : 'Abgelehnt';
    const statusIcon = isPending ? ICON_WARTEND_GEFUELLT : isApproved ? ICON_ZUSAGE_GEFUELLT : ICON_ABSAGE;

    return { statusColor, statusText, statusIcon, isPending, isApproved, isRejected };
  };


  return (
    <div>
      <SectionHeader
        title="Deine Aktivitäten"
        subtitle="Was du gemeldet hast"
        icon={ICON_ZUSAGE_GEFUELLT}
        preset="konfi-requests"
        stats={[
          // Die Kacheln entsprechen den drei Reitern und schalten dorthin.
          { value: pendingRequests.length, label: 'Offen', onClick: () => onTabChange('pending'), active: activeTab === 'pending' },
          { value: approvedRequests.length, label: 'Erledigt', onClick: () => onTabChange('approved'), active: activeTab === 'approved' },
          { value: rejectedRequests.length, label: 'Abgelehnt', onClick: () => onTabChange('rejected'), active: activeTab === 'rejected' }
        ]}
      />

      {headerSlot}

      {/* Suche & Filter — wie Chat-Pattern */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--success">
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" className="app-icon-color--system" style={{ fontSize: 'var(--app-text-standard)' }} />
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
          onIonChange={(e) => onTabChange(e.detail.value as 'all' | 'pending' | 'approved' | 'rejected')}
        >
          <IonSegmentButton value="pending">
            <IonLabel>Offen</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="approved">
            <IonLabel>Angerechnet</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="rejected">
            <IonLabel>Abgelehnt</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

      {/* Aktivitäten-Liste — neue Aktivitäten laufen ueber den Plus-Button im Header */}
      <ListSection
        icon={ICON_TEXTDOKUMENT}
        title="Aktivitäten"
        count={filteredRequests.length}
        iconColorClass="success"
        isEmpty={filteredRequests.length === 0}
        emptyIcon={ICON_TEXTDOKUMENT}
        emptyTitle="Keine Aktivitäten gefunden"
        emptyMessage="Noch keine Aktivitäten gemeldet"
        emptyIconColor="var(--app-color-success-strong)"
      >
        {filteredRequests.map((request) => {
          const { statusColor, statusText, statusIcon, isPending, isRejected } = getRequestStatusInfo(request);

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
                        <IonIcon icon={statusIcon} style={{ color: 'white' }} />
                      </div>

                      {/* Content */}
                      <div className="app-list-item__content">
                        {/* Zeile 1: Aktivitätsname */}
                        <div
                          className="app-list-item__title"
                          style={{
                            paddingRight: 'var(--app-freiraum-aktion-l)'
                          }}
                        >
                          {request.activity_name}
                        </div>

                        {/* Zeile 2: Datum + Punkte + Typ + Foto */}
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-icon-color--gemeinde" />
                            {formatDate(request.requested_date)}
                          </span>
                          {/* Punkte nur fuer Konfis — Teamer-Aktivitaeten geben keine Punkte. */}
                          {!teamerMode && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_POKAL_GEFUELLT} className="app-icon-color--points" />
                              {request.activity_points}P
                            </span>
                          )}
                          <span className="app-list-item__meta-item">
                            {teamerMode ? (
                              <>
                                <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-icon-color--teamer" />
                                Team
                              </>
                            ) : (
                              <>
                                <IonIcon
                                  icon={request.activity_type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_GEMEINDE_GEFUELLT}
                                  className={request.activity_type === 'gottesdienst' ? 'app-icon-color--gottesdienst' : 'app-icon-color--gemeinde'}
                                />
                                {request.activity_type === 'gottesdienst' ? 'GD' : 'Gem.'}
                              </>
                            )}
                          </span>
                          {request.photo_filename && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_KAMERA_GEFUELLT} className="app-icon-color--konfis" />
                              Foto
                            </span>
                          )}
                        </div>

                        {/* Zeile 3: Kommentar (falls vorhanden) */}
                        {request.comment && (
                          <div className="app-list-item__subtitle" style={{
                            color: 'var(--app-text-secondary)',
                            fontStyle: 'italic',
                            marginTop: 'var(--app-abstand-mini)'
                          }}>
                            "{request.comment}"
                          </div>
                        )}

                        {/* Ablehnungsgrund bei rejected */}
                        {isRejected && request.admin_comment && (
                          <div className="app-reason-box app-reason-box--danger" style={{ marginTop: 'var(--app-abstand-eng)' }}>
                            <div>
                              <span className="app-reason-box__label" style={{
                                fontSize: 'var(--app-text-meta)'
                              }}>
                                Grund der Ablehnung
                              </span>
                              <p style={{
                                margin: 'var(--app-abstand-winzig) 0 0 0',
                                fontSize: 'var(--app-text-hinweis)',
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
                    onClick={() => { closeOpenSlidingItems(); onDeleteRequest(request); }}
                    aria-label="Aktivität löschen"
                    className="app-swipe-action"
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
    </div>
  );
};

export default RequestsView;
