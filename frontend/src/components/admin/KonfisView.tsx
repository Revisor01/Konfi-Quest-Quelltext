import React, { useState, useEffect } from 'react';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemGroup,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonItem,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonSegment,
  IonSegmentButton
} from '@ionic/react';
import {
  trash,
  swapVertical,
  star,
  calendar,
  people,
  peopleOutline,
  ribbonOutline,
  filterOutline,
  search,
  calendarOutline,
  ribbon,
  documentOutline
} from 'ionicons/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection, TrialBanner } from '../shared';
import api from '../../services/api';
import { useApp } from '../../contexts/AppContext';

interface Konfi {
  id: number;
  name: string;
  username?: string;
  jahrgang?: string;
  jahrgang_name?: string;
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
  badgeCount?: number;
  activities_count?: number;
}

interface Jahrgang {
  id: number;
  name: string;
}

interface Settings {
  target_gottesdienst?: string;
  target_gemeinde?: string;
}

interface KonfisViewProps {
  konfis: Konfi[];
  jahrgaenge: Jahrgang[];
  settings: Settings;
  onUpdate: () => void;
  onAddKonfiClick: () => void;
  onSelectKonfi: (konfi: Konfi) => void;
  onDeleteKonfi: (konfi: Konfi) => void;
  onDeleteTeamer: (teamer: any) => void;
  // Im iPad-Split-View aktuell rechts geoeffneter Konfi (fuer Highlighting).
  selectedKonfiId?: number | null;
}

