import React, { forwardRef } from 'react';
import type { KonfiWrappedData, TeamerWrappedData } from '../../../types/wrapped';
import './ShareCard.css';

interface ShareCardProps {
  slideKey: string;
  data: KonfiWrappedData | TeamerWrappedData;
  wrappedType: 'konfi' | 'teamer';
  displayName: string;
  jahrgangName?: string;
  year: number;
}

const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(
  ({ slideKey, data, wrappedType, displayName, jahrgangName, year }, ref) => {
    const isTeamer = wrappedType === 'teamer';
    const konfi = !isTeamer ? (data as KonfiWrappedData) : null;
    const teamer = isTeamer ? (data as TeamerWrappedData) : null;

    const bgClass = `share-card share-card--${slideKey}${isTeamer ? ' share-card--teamer' : ''}`;

    const renderContent = () => {
      switch (slideKey) {
        case 'intro':
          return (
            <>
              <div style={{ fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
                Dein Konfi-Jahr {year}
              </div>
              <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
                {displayName}
              </div>
              {jahrgangName && (
                <div style={{ fontSize: 36, color: 'rgba(255,255,255,0.7)', marginTop: 24 }}>
                  {jahrgangName}
                </div>
              )}
            </>
          );

        case 'punkte':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Deine Punkte</div>
              <div className="share-big-number">{konfi.slides.punkte.total}</div>
              <div className="share-subtitle">Punkte gesammelt</div>
              <div style={{ display: 'flex', gap: 48, marginTop: 48 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#a78bfa' }}>{konfi.slides.punkte.gottesdienst}</div>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Gottesdienst</div>
                </div>
                <div style={{ width: 2, height: 80, background: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#a78bfa' }}>{konfi.slides.punkte.gemeinde}</div>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Gemeinde</div>
                </div>
              </div>
            </>
          );

        case 'events':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Events</div>
              <div className="share-big-number">{konfi.slides.events.total_attended}</div>
              <div className="share-subtitle">Events besucht</div>
              {konfi.slides.events.lieblings_event && (
                <div style={{ marginTop: 48, padding: '24px 36px', background: 'rgba(124,58,237,0.15)', borderRadius: 24, border: '1px solid rgba(124,58,237,0.3)' }}>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)' }}>Lieblings-Event</div>
                  <div style={{ fontSize: 36, fontWeight: 600, marginTop: 8 }}>{konfi.slides.events.lieblings_event.name}</div>
                </div>
              )}
            </>
          );

        case 'badges':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Badges</div>
              <div className="share-big-number">{konfi.slides.badges.total_earned}</div>
              <div className="share-subtitle">Badges verdient</div>
              {konfi.slides.badges.badges.length > 0 && (
                <div style={{ display: 'flex', gap: 24, marginTop: 48, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 600 }}>
                  {konfi.slides.badges.badges.slice(0, 6).map((b, i) => (
                    <div key={i} style={{ width: 80, height: 80, borderRadius: '50%', background: b.color || 'rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 28, fontWeight: 700 }}>{b.name.charAt(0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          );

        case 'aktivster-monat':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Aktivster Monat</div>
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>{konfi.slides.aktivster_monat.monat_name}</div>
              <div className="share-subtitle">{konfi.slides.aktivster_monat.aktivitaeten} Aktivitäten</div>
            </>
          );

        case 'chat':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Chat</div>
              <div className="share-big-number">{konfi.slides.chat.nachrichten_gesendet}</div>
              <div className="share-subtitle">Nachrichten gesendet</div>
            </>
          );

        case 'endspurt':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Endspurt</div>
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>
                {konfi.slides.endspurt.fehlende_punkte}
              </div>
              <div className="share-subtitle">Punkte bis zum Ziel</div>
              <div style={{ width: '80%', maxWidth: 600, marginTop: 48 }}>
                <div style={{ height: 20, background: 'rgba(255,255,255,0.15)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (konfi.slides.endspurt.aktuell_total / Math.max(1, konfi.slides.endspurt.ziel_total)) * 100)}%`,
                    background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
                    borderRadius: 10,
                  }} />
                </div>
              </div>
            </>
          );

        case 'abschluss':
          if (!konfi) return null;
          return (
            <>
              <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 48 }}>
                Dein Konfi-Jahr {year}
              </div>
              <div style={{ display: 'flex', gap: 48 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#a78bfa' }}>{konfi.slides.punkte.total}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Punkte</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#a78bfa' }}>{konfi.slides.events.total_attended}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Events</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#a78bfa' }}>{konfi.slides.badges.total_earned}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Badges</div>
                </div>
              </div>
            </>
          );

        // Teamer-Slides
        case 'teamer-intro':
          return (
            <>
              <div style={{ fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
                Dein Teamer-Jahr {year}
              </div>
              <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
                {displayName}
              </div>
            </>
          );

        case 'teamer-events':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Events geleitet</div>
              <div className="share-big-number">{teamer.slides.events_geleitet.total}</div>
              <div className="share-subtitle">Events geleitet</div>
              {teamer.slides.events_geleitet.meiste_teilnehmer_event && (
                <div style={{ marginTop: 48, padding: '24px 36px', background: 'rgba(225,29,72,0.15)', borderRadius: 24, border: '1px solid rgba(225,29,72,0.3)' }}>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)' }}>Größtes Event</div>
                  <div style={{ fontSize: 36, fontWeight: 600, marginTop: 8 }}>{teamer.slides.events_geleitet.meiste_teilnehmer_event.name}</div>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                    {teamer.slides.events_geleitet.meiste_teilnehmer_event.teilnehmer} Teilnehmer:innen
                  </div>
                </div>
              )}
            </>
          );

        case 'teamer-konfis':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Konfis betreut</div>
              <div className="share-big-number">{teamer.slides.konfis_betreut.total_konfis}</div>
              <div className="share-subtitle">Konfis betreut</div>
              {teamer.slides.konfis_betreut.jahrgaenge.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 32, justifyContent: 'center' }}>
                  {teamer.slides.konfis_betreut.jahrgaenge.map((j, i) => (
                    <div key={i} style={{ background: 'rgba(225,29,72,0.2)', border: '1px solid rgba(225,29,72,0.4)', borderRadius: 16, padding: '8px 20px', fontSize: 28 }}>
                      {j}
                    </div>
                  ))}
                </div>
              )}
            </>
          );

        case 'teamer-badges':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Badges</div>
              <div className="share-big-number">{teamer.slides.badges.total_earned}</div>
              <div className="share-subtitle">Badges verdient</div>
            </>
          );

        case 'teamer-zertifikate':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Zertifikate</div>
              <div className="share-big-number">{teamer.slides.zertifikate.total}</div>
              <div className="share-subtitle">Zertifikate erhalten</div>
            </>
          );

        case 'teamer-jahre':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Engagement</div>
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>
                {teamer.slides.engagement.jahre_aktiv}
              </div>
              <div className="share-subtitle">
                {teamer.slides.engagement.jahre_aktiv === 1 ? 'Jahr' : 'Jahre'} als Teamer:in
              </div>
            </>
          );

        case 'teamer-abschluss':
          if (!teamer) return null;
          return (
            <>
              <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 48 }}>
                Dein Teamer-Jahr {year}
              </div>
              <div style={{ display: 'flex', gap: 48 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#fb7185' }}>{teamer.slides.events_geleitet.total}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Events</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#fb7185' }}>{teamer.slides.konfis_betreut.total_konfis}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Konfis</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: '#fb7185' }}>{teamer.slides.badges.total_earned}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Badges</div>
                </div>
              </div>
            </>
          );

        default:
          return null;
      }
    };

    return (
      <div className="share-card-container" ref={ref}>
        <div className={bgClass}>
          {renderContent()}
          <div className="share-card-watermark">Konfi Quest</div>
        </div>
      </div>
    );
  }
);

ShareCard.displayName = 'ShareCard';

export default ShareCard;
