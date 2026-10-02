/**
 * Hat die Person im System „Bewegung reduzieren" eingeschaltet?
 *
 * Ohne matchMedia (alte WebViews, Tests ohne Mock): nicht reduziert -- die
 * App verhält sich dann wie bisher.
 */
export const bewegungReduziert = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
};
