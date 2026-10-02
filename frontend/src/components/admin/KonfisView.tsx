import React, { useState, useEffect, useCallback } from 'react';
import { IonIcon, IonLabel, IonList, IonListHeader, IonItemGroup, IonItemSliding, IonItemOptions, IonItemOption, IonItem, IonInput, IonSelect, IonSelectOption, IonSegment, IonSegmentButton ,
  IonSpinner} from '@ionic/react';
import {
  ICON_ABZEICHEN,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_DATEI,
  ICON_FILTER,
  ICON_GRUPPE,
  ICON_GRUPPE_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_SORTIEREN,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
} from '../shared/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection, TrialBanner, StoreUpdateBanner } from '../shared';
import WartungsHinweis from '../shared/WartungsHinweis';
import WeitereEintraege from '../shared/WeitereEintraege';
import { useSchrittweiseListe } from '../../hooks/useSchrittweiseListe';
import api from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { closeOpenSlidingItems } from '../../utils/slidingItems';
import type { TeamerListenEintrag } from '../../types/user';

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

interface KonfisViewProps {
  konfis: Konfi[];
  jahrgaenge: Jahrgang[];
  onSelectKonfi: (konfi: Konfi) => void;
  onDeleteKonfi: (konfi: Konfi) => void;
  onDeleteTeamer: (teamer: TeamerListenEintrag) => void | Promise<void>;
  // Im iPad-Split-View aktuell rechts geoeffneter Konfi (für Highlighting).
  selectedKonfiId?: number | null;
  onViewModeChange?: (mode: 'konfis' | 'teamer') => void;
  // Startsegment. Nur der Erstwert — die Umschaltung bleibt interner State.
  // (JSDOM reicht ionChange nicht an den React-Handler durch; ueber diesen
  // Erstwert ist das Teamer-Segment auch im Test erreichbar.)
  initialViewMode?: 'konfis' | 'teamer';
  ohneJahrgang?: boolean;

}

