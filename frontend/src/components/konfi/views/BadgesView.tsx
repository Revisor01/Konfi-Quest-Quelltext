import React, { useState, useRef } from 'react';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemGroup,
  IonItem,
  IonInput,
  useIonPopover
} from '@ionic/react';
import { SectionHeader, EmptyState } from '../../shared';
import {
  trophy,
  trophyOutline,
  medal,
  ribbon,
  star,
  checkmarkCircle,
  diamond,
  shield,
  flame,
  flash,
  rocket,
  sparkles,
  thumbsUp,
  heart,
  people,
  personAdd,
  chatbubbles,
  gift,
  book,
  school,
  construct,
  brush,
  colorPalette,
  sunny,
  moon,
  leaf,
  rose,
  calendar,
  calendarOutline,
  today,
  time,
  timer,
  stopwatch,
  restaurant,
  fitness,
  bicycle,
  car,
  airplane,
  boat,
  camera,
  image,
  musicalNote,
  balloon,
  home,
  business,
  location,
  navigate,
  compass,
  pin,
  flag,
  informationCircle,
  helpCircle,
  alertCircle,
  hammer,
  lockClosed,
  layersOutline,
  gridOutline,
  prismOutline,
  cubeOutline,
  handLeft,
  checkmark,
  search,
  filterOutline,
  eyeOff
} from 'ionicons/icons';

// Badge Icon Mapping
const BADGE_ICONS: Record<string, { icon: string; name: string; category: string }> = {
  trophy: { icon: trophy, name: 'Pokal', category: 'Erfolg' },
  medal: { icon: medal, name: 'Medaille', category: 'Erfolg' },
  ribbon: { icon: ribbon, name: 'Band', category: 'Erfolg' },
  star: { icon: star, name: 'Stern', category: 'Erfolg' },
  checkmarkCircle: { icon: checkmarkCircle, name: 'Bestanden', category: 'Erfolg' },
  diamond: { icon: diamond, name: 'Diamant', category: 'Erfolg' },
  shield: { icon: shield, name: 'Schild', category: 'Erfolg' },
  flame: { icon: flame, name: 'Flamme', category: 'Engagement' },
  flash: { icon: flash, name: 'Blitz', category: 'Engagement' },
  rocket: { icon: rocket, name: 'Rakete', category: 'Engagement' },
  sparkles: { icon: sparkles, name: 'Funken', category: 'Engagement' },
  thumbsUp: { icon: thumbsUp, name: 'Daumen hoch', category: 'Engagement' },
  heart: { icon: heart, name: 'Herz', category: 'Gemeinschaft' },
  people: { icon: people, name: 'Gruppe', category: 'Gemeinschaft' },
  personAdd: { icon: personAdd, name: 'Neue Person', category: 'Gemeinschaft' },
  chatbubbles: { icon: chatbubbles, name: 'Chat', category: 'Gemeinschaft' },
  gift: { icon: gift, name: 'Geschenk', category: 'Gemeinschaft' },
  book: { icon: book, name: 'Buch', category: 'Lernen' },
  school: { icon: school, name: 'Schule', category: 'Lernen' },
  construct: { icon: construct, name: 'Werkzeug', category: 'Lernen' },
  brush: { icon: brush, name: 'Pinsel', category: 'Lernen' },
  colorPalette: { icon: colorPalette, name: 'Farbpalette', category: 'Lernen' },
  sunny: { icon: sunny, name: 'Sonne', category: 'Natur' },
  moon: { icon: moon, name: 'Mond', category: 'Natur' },
  leaf: { icon: leaf, name: 'Blatt', category: 'Natur' },
  rose: { icon: rose, name: 'Rose', category: 'Natur' },
  calendar: { icon: calendar, name: 'Kalender', category: 'Zeit' },
  today: { icon: today, name: 'Heute', category: 'Zeit' },
  time: { icon: time, name: 'Uhr', category: 'Zeit' },
  timer: { icon: timer, name: 'Timer', category: 'Zeit' },
  stopwatch: { icon: stopwatch, name: 'Stoppuhr', category: 'Zeit' },
  restaurant: { icon: restaurant, name: 'Restaurant', category: 'Aktivitäten' },
  fitness: { icon: fitness, name: 'Fitness', category: 'Aktivitäten' },
  bicycle: { icon: bicycle, name: 'Fahrrad', category: 'Aktivitäten' },
  car: { icon: car, name: 'Auto', category: 'Aktivitäten' },
  airplane: { icon: airplane, name: 'Flugzeug', category: 'Aktivitäten' },
  boat: { icon: boat, name: 'Boot', category: 'Aktivitäten' },
  camera: { icon: camera, name: 'Kamera', category: 'Aktivitäten' },
  image: { icon: image, name: 'Bild', category: 'Aktivitäten' },
  musicalNote: { icon: musicalNote, name: 'Musik', category: 'Aktivitäten' },
  balloon: { icon: balloon, name: 'Ballon', category: 'Aktivitäten' },
  home: { icon: home, name: 'Zuhause', category: 'Orte' },
  business: { icon: business, name: 'Gebäude', category: 'Orte' },
  location: { icon: location, name: 'Standort', category: 'Orte' },
  navigate: { icon: navigate, name: 'Navigation', category: 'Orte' },
  compass: { icon: compass, name: 'Kompass', category: 'Orte' },
  pin: { icon: pin, name: 'Pin', category: 'Orte' },
  flag: { icon: flag, name: 'Flagge', category: 'Orte' },
  informationCircle: { icon: informationCircle, name: 'Info', category: 'Sonstiges' },
  helpCircle: { icon: helpCircle, name: 'Hilfe', category: 'Sonstiges' },
  alertCircle: { icon: alertCircle, name: 'Warnung', category: 'Sonstiges' },
  hammer: { icon: hammer, name: 'Hammer', category: 'Sonstiges' }
};