const KonfisView: React.FC<KonfisViewProps> = ({
  konfis,
  jahrgaenge,
  settings,
  onUpdate,
  onAddKonfiClick,
  onSelectKonfi,
  onDeleteKonfi,
  onDeleteTeamer,
  selectedKonfiId
}) => {
  const { user } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJahrgang, setSelectedJahrgang] = useState('alle');
  const [sortBy, setSortBy] = useState('name');
  const [viewMode, setViewMode] = useState<'konfis' | 'teamer'>('konfis');
  const [teamers, setTeamers] = useState<any[]>([]);
  const [teamerLoading, setTeamerLoading] = useState(false);
  // Konfi-Limit der eigenen Organisation (NULL = unbegrenzt) für read-only "X von Y"-Anzeige
  const [konfiLimit, setKonfiLimit] = useState<number | null>(null);

  // Limit der eigenen Organisation laden (kein neuer Endpunkt: GET /organizations/:id liefert max_konfis)
  useEffect(() => {
    if (!user?.organization_id) return;
    let cancelled = false;
    const loadLimit = async () => {
      try {
        const response = await api.get(`/organizations/${user.organization_id}`);
        if (!cancelled) {
          const mk = response.data?.max_konfis;
          setKonfiLimit(mk !== null && mk !== undefined ? Number(mk) : null);
        }
      } catch (err) {
        if (!cancelled) setKonfiLimit(null);
      }
    };
    loadLimit();
    return () => { cancelled = true; };
  }, [user?.organization_id]);

  // Teamer laden wenn Teamer-Segment aktiv
  useEffect(() => {
    if (viewMode === 'teamer') {
      const loadTeamers = async () => {
        setTeamerLoading(true);
        try {
          const response = await api.get('/admin/konfis/teamer');
          setTeamers(response.data || []);
        } catch (err) {
          console.error('Error loading teamers:', err);
          setTeamers([]);
        } finally {
          setTeamerLoading(false);
        }
      };
      loadTeamers();
    }
  }, [viewMode]);

  const getTotalPoints = (konfi: Konfi) => {
    const godiEnabled = konfi.gottesdienst_enabled !== false;
    const gemEnabled = konfi.gemeinde_enabled !== false;
    const gottesdienst = godiEnabled ? (konfi.gottesdienst_points ?? konfi.points?.gottesdienst ?? 0) : 0;
    const gemeinde = gemEnabled ? (konfi.gemeinde_points ?? konfi.points?.gemeinde ?? 0) : 0;
    return gottesdienst + gemeinde;
  };

  const getGottesdienstPoints = (konfi: Konfi) => {
    return konfi.gottesdienst_points ?? konfi.points?.gottesdienst ?? 0;
  };

  const getGemeindePoints = (konfi: Konfi) => {
    return konfi.gemeinde_points ?? konfi.points?.gemeinde ?? 0;
  };

  const filteredAndSortedKonfis = (() => {
    let result = konfis;

    result = filterBySearchTerm(result, searchTerm, ['name', 'username']);

    if (selectedJahrgang !== 'alle') {
      result = result.filter(konfi =>
        konfi.jahrgang_name === selectedJahrgang || konfi.jahrgang === selectedJahrgang
      );
    }

    if (sortBy === 'points') {
      result = [...result].sort((a, b) => getTotalPoints(b) - getTotalPoints(a));
    } else {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
  })();

  const getInitials = (name: string) => {
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase();
    }
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  };

  // Pro-Konfi Targets aus Jahrgang-Config
  const getKonfiTargets = (konfi: Konfi) => {
    const godiEnabled = konfi.gottesdienst_enabled !== false;
    const gemEnabled = konfi.gemeinde_enabled !== false;
    const targetGodi = konfi.target_gottesdienst || 10;
    const targetGem = konfi.target_gemeinde || 10;
    const targetTotal = (godiEnabled ? targetGodi : 0) + (gemEnabled ? targetGem : 0);
    return { godiEnabled, gemEnabled, targetGodi, targetGem, targetTotal };
  };

  // Farbe: Lila für alle auf dem Weg, Grün für fertige
  const getStatusColor = (konfi: Konfi) => {
    const { targetTotal } = getKonfiTargets(konfi);
    const total = getTotalPoints(konfi);
    const percent = targetTotal > 0 ? (total / targetTotal) * 100 : 0;
    if (percent >= 100) return '#059669'; // Dunkelgruen - Ziel erreicht
    return 'var(--app-color-konfis)'; // Lila - Auf dem Weg (Sektionsfarbe)
  };

  return (
    <>
      <TrialBanner />

      <SectionHeader
        title={viewMode === 'teamer' ? 'Teamer:innen' : 'Konfis'}
        subtitle={viewMode === 'teamer' ? 'Teamer:innen verwalten' : 'Konfis verwalten'}
        icon={viewMode === 'teamer' ? ribbon : people}
        preset={viewMode === 'teamer' ? 'teamer' : 'konfis'}
        stats={viewMode === 'teamer' ? [
          { value: teamers.length, label: 'Team' },
          { value: teamers.reduce((sum, t) => sum + (t.cert_count || 0), 0), label: 'Zertifikate' },
          { value: teamers.reduce((sum, t) => sum + (t.badge_count || 0), 0), label: 'Badges' }
        ] : [
          { value: konfis.length, label: 'Konfis' },
          { value: konfis.reduce((sum, k) => sum + getTotalPoints(k), 0), label: 'Punkte' },
          { value: jahrgaenge.length, label: 'Jahrgänge' }
        ]}
      />

      {/* (Entfernt) Der "X Konfis"-Zwischentext zwischen Header-Stats und Switcher
          war redundant zum Header-Stat. Konfi-Limit ("X von Y") gehoert in die
          Org-Verwaltung, nicht zwischen Stats und Switcher. */}

      {/* Konfis / Teamer:innen Segment */}
      <IonSegment
        value={viewMode}
        onIonChange={(e) => setViewMode(e.detail.value as 'konfis' | 'teamer')}
        style={{ margin: '0 16px 8px', maxWidth: 'calc(100% - 32px)' }}
      >
        <IonSegmentButton value="konfis">
          <IonLabel>Konfis</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="teamer">
          <IonLabel>Teamer:innen</IonLabel>
        </IonSegmentButton>
      </IonSegment>

      {/* Suche & Filter */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className={`app-section-icon app-section-icon--${viewMode === 'teamer' ? 'teamer' : 'primary'}`}>
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
              placeholder={viewMode === 'teamer' ? 'Teamer:in suchen...' : 'Konfi suchen...'}
            />
          </IonItem>
          {/* Jahrgang Filter - nur für Konfis */}
          {viewMode === 'konfis' && (
            <IonItem>
              <IonIcon icon={calendarOutline} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
              <IonSelect
                value={selectedJahrgang}
                onIonChange={(e) => setSelectedJahrgang(e.detail.value)}
                interface="popover"
                placeholder="Jahrgang"
                style={{ width: '100%' }}
              >
                <IonSelectOption value="alle">Alle Jahrgänge</IonSelectOption>
                {jahrgaenge.map(jg => (
                  <IonSelectOption key={jg.id} value={jg.name}>{jg.name}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
          )}
          {/* Sortierung - nur für Konfis */}
          {viewMode === 'konfis' && (
            <IonItem>
              <IonIcon icon={swapVertical} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
              <IonSelect
                value={sortBy}
                onIonChange={(e) => setSortBy(e.detail.value)}
                interface="popover"
                placeholder="Sortierung"
                style={{ width: '100%' }}
              >
                <IonSelectOption value="name">Name (A-Z)</IonSelectOption>
                <IonSelectOption value="points">Punkte</IonSelectOption>
              </IonSelect>
            </IonItem>
          )}
        </IonItemGroup>
      </IonList>

      {/* Teamer-Liste */}
      {viewMode === 'teamer' ? (
        <ListSection
          icon={ribbon}
          title="Teamer:innen"
          count={filterBySearchTerm(teamers, searchTerm, ['name', 'display_name', 'username']).length}
          iconColorClass="teamer"
          isEmpty={filterBySearchTerm(teamers, searchTerm, ['name', 'display_name', 'username']).length === 0}
          emptyIcon={ribbon}
          emptyTitle="Keine Teamer:innen gefunden"
          emptyMessage={searchTerm ? 'Versuche andere Suchbegriffe' : 'Noch keine Teamer:innen vorhanden'}
          emptyIconColor="var(--app-color-teamer)"
        >
          {filterBySearchTerm(teamers, searchTerm, ['name', 'display_name', 'username']).map((teamer: any, index: number, arr: any[]) => (
            <IonItemSliding key={teamer.id} style={{ marginBottom: index < arr.length - 1 ? '8px' : '0' }}>
              <IonItem
                button
                onClick={() => onSelectKonfi(teamer)}
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
                  className="app-list-item app-list-item--teamer"
                  style={{
                    width: '100%',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div
                        className="app-icon-circle app-icon-circle--lg app-icon-circle--teamer"
                        style={{ color: 'white', fontWeight: '600' }}
                      >
                        {(teamer.display_name || teamer.name || '??').trim().split(/\s+/).length === 1
                          ? (teamer.display_name || teamer.name || '??').substring(0, 2).toUpperCase()
                          : ((teamer.display_name || teamer.name || '??').trim().split(/\s+/)[0][0] +
                             (teamer.display_name || teamer.name || '??').trim().split(/\s+/).slice(-1)[0][0]).toUpperCase()
                        }
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">
                          {teamer.display_name || teamer.name}
                        </div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ribbonOutline} style={{ color: 'var(--app-color-teamer)' }} />
                            {teamer.badge_count || 0} Badges
                          </span>
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={documentOutline} style={{ color: '#059669' }} />
                            {teamer.cert_count || 0} Zertifikate
                          </span>
                          {teamer.teamer_since && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={calendarOutline} style={{ color: '#6b7280' }} />
                              seit {new Date(teamer.teamer_since).getFullYear()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </IonItem>

              {/* Teamer:innen loeschen darf nur org_admin (Backend: requireOrgAdmin
                  auf DELETE /users/:id). Normalen Admins die Aktion gar nicht
                  erst anbieten -> kein 403-Wisch. */}
              {(user?.role_name === 'org_admin' || user?.is_super_admin === true) && (
                <IonItemOptions side="end" className="app-swipe-actions">
                  <IonItemOption
                    onClick={() => onDeleteTeamer(teamer)}
                    className="app-swipe-action"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={trash} />
                    </div>
                  </IonItemOption>
                </IonItemOptions>
              )}
            </IonItemSliding>
          ))}
        </ListSection>
      ) : (
      /* Konfis Liste */
      <ListSection
        icon={peopleOutline}
        title="Konfis"
        count={filteredAndSortedKonfis.length}
        iconColorClass="primary"
        isEmpty={filteredAndSortedKonfis.length === 0}
        emptyIcon={peopleOutline}
        emptyTitle="Keine Konfis gefunden"
        emptyMessage={searchTerm ? 'Versuche andere Suchbegriffe' : 'Noch keine Konfis angelegt'}
        emptyIconColor="#5b21b6"
      >
        {filteredAndSortedKonfis.map((konfi, index) => {
                  const statusColor = getStatusColor(konfi);
                  const totalPoints = getTotalPoints(konfi);
                  const godiPoints = getGottesdienstPoints(konfi);
                  const gemPoints = getGemeindePoints(konfi);
                  const { godiEnabled, gemEnabled, targetGodi, targetGem, targetTotal } = getKonfiTargets(konfi);
                  const percentTotal = targetTotal > 0 ? Math.round((totalPoints / targetTotal) * 100) : 0;
                  const percentGodi = targetGodi > 0 ? Math.round((godiPoints / targetGodi) * 100) : 0;
                  const percentGem = targetGem > 0 ? Math.round((gemPoints / targetGem) * 100) : 0;
                  const isComplete = percentTotal >= 100;

                  return (
                    <IonItemSliding key={konfi.id} style={{ marginBottom: index < filteredAndSortedKonfis.length - 1 ? '8px' : '0' }}>
                      <IonItem
                        button
                        onClick={() => onSelectKonfi(konfi)}
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
                          className={`app-list-item app-list-item--primary${selectedKonfiId === konfi.id ? ' app-list-item--selected' : ''}`}
                          style={{
                            width: '100%',
                            borderLeftColor: statusColor,
                            position: 'relative',
                            overflow: 'hidden'
                          }}
                        >

                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              {/* Avatar */}
                              <div
                                className="app-icon-circle app-icon-circle--lg"
                                style={{ backgroundColor: statusColor, color: 'white', fontWeight: '600' }}
                              >
                                {getInitials(konfi.name)}
                              </div>

                              {/* Content */}
                              <div className="app-list-item__content">
                                {/* Zeile 1: Name */}
                                <div className="app-list-item__title">
                                  {konfi.name}
                                </div>

                                {/* Zeile 2: Jahrgang + Badges */}
                                <div className="app-list-item__meta">
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={calendar} style={{ color: 'var(--app-color-jahrgang)' }} />
                                    {konfi.jahrgang_name || konfi.jahrgang || 'Kein Jahrgang'}
                                  </span>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={ribbonOutline} style={{ color: '#fbbf24' }} />
                                    {konfi.badgeCount || 0} Badges
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Punkte rechts */}
                            <div className="app-points-display">
                              <div className="app-points-display__value" style={{ color: statusColor }}>
                                {totalPoints}
                              </div>
                              <div className="app-points-display__target">
                                /{targetTotal}
                              </div>
                            </div>
                          </div>

                          {/* Progress Bars - nur aktive Typen */}
                          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {godiEnabled && gemEnabled ? (
                              <>
                                {/* Gottesdienst + Gemeinde nebeneinander */}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                      <span style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: '600' }}>Godi</span>
                                      <span style={{ fontSize: '0.65rem', color: '#999' }}>{godiPoints}/{targetGodi}</span>
                                    </div>
                                    <div className="app-progress-bar">
                                      <div className="app-progress-bar__track" style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)' }}>
                                        <div className="app-progress-bar__fill" style={{ width: `${Math.min(100, percentGodi)}%`, backgroundColor: '#3b82f6' }} />
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                      <span style={{ fontSize: '0.65rem', color: '#059669', fontWeight: '600' }}>Gemeinde</span>
                                      <span style={{ fontSize: '0.65rem', color: '#999' }}>{gemPoints}/{targetGem}</span>
                                    </div>
                                    <div className="app-progress-bar">
                                      <div className="app-progress-bar__track" style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)' }}>
                                        <div className="app-progress-bar__fill" style={{ width: `${Math.min(100, percentGem)}%`, backgroundColor: '#059669' }} />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                {/* Gesamt */}
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--app-color-konfis)', fontWeight: '700' }}>Gesamt</span>
                                    <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: '600' }}>
                                      {totalPoints}/{targetTotal}
                                      {percentTotal > 100 && <span style={{ color: '#059669', marginLeft: '4px' }}>({percentTotal}%)</span>}
                                    </span>
                                  </div>
                                  <div className="app-progress-bar app-progress-bar--thick">
                                    <div className="app-progress-bar__track" style={{ backgroundColor: 'rgba(91, 33, 182, 0.12)' }}>
                                      <div className="app-progress-bar__fill" style={{ width: `${Math.min(100, percentTotal)}%`, backgroundColor: 'var(--app-color-konfis)' }} />
                                    </div>
                                  </div>
                                </div>
                              </>
                            ) : (
                              /* Ein breiter Balken für den aktiven Typ */
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                  <span style={{ fontSize: '0.7rem', color: godiEnabled ? '#3b82f6' : '#059669', fontWeight: '700' }}>
                                    {godiEnabled ? 'Gottesdienst' : 'Gemeinde'}
                                  </span>
                                  <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: '600' }}>
                                    {godiEnabled ? godiPoints : gemPoints}/{godiEnabled ? targetGodi : targetGem}
                                  </span>
                                </div>
                                <div className="app-progress-bar app-progress-bar--thick">
                                  <div className="app-progress-bar__track" style={{ backgroundColor: godiEnabled ? 'rgba(59, 130, 246, 0.15)' : 'rgba(34, 197, 94, 0.15)' }}>
                                    <div className="app-progress-bar__fill" style={{
                                      width: `${Math.min(100, godiEnabled ? percentGodi : percentGem)}%`,
                                      backgroundColor: godiEnabled ? '#3b82f6' : '#059669'
                                    }} />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </IonItem>

                      <IonItemOptions side="end" className="app-swipe-actions">
                        <IonItemOption
                          onClick={() => onDeleteKonfi(konfi)}
                          className="app-swipe-action"
                        >
                          <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                            <IonIcon icon={trash} />
                          </div>
                        </IonItemOption>
                      </IonItemOptions>
                    </IonItemSliding>
                  );
                })}
      </ListSection>
      )}
    </>
  );
};

export default KonfisView;
