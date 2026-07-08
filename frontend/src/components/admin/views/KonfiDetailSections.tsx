import React from 'react';
import {
  IonCard,
  IonCardContent,
  IonLabel,
  IonList,
  IonListHeader,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonIcon,
  IonButton,
  IonInput,
  IonDatetimeButton,
  IonDatetime,
  IonModal
} from '@ionic/react';
import {
  trophy,
  flash,
  calendar,
  school,
  add,
  time,
  gift,
  trash,
  image,
  podium,
  personOutline,
  ribbon,
  documentOutline,
  calendarOutline,
  timeOutline,
  starOutline,
  flashOutline,
  giftOutline,
  cloudOfflineOutline,
  chevronDown,
  chevronUp,
  bookOutline,
  locationOutline,
  book,
  documentText,
  chevronForward,
  checkmarkCircle
} from 'ionicons/icons';
import ActivityRings from './ActivityRings';
import { EmptyState } from '../../shared';

// ---- Shared Types ----

export interface Konfi {
  id: number;
  name: string;
  display_name?: string;
  username?: string;
  jahrgang?: string;
  jahrgang_name?: string;
  jahrgang_id?: number;
  gottesdienst_points?: number;
  gemeinde_points?: number;
  gottesdienst_enabled?: boolean;
  gemeinde_enabled?: boolean;
  target_gottesdienst?: number;
  target_gemeinde?: number;
  points?: {
    gottesdienst: number;
    gemeinde: number;
  };
  bonus?: number;
  bonusPoints?: number;
  totalBonus?: number;
  badgeCount?: number;
  activities_count?: number;
  role_name?: string;
  user_type?: string;
  teamer_since?: string;
  konfspruch?: {
    source: 'liste' | 'freitext';
    id?: number;
    reference?: string;
    text?: string;
    translation?: string;
  } | null;
  // Konfirmationstermin/-ort aus dem is_konfirmation-Event des Jahrgangs (read-only).
  confirmation_date?: string | null;
  confirmation_location?: string | null;
}

export interface Activity {
  id: number | string;
  name: string;
  points: number;
  type: string;
  date: string;
  completed_date?: string;
  target_role?: string;
  admin?: string;
  isPending?: boolean;
  photo_filename?: string;
  requestId?: number;
  hasPhoto?: boolean;
}

// ---- KonfiHeaderCard ----

interface KonfiHeaderCardProps {
  currentKonfi: Konfi | null;
  isTeamer: boolean;
  getTotalPoints: () => number;
  getGottesdienstPoints: () => number;
  getGemeindePoints: () => number;
  certificates: Array<{ id: number }>;
  teamerEvents: Array<{ id: number }>;
  activities: Activity[];
}

