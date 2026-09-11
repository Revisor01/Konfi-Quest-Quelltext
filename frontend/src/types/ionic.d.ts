export {}; // wichtig für den Modulkontext

declare global {
  type HTMLIonPageElement = HTMLElement;
}

declare module 'react' {
  // Ionic wird ueber CSS-Custom-Properties gestaltet (--padding-start,
  // --background, --bar-background ...), und die stehen in dieser App an gut
  // zwanzig Stellen direkt im style-Attribut.
  //
  // Bis zum Umstieg auf Ionic 9 trug @types/react-router-dom
  // eine passende Erweiterung mit. Das Paket ist mit react-router 6 ueberfluessig
  // geworden — react-router bringt seine Typen selbst mit —, und mit ihm fiel
  // still diese Erweiterung weg: 21 Fehler "'--padding-start' does not exist
  // in type Properties". Nachgemessen: auf Ionic 8 waren es null, es liegt
  // also nicht an Ionic 9.
  //
  // Deshalb hier ausdruecklich, statt sie an einem fremden Paket haengen zu
  // lassen. Nur Eigenschaften mit doppeltem Bindestrich sind erlaubt — ein
  // Tippfehler in einem normalen CSS-Namen faellt weiterhin auf.
  interface CSSProperties {
    [eigenschaft: `--${string}`]: string | number | undefined;
  }
}