// Helper function to get icon from string
const getIconFromString = (iconName: string): string => {
  return BADGE_ICONS[iconName]?.icon || trophy;
};

interface Badge {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_hidden: boolean;
  is_active: boolean;
  color?: string;
  is_earned: boolean;
  earned_at?: string;
  progress_points?: number;
  progress_percentage?: number;
}

// Zeitfenster-Hinweis fuer zeitbasierte Badges (time_based) und Serien (streak).
// Erklaert, ab wann / in welchem Zeitraum der Fortschritt zaehlt, damit der
// schwankende Fortschritt (Aktivitaeten fallen aus dem Fenster) verstaendlich ist.
const getTimeWindowHint = (badge: Badge): string | null => {
  const fmt = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  if (badge.criteria_type === 'time_based') {
    let days: number | null = null;
    try {
      const extra = typeof badge.criteria_extra === 'string'
        ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
      days = extra.days || (extra.weeks ? extra.weeks * 7 : null);
    } catch { /* ignore */ }
    if (!days) return null;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return `Zählt die letzten ${days} Tage (seit ${fmt(start)}). Ältere Aktivitäten fallen wieder heraus.`;
  }
  if (badge.criteria_type === 'streak') {
    return 'Zählt aufeinanderfolgende Wochen mit mindestens einer Aktivität. Eine Woche ohne Aktivität setzt die Serie zurück.';
  }
  return null;
};

