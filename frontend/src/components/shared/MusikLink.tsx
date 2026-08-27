// Darstellung eines eingereichten Musik-Links (Challenge-Beitraege).
//
// Cover werden bewusst NICHT geladen — beim Betrachten der Beitraege soll kein
// Musikdienst kontaktiert werden.
import React from 'react';
import { IonIcon } from '@ionic/react';
import { openOutline, musicalNotesOutline } from 'ionicons/icons';
import { linkTeile } from '../../utils/linkDisplay';

interface MusikLinkProps {
  submission: {
    link_url?: string | null;
    link_title?: string | null;
    link_author?: string | null;
    link_album?: string | null;
  };
  /** Akzentfarbe; Standard ist die Challenges-Farbe. */
  farbe?: string;
}

const MusikLink: React.FC<MusikLinkProps> = ({
  submission,
  farbe = 'var(--app-color-challenges)'
}) => {
  const url = submission.link_url;
  if (!url) return null;

  const { titel, interpret, album, dienst, hatMetadaten } = linkTeile(submission);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      // Der Tap gehoert dem Link — sonst faengt ein umgebendes IonItem ihn ab
      // und oeffnet statt der Seite das Aktions-Menue (Leitungsansicht).
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginTop: '8px',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'var(--app-surface-subtle, rgba(127,127,127,0.08))',
        textDecoration: 'none',
        maxWidth: '100%'
      }}
    >
      <IonIcon
        icon={hatMetadaten ? musicalNotesOutline : openOutline}
        style={{ flexShrink: 0, fontSize: '1.3rem', color: farbe }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '0.92rem', fontWeight: 700, color: 'var(--app-text-primary, inherit)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}
        >
          {titel}
        </div>
        {interpret && (
          <div
            style={{
              fontSize: '0.84rem', color: 'var(--app-text-secondary, #6b7280)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}
          >
            {interpret}
          </div>
        )}
        {album && (
          <div
            style={{
              fontSize: '0.78rem', color: 'var(--app-text-system, #8e8e93)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}
          >
            {album}
          </div>
        )}
        {dienst && (
          <div style={{ fontSize: '0.74rem', color: farbe, fontWeight: 600, marginTop: '2px' }}>
            {dienst}
          </div>
        )}
      </div>
      <IonIcon icon={openOutline} style={{ flexShrink: 0, color: farbe, fontSize: '1rem' }} />
    </a>
  );
};

export default MusikLink;
