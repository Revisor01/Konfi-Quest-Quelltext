import React from 'react';

const SpiritFooter: React.FC = () => {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 'var(--app-abstand-gross) var(--app-abstand-basis)',
        color: 'var(--ion-color-medium)',
        fontSize: 'var(--app-text-hinweis)',
        lineHeight: 1.5
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--app-abstand-mini)',
          flexWrap: 'wrap',
          justifyContent: 'center'
        }}
      >
        <span>Made with</span>
        <img
          src="/assets/branding/bird.png"
          alt="Friedenstaube"
          style={{ width: '14px', height: '14px', verticalAlign: 'middle' }}
        />
        <span>in Hennstedt</span>
      </div>
      <div style={{ marginTop: 'var(--app-abstand-mini)', fontStyle: 'italic', opacity: 0.8 }}>
        Friede. Schalom. Salam.
      </div>
    </div>
  );
};

export default SpiritFooter;
