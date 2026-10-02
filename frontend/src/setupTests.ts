// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Node ab 25 bringt ein eigenes localStorage mit. Ohne --localstorage-file ist
// es undefined und verdeckt das von jsdom: Preferences (Web) und der
// offlineCache liefen ins Leere, und Tests, die unter Node 22 gruen waren,
// fielen im CI (Node 26). Dann das von jsdom einsetzen.
const jsdomFenster = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (jsdomFenster && typeof globalThis[name] === 'undefined') {
    Object.defineProperty(globalThis, name, {
      value: jsdomFenster[name],
      configurable: true,
      writable: true,
    });
  }
}

// Mock matchMedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};

// Mock navigator.setAppBadge / clearAppBadge (jsdom hat das nicht — @capawesome/capacitor-badge ruft es im Web-Fallback auf)
// Badging API (https://w3c.github.io/badging/): lib.dom fuehrt beide Methoden
// als vorhanden, jsdom kennt sie nicht -- hier deshalb als optional.
type NavigatorMitBadging = Omit<Navigator, 'setAppBadge' | 'clearAppBadge'> & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

if (typeof navigator !== 'undefined') {
  const nav = navigator as NavigatorMitBadging;
  if (typeof nav.setAppBadge !== 'function') {
    nav.setAppBadge = () => Promise.resolve();
  }
  if (typeof nav.clearAppBadge !== 'function') {
    nav.clearAppBadge = () => Promise.resolve();
  }
}