// Popover Content Komponente für Badge-Details
const BadgePopoverContent: React.FC<{
  badgeRef: React.RefObject<{ badge: Badge | null; getBadgeColor: (badge: Badge) => string }>;
}> = ({ badgeRef }) => {
  const data = badgeRef.current;
  if (!data || !data.badge) return null;
  const badge = data.badge;
  const badgeColor = data.getBadgeColor(badge);
  const timeWindowHint = getTimeWindowHint(badge);

  return (
    <div style={{ padding: '12px', background: 'white', maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: badge.is_earned
            ? `linear-gradient(145deg, ${badgeColor} 0%, ${badgeColor}cc 100%)`
            : 'linear-gradient(145deg, #d0d0d0 0%, #b8b8b8 100%)',
          boxShadow: badge.is_earned
            ? `0 2px 8px ${badgeColor}40`
            : '0 1px 4px rgba(0,0,0,0.1)'
        }}>
          <IonIcon
            icon={getIconFromString(badge.icon)}
            style={{
              fontSize: '1.4rem',
              color: badge.is_earned ? 'white' : '#999'
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: '700', color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {badge.name}
          </h3>
          <p style={{
            margin: '0',
            fontSize: '0.8rem',
            color: '#666',
            lineHeight: '1.3'
          }}>
            {badge.description || 'Keine Beschreibung'}
          </p>
        </div>
      </div>
      <div style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {badge.is_earned ? (
          <>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: '#22c55e',
              color: 'white',
              padding: '3px 8px',
              borderRadius: '8px',
              fontSize: '0.7rem',
              fontWeight: '600'
            }}>
              <IonIcon icon={checkmarkCircle} style={{ fontSize: '0.75rem' }} />
              Erreicht
            </div>
            {badge.earned_at && (
              <span style={{ fontSize: '0.7rem', color: '#888' }}>
                {new Date(badge.earned_at).toLocaleDateString('de-DE', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </span>
            )}
          </>
        ) : badge.progress_percentage && badge.progress_percentage > 0 ? (
          <>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: '#667eea',
              color: 'white',
              padding: '3px 8px',
              borderRadius: '8px',
              fontSize: '0.7rem',
              fontWeight: '600'
            }}>
              {Math.round(badge.progress_percentage || 0)}% - In Arbeit
            </div>
            <span style={{ fontSize: '0.7rem', color: '#888' }}>
              {badge.progress_points || 0} / {badge.criteria_value}
            </span>
          </>
        ) : (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: '#8e8e93',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '8px',
            fontSize: '0.7rem',
            fontWeight: '600'
          }}>
            <IonIcon icon={lockClosed} style={{ fontSize: '0.7rem' }} />
            Noch nicht erreicht
          </div>
        )}
      </div>
      {timeWindowHint && (
        <div style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid #eee',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          fontSize: '0.72rem',
          color: '#888',
          lineHeight: '1.35'
        }}>
          <IonIcon icon={time} style={{ fontSize: '0.85rem', marginTop: '1px', flexShrink: 0 }} />
          <span>{timeWindowHint}</span>
        </div>
      )}
    </div>
  );
};

interface BadgesViewProps {
  badges: Badge[];
  badgeStats: {
    totalVisible: number;
    totalSecret: number;
  };
  selectedFilter: string;
  onFilterChange: (filter: string) => void;
}

