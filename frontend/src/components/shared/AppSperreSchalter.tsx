import React, { useCallback, useEffect, useState } from 'react';
import { IonIcon, IonSpinner, useIonActionSheet } from '@ionic/react';
import { ICON_SPERRE } from './icons';
import {
  SperrVerzoegerung,
  VERZOEGERUNGEN,
  VERZOEGERUNG_BEZEICHNUNG,
  sperreVerfuegbar,
  sperreLesen,
  sperreSpeichern,
  sperreOeffnen
} from '../../services/appSperre';
import { biometrieVerfuegbar } from '../../services/biometrics';
import { tastaturKlick } from '../../utils/tastatur';

// Farbvariante der jeweiligen Rolle — dasselbe Muster wie BiometrieSchalter,
// damit sich der Eintrag in die "Konto-Einstellungen" aller drei Ansichten
// einfuegt.
export type SchalterVariante = 'users' | 'teamer' | 'purple';

interface Props {
  variante: SchalterVariante;
}

/**
 * Eintrag fuer die "Konto-Einstellungen": App-Sperre ein/aus und Wartezeit.
 *
 * BEWUSST EINE GEMEINSAME KOMPONENTE fuer alle drei Rollen (Leitung,
 * Teamer:innen, Konfis). Die App hat drei getrennte Komponentenbaeume, und die
 * uebliche Falle ist, eine Aenderung nur in einem davon zu machen. Die gesamte
 * Logik steckt hier an EINER Stelle; die drei Profil-Seiten binden sie ein und
 * geben ueber `variante` nur ihre Farbe mit.
 *
 * Rendert NICHTS ohne eingerichtete Biometrie und nichts im Browser — ein
 * Schalter, der ins Leere fuehrt, ist schlimmer als gar keiner.
 *
 * Statt Schalter plus Auswahl steht hier EIN Eintrag, der die Auswahl oeffnet:
 * "Aus" ist einer der Punkte darin. Ein getrennter Schalter muesste sich merken,
 * welche Wartezeit vor dem Ausschalten galt, und die Auswahl ausgrauen, solange
 * er aus ist — zwei Bedienelemente fuer eine Entscheidung.
 */
