/**
 * Leerer Ersatz fuer `firebase/messaging`.
 *
 * `@capacitor-firebase/messaging` nutzen wir ausschliesslich fuer den aktiven
 * Token-Abruf auf den Geraeten (FirebaseMessaging.getToken()) — dort laeuft
 * das native SDK, nicht dieser Code. Der Web-Fallback des Plugins importiert
 * `firebase/messaging` jedoch STATISCH, und der Build zieht ihn deshalb mit
 * hinein.
 *
 * Das echte `firebase`-Paket dafuer aufzunehmen waere ein schlechter Tausch:
 * 37 MB fuer einen Zweig, der nie ausgefuehrt wird. Im Browser gibt es keine
 * Push-Nachrichten, und zwar seit immer — jeder Push-Weg in AppContext haengt
 * an Capacitor.isNativePlatform().
 *
 * Sollte der Browser-Push je gewollt sein, ist DAS hier die Stelle: echtes
 * firebase als Abhaengigkeit aufnehmen und diesen Alias entfernen.
 */
const nichtImBrowser = (name: string) => () => {
  throw new Error(`firebase/messaging.${name} ist im Browser nicht verfuegbar`);
};

export const getMessaging = nichtImBrowser('getMessaging');
export const getToken = nichtImBrowser('getToken');
export const deleteToken = nichtImBrowser('deleteToken');
export const onMessage = nichtImBrowser('onMessage');
export const isSupported = async () => false;