const BadgesView: React.FC<BadgesViewProps> = ({
  badges,
  badgeStats,
  selectedFilter,
  onFilterChange
}) => {
  const badgePopoverRef = useRef<{ badge: Badge | null; getBadgeColor: (badge: Badge) => string }>({ badge: null, getBadgeColor: () => '#667eea' });
  const [searchText, setSearchText] = useState('');

  // Badges nach Kategorien gruppieren
  const getBadgeCategories = () => {
    let filtered = badges;
    switch (selectedFilter) {
      case 'nicht_erhalten':
        filtered = badges.filter(badge => !badge.is_earned);
        break;
      case 'in_arbeit':
        filtered = badges.filter(badge => !badge.is_earned && badge.progress_percentage && badge.progress_percentage > 0);
        break;
      default:
        filtered = badges;
    }

    // Suchtext-Filter
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      filtered = filtered.filter(badge =>
        badge.name.toLowerCase().includes(query) ||
        (badge.description && badge.description.toLowerCase().includes(query))
      );
    }

    const categories: { key: string; title: string; icon: string; color: string; badges: Badge[] }[] = [
      { key: 'total_points', title: 'Punkte-Sammler', icon: trophy, color: '#ffd700', badges: filtered.filter(b => b.criteria_type === 'total_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'gottesdienst_points', title: 'Gottesdienst-Held', icon: sunny, color: '#ff9500', badges: filtered.filter(b => b.criteria_type === 'gottesdienst_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'gemeinde_points', title: 'Gemeinde-Star', icon: people, color: '#059669', badges: filtered.filter(b => b.criteria_type === 'gemeinde_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'bonus_points', title: 'Bonus-Jäger', icon: gift, color: '#ff6b9d', badges: filtered.filter(b => b.criteria_type === 'bonus_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'both_categories', title: 'Allrounder', icon: layersOutline, color: '#5856d6', badges: filtered.filter(b => b.criteria_type === 'both_categories').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'activity_count', title: 'Aktiv dabei', icon: checkmarkCircle, color: '#3880ff', badges: filtered.filter(b => b.criteria_type === 'activity_count').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'unique_activities', title: 'Vielseitig', icon: gridOutline, color: '#10dc60', badges: filtered.filter(b => b.criteria_type === 'unique_activities').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'activity_combination', title: 'Kombinier-Profi', icon: prismOutline, color: '#7044ff', badges: filtered.filter(b => b.criteria_type === 'activity_combination').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'category_activities', title: 'Kategorie-Meister', icon: cubeOutline, color: '#0cd1e8', badges: filtered.filter(b => b.criteria_type === 'category_activities').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'specific_activity', title: 'Spezialist', icon: handLeft, color: '#ffce00', badges: filtered.filter(b => b.criteria_type === 'specific_activity').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'streak', title: 'Serien-Champion', icon: flame, color: '#eb445a', badges: filtered.filter(b => b.criteria_type === 'streak').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'time_based', title: 'Zeitreisender', icon: time, color: '#8e8e93', badges: filtered.filter(b => b.criteria_type === 'time_based').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'event_count', title: 'Event-Champion', icon: calendar, color: '#e63946', badges: filtered.filter(b => b.criteria_type === 'event_count').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'teamer_year', title: 'Erfahrung', icon: ribbon, color: '#5b21b6', badges: filtered.filter(b => b.criteria_type === 'teamer_year').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'collection', title: 'Sammler', icon: trophy, color: '#ffd700', badges: filtered.filter(b => b.criteria_type === 'collection').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'yearly', title: 'Jahres-Badges', icon: calendarOutline, color: '#8e8e93', badges: filtered.filter(b => b.criteria_type === 'yearly').sort((a, b) => a.criteria_value - b.criteria_value) }
    ];

    return categories.filter(cat => cat.badges.length > 0);
  };

  const badgeCategories = getBadgeCategories();
  const earnedSecretCount = badges.filter(b => b.is_earned && b.is_hidden).length;

  const getBadgeColor = (badge: Badge) => {
    if (badge.color) return badge.color;
    if (badge.criteria_type === 'total_points') {
      if (badge.criteria_value <= 5) return '#cd7f32';
      if (badge.criteria_value <= 15) return '#c0c0c0';
      return '#ffd700';
    }
    return '#667eea';
  };

  const [presentBadgePopover, dismissBadgePopover] = useIonPopover(BadgePopoverContent, {
    badgeRef: badgePopoverRef
  });

  const handleBadgeClick = (badge: Badge, e: React.MouseEvent) => {
    badgePopoverRef.current = { badge, getBadgeColor };
    presentBadgePopover({
      event: e.nativeEvent,
      side: 'bottom',
      alignment: 'center',
      cssClass: 'badge-detail-popover badge-popover-auto-width'
    });
  };

  return (
    <div>
      <SectionHeader
        title="Deine Badges"
        subtitle="Sammle alle Erfolge!"
        icon={trophy}
        preset="badges"
        stats={[
          { value: badges.filter(b => b.is_earned && !b.is_hidden).length, label: 'ERREICHT' },
          ...(badgeStats.totalSecret > 0 ? [{ value: earnedSecretCount, label: 'GEHEIM' }] : []),
          { value: (badgeStats.totalVisible + badgeStats.totalSecret) === 0 ? 0 : Math.round((badges.filter(b => b.is_earned).length / (badgeStats.totalVisible + badgeStats.totalSecret)) * 100), label: 'PROZENT' }
        ]}
      />

      {/* Suche & Filter — wie Events-Pattern: Section-Header, Suchleiste, dann Tab-Leiste */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--warning">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={search} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
            <IonInput
              value={searchText}
              onIonInput={(e) => setSearchText(e.detail.value || '')}
              placeholder="Badges durchsuchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      <div className="app-segment-wrapper">
        <IonSegment value={selectedFilter} onIonChange={(e) => onFilterChange(e.detail.value as string)}>
          <IonSegmentButton value="alle"><IonLabel>Alle</IonLabel></IonSegmentButton>
          <IonSegmentButton value="nicht_erhalten"><IonLabel>Offen</IonLabel></IonSegmentButton>
          <IonSegmentButton value="in_arbeit"><IonLabel>In Arbeit</IonLabel></IonSegmentButton>
        </IonSegment>
      </div>

      {/* Badges Grid */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--warning">
            <IonIcon icon={trophy} />
          </div>
          <IonLabel>Erreichte Badges ({badges.filter(b => b.is_earned).length})</IonLabel>
        </IonListHeader>
        {badgeCategories.length === 0 ? (
          <IonCard className="app-card">
            <IonCardContent>
              {selectedFilter === 'nicht_erhalten' ? (
                <EmptyState
                  icon={checkmarkCircle}
                  title="Alle Badges erreicht!"
                  message="Du hast alle sichtbaren Badges eingesammelt."
                  iconColor="#f59e0b"
                />
              ) : selectedFilter === 'in_arbeit' ? (
                <EmptyState
                  icon={trophyOutline}
                  title="Keine Badges in Arbeit"
                  message="Sammle Punkte, um den Fortschritt bei Badges zu starten!"
                  iconColor="#f59e0b"
                />
              ) : (
                <EmptyState
                  icon={trophyOutline}
                  title="Keine Badges gefunden"
                  message="Sammle Punkte für deine ersten Badges!"
                  iconColor="#f59e0b"
                />
              )}
            </IonCardContent>
          </IonCard>
        ) : (
          badgeCategories.map((category, index) => {
            const earnedCount = category.badges.filter(b => b.is_earned).length;
            const totalCount = category.badges.length;
            const progressPercent = Math.round((earnedCount / totalCount) * 100);
            const categorySecretCount = category.badges.filter(b => b.is_hidden).length;
            const categoryEarnedSecretCount = category.badges.filter(b => b.is_hidden && b.is_earned).length;
            const categoryHasUndiscoveredSecrets = categorySecretCount > categoryEarnedSecretCount;

            return (
              <IonCard key={category.key} className="app-card" style={{ marginTop: index > 0 ? '8px' : '0' }}>
                <IonCardContent style={{ padding: '12px' }}>
                  {/* Category Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '42px', height: '42px', borderRadius: '12px',
                        background: `linear-gradient(135deg, ${category.color} 0%, ${category.color}cc 100%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 4px 12px ${category.color}40`
                      }}>
                        <IonIcon icon={category.icon} style={{ fontSize: '1.3rem', color: 'white' }} />
                      </div>
                      <div>
                        <h3 style={{ margin: '0', fontSize: '1.1rem', fontWeight: '700', color: '#333' }}>{category.title}</h3>
                        <span style={{ fontSize: '0.85rem', color: '#888' }}>{earnedCount} von {totalCount}</span>
                      </div>
                    </div>

                    {/* Progress Circle */}
                    <div style={{ width: '48px', height: '48px', position: 'relative' }}>
                      <svg width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="24" cy="24" r="20" fill="none" stroke="#e8e8e8" strokeWidth="4" />
                        <circle cx="24" cy="24" r="20" fill="none" stroke={category.color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${progressPercent * 1.257} 125.7`} />
                      </svg>
                      <span style={{
                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        fontSize: progressPercent === 100 && categoryHasUndiscoveredSecrets ? '0.6rem' : '0.7rem',
                        fontWeight: '700', color: category.color
                      }}>
                        {progressPercent === 100 && categoryHasUndiscoveredSecrets ? '100%?' : `${progressPercent}%`}
                      </span>
                    </div>
                  </div>

                  {/* 3-Column Badge Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '12px'
                  }}>
                    {category.badges.map((badge) => {
                      const badgeColor = getBadgeColor(badge);
                      const isEarned = badge.is_earned;
                      const hasProgress = !isEarned && (badge.progress_percentage ?? 0) > 0;

                      return (
                        <div
                          key={badge.id}
                          onClick={(e) => handleBadgeClick(badge, e)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '12px 8px',
                            borderRadius: '16px',
                            background: isEarned ? `${badgeColor}10` : '#f5f5f5',
                            border: isEarned ? `2px solid ${badgeColor}40` : '2px solid transparent',
                            cursor: 'pointer',
                            transition: 'transform 0.2s',
                            position: 'relative',
                            minHeight: '110px',
                            justifyContent: 'flex-start',
                            minWidth: 0,
                            overflow: 'hidden'
                          }}
                        >
                          {/* Badge Icon */}
                          <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isEarned
                              ? `linear-gradient(145deg, ${badgeColor} 0%, ${badgeColor}cc 100%)`
                              : 'linear-gradient(145deg, #d0d0d0 0%, #b8b8b8 100%)',
                            boxShadow: isEarned ? `0 4px 12px ${badgeColor}40` : '0 2px 8px rgba(0,0,0,0.1)',
                            position: 'relative',
                            marginBottom: '8px'
                          }}>
                            {/* Progress Ring */}
                            {hasProgress && (
                              <svg style={{ position: 'absolute', top: '-4px', left: '-4px', width: '64px', height: '64px', transform: 'rotate(-90deg)' }}>
                                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="3" />
                                <circle cx="32" cy="32" r="28" fill="none" stroke="#667eea" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(badge.progress_percentage || 0) * 1.76} 176`} />
                              </svg>
                            )}

                            <IonIcon
                              icon={getIconFromString(badge.icon)}
                              style={{
                                fontSize: '1.8rem',
                                color: isEarned ? 'white' : '#999'
                              }}
                            />

                            {/* Earned Checkmark */}
                            {isEarned && (
                              <div style={{
                                position: 'absolute',
                                bottom: '-2px',
                                right: '-2px',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: '#22c55e',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white'
                              }}>
                                <IonIcon icon={checkmark} style={{ fontSize: '0.7rem', color: 'white' }} />
                              </div>
                            )}

                            {/* Lock for not earned */}
                            {!isEarned && !hasProgress && (
                              <div style={{
                                position: 'absolute',
                                bottom: '-2px',
                                right: '-2px',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: '#8e8e93',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white'
                              }}>
                                <IonIcon icon={lockClosed} style={{ fontSize: '0.6rem', color: 'white' }} />
                              </div>
                            )}
                          </div>

                          {/* Badge Name */}
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            color: isEarned ? '#333' : '#999',
                            textAlign: 'center',
                            lineHeight: '1.2',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: 'vertical'
                          }}>
                            {badge.name || ''}
                          </span>

                          {/* Progress percentage for in-progress badges */}
                          {hasProgress && (
                            <span style={{
                              fontSize: '0.65rem',
                              fontWeight: '700',
                              color: '#667eea',
                              marginTop: '2px'
                            }}>
                              {Math.round(badge.progress_percentage || 0)}%
                            </span>
                          )}

                          {/* Secret Badge Eselsohr */}
                          {badge.is_hidden && badge.is_earned && (
                            <div className="app-corner-badges">
                              <div
                                className="app-corner-badge"
                                style={{
                                  background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '4px 8px'
                                }}
                                title="Geheimes Badge"
                              >
                                <IonIcon icon={eyeOff} style={{ color: '#fff', fontSize: '0.85rem' }} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </IonCardContent>
              </IonCard>
            );
          })
        )}
      </IonList>

    </div>
  );
};

export default BadgesView;
