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
if (typeof navigator !== 'undefined') {
  if (typeof (navigator as any).setAppBadge !== 'function') {
    (navigator as any).setAppBadge = () => Promise.resolve();
  }
  if (typeof (navigator as any).clearAppBadge !== 'function') {
    (navigator as any).clearAppBadge = () => Promise.resolve();
  }
}