const AppSperreSchalter: React.FC<Props> = ({ variante }) => {
  const [zeigeAuswahl] = useIonActionSheet();
  const [verfuegbar, setVerfuegbar] = useState(false);
  // Neutral bis das Geraet geantwortet hat — "Face ID" waere auf einem
  // Fingerabdruck-Geraet geraten. Das Symbol dieses Eintrags bleibt bewusst das
  // Schloss: Er benennt die App-Sperre, nicht das Verfahren.
  const [bezeichnung, setBezeichnung] = useState('Biometrie');
  const [wert, setWert] = useState<SperrVerzoegerung>('aus');
  const [laedt, setLaedt] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  // Eine fehlgeschlagene Abfrage muss sichtbar werden: Sonst tippt jemand auf
  // "Sofort", nichts passiert, und er haelt die Sperre fuer eingeschaltet.
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgemeldet = false;
    (async () => {
      const [nutzbar, art, gespeichert] = await Promise.all([
        sperreVerfuegbar(),
        biometrieVerfuegbar(),
        sperreLesen()
      ]);
      if (abgemeldet) return;
      setVerfuegbar(nutzbar);
      setBezeichnung(art.bezeichnung);
      setWert(gespeichert);
      setLaedt(false);
    })();
    return () => { abgemeldet = true; };
  }, []);

  /**
   * BEIM EINSCHALTEN WIRD DIE BIOMETRIE EINMAL ABGEFRAGT.
   *
   * WARUM: Wer die Sperre einschaltet, erfaehrt sonst erst beim naechsten
   * Kaltstart, ob sie ueberhaupt funktioniert -- und steht dann vor der
   * eigenen App, ohne hineinzukommen. Der einzige Ausweg waere der
   * Abmelden-Knopf auf dem Sperrbildschirm. Die Abfrage hier verlegt genau
   * diesen Moment dorthin, wo er harmlos ist: in die Einstellungen, bei
   * offener App. Klappt sie nicht, bleibt die Sperre aus, und niemand sperrt
   * sich aus. So machen es die anderen Apps auch.
   *
   * WARUM NICHT BEIM AUSSCHALTEN: Wer abschalten kann, sitzt bereits in der
   * entsperrten App -- er hat sich beim Oeffnen ausgewiesen oder die Sperre
   * stand nie. Eine zweite Huerde davor schuetzt niemanden zusaetzlich, kann
   * aber genau den Fall verschlimmern, den die Abfrage oben verhindern soll:
   * Geht die Biometrie kaputt (neues Gesicht angelernt, Sensor defekt), waere
   * die Sperre dann weder zu oeffnen NOCH abzuschalten.
   *
   * WARUM NICHT BEIM WECHSEL DER WARTEZEIT: Die Sperre ist da schon an und
   * schon einmal bestaetigt worden; es aendert sich nur eine Zahl, kein
   * Zugang. Eine Abfrage bei jedem Umstellen waere Zeremonie ohne Gewinn.
   */
  const setzen = useCallback(async (neu: SperrVerzoegerung) => {
    setSpeichert(true);
    try {
      const schaltetEin = neu !== 'aus' && wert === 'aus';
      if (schaltetEin) {
        const ausgang = await sperreOeffnen();
        if (ausgang !== 'ok') {
          setFehler(
            ausgang === 'abgebrochen'
              ? `Die Sperre bleibt aus – ${bezeichnung} wurde abgebrochen.`
              : `Die Sperre bleibt aus – ${bezeichnung} hat nicht geklappt.`
          );
          return;
        }
      }
      setFehler(null);
      await sperreSpeichern(neu);
      setWert(neu);
      // Der laufende Sperr-Hook liest daraufhin neu. Ohne dieses Ereignis
      // griffe eine gerade eingeschaltete Sperre erst beim naechsten Start.
      window.dispatchEvent(new CustomEvent('app-sperre:geaendert'));
    } finally {
      setSpeichert(false);
    }
  }, [wert, bezeichnung]);

  const oeffnen = useCallback(() => {
    zeigeAuswahl({
      header: 'App sperren',
      subHeader: `Wann soll ${bezeichnung} verlangt werden?`,
      buttons: [
        ...VERZOEGERUNGEN.map((v) => ({
          text: VERZOEGERUNG_BEZEICHNUNG[v],
          handler: () => { setzen(v); }
        })),
        { text: VERZOEGERUNG_BEZEICHNUNG.aus, role: 'destructive', handler: () => { setzen('aus'); } },
        { text: 'Abbrechen', role: 'cancel' }
      ]
    });
  }, [zeigeAuswahl, bezeichnung, setzen]);

  if (laedt || !verfuegbar) return null;

  const beschreibung = fehler
    ? fehler
    : wert === 'aus'
      ? `Die App nach einer Pause mit ${bezeichnung} schützen`
      : `${VERZOEGERUNG_BEZEICHNUNG[wert]} im Hintergrund`;

  return (
    <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-disabled={speichert}
      className={`app-list-item app-list-item--${variante}`}
      style={{ width: '100%', cursor: 'pointer' }}
      onClick={speichert ? undefined : oeffnen}
    >
      <div className="app-list-item__row">
        <div className="app-list-item__main">
          <div className={`app-icon-circle app-icon-circle--${variante}`}>
            <IonIcon icon={ICON_SPERRE} />
          </div>
          <div className="app-list-item__content">
            <div className="app-list-item__title">App sperren</div>
            <div className="app-list-item__meta">
              <span className="app-list-item__meta-item">{beschreibung}</span>
            </div>
          </div>
        </div>
        {speichert ? <IonSpinner name="crescent" /> : null}
      </div>
    </div>
  );
};

export default AppSperreSchalter;
