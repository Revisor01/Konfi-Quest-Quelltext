import React, { useEffect, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_SCHLIESSEN, ICON_UPGRADE } from './icons';
import {
  pruefeStoreUpdate,
  istHinweisWeggeklickt,
  merkeHinweisWeggeklickt,
  StoreUpdateInfo
} from '../../services/updateCheck';

/**
 * Hinweis "Neue Version im Store" fuer die drei Dashboards.
 * Selbsttragend wie TrialBanner: prueft selbst (services/updateCheck) und
 * rendert nichts, wenn es nichts zu sagen gibt — die Seiten setzen ihn
 * einfach neben den TrialBanner, ohne eigene Logik.
 *
 * BEWUSST NUR EIN HINWEIS, KEINE BLOCKADE: Tippen oeffnet die Store-Seite
 * der App (App Store bzw. Google Play), das X blendet den Hinweis dauerhaft
 * fuer DIESE Version aus. Erst die naechste Version bringt ihn wieder.
 * Offline oder bei Fehlern erscheint schlicht nichts (updateCheck.ts).
 */
// Standardabstand wie bei NeuerungenBanner: Ohne ihn
// klebte das Banner in der Leitungsansicht (KonfisView) an beiden Raendern
// und fuellte die volle Breite -- dort wurde es ohne style eingebunden,
// waehrend Konfi- und Teamer-Startseite je einen mitgaben. Ein Standardwert
// verhindert, dass eine weitere Rolle ihn wieder vergisst.
const StoreUpdateBanner: React.FC<{ style?: React.CSSProperties }> = ({
  style = { margin: 'var(--app-abstand-eng) var(--app-abstand-basis) 0' },
}) => {
  const [info, setInfo] = useState<StoreUpdateInfo | null>(null);

  useEffect(() => {
    let aktiv = true;
    pruefeStoreUpdate()
      .then(async (ergebnis) => {
        if (!ergebnis || !aktiv) return;
        if (await istHinweisWeggeklickt(ergebnis.version)) return;
        if (aktiv) setInfo(ergebnis);
      })
      .catch(() => { /* updateCheck wirft nie — doppelt haelt besser */ });
    return () => { aktiv = false; };
  }, []);

  if (!info) return null;

  const oeffneStore = () => window.open(info.url, '_blank');

  return (
    <div
      className="app-whatsnew app-whatsnew--store"
      role="button"
      tabIndex={0}
      style={style}
      aria-label={`Version ${info.version} ist verfügbar. Im Store ansehen`}
      onClick={oeffneStore}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          oeffneStore();
        }
      }}
    >
      <IonIcon
        icon={ICON_UPGRADE}
        className="app-whatsnew__icon"
        aria-hidden="true"
      />
      <div className="app-whatsnew__text">
        <span className="app-whatsnew__title">Version {info.version} ist da</span>
        <span className="app-whatsnew__sub">
          Hier tippen, um das Update im Store zu laden.
        </span>
      </div>
      <button
        type="button"
        className="app-whatsnew__close"
        aria-label="Hinweis ausblenden"
        onClick={(e) => {
          // Das X blendet nur aus — es darf NICHT gleichzeitig den Store oeffnen.
          e.stopPropagation();
          merkeHinweisWeggeklickt(info.version);
          setInfo(null);
        }}
      >
        <IonIcon icon={ICON_SCHLIESSEN} aria-hidden="true" />
      </button>
    </div>
  );
};

export default StoreUpdateBanner;
