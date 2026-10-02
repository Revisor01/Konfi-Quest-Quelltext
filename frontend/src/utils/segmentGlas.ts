import { isPlatform } from '@ionic/react';
import { registerSegmentEffect } from '@rdlabo/ionic-theme-ios27';

/**
 * Schaltet den Glas-Effekt des iOS-Themes fuer alle Segmente an.
 *
 * WARUM ES DAS BRAUCHT: Das Theme bringt den Effekt mit, aber nur als
 * Funktion — von allein passiert nichts. Ohne diesen Aufruf blieb der
 * Konfis/Team-Umschalter eine flache graue Flaeche, obwohl das Theme-CSS
 * laengst eine Glasregel dafuer hat (`.segment-style-glass`). Dieselbe Luecke
 * gab es bei der Tab-Leiste, wo `registerTabBarEffect` nie gerufen wurde.
 *
 * WARUM ZENTRAL UND NICHT JE SEITE: Es gibt 26 Dateien mit `IonSegment`. Jede
 * einzeln anzufassen hiesse, die Zeile beim naechsten neuen Segment zu
 * vergessen — und niemand merkt es, weil nichts kaputtgeht, nur der Effekt
 * fehlt. Der Beobachter unten faengt auch Segmente, die erst spaeter in einem
 * Modal auftauchen.
 *
 * NUR iOS: Auf Android laeuft das MD3-Theme mit eigener Darstellung. Die
 * Theme-Funktion prueft das zwar selbst, aber wir rufen sie gar nicht erst.
 *
 * Aufraeumen ist Pflicht: Jede Registrierung gibt ein `destroy()` zurueck, und
 * der Effekt haengt Elemente ausserhalb der React-Komponente an. Ohne das
 * Abraeumen blieben sie beim Schliessen eines Modals liegen.
 */
export function segmentGlasAnschalten(): () => void {
  if (!isPlatform('ios')) return () => {};

  const effekte = new Map<Element, { destroy: () => void }>();

  const anmelden = (el: Element) => {
    if (effekte.has(el) || !(el instanceof HTMLElement)) return;
    // Zwei Dinge, und beide werden gebraucht (Theme-Doku, "Full-width
    // segments"): `.segment-style-glass` gibt dem Segment die Glasflaeche und
    // den Indikator der Tab-Leiste, `registerSegmentEffect` die BEWEGLICHE
    // Linse darueber ("The optional moving glass"). Nur die Funktion zu rufen
    // liess die Flaeche flach — der erste Anlauf hier hatte genau das.
    el.classList.add('segment-style-glass');

    // Auf die .ios-Klasse warten, bevor die Linse registriert wird.
    //
    // WARUM: registerSegmentEffect steigt still aus, solange das Element sie
    // nicht traegt (im Paket nachgesehen: `if (!segment.classList.contains(
    // 'ios') || ...) return undefined`). Ionic vergibt sie erst beim
    // Hydrieren. Der Fehlschlag faellt kaum auf, weil `.segment-style-glass`
    // oben trotzdem gesetzt ist — die Glasflaeche ist dann da, nur die
    // bewegliche Linse fehlt.
    //
    // `whenDefined` wartet auf die Komponentendefinition, das anschliessende
    // requestAnimationFrame auf einen Rahmen, in dem Ionic die Mode-Klasse
    // gesetzt hat. MainTabs.tsx loest dasselbe fuer die Tab-Leiste mit einer
    // Wiederholschleife.
    const registrieren = () => {
      if (effekte.has(el) || !el.isConnected || !el.classList.contains('ios')) return;
      const effekt = registerSegmentEffect(el);
      if (effekt) effekte.set(el, effekt);
    };
    if (el.classList.contains('ios')) {
      registrieren();
    } else {
      customElements
        .whenDefined('ion-segment')
        .then(() => requestAnimationFrame(registrieren))
        .catch(() => {});
    }
  };

  const abmelden = (el: Element) => {
    effekte.get(el)?.destroy();
    effekte.delete(el);
  };

  document.querySelectorAll('ion-segment').forEach(anmelden);

  const beobachter = new MutationObserver((eintraege) => {
    for (const eintrag of eintraege) {
      eintrag.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.tagName === 'ION-SEGMENT') anmelden(n);
        n.querySelectorAll?.('ion-segment').forEach(anmelden);
      });
      eintrag.removedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.tagName === 'ION-SEGMENT') abmelden(n);
        n.querySelectorAll?.('ion-segment').forEach(abmelden);
      });
    }
  });
  beobachter.observe(document.body, { childList: true, subtree: true });

  return () => {
    beobachter.disconnect();
    effekte.forEach((e) => e.destroy());
    effekte.clear();
  };
}

