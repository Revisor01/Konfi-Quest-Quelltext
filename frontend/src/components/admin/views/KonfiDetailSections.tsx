import React from 'react';
import { IonCard, IonCardContent, IonLabel, IonList, IonListHeader, IonItem, IonItemSliding, IonItemOptions, IonItemOption, IonIcon, IonButton, IonDatetimeButton, IonDatetime, IonModal } from '@ionic/react';
import {
  ICON_ABSAGE,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_AKTION,
  ICON_AKTION_GEFUELLT,
  ICON_AUFKLAPPEN_GEFUELLT,
  ICON_BILD_GEFUELLT,
  ICON_BONUS,
  ICON_BONUS_GEFUELLT,
  ICON_BUCH_GEFUELLT,
  ICON_DATEI,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_GOTTESDIENST,
  ICON_GOTTESDIENST_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_OFFLINE,
  ICON_PERSON,
  ICON_PODIUM,
  ICON_POKAL_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_TEXTDOKUMENT_GEFUELLT,
  ICON_UHRZEIT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_WARNHINWEIS_GEFUELLT,
  ICON_WEITER_GEFUELLT,
  ICON_ZUKLAPPEN,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import ActivityRings from './ActivityRings';
import { EmptyState } from '../../shared';
import { getIconFromString } from '../../../utils/badgeIcons';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import type { UseIonModalResult } from '@ionic/react';
import type { AxiosInstance } from 'axios';
import type { BonusEintrag, EventPunkteEintrag } from '../../../types/user';

/**
 * Die "present"-Funktion aus useIonModal — erste Haelfte des Rueckgabepaars.
 * So bleibt der Typ an Ionic gebunden, statt ihn als (opts?: any) zu raten.
 */
type HookOverlayPresenter = UseIonModalResult[0];

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
  // `admin` traegt bei offenen Antraegen den Statustext, den die Ansicht
  // selbst setzt (KonfiDetailView.tsx). Fuer verbuchte Aktivitaeten liefert
  // das Backend den Namen als `admin_name`
  // (konfi-management.js:543 aliast u.display_name as admin_name).
  admin?: string;
  admin_name?: string;
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
}

export const KonfiHeaderCard = React.memo<KonfiHeaderCardProps>(({
  currentKonfi,
  isTeamer,
  getTotalPoints,
  getGottesdienstPoints,
  getGemeindePoints,
  certificates,
  teamerEvents
}) => (
  <div
    style={{
      background: isTeamer
        ? 'var(--app-gradient-teamer)'
        : 'var(--app-gradient-konfi)',
      borderRadius: 'var(--app-radius-modal)',
      padding: 'var(--app-abstand-weit)',
      margin: 'var(--app-abstand-basis)',
      boxShadow: isTeamer
        ? '0 20px 40px rgba(var(--app-color-teamer-rgb), 0.3)'
        : '0 20px 40px rgba(var(--app-color-konfis-rgb), 0.3)',
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
          fontSize: 'var(--app-anzeige-riesig)',
          fontWeight: 'var(--app-schrift-extrafett)',
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
        marginTop: 'var(--app-abstand-extraweit)',
        marginBottom: 'var(--app-abstand-mini)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--app-abstand-eng)'
        }}
      >
        <IonIcon
          icon={ICON_PERSON}
          style={{ fontSize: 'var(--app-text-untertitel)', color: 'rgba(255, 255, 255, 0.8)' }}
        />
        <h1
          style={{
            margin: '0',
            fontSize: 'var(--app-text-titel-gross)',
            fontWeight: 'var(--app-schrift-fett)',
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
        marginBottom: isTeamer ? 'var(--app-abstand-mini)' : 'var(--app-abstand-basis)',
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: 'var(--app-text-sekundaer)'
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
          marginBottom: 'var(--app-abstand-basis)',
          color: 'rgba(255, 255, 255, 0.6)',
          fontSize: 'var(--app-text-hinweis)'
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
          marginTop: 'var(--app-abstand-basis)'
        }}
      >
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--app-radius-karte)',
            padding: 'var(--app-abstand-eng) var(--app-abstand-basis)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--app-abstand-eng)'
          }}
        >
          <IonIcon icon={ICON_POKAL_GEFUELLT} className="app-icon-color--badges" style={{ fontSize: 'var(--app-text-untertitel)' }} />
          <span style={{ color: 'white', fontWeight: 'var(--app-schrift-halbfett)' }}>{currentKonfi?.badgeCount || 0} Badges</span>
        </div>
      </div>
    )}
  </div>
));

