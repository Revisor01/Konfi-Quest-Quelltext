import { toPng } from 'html-to-image';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface ShareTextData {
  wrappedType: 'konfi' | 'teamer';
  displayName: string;
  year: number;
  slideKey: string;
  slideValue?: string;
}

function generateFallbackText(data: ShareTextData): string {
  const prefix = data.wrappedType === 'teamer'
    ? `Mein Teamer-Jahr ${data.year}`
    : 'Meine Konfi-Zeit';

  if (data.slideValue) {
    return `${prefix}: ${data.slideValue}! #KonfiQuest`;
  }
  return `${prefix} - Schau dir meinen Rückblick an! #KonfiQuest`;
}


/**
 * Wartet, bis das Hintergrundfoto der Karte wirklich geladen ist.
 *
 * WARUM: html-to-image zeichnet, was DA IST. Ein Motiv, das im Moment des
 * Tippens noch laedt, fehlt im Bild -- ohne Fehler und ohne Meldung. Die
 * Motive werden zwar mit der App ausgeliefert, aber beim allerersten
 * Oeffnen einer Seite sind sie noch nicht im Zwischenspeicher.
 *
 * decode() statt onload: Es wartet nicht nur auf die Bytes, sondern auch
 * darauf, dass das Bild entpackt ist -- erst dann kann es gezeichnet werden.
 */
async function wartAufBilder(el: HTMLElement): Promise<void> {
  const foto = el.querySelector('.share-card-foto') as HTMLElement | null;
  const stil = foto?.style.backgroundImage;
  const treffer = stil?.match(/url\(["']?([^"')]+)["']?\)/);
  if (!treffer) return;
  try {
    const bild = new Image();
    bild.src = treffer[1];
    await bild.decode();
  } catch {
    // Bild fehlt oder laesst sich nicht entpacken: Die Karte wird dann
    // ohne Foto exportiert -- mit Farbverlauf und Text ist sie immer noch
    // ein brauchbares Bild. Besser als gar nichts zu teilen.
  }
}

/**
 * Erzeugt das Teilen-Bild.
 */
async function erzeugeBild(el: HTMLElement): Promise<string> {
  await wartAufBilder(el);
  return toPng(el, {
    width: 1080,
    height: 1920,
    pixelRatio: 1,
  });
}

/**
 * Wie das Teilen ausgegangen ist.
 *
 * ABGEBROCHEN IST KEIN FEHLER: Wer das Teilen-Blatt wieder zuschiebt, hat
 * sich entschieden. Eine Fehlermeldung darauf waere Bevormundung.
 */
export type TeilenErgebnis =
  /** Bild ging ans Teilen-Blatt (oder wurde im Browser geladen). */
  | { art: 'geteilt' }
  /** Nutzer hat abgebrochen -- nichts sagen. */
  | { art: 'abgebrochen' }
  /** Bild ging nicht, stattdessen wurde der Text geteilt. */
  | { art: 'nur-text' }
  /** Gar nichts hat geklappt. */
  | { art: 'fehler'; grund: string };

/** Hat der Nutzer selbst abgebrochen? */
function istAbbruch(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name;
  const text = String((err as { message?: string }).message || err);
  // Web Share API meldet AbortError; die Capacitor-Bruecke meldet je nach
  // Plattform "canceled"/"cancelled" oder "Share canceled".
  return name === 'AbortError' || /cancel/i.test(text);
}


/**
 * Der Browser-Weg.
 *
 * canShare({files}) VOR share(): Ob ein Browser Dateien teilen kann, sagt
 * nur diese Pruefung. Ohne sie wirft share() auf dem Desktop und der Nutzer
 * bekaeme eine Fehlermeldung, wo ein Download das Richtige gewesen waere.
 */
async function teileImBrowser(
  dataUrl: string,
  slideKey: string,
  wrappedType: 'konfi' | 'teamer',
  textFallbackData: ShareTextData
): Promise<TeilenErgebnis> {
  const dateiname = `wrapped_${slideKey}.png`;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const datei = new File([blob], dateiname, { type: 'image/png' });
    if (navigator.canShare?.({ files: [datei] })) {
      await navigator.share({
        files: [datei],
        title: wrappedType === 'teamer' ? 'Mein Teamer Wrapped' : 'Mein Konfi Wrapped',
        text: generateFallbackText(textFallbackData),
      });
      return { art: 'geteilt' };
    }
  } catch (err) {
    // Abbruch ist eine Entscheidung, kein Fehler -- und dann darf auch
    // KEIN Download hinterherlaufen. Sonst landete die Datei im
    // Download-Ordner, obwohl der Nutzer gerade abgesagt hat.
    if (istAbbruch(err)) return { art: 'abgebrochen' };
  }

  // Der Browser kann keine Dateien teilen (Desktop): herunterladen.
  const link = document.createElement('a');
  link.download = dateiname;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return { art: 'geteilt' };
}

export async function shareSlide(
  cardElement: HTMLElement,
  slideKey: string,
  wrappedType: 'konfi' | 'teamer',
  textFallbackData: ShareTextData
): Promise<TeilenErgebnis> {
  let dataUrl: string;
  try {
    dataUrl = await erzeugeBild(cardElement);
  } catch (err) {
    // Das BILD ist gescheitert. Der Text ist immer noch besser als nichts.
    return teileNurText(wrappedType, textFallbackData, err);
  }

  try {
    if (Capacitor.isNativePlatform()) {
      const base64 = dataUrl.split(',')[1];
      const fileName = `wrapped_${slideKey}_${Date.now()}.png`;

      await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Cache,
      });

      const fileUri = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Cache,
      });

      await Share.share({ files: [fileUri.uri] });
      return { art: 'geteilt' };
    }
    return await teileImBrowser(dataUrl, slideKey, wrappedType, textFallbackData);
  } catch (err) {
    if (istAbbruch(err)) return { art: 'abgebrochen' };
    return teileNurText(wrappedType, textFallbackData, err);
  }
}

/**
 * Rueckfallebene: Das Bild ging nicht, also wenigstens den Text.
 */
async function teileNurText(
  wrappedType: 'konfi' | 'teamer',
  textFallbackData: ShareTextData,
  ursprung: unknown
): Promise<TeilenErgebnis> {
  const fallbackText = generateFallbackText(textFallbackData);
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({
        title: wrappedType === 'teamer' ? 'Mein Teamer Wrapped' : 'Mein Konfi Wrapped',
        text: fallbackText,
      });
      return { art: 'nur-text' };
    }
    if (navigator.share) {
      await navigator.share({ text: fallbackText });
      return { art: 'nur-text' };
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(fallbackText);
      return { art: 'nur-text' };
    }
  } catch (err) {
    if (istAbbruch(err)) return { art: 'abgebrochen' };
  }
  return {
    art: 'fehler',
    grund: String((ursprung as { message?: string })?.message || ursprung || 'unbekannt'),
  };
}