export const KonfiHeaderCard = React.memo<KonfiHeaderCardProps>(({
  currentKonfi,
  isTeamer,
  getTotalPoints,
  getGottesdienstPoints,
  getGemeindePoints,
  certificates,
  teamerEvents,
  activities
}) => (
  <div
    style={{
      background: isTeamer
        ? 'linear-gradient(135deg, #e11d48 0%, #be185d 50%, #9f1239 100%)'
        : 'linear-gradient(135deg, #5b21b6 0%, #4c1d95 100%)',
      borderRadius: '24px',
      padding: '24px',
      margin: '16px',
      boxShadow: isTeamer
        ? '0 20px 40px rgba(225, 29, 72, 0.3)'
        : '0 20px 40px rgba(91, 33, 182, 0.3)',
      position: 'relative',
      overflow: 'hidden'
    }}
  >
    {/* Überschrift - gross und überlappend */}
    <div
      style={{
        position: 'absolute',
        top: '-5px',
        left: '12px',
        zIndex: 1
      }}
    >
      <h2
        style={{
          fontSize: '3rem',
          fontWeight: '900',
          color: 'rgba(255, 255, 255, 0.08)',
          margin: '0',
          lineHeight: '0.8',
          letterSpacing: '-2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '280px'
        }}
      >
        {isTeamer ? 'TEAMER:IN' : (currentKonfi?.name || 'KONFI').toUpperCase()}
      </h2>
    </div>

    {/* Voller Name */}
    <div
      style={{
        textAlign: 'center',
        marginTop: '32px',
        marginBottom: '4px'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}
      >
        <IonIcon
          icon={personOutline}
          style={{ fontSize: '1.2rem', color: 'rgba(255, 255, 255, 0.8)' }}
        />
        <h1
          style={{
            margin: '0',
            fontSize: '1.4rem',
            fontWeight: '700',
            color: 'white'
          }}
        >
          {currentKonfi?.display_name || currentKonfi?.name || (isTeamer ? 'Teamer:in' : 'Konfi')}
        </h1>
      </div>
    </div>

    {/* Username und Jahrgang */}
    <div
      style={{
        textAlign: 'center',
        marginBottom: isTeamer ? '4px' : '16px',
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: '0.85rem'
      }}
    >
      {currentKonfi?.jahrgang_name || currentKonfi?.jahrgang
        ? `${currentKonfi?.jahrgang_name || currentKonfi?.jahrgang} - `
        : ''}@{currentKonfi?.username}
    </div>

    {/* Teamer: Aktiv seit */}
    {isTeamer && currentKonfi?.teamer_since && (
      <div
        style={{
          textAlign: 'center',
          marginBottom: '16px',
          color: 'rgba(255, 255, 255, 0.6)',
          fontSize: '0.8rem'
        }}
      >
        Teamer:in seit {new Date(currentKonfi.teamer_since).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
      </div>
    )}

    {/* Activity Rings - nur für Konfis */}
    {!isTeamer && (
      <ActivityRings
        totalPoints={getTotalPoints()}
        gottesdienstPoints={getGottesdienstPoints()}
        gemeindePoints={getGemeindePoints()}
        gottesdienstGoal={currentKonfi?.target_gottesdienst || 10}
        gemeindeGoal={currentKonfi?.target_gemeinde || 10}
        gottesdienstEnabled={currentKonfi?.gottesdienst_enabled}
        gemeindeEnabled={currentKonfi?.gemeinde_enabled}
        size={160}
      />
    )}

    {/* Teamer Stats Chips */}
    {isTeamer && (
      <div className="app-stats-row">
        {[
          { value: certificates.length, label: 'Zertifikate' },
          { value: teamerEvents.length, label: 'Events' },
          { value: currentKonfi?.badgeCount || 0, label: 'Badges' }
        ].map(stat => (
          <div key={stat.label} className="app-stats-row__item">
            <div className="app-stats-row__value">{stat.value}</div>
            <div className="app-stats-row__label">{stat.label}</div>
          </div>
        ))}
      </div>
    )}

    {/* Badge Count - nur für Konfis (Teamer haben Stats Chips) */}
    {!isTeamer && (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: '16px'
        }}
      >
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.15)',
            borderRadius: '12px',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <IonIcon icon={trophy} className="app-icon-color--badges" style={{ fontSize: '1.2rem' }} />
          <span style={{ color: 'white', fontWeight: '600' }}>{currentKonfi?.badgeCount || 0} Badges</span>
        </div>
      </div>
    )}
  </div>
));

// ---- BonusSection ----

interface BonusSectionProps {
  bonusEntries: any[];
  currentKonfi: Konfi | null;
  getBonusPoints: () => number;
  formatDate: (dateString: string) => string;
  handleDeleteBonus: (bonus: any) => void;
  presentBonusModal: (opts?: any) => void;
  presentingElement: HTMLElement | null;
}