// ---- BonusSection ----

interface BonusSectionProps {
  bonusEntries: BonusEintrag[];
  currentKonfi: Konfi | null;
  getBonusPoints: () => number;
  formatDate: (dateString: string) => string;
  handleDeleteBonus: (bonus: BonusEintrag) => void;
  presentBonusModal: HookOverlayPresenter;
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
        <IonIcon icon={ICON_BONUS_GEFUELLT} />
      </div>
      <IonLabel>Bonus ({getBonusPoints()})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: bonusEntries.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
        {bonusEntries.length === 0 ? (
          <EmptyState
            icon={ICON_BONUS}
            title="Keine Bonuspunkte"
            message="Noch keine Bonuspunkte erhalten"
            iconColor="var(--app-color-bonus)"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {bonusEntries.map((bonus, index) => {
              const isTypeDisabled = (bonus.type === 'gottesdienst' && currentKonfi?.gottesdienst_enabled === false)
                || (bonus.type === 'gemeinde' && currentKonfi?.gemeinde_enabled === false);
              return (
              <IonItemSliding key={bonus.id || index} style={{ marginBottom: index < bonusEntries.length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
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
                          <IonIcon icon={ICON_BONUS_GEFUELLT} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title app-list-item__title--badge-space">
                            {bonus.description || 'Bonuspunkte'}
                            {isTypeDisabled && (
                              <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-muted)', fontWeight: 'var(--app-schrift-normal)', marginLeft: 'var(--app-abstand-kompakt)' }}>(deaktiviert)</span>
                            )}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-icon-color--events" />
                              {/* `bonus.date` gibt es in dieser Antwort nicht — sie
                                  liefert bp.* aus bonus_points. Der Rueckfall geht
                                  deshalb auf created_at. */}
                              {formatDate(bonus.completed_date || bonus.created_at || '')}
                            </span>
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_PERSON} className="app-icon-color--konfis" />
                              {bonus.admin_name || 'Admin'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </IonItem>
                <IonItemOptions className="app-swipe-actions" side="end">
                  <IonItemOption
                    className="app-swipe-action"
                    onClick={() => { closeOpenSlidingItems(); handleDeleteBonus(bonus); }}
                    aria-label="Bonuspunkte löschen"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
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
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} slot="start" />
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
        <IonIcon icon={ICON_BUCH_GEFUELLT} />
      </div>
      <IonLabel>Konfirmation</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent className="app-card-content">
        {/* Konfirmationstermin (read-only, aus is_konfirmation-Event) */}
        <div className="app-info-row">
          <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-info-row__icon app-icon-color--konfis" />
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
          <IonIcon icon={ICON_TEXTDOKUMENT_GEFUELLT} className="app-info-row__icon app-icon-color--konfis app-event-detail__icon--align-top" />
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
            <IonIcon icon={ICON_ZUSAGE_GEFUELLT} className="app-info-row__icon app-icon-color--konfis" />
            <div style={{ flex: 1 }}>
              <div className="app-info-row__label">Pflicht-Events</div>
              <div className="app-info-row__value" style={{ color: quoteColor, fontWeight: 'var(--app-schrift-fett)', fontVariantNumeric: 'tabular-nums' }}>
                {attendance!.attended} von {attendance!.total_mandatory} besucht · {pct}%
              </div>
            </div>
            {onOpenMatrix && (
              <IonIcon icon={ICON_WEITER_GEFUELLT} style={{ color: 'var(--app-border-strong)', fontSize: 'var(--app-text-gross)', flexShrink: 0 }} />
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
  eventPoints: EventPunkteEintrag[];
  currentKonfi: Konfi | null;
}

export const EventPointsSection = React.memo<EventPointsSectionProps>(({
  eventPoints,
  currentKonfi
}) => (
  <IonList className="app-section-inset" inset={true}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={ICON_PODIUM} />
      </div>
      <IonLabel>Events ({eventPoints.reduce((sum, ep) => sum + (ep.points || 0), 0)})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: eventPoints.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
        {eventPoints.length === 0 ? (
          <EmptyState
            icon={ICON_TERMIN}
            title="Keine Event-Punkte"
            message="Noch keine Event-Punkte erhalten"
            iconColor="var(--app-color-events)"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {eventPoints.map((eventPoint, index) => {
              const isEventTypeDisabled = (eventPoint.point_type === 'gottesdienst' && currentKonfi?.gottesdienst_enabled === false)
                || (eventPoint.point_type === 'gemeinde' && currentKonfi?.gemeinde_enabled === false);
              return (
              <div
                key={eventPoint.id || index}
                className="app-list-item app-list-item--events"
                style={{
                  marginBottom: index < eventPoints.length - 1 ? 'var(--app-abstand-eng)' : '0',
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
                      <IonIcon icon={ICON_PODIUM} />
                    </div>
                    <div className="app-list-item__content">
                      <div className="app-list-item__title app-list-item__title--badge-space">
                        {eventPoint.event_name || 'Event'}
                        {isEventTypeDisabled && (
                          <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-muted)', fontWeight: 'var(--app-schrift-normal)', marginLeft: 'var(--app-abstand-kompakt)' }}>(deaktiviert)</span>
                        )}
                      </div>
                      <div className="app-list-item__meta">
                        <span className="app-list-item__meta-item">
                          <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-icon-color--events" />
                          {eventPoint.awarded_date &&
                            new Date(eventPoint.awarded_date).toLocaleDateString('de-DE', {
                              day: '2-digit',
                              month: '2-digit'
                            })}
                        </span>
                        <span className="app-list-item__meta-item">
                          <IonIcon icon={ICON_PERSON} className="app-icon-color--konfis" />
                          {eventPoint.admin_name || 'Admin'}
                        </span>
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
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: 'var(--app-abstand-extraweit)' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--events">
        <IonIcon icon={ICON_TERMIN_GEFUELLT} />
      </div>
      <IonLabel>Events ({teamerEvents.length})</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: teamerEvents.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
        {teamerEvents.length === 0 ? (
          <EmptyState
            icon={ICON_TERMIN_GEFUELLT}
            title="Keine Events"
            message="Noch bei keinem Termin dabei gewesen"
            iconColor="var(--app-color-events)"
          />
        ) : (
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
                  {/* Status als Symbol-Badge statt Text (wie in Challenges und
                      Zertifikaten) — der Titel darunter bekommt dadurch die
                      volle Breite. Klartext haengt am title-Attribut. */}
                  <div className="app-corner-badges">
                    <div
                      className="app-corner-badge"
                      style={{
                        backgroundColor: event.booking_status === 'confirmed' ? 'var(--app-color-success-strong)'
                          : event.booking_status === 'absent' ? 'var(--app-color-events)'
                          : 'var(--app-color-badges)',
                        padding: 'var(--app-abstand-mini) var(--app-abstand-kompakt)'
                      }}
                      title={event.booking_status === 'confirmed' ? 'Anwesend'
                        : event.booking_status === 'absent' ? 'Abwesend'
                        : 'Ausstehend'}
                    >
                      <IonIcon
                        icon={event.booking_status === 'confirmed' ? ICON_ZUSAGE_GEFUELLT
                          : event.booking_status === 'absent' ? ICON_ABSAGE
                          : ICON_UHRZEIT_GEFUELLT}
                        style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }}
                      />
                    </div>
                  </div>
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--events">
                        <IonIcon icon={ICON_TERMIN_GEFUELLT} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title app-list-item__title--badge-space">
                          {event.name}
                        </div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ICON_TERMIN} className="app-icon-color--events" />
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
          {/* Die Liste ist auf 10 begrenzt, der Titel zaehlt aber alle —
              ohne diesen Hinweis sah "Events (23)" mit 10 Zeilen nach einem
              Fehler aus. */}
          {teamerEvents.length > 10 && (
            <div
              style={{
                textAlign: 'center', fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)',
                padding: 'var(--app-abstand-eng) 0 var(--app-abstand-winzig) 0'
              }}
            >
              und {teamerEvents.length - 10} weitere
            </div>
          )}
        </div>
        )}
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
  presentActivityModal: HookOverlayPresenter;
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
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: 'var(--app-abstand-extraweit)' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--activities">
        <IonIcon icon={ICON_AKTION_GEFUELLT} />
      </div>
      <IonLabel>Aktivitäten {!isTeamer && `(${activities.filter((a) => !a.isPending).reduce((sum, a) => sum + (a.points || 0), 0)})`} {isTeamer && `(${activities.filter((a) => !a.isPending).length})`}</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: activities.length === 0 ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
        {activities.length === 0 ? (
          <EmptyState
            icon={ICON_AKTION}
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
              // Einheitliche Typ-Farbe für BEIDE vorderen Elemente (Eselsohr-Badge
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
                          {/* Teamer-Aktivitaeten haben keinen Typ — ohne den
                              Zweig bekaemen sie immer das Gemeinde-Icon. */}
                          <IonIcon icon={activity.isPending ? ICON_UHRZEIT_GEFUELLT
                            : isTeamer ? ICON_ABZEICHEN_GEFUELLT
                            : activity.type === 'gottesdienst' ? ICON_GOTTESDIENST_GEFUELLT : ICON_AKTION_GEFUELLT} />
                        </div>
                        <div className="app-list-item__content">
                          <div
                            className="app-list-item__title app-list-item__title--badge-space"
                            style={{
                              color: activity.isPending ? 'var(--app-color-badges)' : undefined,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--app-abstand-kompakt)'
                            }}
                          >
                            {activity.name}
                            {isActivityTypeDisabled && (
                              <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-muted)', fontWeight: 'var(--app-schrift-normal)' }}>(deaktiviert)</span>
                            )}
                            {activity.hasPhoto && (
                              <IonIcon icon={ICON_BILD_GEFUELLT} className="app-icon-color--category" style={{ fontSize: 'var(--app-text-hinweis)', opacity: 0.7 }} />
                            )}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-icon-color--events" />
                              {formatDate(activity.completed_date || activity.date)}
                            </span>
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_PERSON} className="app-icon-color--konfis" />
                              {activity.admin || activity.admin_name || 'Admin'}
                            </span>
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
                      onClick={() => { closeOpenSlidingItems(); handleDeleteActivity(activity); }}
                      aria-label="Aktivität löschen"
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
            <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} slot="start" />
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
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: 'var(--app-abstand-extraweit)' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--teamer">
        <IonIcon icon={ICON_DATEI} />
      </div>
      <IonLabel>Zertifikate</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
        {(
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {certificates.map((cert, index) => (
              <IonItemSliding key={cert.id} style={{ marginBottom: index < certificates.length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
                <IonItem
                  className="app-item-transparent"
                  detail={false}
                  lines="none"
                >
                  <div
                    className="app-list-item"
                    style={{
                      // Teamer-Token statt eines abweichenden Pink — der
                      // Sektionskopf nutzt dieselbe Farbe.
                      borderLeftColor: 'var(--app-color-teamer)'
                    }}
                  >
                    {cert.status === 'expired' && (
                      <div className="app-corner-badges">
                        <div
                          className="app-corner-badge"
                          style={{ backgroundColor: 'var(--app-color-danger)', padding: 'var(--app-abstand-mini) var(--app-abstand-kompakt)' }}
                          title="Abgelaufen"
                        >
                          <IonIcon
                            icon={ICON_WARNHINWEIS_GEFUELLT}
                            style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="app-list-item__row">
                      <div className="app-list-item__main">
                        <div
                          className="app-icon-circle"
                          style={{
                            backgroundColor: 'var(--app-color-teamer)'
                          }}
                        >
                          {/* Das gepflegte Zertifikats-Icon zeigen — die
                              Teamer-Sicht (Dashboard) tut das laengst; hier
                              sahen bisher alle Zertifikate gleich aus. */}
                          <IonIcon icon={getIconFromString(cert.icon)} />
                        </div>
                        <div className="app-list-item__content">
                          <div className="app-list-item__title app-list-item__title--badge-space">
                            {cert.name}
                          </div>
                          <div className="app-list-item__meta">
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-icon-color--events" />
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
                    onClick={() => { closeOpenSlidingItems(); handleDeleteCertificate(cert); }}
                    aria-label="Zertifikat entfernen"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
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
          style={{ marginTop: 'var(--app-abstand-basis)' }}
        >
          <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} slot="start" />
          {!isOnline ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</> : 'Zertifikat zuweisen'}
        </IonButton>
      </IonCardContent>
    </IonCard>
  </IonList>
));

// ---- TeamerSinceSection ----

interface TeamerSinceSectionProps {
  currentKonfi: Konfi | null;
  konfiId: number;
  api: AxiosInstance;
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
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: 'var(--app-abstand-extraweit)' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--teamer">
        <IonIcon icon={ICON_TERMIN} />
      </div>
      <IonLabel>Teamer:in seit</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
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
  // NULL-SICHER: Fehlt history/totals (alter Cache, Teamer ohne Konfi-Zeit,
  // unvollstaendige Antwort), wirft ein Zugriff hier den ganzen Render — und
  // die ErrorBoundary leert dann Auth + Cache, was sich als "ploetzlich
  // ausgeloggt" zeigt (User-Hinweis 11.08.).
  const history = Array.isArray(konfiHistory?.history) ? konfiHistory.history : [];
  const totals = konfiHistory?.totals || { gottesdienst: 0, gemeinde: 0, total: 0 };
  const visibleCount = expanded ? history.length : 3;
  return (
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: 'var(--app-abstand-extraweit)' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--purple">
        <IonIcon icon={ICON_UHRZEIT} />
      </div>
      <IonLabel>Konfi-Historie ({totals.total} Punkte)</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
        {/* Punkte-Uebersicht */}
        <div style={{ display: 'flex', gap: 'var(--app-abstand-eng)', marginBottom: 'var(--app-abstand-mittel)' }}>
          {totals.gottesdienst > 0 && (
            <div style={{
              flex: 1,
              background: 'rgba(var(--app-color-gottesdienst-rgb), 0.1)',
              borderRadius: 'var(--app-radius-knopf)',
              padding: 'var(--app-abstand-schmal)',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: 'var(--app-text-untertitel)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-color-gottesdienst)' }}>{totals.gottesdienst}</div>
              <div style={{ fontSize: 'var(--app-text-mini)', color: 'var(--app-color-neutral)', fontWeight: 'var(--app-schrift-halbfett)' }}>GOTTESDIENST</div>
            </div>
          )}
          {totals.gemeinde > 0 && (
            <div style={{
              flex: 1,
              background: 'rgba(var(--app-color-success-strong-rgb), 0.1)',
              borderRadius: 'var(--app-radius-knopf)',
              padding: 'var(--app-abstand-schmal)',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: 'var(--app-text-untertitel)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-color-gemeinde)' }}>{totals.gemeinde}</div>
              <div style={{ fontSize: 'var(--app-text-mini)', color: 'var(--app-color-neutral)', fontWeight: 'var(--app-schrift-halbfett)' }}>GEMEINDE</div>
            </div>
          )}
          <div style={{
            flex: 1,
            background: 'rgba(var(--app-color-konfis-rgb), 0.1)',
            borderRadius: 'var(--app-radius-knopf)',
            padding: 'var(--app-abstand-schmal)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 'var(--app-text-untertitel)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-color-konfis)' }}>{totals.total}</div>
            <div style={{ fontSize: 'var(--app-text-mini)', color: 'var(--app-color-neutral)', fontWeight: 'var(--app-schrift-halbfett)' }}>GESAMT</div>
          </div>
        </div>

        {/* Verlauf */}
        {history.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-kompakt)' }}>
            {history.slice(0, visibleCount).map((entry) => {
              const categoryColor = entry.category === 'gottesdienst' ? 'var(--app-color-gottesdienst)' : 'var(--app-color-gemeinde)';
              const entryIcon = entry.source_type === 'bonus' ? ICON_BONUS
                : entry.source_type === 'event' ? ICON_TERMIN
                : entry.category === 'gottesdienst' ? ICON_GOTTESDIENST : ICON_AKTION;
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
                    {/* Herkunft als Symbol (Geschenk = Bonus, Kalender = Event);
                        Klartext am title. Die Punktzahl daneben bleibt Text —
                        sie ist die eigentliche Information und laesst sich
                        nicht als Symbol ausdruecken. Punkte sind hier korrekt:
                        die Sektion zeigt die KONFI-Zeit einer befoerderten
                        Teamer:in. */}
                    {typeBadgeColor && typeBadgeLabel && (
                      <>
                        <div
                          className="app-corner-badge"
                          style={{ backgroundColor: typeBadgeColor, padding: 'var(--app-abstand-mini) var(--app-abstand-kompakt)' }}
                          title={typeBadgeLabel}
                        >
                          <IonIcon
                            icon={entry.source_type === 'bonus' ? ICON_BONUS : ICON_TERMIN}
                            style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)', display: 'block' }}
                          />
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
            {history.length > 3 && (
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => setExpanded(!expanded)}
                style={{ marginTop: 'var(--app-abstand-basis)' }}
              >
                <IonIcon icon={expanded ? ICON_ZUKLAPPEN : ICON_AUFKLAPPEN_GEFUELLT} slot="start" />
                {expanded
                  ? 'Weniger anzeigen'
                  : `${history.length - 3} weitere anzeigen`}
              </IonButton>
            )}
          </div>
        ) : (
          <EmptyState
            icon={ICON_UHRZEIT}
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
  <IonList className="app-section-inset" inset={true} style={{ marginBottom: 'var(--app-abstand-extraweit)' }}>
    <IonListHeader>
      <div className="app-section-icon app-section-icon--purple">
        <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
      </div>
      <IonLabel>Rolle ändern</IonLabel>
    </IonListHeader>
    <IonCard className="app-card">
      <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
        <p style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--ion-color-medium)', textAlign: 'center', marginBottom: 'var(--app-abstand-mittel)' }}>
          Beim Befördern bleiben Konfi-Punkte und Badges als Historie erhalten. Event-Buchungen und offene Aktivitäten werden gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
        </p>
        <div className="app-event-detail__add-button-wrapper">
          <IonButton
            expand="block"
            style={{ '--background': 'var(--app-color-konfis)', '--background-hover': 'var(--app-color-konfis-dunkel)' }}
            disabled={!isOnline}
            onClick={handlePromoteToTeamer}
          >
            <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} slot="start" />
            {!isOnline ? <><IonIcon icon={ICON_OFFLINE} style={{ marginRight: 'var(--app-abstand-mini)'}} /> Du bist offline</> : 'Zur Teamer:in befördern'}
          </IonButton>
        </div>
      </IonCardContent>
    </IonCard>
  </IonList>
));
