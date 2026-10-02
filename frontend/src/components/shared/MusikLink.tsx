// Darstellung eines eingereichten Musik-Links (Challenge-Beitraege).
//
// Cover werden bewusst NICHT geladen — beim Betrachten der Beitraege soll kein
// Musikdienst kontaktiert werden.
import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_EXTERN_OEFFNEN, ICON_MUSIK } from './icons';
import { linkTeile } from '../../utils/linkDisplay';
import { linkOeffnen } from '../../services/systemDialoge';

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
      // Geoeffnet wird ueber linkOeffnen, damit der Abstecher in die
      // Musik-App die App-Sperre nicht ausloest (href bleibt fuer Vorlesen
      // und langes Druecken).
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); linkOeffnen(url); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--app-abstand-schmal)',
        marginTop: 'var(--app-abstand-eng)',
        padding: 'var(--app-abstand-schmal) var(--app-abstand-mittel)',
        borderRadius: 'var(--app-radius-knopf)',
        background: 'var(--app-surface-subtle, rgba(127,127,127,0.08))',
        textDecoration: 'none',
        maxWidth: '100%'
      }}
    >
      <IonIcon
        icon={hatMetadaten ? ICON_MUSIK : ICON_EXTERN_OEFFNEN}
        style={{ flexShrink: 0, fontSize: 'var(--app-text-titel)', color: farbe }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-text-primary, inherit)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}
        >
          {titel}
        </div>
        {interpret && (
          <div
            style={{
              fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}
          >
            {interpret}
          </div>
        )}
        {album && (
          <div
            style={{
              fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}
          >
            {album}
          </div>
        )}
        {dienst && (
          <div style={{ fontSize: 'var(--app-text-klein)', color: farbe, fontWeight: 'var(--app-schrift-halbfett)', marginTop: 'var(--app-abstand-winzig)' }}>
            {dienst}
          </div>
        )}
      </div>
      <IonIcon icon={ICON_EXTERN_OEFFNEN} style={{ flexShrink: 0, color: farbe, fontSize: 'var(--app-text-standard)' }} />
    </a>
  );
};

export default MusikLink;
