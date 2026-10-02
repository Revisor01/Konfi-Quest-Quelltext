import React, { useCallback, useEffect, useState } from 'react';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  useIonModal
} from '@ionic/react';
import { ICON_BENACHRICHTIGUNG, ICON_SCHLIESSEN } from './icons';
import { useApp } from '../../contexts/AppContext';
import api from '../../services/api';
import { fehlerText } from '../../utils/fehler';
import { tastaturKlick } from '../../utils/tastatur';

/**
 * Auswahl, welche Push-Mitteilungen aufs Handy kommen -- fuer alle drei
 * Rollen (Leitung, Teamer:innen, Konfis).
 *
 * WELCHE GRUPPEN, ENTSCHEIDET DER SERVER je Rolle: Konfis bekommen "Anfragen
 * und Freigaben" gar nicht angeboten, weil bei ihnen dort nie etwas ankommt.
 * Die App zeigt, was GET /notifications/preferences liefert -- keine zweite
 * Liste hier, die auseinanderlaufen koennte.
 *
 * DAS POSTFACH BLEIBT VOLL: Wer eine Gruppe abwaehlt, bekommt die Mitteilung
 * weiter unter der Glocke. Abgewaehlt wird nur der Weg aufs Handy.
 *
 * BEWUSST EINE GEMEINSAME KOMPONENTE (wie AppSperreSchalter): Die App hat drei
 * getrennte Komponentenbaeume, und die uebliche Falle ist, eine Aenderung nur
 * in einem davon zu machen. Die drei Profil-Seiten binden den Eintrag ein und
 * geben ueber `variante` nur ihre Farbe mit.
 */

export type PushAuswahlVariante = 'users' | 'teamer' | 'purple';

export interface PushGruppe {
  id: string;
  name: string;
  beschreibung: string;
  aktiv: boolean;
}

export interface PushEinstellungen {
  push_enabled: boolean;
  stumm: string[];
  gruppen: PushGruppe[];
}

const STIL: Record<PushAuswahlVariante, { sectionIcon: string; toggle: string; infoBox: string }> = {
  users: { sectionIcon: 'app-section-icon--users', toggle: 'app-toggle--users', infoBox: 'app-info-box--blue' },
  teamer: { sectionIcon: 'app-section-icon--teamer', toggle: 'app-toggle--teamer', infoBox: 'app-info-box--teamer' },
  purple: { sectionIcon: 'app-section-icon--purple', toggle: 'app-toggle--konfi', infoBox: 'app-info-box--purple' }
};

export const ladePushEinstellungen = async (): Promise<PushEinstellungen> => {
  const res = await api.get('/notifications/preferences');
  const d = res.data || {};
  return {
    push_enabled: d.push_enabled !== false,
    stumm: Array.isArray(d.stumm) ? d.stumm : [],
    gruppen: Array.isArray(d.gruppen) ? d.gruppen : []
  };
};

/**
 * Kurzfassung fuer die Meta-Zeile des Eintrags -- eine Zeile, die sagt, was
 * gerade gilt, ohne das Modal zu oeffnen.
 */
export const pushZusammenfassung = (e: PushEinstellungen | null, berechtigung: string): string => {
  if (berechtigung !== 'granted') return 'Noch nicht erlaubt – antippen zum Erlauben';
  if (!e) return 'Welche Mitteilungen aufs Handy kommen';
  if (!e.push_enabled) return 'Aus – nur im Postfach';
  const an = e.gruppen.filter((g) => g.aktiv).length;
  if (e.gruppen.length === 0 || an === e.gruppen.length) return 'Alle Mitteilungen aufs Handy';
  if (an === 0) return 'Keine Gruppe ausgewählt – nur im Postfach';
  return `${an} von ${e.gruppen.length} Gruppen aufs Handy`;
};

interface ModalProps {
  onClose: () => void;
  variante: PushAuswahlVariante;
  /** Wird nach jeder gespeicherten Aenderung gerufen, damit der Eintrag darunter mitzieht. */
  onGeaendert?: (e: PushEinstellungen) => void;
}

/**
 * Inhalt des Modals: Hauptschalter oben, darunter die Gruppen der Rolle.
 * Jeder Wechsel wird sofort gespeichert (PUT), wie bei den Dashboard-Schaltern.
 */