const KonfisView: React.FC<KonfisViewProps> = ({
  konfis,
  jahrgaenge,
  onSelectKonfi,
  onDeleteKonfi,
  onDeleteTeamer,
  selectedKonfiId,
  ohneJahrgang = false,
  onViewModeChange,
  initialViewMode = 'konfis'
}) => {
  const { user, setError } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJahrgang, setSelectedJahrgang] = useState('alle');
  const [sortBy, setSortBy] = useState('name');
  const [viewMode, setViewMode] = useState<'konfis' | 'teamer'>(initialViewMode);
  const [teamers, setTeamers] = useState<TeamerListenEintrag[]>([]);
  const [teamerLoading, setTeamerLoading] = useState(false);

  // Teamer laden (wiederverwendbar: Segment-Wechsel + Reload nach Löschen)
  const loadTeamers = useCallback(async () => {
    setTeamerLoading(true);
    try {
      const response = await api.get('/admin/konfis/teamer');
      setTeamers(response.data || []);
    } catch (err) {
      // Fehler NICHT als Leerzustand ausgeben — eine leere Liste sieht aus,
      // als gaebe es keine Teamer:innen.
      console.error('Error loading teamers:', err);
      setTeamers([]);
      setError('Das Team konnte nicht geladen werden');
    } finally {
      setTeamerLoading(false);
    }
  }, []);

  // Teamer laden wenn Teamer-Segment aktiv
  useEffect(() => {
    if (viewMode === 'teamer') {
      loadTeamers();
    }
  }, [viewMode, loadTeamers]);

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
      result = [...result].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    return result;
  })();

  // Schrittweise rendern: 150 Konfis kosteten gedrosselt
  // 3,1 s bis zur letzten Zeile, jetzt 1,7 s (Zahlen im Hook).
  // Suche, Jahrgang und Sortierung laufen weiter ueber alle; ein neuer
  // Suchbegriff beginnt wieder oben (hooks/useSchrittweiseListe.ts).
  const { sichtbar: sichtbareKonfis, weitere: weitereKonfis, mehrZeigen: mehrKonfis } =
    useSchrittweiseListe(filteredAndSortedKonfis, `${searchTerm}|${selectedJahrgang}|${sortBy}`);

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
    if (percent >= 100) return 'var(--app-color-success-strong)'; // Dunkelgruen - Ziel erreicht
    return 'var(--app-color-konfis)'; // Lila - Auf dem Weg (Sektionsfarbe)
  };

  return (
    <>
      <TrialBanner />

      {/* Dezenter Hinweis, wenn im Store eine neuere Version liegt.
          Prueft selbst und rendert sonst nichts (StoreUpdateBanner). */}
      <StoreUpdateBanner />

      {/* Wartungshinweis des Betriebs: steht, solange der Server ihn
          meldet; liest nur den Stand und rendert sonst nichts. */}
      <WartungsHinweis />

      <SectionHeader
        title={viewMode === 'teamer' ? 'Team' : 'Konfis'}
        subtitle={viewMode === 'teamer' ? 'Team verwalten' : 'Konfis verwalten'}
        icon={viewMode === 'teamer' ? ICON_ABZEICHEN_GEFUELLT : ICON_GRUPPE_GEFUELLT}
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
        onIonChange={(e) => {
          const mode = e.detail.value as 'konfis' | 'teamer';
          setViewMode(mode);
          onViewModeChange?.(mode);
        }}
        style={{ margin: '0 var(--app-abstand-basis) var(--app-abstand-eng)', maxWidth: 'calc(100% - 32px)' }}
      >
        <IonSegmentButton value="konfis">
          <IonLabel>Konfis</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="teamer">
          <IonLabel>Team</IonLabel>
        </IonSegmentButton>
      </IonSegment>

      {/* Suche & Filter */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className={`app-section-icon app-section-icon--${viewMode === 'teamer' ? 'teamer' : 'primary'}`}>
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          {/* Suchfeld */}
          <IonItem>
            <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
            <IonInput aria-label={viewMode === 'teamer' ? 'Im Team suchen' : 'Konfi suchen'}
              value={searchTerm}
              onIonInput={(e) => setSearchTerm(e.detail.value!)}
              placeholder={viewMode === 'teamer' ? 'Im Team suchen...' : 'Konfi suchen...'}
            />
          </IonItem>
          {/* Jahrgang Filter - nur für Konfis */}
          {viewMode === 'konfis' && (
            <IonItem>
              <IonIcon icon={ICON_TERMIN} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
              <IonSelect aria-label="Jahrgang"
                value={selectedJahrgang}
                onIonChange={(e) => setSelectedJahrgang(e.detail.value)}
                interface="popover"
                interfaceOptions={{ arrow: false }}
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
              <IonIcon icon={ICON_SORTIEREN} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
              <IonSelect aria-label="Sortierung"
                value={sortBy}
                onIonChange={(e) => setSortBy(e.detail.value)}
                interface="popover"
                interfaceOptions={{ arrow: false }}
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

      {viewMode === 'teamer' && teamerLoading && teamers.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-extraweit)' }}>
          <IonSpinner name="crescent" />
        </div>
      ) : viewMode === 'teamer' ? (
        <ListSection
          icon={ICON_ABZEICHEN_GEFUELLT}
          title="Team"
          count={filterBySearchTerm(teamers, searchTerm, ['name', 'display_name', 'username']).length}
          iconColorClass="teamer"
          isEmpty={filterBySearchTerm(teamers, searchTerm, ['name', 'display_name', 'username']).length === 0}
          emptyIcon={ICON_ABZEICHEN_GEFUELLT}
          emptyTitle="Niemand im Team gefunden"
          emptyMessage={searchTerm ? 'Versuche andere Suchbegriffe' : 'Noch niemand im Team'}
          emptyIconColor="var(--app-color-teamer)"
        >
          {filterBySearchTerm(teamers, searchTerm, ['name', 'display_name', 'username']).map((teamer, index, arr) => (
            <IonItemSliding key={teamer.id} style={{ marginBottom: index < arr.length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
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
                        style={{ color: 'white', fontWeight: 'var(--app-schrift-halbfett)' }}
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
                            <IonIcon icon={ICON_ABZEICHEN} style={{ color: 'var(--app-text-teamer)' }} />
                            {teamer.badge_count || 0} Badges
                          </span>
                          <span className="app-list-item__meta-item">
                            <IonIcon icon={ICON_DATEI} style={{ color: 'var(--app-color-success-strong)' }} />
                            {teamer.cert_count || 0} Zertifikate
                          </span>
                          {teamer.teamer_since && (
                            <span className="app-list-item__meta-item">
                              <IonIcon icon={ICON_TERMIN} style={{ color: 'var(--app-color-neutral)' }} />
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
                    onClick={async () => { closeOpenSlidingItems(); await onDeleteTeamer(teamer); await loadTeamers(); }}
                    aria-label="Teamer:in löschen"
                    className="app-swipe-action"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
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
        icon={ICON_GRUPPE}
        title="Konfis"
        count={filteredAndSortedKonfis.length}
        iconColorClass="primary"
        isEmpty={filteredAndSortedKonfis.length === 0}
        emptyIcon={ICON_GRUPPE}
        emptyTitle={ohneJahrgang && !searchTerm ? 'Kein Jahrgang zugewiesen' : 'Keine Konfis gefunden'}
        emptyMessage={
          searchTerm
            ? 'Versuche andere Suchbegriffe'
            : ohneJahrgang
              ? 'Dir ist noch kein Jahrgang zugewiesen. Die Gemeindeleitung kann das in den Einstellungen ändern.'
              : 'Noch keine Konfis angelegt'
        }
        emptyIconColor="var(--app-color-konfis)"
      >
        {sichtbareKonfis.map((konfi, index) => {
                  const statusColor = getStatusColor(konfi);
                  const totalPoints = getTotalPoints(konfi);
                  const godiPoints = getGottesdienstPoints(konfi);
                  const gemPoints = getGemeindePoints(konfi);
                  const { godiEnabled, gemEnabled, targetGodi, targetGem, targetTotal } = getKonfiTargets(konfi);
                  const percentTotal = targetTotal > 0 ? Math.round((totalPoints / targetTotal) * 100) : 0;
                  const percentGodi = targetGodi > 0 ? Math.round((godiPoints / targetGodi) * 100) : 0;
                  const percentGem = targetGem > 0 ? Math.round((gemPoints / targetGem) * 100) : 0;

                  return (
                    <IonItemSliding key={konfi.id} style={{ marginBottom: index < sichtbareKonfis.length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
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
                                style={{ backgroundColor: statusColor, color: 'white', fontWeight: 'var(--app-schrift-halbfett)' }}
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
                                    <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ color: 'var(--app-text-jahrgang)' }} />
                                    {konfi.jahrgang_name || konfi.jahrgang || 'Kein Jahrgang'}
                                  </span>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={ICON_ABZEICHEN} style={{ color: 'var(--app-wrapped-gold)' }} />
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
                          <div style={{ marginTop: 'var(--app-abstand-mittel)', display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                            {godiEnabled && gemEnabled ? (
                              <>
                                {/* Gottesdienst + Gemeinde nebeneinander */}
                                <div style={{ display: 'flex', gap: 'var(--app-abstand-eng)' }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--app-abstand-winzig)' }}>
                                      <span style={{ fontSize: 'var(--app-text-mini)', color: 'var(--app-text-gottesdienst)', fontWeight: 'var(--app-schrift-halbfett)' }}>Godi</span>
                                      <span style={{ fontSize: 'var(--app-text-mini)', color: 'var(--app-text-muted)' }}>{godiPoints}/{targetGodi}</span>
                                    </div>
                                    <div className="app-progress-bar">
                                      <div className="app-progress-bar__track" style={{ backgroundColor: 'rgba(var(--app-color-gottesdienst-rgb), 0.15)' }}>
                                        <div className="app-progress-bar__fill" style={{ width: `${Math.min(100, percentGodi)}%`, backgroundColor: 'var(--app-color-gottesdienst)' }} />
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--app-abstand-winzig)' }}>
                                      <span style={{ fontSize: 'var(--app-text-mini)', color: 'var(--app-text-gemeinde)', fontWeight: 'var(--app-schrift-halbfett)' }}>Gemeinde</span>
                                      <span style={{ fontSize: 'var(--app-text-mini)', color: 'var(--app-text-muted)' }}>{gemPoints}/{targetGem}</span>
                                    </div>
                                    <div className="app-progress-bar">
                                      <div className="app-progress-bar__track" style={{ backgroundColor: 'rgba(var(--app-color-success-rgb), 0.15)' }}>
                                        <div className="app-progress-bar__fill" style={{ width: `${Math.min(100, percentGem)}%`, backgroundColor: 'var(--app-color-gemeinde)' }} />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                {/* Gesamt */}
                                <div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--app-abstand-winzig)' }}>
                                    <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-konfis)', fontWeight: 'var(--app-schrift-fett)' }}>Gesamt</span>
                                    <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-secondary)', fontWeight: 'var(--app-schrift-halbfett)' }}>
                                      {totalPoints}/{targetTotal}
                                      {percentTotal > 100 && <span style={{ color: 'var(--app-color-success-strong)', marginLeft: 'var(--app-abstand-mini)' }}>({percentTotal}%)</span>}
                                    </span>
                                  </div>
                                  <div className="app-progress-bar app-progress-bar--thick">
                                    <div className="app-progress-bar__track" style={{ backgroundColor: 'rgba(var(--app-color-konfis-rgb), 0.12)' }}>
                                      <div className="app-progress-bar__fill" style={{ width: `${Math.min(100, percentTotal)}%`, backgroundColor: 'var(--app-color-konfis)' }} />
                                    </div>
                                  </div>
                                </div>
                              </>
                            ) : (
                              /* Ein breiter Balken für den aktiven Typ */
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--app-abstand-winzig)' }}>
                                  <span style={{ fontSize: 'var(--app-text-meta)', color: godiEnabled ? 'var(--app-text-gottesdienst)' : 'var(--app-text-gemeinde)', fontWeight: 'var(--app-schrift-fett)' }}>
                                    {godiEnabled ? 'Gottesdienst' : 'Gemeinde'}
                                  </span>
                                  <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-secondary)', fontWeight: 'var(--app-schrift-halbfett)' }}>
                                    {godiEnabled ? godiPoints : gemPoints}/{godiEnabled ? targetGodi : targetGem}
                                  </span>
                                </div>
                                <div className="app-progress-bar app-progress-bar--thick">
                                  <div className="app-progress-bar__track" style={{ backgroundColor: godiEnabled ? 'rgba(var(--app-color-gottesdienst-rgb), 0.15)' : 'rgba(var(--app-color-success-rgb), 0.15)' }}>
                                    <div className="app-progress-bar__fill" style={{
                                      width: `${Math.min(100, godiEnabled ? percentGodi : percentGem)}%`,
                                      backgroundColor: godiEnabled ? 'var(--app-color-gottesdienst)' : 'var(--app-color-gemeinde)'
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
                          onClick={() => { closeOpenSlidingItems(); onDeleteKonfi(konfi); }}
                          aria-label="Konfi löschen"
                          className="app-swipe-action"
                        >
                          <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                            <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                          </div>
                        </IonItemOption>
                      </IonItemOptions>
                    </IonItemSliding>
                  );
                })}
      </ListSection>
      )}
      {viewMode === 'konfis' && (
        <WeitereEintraege weitere={weitereKonfis} onMehr={mehrKonfis} bezeichnung="Konfis" />
      )}
    </>
  );
};

export default KonfisView;
