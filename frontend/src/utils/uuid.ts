/**
 * Sichere UUID-v4-Generierung.
 *
 * `crypto.randomUUID()` ist nur in Secure Contexts verfügbar (HTTPS oder
 * localhost). Im Live-Reload-Dev gegen eine LAN-IP (http://192.168.x.x)
 * ist es undefined — der Fallback `${Date.now()}-${Math.random()}` erzeugt
 * dann KEINE gültige UUID, was Backend-Validierungen (isUUID) brechen lässt.
 *
 * Dieser Helper liefert in beiden Fällen eine valide UUID v4:
 * 1. crypto.randomUUID() wenn verfügbar
 * 2. crypto.getRandomValues()-basierter v4-Aufbau als Fallback
 * 3. Math.random()-basierter v4-Aufbau als letzter Ausweg
 */
export const safeUUID = (): string => {
  // 1. Bevorzugt: native randomUUID (Secure Context)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // 2. Fallback: getRandomValues (auch in non-secure Contexts verfügbar)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Version (4) und Variant (10xx) setzen
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
    return (
      hex.slice(0, 4).join('') +
      '-' + hex.slice(4, 6).join('') +
      '-' + hex.slice(6, 8).join('') +
      '-' + hex.slice(8, 10).join('') +
      '-' + hex.slice(10, 16).join('')
    );
  }

  // 3. Letzter Ausweg: Math.random()-basiert (RFC-4122 v4 Form)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
