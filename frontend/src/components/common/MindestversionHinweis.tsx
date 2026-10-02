import React, { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useIonAlert } from '@ionic/react';
import { useBetriebsstatus } from '../../hooks/useBetriebsstatus';
import {
  mindestversionHinweisSchonGezeigt,
  merkeMindestversionHinweisGezeigt,
} from '../../services/betriebsstatus';
import { linkOeffnen } from '../../services/systemDialoge';

interface Props {
  /**
   * true, solange der Hinweis warten muss: Der Sperrbildschirm der App-Sperre
   * steht davor, oder beim Start ist noch nicht klar, ob er kommt. App.tsx
   * setzt das aus useAppSperre (gesperrt || !startGeklaert).
   */
  zurueckhalten?: boolean;
}

/**
 * WARUM EIN DIALOG UND NICHT DIE BLAUE STORE-KARTE ("Version … ist da",
 * shared/StoreUpdateBanner) als dringlichere Variante:
 *   - Reichweite: Die Karte steht nur auf den Startseiten von Konfi, Team
 *     und Leitung — nicht auf der Anmeldeseite, nicht bei Super-Admins, und
 *     wer ueber einen Push direkt in einen Chat springt, sieht sie nicht.
 *     Die Mindestversion setzt der Betrieb gerade, um JEDES alte Geraet zu
 *     erreichen; der Dialog haengt deshalb einmal in App.tsx und erscheint
 *     ueberall, auch vor der Anmeldung.
 *   - Gewicht: Zwischen "Was ist neu", Mitmachen und Testphase waere eine
 *     weitere Karte leicht zu uebersehen — und sie saehe aus wie die, die
 *     viele schon einmal weggetippt haben.
 *   - Andere Regeln: Die Karte wird PRO VERSION DAUERHAFT weggetippt und
 *     einmal je Start geprueft (updateCheck.ts); der Hinweis hier kommt bei
 *     jedem Start wieder, und die Pruefung laeuft auch bei jeder Rueckkehr
 *     in die App. Beides in einer Komponente haette zwei Quellen mit zwei
 *     Regeln vermischt.
 * Beide ergaenzen sich: Nach "Später" bleibt die blaue Karte auf der
 * Startseite als ruhige Erinnerung stehen (solange sie fuer diese Version
 * nicht weggetippt ist).
 *
 * WIE OFT: einmal je App-Start. Ob und warum, steht bei
 * merkeMindestversionHinweisGezeigt (services/betriebsstatus.ts).
 *
 * ALS ion-alert, dem ueblichen Dialog der App fuer Rueckfragen: Er bringt
 * mit, was ein wegklickbarer Hinweis braucht, auf iOS und Android im
 * jeweiligen Stil. role="alertdialog" mit der Ueberschrift als Namen und dem
 * Grund als Beschreibung; der Fokus springt beim Erscheinen in den Dialog und
 * nach dem Schliessen dorthin zurueck, wo er vorher stand; Tab bleibt im
 * Dialog. Schliessen geht ueber "Später", einen Tipp daneben, die
 * Zurueck-Taste auf Android und Escape. Die Knopftexte sind bewusst kurz,
 * damit beide auf dem iPhone nebeneinander Platz haben; welcher Store es ist,
 * sagt der Text darueber.
 *
 * WARTEN AUF DIE APP-SPERRE: Ionic-Dialoge liegen unter dem Sperrbildschirm
 * (z-index 20000 gegen 100000). Kaeme der Hinweis beim Kaltstart mit
 * eingeschalteter Sperre sofort, laege ein modaler Dialog unsichtbar unter
 * dem Schloss und zoege Fokus und Vorlesehilfe von dort weg. Deshalb wartet
 * er (`zurueckhalten`) und erscheint nach dem Entsperren.
 *
 * Ob der Fall ueberhaupt vorliegt, entscheidet services/betriebsstatus.ts:
 * nur nativ, nur mit Antwort des Servers, nie im Browser, nie ohne Netz.
 * Die Komponente selbst rendert nichts in den Baum.
 */
const MindestversionHinweis: React.FC<Props> = ({ zurueckhalten = false }) => {
  const { aktualisierenUrl } = useBetriebsstatus();
  const [zeigeDialog] = useIonAlert();

  useEffect(() => {
    if (!aktualisierenUrl || zurueckhalten || mindestversionHinweisSchonGezeigt()) return;
    // VOR dem Zeigen merken: Eine neue Montage oder ein weiterer Durchlauf
    // dieses Effekts, waehrend der Dialog offen ist, darf keinen zweiten
    // oeffnen. Offen heisst ohnehin, dass er gleich geschlossen wird.
    merkeMindestversionHinweisGezeigt();

    const store = Capacitor.getPlatform() === 'android' ? 'bei Google Play' : 'im App Store';
    void zeigeDialog({
      header: 'Bitte aktualisiere Konfi Quest',
      message: `Diese Version wird nicht mehr unterstützt. Die aktuelle Version liegt ${store} bereit.`,
      buttons: [
        { text: 'Später', role: 'cancel' },
        {
          text: 'Aktualisieren',
          // Wie die Store-Karte (StoreUpdateBanner): window.open fuehrt auf
          // dem Geraet in die Store-App. Der Dialog schliesst dabei; wer ohne
          // Update zurueckkommt, nutzt die App weiter.
          handler: () => { linkOeffnen(aktualisierenUrl); },
        },
      ],
    });
  }, [aktualisierenUrl, zurueckhalten, zeigeDialog]);

  return null;
};

export default MindestversionHinweis;
