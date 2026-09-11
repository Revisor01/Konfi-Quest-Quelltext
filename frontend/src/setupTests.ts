// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock matchMedia
window.matchMedia = window.matchMedia || function() {
  return {
      matches: false,
      addListener: function() {},
      removeListener: function() {}
  };
};

// Mock navigator.setAppBadge / clearAppBadge (jsdom hat das nicht — @capawesome/capacitor-badge ruft es im Web-Fallback auf)
// Badging API (https://w3c.github.io/badging/), in den lib.dom-Typen noch nicht enthalten
interface NavigatorMitBadging extends Navigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

if (typeof navigator !== 'undefined') {
  const nav = navigator as NavigatorMitBadging;
  if (typeof nav.setAppBadge !== 'function') {
    nav.setAppBadge = () => Promise.resolve();
  }
  if (typeof nav.clearAppBadge !== 'function') {
    nav.clearAppBadge = () => Promise.resolve();
  }
}