export const BonusSection = React.memo<BonusSectionProps>(({
  bonusEntries,
  currentKonfi,
  getBonusPoints,
  formatDate,
  handleDeleteBonus,
  presentBonusModal,
  presentingElement
}) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--bonus">
        <IonIcon icon={gift} />
      </div>
      <IonLabel>Bonus ({getBonusPoints()})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: bonusEntries.length === 0 ? '16px' : '12px' }}>
        {bonusEntries.length === 0 ? (
          <EmptyState
            icon={giftOutline}
            title="Keine Bonuspunkte"
            message="Noch keine Bonuspunkte erhalten"
            iconColor="var(--app-color-bonus)"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {bonusEntries.map((bonus: any, index: number) => {
              const isTypeDisabled = (bonus.type === 'gottesdienst' && currentKonfi?.gottesdienst_enabled === false)
                || (bonus.type === 'gemeinde' && currentKonfi?.gemeinde_enabled === false);
              return (
              <IonItemSliding key={bonus.id || index} style={{ marginBottom: index < bonusEntries.length - 1 ? '8px' : '0' }}>
                <IonItem
                  className="app-item-transparent"
                  detail={false}
                  lines="none"
                >
                  <div
                    className="app-list-item app-list-item--bonus"
                    style={{
                      ...(isTypeDisabled ? { opacity: 0.4, filter: 'grayscale(100%)' } : {})
                    }}
                  >
                    {/* Corner Badge: Punkt-Typ-Farbe */}
                    <div className="app-corner-badges">
                      <div
                        className="app-corner-badge"
                        style={{
                          backgroundColor: bonus.type === 'gottesdienst' ? 'var(--app-color-gottesdienst)' : 'var(--app-color-gemeinde)'
                        }}
                      >
                        +{bonus.points}P
                      </div>
                    </div>
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div className="app-icon-circle app-icon-circle--bonus">
                          <IonIcon icon={gift} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title app-list-item__title--badge-space">
                            {bonus.description || 'Bonuspunkte'}
                            {isTypeDisabled && (
                              <span style={{ fontSize: '0.7rem', color: '#999', fontWeight: '400', marginLeft: '6px' }}>(deaktiviert)</span>
                            )}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={calendar} className="app-icon-color--events" />
                              {formatDate(bonus.completed_date || bonus.date)}
                            </span>
                            <span className="app-list-item__meta-item">{bonus.admin || 'Admin'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>
                <IonItemOptions className="app-swipe-actions" side="end">
                  <IonItemOption
                    className="app-swipe-action"
                    onClick={() => handleDeleteBonus(bonus)}
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={trash} />
                    </div>
                  </IonItemOption>
                </IonItemOptions>
              </IonItemSliding>
            );
            })}
          </div>
        )}
        <div className="app-event-detail__add-button-wrapper">
          <IonButton
            expand="block"
            fill="outline"
            onClick={() =>
              presentBonusModal({
                presentingElement: presentingElement || undefined
              })
            }
          >
            <IonIcon icon={add} slot="start" />
            Bonuspunkte hinzufügen
          </IonButton>
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- KonfispruchSection (read-only) ----

interface KonfispruchSectionProps {
  konfspruch: Konfi['konfspruch'];
  confirmationDate?: string | null;
  confirmationLocation?: string | null;
  attendance?: { total_mandatory: number; attended: number; percentage: number } | null;
  onOpenMatrix?: () => void;
}

export const KonfispruchSection = React.memo<KonfispruchSectionProps>(({ konfspruch, confirmationDate, confirmationLocation, attendance, onOpenMatrix }) => {
  // Spruch-Anzeige: Referenz (Buch/Stelle) + Text, unabhaengig von der Quelle.
  const spruchReference = konfspruch?.reference || null;
  const spruchText = konfspruch?.text || null;
  // Anwesenheits-Zeile: Quote farbcodiert wie in der frueheren AttendanceSection.
  const hasAttendance = !!attendance && attendance.total_mandatory > 0;
  const pct = attendance?.percentage ?? 0;
  const quoteColor = pct >= 80 ? 'var(--app-color-activities)'
    : pct >= 50 ? 'var(--app-color-warning)'
    : 'var(--app-color-danger)';
  return (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--konfis">
        <IonIcon icon={book} />
      </div>
      <IonLabel>Konfirmation</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent className="app-card-content">
        {/* Konfirmationstermin (read-only, aus is_konfirmation-Event) */}
        <div className="app-info-row">
          <IonIcon icon={calendar} className="app-info-row__icon app-icon-color--konfis" />
          <div>
            <div className="app-info-row__label">Konfirmationstermin</div>
            {confirmationDate ? (
              <div className="app-info-row__value">
                {new Date(confirmationDate).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                {' · '}
                {new Date(confirmationDate).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
                {confirmationLocation && ` · ${confirmationLocation}`}
              </div>
            ) : (
              <div className="app-info-row__value app-text-sub">Noch kein Termin festgelegt</div>
            )}
          </div>
        </div>

        {/* Konfispruch (read-only) */}
        <div className="app-info-row app-info-row--top">
          <IonIcon icon={documentText} className="app-info-row__icon app-icon-color--konfis app-event-detail__icon--align-top" />
          <div>
            <div className="app-info-row__label">{spruchReference || 'Konfispruch'}</div>
            {spruchText ? (
              <div className="app-info-row__value">{spruchText}</div>
            ) : (
              <div className="app-info-row__value app-text-sub">
                {konfspruch ? 'Übersetzung noch nicht hinterlegt' : 'Noch kein Spruch gewählt'}
              </div>
            )}
          </div>
        </div>

        {/* Pflicht-Events / Anwesenheit (klickbar -> Anwesenheitsmatrix) */}
        {hasAttendance && (
          <div
            className="app-info-row"
            onClick={onOpenMatrix}
            style={onOpenMatrix ? { cursor: 'pointer' } : undefined}
            role={onOpenMatrix ? 'button' : undefined}
          >
            <IonIcon icon={checkmarkCircle} className="app-info-row__icon app-icon-color--konfis" />
            <div style={{ flex: 1 }}>
              <div className="app-info-row__label">Pflicht-Events</div>
              <div className="app-info-row__value" style={{ color: quoteColor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {attendance!.attended} von {attendance!.total_mandatory} besucht · {pct}%
              </div>
            </div>
            {onOpenMatrix && (
              <IonIcon icon={chevronForward} style={{ color: '#c7c7cc', fontSize: '1.1rem', flexShrink: 0 }} />
            )}
          </div>
        )}
      </IonCardContent>
    </IonCard>
  </IonList>
  );
});

// ---- EventPointsSection ----

interface EventPointsSectionProps {
  eventPoints: any[];
  currentKonfi: Konfi | null;
}

export const EventPointsSection = React.memo<EventPointsSectionProps>(({
  eventPoints,
  currentKonfi
}) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={podium} />
      </div>
      <IonLabel>Events ({eventPoints.reduce((sum: number, ep: any) => sum + (ep.points || 0), 0)})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: eventPoints.length === 0 ? '16px' : '12px' }}>
        {eventPoints.length === 0 ? (
          <EmptyState
            icon={calendarOutline}
            title="Keine Event-Punkte"
            message="Noch keine Event-Punkte erhalten"
            iconColor="var(--app-color-events)"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {eventPoints.map((eventPoint: any, index: number) => {
              const isEventTypeDisabled = (eventPoint.point_type === 'gottesdienst' && currentKonfi?.gottesdienst_enabled === false)
                || (eventPoint.point_type === 'gemeinde' && currentKonfi?.gemeinde_enabled === false);
              return (
              <div
                key={eventPoint.id || index}
                className="app-list-item app-list-item--events"
                style={{
                  marginBottom: index < eventPoints.length - 1 ? '8px' : '0',
                  ...(isEventTypeDisabled ? { opacity: 0.4, filter: 'grayscale(100%)' } : {})
                }}
              >
                {/* Corner Badge: Punkt-Typ-Farbe */}
                <div className="app-corner-badges">
                  <div
                    className="app-corner-badge"
                    style={{
                      backgroundColor: eventPoint.point_type === 'gottesdienst' ? 'var(--app-color-gottesdienst)' : 'var(--app-color-gemeinde)'
                    }}
                  >
                    +{eventPoint.points}P
                  </div>
                </div>
                <div className="app-list-item__row">
                  <div className="app-list-item__main">
                    <div className="app-icon-circle app-icon-circle--events">
                      <IonIcon icon={podium} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title app-list-item__title--badge-space">
                        {eventPoint.event_name || 'Event'}
                        {isEventTypeDisabled && (
                          <span style={{ fontSize: '0.7rem', color: '#999', fontWeight: '400', marginLeft: '6px' }}>(deaktiviert)</span>
                        )}
                      </div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">
                          <IonIcon icon={calendar} className="app-icon-color--events" />
                          {eventPoint.awarded_date &&
                            new Date(eventPoint.awarded_date).toLocaleDateString('de-DE', {
                              day: '2-digit',
                              month: '2-digit'
                            })}
                        </span>
                        <span className="app-list-item__meta-item">{eventPoint.admin_name || 'Admin'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        )}
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- TeamerEventsSection ----

interface TeamerEventsSectionProps {
  teamerEvents: Array<{
    id: number;
    name: string;
    event_date: string;
    location: string;
    teamer_only: boolean;
    teamer_needed: boolean;
    booking_status: string;
    booking_date: string;
  }>;
  formatDate: (dateString: string) => string;
}

export const TeamerEventsSection = React.memo<TeamerEventsSectionProps>(({
  teamerEvents,
  formatDate
}) => (
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: '32px' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={calendar} />
      </div>
      <IonLabel>Events ({teamerEvents.length})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {teamerEvents.slice(0, 10).map((event, index) => {
            return (
              <IonItem
                key={event.id}
                className="app-item-transparent"
                detail={false}
                lines="none"
                style={{ marginBottom: index < Math.min(teamerEvents.length, 10) - 1 ? '8px' : '0' }}
              >
                <div
                  className="app-list-item app-list-item--events"
                >
                  <div className="app-corner-badges">
                    <div
                      className="app-corner-badge"
                      style={{
                        backgroundColor: event.booking_status === 'confirmed' ? '#059669'
                          : event.booking_status === 'absent' ? 'var(--app-color-events)'
                          : 'var(--app-color-badges)'
                      }}
                    >
                      {event.booking_status === 'confirmed' ? 'Anwesend'
                        : event.booking_status === 'absent' ? 'Abwesend'
                        : 'Ausstehend'}
                    </div>
                  </div>
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--events">
                        <IonIcon icon={calendar} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title app-list-item__title--badge-space">
                          {event.name}
                        </div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={calendarOutline} className="app-icon-color--events" />
                            {formatDate(event.event_date)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </IonItem>
            );
          })}
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- ActivitiesSection ----

interface ActivitiesSectionProps {
  activities: Activity[];
  currentKonfi: Konfi | null;
  isTeamer: boolean;
  formatDate: (dateString: string) => string;
  handleDeleteActivity: (activity: Activity) => void;
  handlePhotoClick: (activity: Activity) => void;
  presentActivityModal: (opts?: any) => void;
  presentingElement: HTMLElement | null;
}

export const ActivitiesSection = React.memo<ActivitiesSectionProps>(({
  activities,
  currentKonfi,
  isTeamer,
  formatDate,
  handleDeleteActivity,
  handlePhotoClick,
  presentActivityModal,
  presentingElement
}) => (
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: '32px' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--activities">
        <IonIcon icon={flash} />
      </div>
      <IonLabel>Aktivitäten {!isTeamer && `(${activities.filter((a) => !a.isPending).reduce((sum, a) => sum + (a.points || 0), 0)})`} {isTeamer && `(${activities.filter((a) => !a.isPending).length})`}</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: activities.length === 0 ? '16px' : '12px' }}>
        {activities.length === 0 ? (
          <EmptyState
            icon={flashOutline}
            title="Keine Aktivitäten"
            message="Noch keine Aktivitäten vorhanden"
            iconColor="var(--app-color-activities)"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activities.slice(0, 10).map((activity, index) => {
              const isActivityTypeDisabled = !activity.isPending
                && ((activity.type === 'gottesdienst' && currentKonfi?.gottesdienst_enabled === false)
                || (activity.type === 'gemeinde' && currentKonfi?.gemeinde_enabled === false));
              // Einheitliche Typ-Farbe fuer BEIDE vorderen Elemente (Eselsohr-Badge
              // UND Icon-Kreis/Border): Gottesdienst=blau, Gemeinde=gruen, Teamer=pink.
              // Pending = Warning-Orange.
              const typeColor = activity.isPending
                ? 'var(--app-color-warning)'
                : isTeamer
                ? 'var(--app-color-teamer)'
                : activity.type === 'gottesdienst'
                ? 'var(--app-color-gottesdienst)'
                : 'var(--app-color-gemeinde)';
              const activityColor = typeColor;
              const badgeColor = typeColor;
              return (
              <IonItemSliding key={activity.id} style={{ marginBottom: index < Math.min(activities.length, 10) - 1 ? '8px' : '0' }}>
                <IonItem
                  className="app-item-transparent"
                  button={activity.hasPhoto}
                  onClick={() => handlePhotoClick(activity)}
                  detail={false}
                  lines="none"
                >
                  <div
                    className={`app-list-item ${activity.isPending ? 'app-list-item--warning' : ''}`}
                    style={{
                      borderLeftColor: activityColor,
                      opacity: activity.isPending ? 0.8 : isActivityTypeDisabled ? 0.4 : 1,
                      ...(isActivityTypeDisabled ? { filter: 'grayscale(100%)' } : {})
                    }}
                  >
                    {/* Corner Badge für Punkte - bei Teamer ausblenden */}
                    {!isTeamer && (
                      <div className="app-corner-badges">
                        <div
                          className="app-corner-badge"
                          style={{ backgroundColor: badgeColor }}
                        >
                          {activity.isPending ? '?' : '+'}{activity.points}P
                        </div>
                      </div>
                    )}
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div
                          className="app-icon-circle"
                          style={{ backgroundColor: activityColor }}
                        >
                          <IonIcon icon={activity.isPending ? time : activity.type === 'gottesdienst' ? school : flash} />
                        </div>
                        <div className="app-list-item__content">
                          <div
                            className="app-list-item__title app-list-item__title--badge-space"
                            style={{
                              color: activity.isPending ? 'var(--app-color-badges)' : undefined,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                          >
                            {activity.name}
                            {isActivityTypeDisabled && (
                              <span style={{ fontSize: '0.7rem', color: '#999', fontWeight: '400' }}>(deaktiviert)</span>
                            )}
                            {activity.hasPhoto && (
                              <IonIcon icon={image} className="app-icon-color--category" style={{ fontSize: '0.8rem', opacity: 0.7 }} />
                            )}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={calendar} className="app-icon-color--events" />
                              {formatDate(activity.completed_date || activity.date)}
                            </span>
                            <span className="app-list-item__meta-item">{activity.admin}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>
                {!activity.isPending && (
                  <IonItemOptions className="app-swipe-actions" side="end">
                    <IonItemOption
                      className="app-swipe-action"
                      onClick={() => handleDeleteActivity(activity)}
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
          </div>
        )}
        <div className="app-event-detail__add-button-wrapper">
          <IonButton
            expand="block"
            fill="outline"
            onClick={() =>
              presentActivityModal({
                presentingElement: presentingElement || undefined
              })
            }
          >
            <IonIcon icon={add} slot="start" />
            Aktivität hinzufügen
          </IonButton>
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- CertificatesSection ----

interface CertificatesSectionProps {
  certificates: Array<{
    id: number;
    certificate_type_id: number;
    name: string;
    icon: string;
    issued_date: string;
    expiry_date: string | null;
    status: string;
  }>;
  isOnline: boolean;
  formatDate: (dateString: string) => string;
  handleAssignCertificate: () => void;
  handleDeleteCertificate: (cert: { id: number; name: string }) => void;
}

export const CertificatesSection = React.memo<CertificatesSectionProps>(({
  certificates,
  isOnline,
  formatDate,
  handleAssignCertificate,
  handleDeleteCertificate
}) => (
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: '32px' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--teamer">
        <IonIcon icon={documentOutline} />
      </div>
      <IonLabel>Zertifikate</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: certificates.length === 0 ? '16px' : '12px' }}>
        {certificates.length === 0 ? (
          <EmptyState
            icon={documentOutline}
            title="Keine Zertifikate"
            message="Noch keine Zertifikate zugewiesen"
            iconColor="var(--app-color-teamer)"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {certificates.map((cert, index) => (
              <IonItemSliding key={cert.id} style={{ marginBottom: index < certificates.length - 1 ? '8px' : '0' }}>
                <IonItem
                  className="app-item-transparent"
                  detail={false}
                  lines="none"
                >
                  <div
                    className="app-list-item"
                    style={{
                      borderLeftColor: '#db2777'
                    }}
                  >
                    {cert.status === 'expired' && (
                      <div className="app-corner-badges">
                        <div className="app-corner-badge" style={{ backgroundColor: '#ef4444' }}>
                          Abgelaufen
                        </div>
                      </div>
                    )}
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div
                          className="app-icon-circle"
                          style={{
                            backgroundColor: '#db2777'
                          }}
                        >
                          <IonIcon icon={ribbon} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title app-list-item__title--badge-space">
                            {cert.name}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={calendar} className="app-icon-color--events" />
                              {formatDate(cert.issued_date)}
                            </span>
                            {cert.expiry_date && (
                              <span className="app-list-item__meta-item">
                                Ablauf: {formatDate(cert.expiry_date)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>
                <IonItemOptions className="app-swipe-actions" side="end">
                  <IonItemOption
                    className="app-swipe-action"
                    onClick={() => handleDeleteCertificate(cert)}
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={trash} />
                    </div>
                  </IonItemOption>
                </IonItemOptions>
              </IonItemSliding>
            ))}
          </div>
        )}
        <IonButton
          expand="block"
          fill="outline"
          disabled={!isOnline}
          onClick={handleAssignCertificate}
          style={{ marginTop: '16px' }}
        >
          <IonIcon icon={add} slot="start" />
          {!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</> : 'Zertifikat zuweisen'}
        </IonButton>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- TeamerSinceSection ----

interface TeamerSinceSectionProps {
  currentKonfi: Konfi | null;
  konfiId: number;
  api: any;
  setCurrentKonfi: (fn: (prev: Konfi | null) => Konfi | null) => void;
  setError: (msg: string) => void;
}

export const TeamerSinceSection = React.memo<TeamerSinceSectionProps>(({
  currentKonfi,
  konfiId,
  api: apiInstance,
  setCurrentKonfi,
  setError
}) => (
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: '32px' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--teamer">
        <IonIcon icon={calendarOutline} />
      </div>
      <IonLabel>Teamer:in seit</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <IonDatetimeButton datetime="teamer-since-date" />
        </div>
      </IonCardContent>
    </IonCard>

    <IonModal keepContentsMounted={true}>
      <IonDatetime
        id="teamer-since-date"
        presentation="date"
        firstDayOfWeek={1}
        locale="de-DE"
        value={currentKonfi?.teamer_since ? new Date(currentKonfi.teamer_since).toISOString().split('T')[0] : undefined}
        onIonChange={async (e) => {
          const value = e.detail.value;
          if (typeof value !== 'string') return;
          const newDate = value.split('T')[0];
          try {
            await apiInstance.put(`/admin/konfis/${konfiId}/teamer-since`, { teamer_since: newDate });
            setCurrentKonfi(prev => prev ? { ...prev, teamer_since: newDate } : prev);
          } catch {
            setError('Fehler beim Aktualisieren');
          }
        }}
      />
    </IonModal>
  </IonList>
));

// ---- KonfiHistorySection ----

interface KonfiHistorySectionProps {
  konfiHistory: {
    history: Array<{ id: number; title: string; points: number; category: string; date: string; source_type: string }>;
    totals: { gottesdienst: number; gemeinde: number; total: number };
  };
  formatDate: (dateString: string) => string;
}

export const KonfiHistorySection = React.memo<KonfiHistorySectionProps>(({
  konfiHistory,
  formatDate
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const visibleCount = expanded ? konfiHistory.history.length : 3;
  return (
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: '32px' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--purple">
        <IonIcon icon={timeOutline} />
      </div>
      <IonLabel>Konfi-Historie ({konfiHistory.totals.total} Punkte)</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: '12px' }}>
        {/* Punkte-Uebersicht */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {konfiHistory.totals.gottesdienst > 0 && (
            <div style={{
              flex: 1,
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: '10px',
              padding: '10px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#3b82f6' }}>{konfiHistory.totals.gottesdienst}</div>
              <div style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: '600' }}>GOTTESDIENST</div>
            </div>
          )}
          {konfiHistory.totals.gemeinde > 0 && (
            <div style={{
              flex: 1,
              background: 'rgba(5, 150, 105, 0.1)',
              borderRadius: '10px',
              padding: '10px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: '700', color: '#059669' }}>{konfiHistory.totals.gemeinde}</div>
              <div style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: '600' }}>GEMEINDE</div>
            </div>
          )}
          <div style={{
            flex: 1,
            background: 'rgba(91, 33, 182, 0.1)',
            borderRadius: '10px',
            padding: '10px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--app-color-konfis)' }}>{konfiHistory.totals.total}</div>
            <div style={{ fontSize: '0.65rem', color: '#6b7280', fontWeight: '600' }}>GESAMT</div>
          </div>
        </div>

        {/* Verlauf */}
        {konfiHistory.history.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {konfiHistory.history.slice(0, visibleCount).map((entry) => {
              const categoryColor = entry.category === 'gottesdienst' ? '#3b82f6' : '#059669';
              const entryIcon = entry.source_type === 'bonus' ? giftOutline
                : entry.source_type === 'event' ? calendarOutline
                : entry.category === 'gottesdienst' ? starOutline : flashOutline;
              const typeBadgeColor = entry.source_type === 'bonus' ? 'var(--app-color-badges)'
                : entry.source_type === 'event' ? 'var(--app-color-events)'
                : null;
              const typeBadgeLabel = entry.source_type === 'bonus' ? 'Bonus'
                : entry.source_type === 'event' ? 'Event'
                : null;
              return (
                <div
                  key={`${entry.source_type}-${entry.id}`}
                  className="app-list-item"
                  style={{ borderLeftColor: categoryColor, position: 'relative', overflow: 'hidden' }}
                >
                  <div className="app-corner-badges">
                    {typeBadgeColor && typeBadgeLabel && (
                      <>
                        <div className="app-corner-badge" style={{ backgroundColor: typeBadgeColor }}>
                          {typeBadgeLabel}
                        </div>
                        <div className="app-corner-badges__separator" />
                      </>
                    )}
                    <div className="app-corner-badge" style={{ backgroundColor: categoryColor }}>
                      +{entry.points}P
                    </div>
                  </div>
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle" style={{ backgroundColor: categoryColor }}>
                        <IonIcon icon={entryIcon} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title app-list-item__title--badge-space">{entry.title}</div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">{formatDate(entry.date)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {konfiHistory.history.length > 3 && (
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => setExpanded(!expanded)}
                style={{ marginTop: '16px' }}
              >
                <IonIcon icon={expanded ? chevronUp : chevronDown} slot="start" />
                {expanded
                  ? 'Weniger anzeigen'
                  : `${konfiHistory.history.length - 3} weitere anzeigen`}
              </IonButton>
            )}
          </div>
        ) : (
          <EmptyState
            icon={timeOutline}
            title="Keine Konfi-Punkte"
            message="Keine Konfi-Punkte vorhanden"
            iconColor="var(--app-color-purple)"
          />
        )}
      </IonCardContent>
    </IonCard>
  </IonList>
  );
});

// ---- PromoteSection ----

interface PromoteSectionProps {
  isOnline: boolean;
  handlePromoteToTeamer: () => void;
}

export const PromoteSection = React.memo<PromoteSectionProps>(({
  isOnline,
  handlePromoteToTeamer
}) => (
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: '32px' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--purple">
        <IonIcon icon={ribbon} />
      </div>
      <IonLabel>Rolle ändern</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: '12px' }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--ion-color-medium)', textAlign: 'center', marginBottom: '12px' }}>
          Beim Befördern bleiben Konfi-Punkte und Badges als Historie erhalten. Event-Buchungen und offene Anträge werden gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
        </p>
        <div className="app-event-detail__add-button-wrapper">
          <IonButton
            expand="block"
            style={{ '--background': 'var(--app-color-konfis)', '--background-hover': '#4c1d95' }}
            disabled={!isOnline}
            onClick={handlePromoteToTeamer}
          >
            <IonIcon icon={ribbon} slot="start" />
            {!isOnline ? <><IonIcon icon={cloudOfflineOutline} style={{ marginRight: 4 }} /> Du bist offline</> : 'Zur Teamer:in befördern'}
          </IonButton>
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));
