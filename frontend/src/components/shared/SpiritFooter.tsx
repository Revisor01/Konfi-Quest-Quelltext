import React from 'react';

const SpiritFooter: React.FC = () => {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '20px 16px',
        color: 'var(--ion-color-medium, #8e8e93)',
        fontSize: '0.8rem',
        lineHeight: 1.5
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
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
      <div style={{ marginTop: '3px', fontStyle: 'italic', opacity: 0.8 }}>
        Friede. Schalom. Salam.
      </div>
    </div>
  );
};

export default SpiritFooter;