export const PushAuswahlModal: React.FC<ModalProps> = ({ onClose, variante, onGeaendert }) => {
  const { setError, pushNotificationsPermission, requestPushPermissions } = useApp();
  const stil = STIL[variante];
  const [einstellungen, setEinstellungen] = useState<PushEinstellungen | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [speichert, setSpeichert] = useState(false);

  // Einmal beim Oeffnen laden -- bewusst OHNE setError in den Abhaengigkeiten.
  // Haengt der Effekt an setError und liefert der Kontext je Render eine neue
  // Funktion, laeuft er nach jedem Speichern erneut und ueberschreibt die
  // gerade gesetzte Auswahl mit dem alten Stand vom Server.
  useEffect(() => {
    let abgemeldet = false;
    ladePushEinstellungen()
      .then((e) => { if (!abgemeldet) setEinstellungen(e); })
      .catch((err) => { if (!abgemeldet) setError(fehlerText(err, 'Einstellungen konnten nicht geladen werden')); })
      .finally(() => { if (!abgemeldet) setLaedt(false); });
    return () => { abgemeldet = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speichern = useCallback(async (aenderung: { push_enabled?: boolean; stumm?: string[] }) => {
    if (!einstellungen) return;
    setSpeichert(true);
    try {
      const res = await api.put('/notifications/preferences', aenderung);
      const stumm: string[] = Array.isArray(res.data?.stumm) ? res.data.stumm : (aenderung.stumm ?? einstellungen.stumm);
      const neu: PushEinstellungen = {
        push_enabled: typeof res.data?.push_enabled === 'boolean' ? res.data.push_enabled : einstellungen.push_enabled,
        stumm,
        gruppen: einstellungen.gruppen.map((g) => ({ ...g, aktiv: !stumm.includes(g.id) }))
      };
      setEinstellungen(neu);
      onGeaendert?.(neu);
    } catch (err) {
      setError(fehlerText(err, 'Einstellung konnte nicht gespeichert werden'));
    } finally {
      setSpeichert(false);
    }
  }, [einstellungen, onGeaendert, setError]);

  const gruppeSchalten = (id: string, an: boolean) => {
    if (!einstellungen) return;
    const stumm = an
      ? einstellungen.stumm.filter((g) => g !== id)
      : [...einstellungen.stumm.filter((g) => g !== id), id];
    speichern({ stumm });
  };

  const erlaubt = pushNotificationsPermission === 'granted';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Benachrichtigungen</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="app-gradient-background">
        {!erlaubt && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonCard className="app-card">
              <IonCardContent>
                <div className={`app-info-box ${stil.infoBox}`}>
                  <p>Das Handy erlaubt Konfi Quest noch keine Mitteilungen. Solange das so ist, kommt nichts an – die Auswahl unten gilt, sobald du es erlaubst.</p>
                  <IonButton size="small" fill="outline" onClick={() => { void requestPushPermissions(); }}>
                    Mitteilungen erlauben
                  </IonButton>
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className={`app-section-icon ${stil.sectionIcon}`}>
              <IonIcon icon={ICON_BENACHRICHTIGUNG} />
            </div>
            <IonLabel>Aufs Handy</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {laedt || !einstellungen ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-mittel)' }}>
                  <IonSpinner name="crescent" />
                </div>
              ) : (
                <IonList lines="none" style={{ background: 'transparent' }}>
                  <IonItem lines="full" className="app-dashboard-settings-item">
                    <IonLabel>
                      <h2>Alle Mitteilungen</h2>
                      <p>Hauptschalter für die Gruppen darunter</p>
                    </IonLabel>
                    <IonToggle
                      slot="end"
                      className={stil.toggle}
                      aria-label="Mitteilungen aufs Handy"
                      checked={einstellungen.push_enabled}
                      disabled={speichert}
                      onIonChange={(e) => speichern({ push_enabled: e.detail.checked })}
                    />
                  </IonItem>
                  {einstellungen.gruppen.map((g, index) => (
                    <IonItem
                      key={g.id}
                      lines={index < einstellungen.gruppen.length - 1 ? 'full' : 'none'}
                      className="app-dashboard-settings-item"
                    >
                      <IonLabel>
                        <h2>{g.name}</h2>
                        <p>{g.beschreibung}</p>
                      </IonLabel>
                      <IonToggle
                        slot="end"
                        className={stil.toggle}
                        aria-label={g.name}
                        checked={g.aktiv}
                        disabled={speichert || !einstellungen.push_enabled}
                        onIonChange={(e) => gruppeSchalten(g.id, e.detail.checked)}
                      />
                    </IonItem>
                  ))}
                </IonList>
              )}
            </IonCardContent>
          </IonCard>
          <IonCard className="app-card">
            <IonCardContent className={`app-info-box ${stil.infoBox}`}>
              Abgeschaltet wird nur der Weg aufs Handy – im Postfach unter der
              Glocke steht jede Mitteilung trotzdem.
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

interface EintragProps {
  variante: PushAuswahlVariante;
  /** Ref der Seite fuer die Karten-Darstellung des Modals; wird erst beim Antippen gelesen. */
  presentingRef?: React.RefObject<HTMLElement | null>;
  /** Rueckfall, wenn die Seite kein Ref durchreicht (Konfi-Profil). */
  presentingElement?: HTMLElement | null;
}

const PushAuswahlEintrag: React.FC<EintragProps> = ({ variante, presentingRef, presentingElement }) => {
  const { pushNotificationsPermission, requestPushPermissions } = useApp();
  const [einstellungen, setEinstellungen] = useState<PushEinstellungen | null>(null);

  useEffect(() => {
    let abgemeldet = false;
    ladePushEinstellungen()
      .then((e) => { if (!abgemeldet) setEinstellungen(e); })
      .catch(() => { /* Meta-Zeile faellt auf den neutralen Text zurueck */ });
    return () => { abgemeldet = true; };
  }, []);

  const [zeigeModal, schliesseModal] = useIonModal(PushAuswahlModal, {
    onClose: () => schliesseModal(),
    variante,
    onGeaendert: (e: PushEinstellungen) => setEinstellungen(e)
  });

  const oeffnen = () => {
    if (pushNotificationsPermission !== 'granted') {
      void requestPushPermissions();
    }
    zeigeModal({ presentingElement: presentingRef?.current ?? presentingElement ?? undefined });
  };

  return (
    <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
      className={`app-list-item app-list-item--${variante}`}
      style={{ width: '100%', cursor: 'pointer' }}
      onClick={oeffnen}
    >
      <div className="app-list-item__row">
        <div className="app-list-item__main">
          <div className={`app-icon-circle app-icon-circle--lg app-icon-circle--${variante}`}>
            <IonIcon icon={ICON_BENACHRICHTIGUNG} />
          </div>
          <div className="app-list-item__content">
            <div className="app-list-item__title">Benachrichtigungen</div>
            <div className="app-list-item__meta">
              <span className="app-list-item__meta-item">{pushZusammenfassung(einstellungen, pushNotificationsPermission)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PushAuswahlEintrag;
