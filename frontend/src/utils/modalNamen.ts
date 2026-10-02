/**
 * Jedes Modal heißt so, wie sein Titel lautet — für Vorlesehilfen
 * 
 *
 * DAS PROBLEM: 92 Modale öffnet die App über `useIonModal`. Ionic zeichnet sie
 * als `ion-modal`, die eigentliche Dialog-Hülle (`role="dialog"`) liegt aber
 * IM Shadow-DOM (`.modal-wrapper`). Ohne Namen sagt VoiceOver/TalkBack beim
 * Öffnen nur „Dialog" — nicht „Passwort ändern" oder „Neuer Termin".
 *
 * WAS IONIC 9.0.3 TRÄGT (gemessen, Chromium-Zugänglichkeitsbaum):
 *   - `aria-label` am Modal oder über `htmlAttributes`: Ionic reicht es an die
 *     Hülle weiter (ion-modal.js, componentWillLoad: `inheritAttributes` nur
 *     für aria-label und role) — der Dialog heißt dann so.
 *   - `aria-labelledby` bleibt am Host `ion-modal` hängen; die Hülle im
 *     Shadow-DOM bleibt namenlos (Name "" im Baum). Ein Verweis aus dem
 *     Shadow-DOM auf eine id im Licht-DOM ginge ohnehin nicht.
 *
 * DIE LÖSUNG AN EINER STELLE: Beim Öffnen jedes Modals (Ereignis
 * `ionModalWillPresent`, es steigt bis zum Dokument auf) liest dieser
 * Beobachter den Titel des Modals — das erste eigene `ion-title`, sonst ein
 * `data-dialogname` für die zwei Vollbild-Ansichten ohne Kopfzeile (Datei,
 * Rückblick) — und setzt ihn als `aria-label` an die Hülle. Ändert sich der
 * Titel („Aktivität laden..." → „Aktivität prüfen"), zieht der Name nach.
 * Kein Aufruf muss daran denken; ein neues Modal mit Titel ist von selbst
 * benannt. Der Test modaleUeberHookBenannt.test.ts hält fest, dass jedes per
 * Hook geöffnete Modal einen Titel oder ein data-dialogname trägt.
 *
 * AUSDRÜCKLICHE NAMEN HABEN VORRANG: Trägt die Hülle schon ein `aria-label`,
 * das nicht von hier stammt (die Datumswähler „Datum wählen"), bleibt es.
 */

/** Name für Modale ohne ion-title (Vollbild-Ansichten mit eigener Kopfleiste). */
export const DIALOGNAME_ATTRIBUT = 'data-dialogname';

const leerzeichen = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

/** Gehört das Element zu diesem Modal und nicht zu einem darin verschachtelten? */
const eigenes = (modal: Element, element: Element): boolean =>
  element.closest('ion-modal') === modal;

/**
 * Der Titel eines Modals: das erste eigene ion-title mit Text, sonst das
 * erste eigene data-dialogname. Ohne beides: null.
 */
export const dialogTitel = (modal: Element): string | null => {
  for (const titel of modal.querySelectorAll('ion-title')) {
    if (!eigenes(modal, titel)) continue;
    const text = leerzeichen(titel.textContent);
    if (text) return text;
  }
  for (const element of modal.querySelectorAll(`[${DIALOGNAME_ATTRIBUT}]`)) {
    if (!eigenes(modal, element)) continue;
    const text = leerzeichen(element.getAttribute(DIALOGNAME_ATTRIBUT));
    if (text) return text;
  }
  return null;
};

/** Die Dialog-Hülle im Shadow-DOM von ion-modal (Ionic 9: .modal-wrapper). */
export const dialogHuelle = (modal: Element): HTMLElement | null =>
  modal.shadowRoot?.querySelector<HTMLElement>('[role="dialog"]') ?? null;

// Welche Namen stammen von hier? Nur die dürfen überschrieben werden.
const vonHierGesetzt = new WeakMap<HTMLElement, string>();

/** Setzt den Titel des Modals als Namen seiner Dialog-Hülle. */
export const modalBenennen = (modal: Element): void => {
  const huelle = dialogHuelle(modal);
  if (!huelle) return;
  const vorhanden = huelle.getAttribute('aria-label');
  const eigener = vonHierGesetzt.get(huelle);
  if (vorhanden && vorhanden !== eigener) return;

  const name = dialogTitel(modal);
  if (!name) {
    if (eigener) {
      huelle.removeAttribute('aria-label');
      vonHierGesetzt.delete(huelle);
    }
    return;
  }
  if (name === vorhanden) return;
  huelle.setAttribute('aria-label', name);
  vonHierGesetzt.set(huelle, name);
};

/**
 * Schaltet die Benennung für alle Modale an — einmal für die ganze App
 * (App.tsx), wie segmentGlasAnschalten. Gibt eine Aufräumfunktion zurück.
 */
export function modalNamenAnschalten(dokument: Document = document): () => void {
  const beobachter = new Map<Element, MutationObserver>();

  const oeffnet = (ereignis: Event) => {
    const modal = ereignis.target;
    if (!(modal instanceof Element) || modal.tagName !== 'ION-MODAL') return;
    modalBenennen(modal);
    if (beobachter.has(modal)) return;
    // Der Inhalt eines Hook-Modals kommt erst nach dem Öffnen (React-Portal),
    // Titel wechseln mit dem Zustand — deshalb beobachten, solange es offen ist.
    const b = new MutationObserver(() => modalBenennen(modal));
    b.observe(modal, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [DIALOGNAME_ATTRIBUT],
    });
    beobachter.set(modal, b);
  };

  const geschlossen = (ereignis: Event) => {
    const modal = ereignis.target;
    if (!(modal instanceof Element)) return;
    beobachter.get(modal)?.disconnect();
    beobachter.delete(modal);
  };

  dokument.addEventListener('ionModalWillPresent', oeffnet);
  dokument.addEventListener('ionModalDidPresent', oeffnet);
  dokument.addEventListener('ionModalDidDismiss', geschlossen);

  return () => {
    dokument.removeEventListener('ionModalWillPresent', oeffnet);
    dokument.removeEventListener('ionModalDidPresent', oeffnet);
    dokument.removeEventListener('ionModalDidDismiss', geschlossen);
    beobachter.forEach((b) => b.disconnect());
    beobachter.clear();
  };
}
