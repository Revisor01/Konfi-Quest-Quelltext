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
    : `Mein Konfi-Jahr ${data.year}`;

  if (data.slideValue) {
    return `${prefix}: ${data.slideValue}! #KonfiQuest`;
  }
  return `${prefix} - Schau dir meinen Rückblick an! #KonfiQuest`;
}

export async function shareSlide(
  cardElement: HTMLElement,
  slideKey: string,
  wrappedType: 'konfi' | 'teamer',
  textFallbackData: ShareTextData
): Promise<void> {
  try {
    // Bild-Export via html-to-image
    const dataUrl = await toPng(cardElement, {
      width: 1080,
      height: 1920,
      pixelRatio: 1,
      cacheBust: true,
    });

    if (Capacitor.isNativePlatform()) {
      // Native: Filesystem + Share-Sheet
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

      await Share.share({
        files: [fileUri.uri],
      });
    } else {
      // Web: Download-Link erstellen
      const link = document.createElement('a');
      link.download = `wrapped_${slideKey}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.warn('Bild-Export fehlgeschlagen, Text-Fallback:', err);

    // Text-Fallback
    const fallbackText = generateFallbackText(textFallbackData);

    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: wrappedType === 'teamer' ? 'Mein Teamer Wrapped' : 'Mein Konfi Wrapped',
          text: fallbackText,
        });
      } else if (navigator.share) {
        await navigator.share({ text: fallbackText });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(fallbackText);
      }
    } catch {
      // Share abgebrochen oder nicht verfuegbar - kein Fehler
    }
  }
}
