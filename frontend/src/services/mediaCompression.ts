// Clientseitige Bild-Kompression vor dem Upload.
//
// Ziel: Chat-Uploads klein halten (Traffic + Speicher). Bilder werden auf eine
// maximale lange Kante von 1920px herunterskaliert und als JPEG (~0.8 Qualitaet)
// kodiert. PNGs mit Transparenz bleiben PNG (sonst wuerde der transparente
// Hintergrund schwarz), alle anderen werden zu JPEG konvertiert.
//
// Videos lassen sich im WebView nicht sinnvoll transkodieren (kein Canvas-Weg,
// ffmpeg.wasm waere zu gross/langsam auf Mobilgeraeten) -> hier NICHT behandelt.

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.8;

// Bilder ab dieser Kantenlaenge ODER Groesse werden ueberhaupt angefasst. Kleine
// Bilder (Screenshots, bereits komprimierte) bleiben unveraendert -> kein
// Qualitaetsverlust durch unnoetiges Re-Encoding.
const SIZE_THRESHOLD = 500 * 1024; // 500 KB

interface CompressResult {
  file: File;
  previewUrl: string; // Object-URL des komprimierten Files (Aufrufer muss revoken)
}

const loadImage = (objectUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = objectUrl;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));

// Prueft, ob ein Bild (teil-)transparente Pixel enthaelt. Nur dann muss PNG
// erhalten bleiben; sonst ist JPEG deutlich kleiner.
const hasTransparency = (ctx: CanvasRenderingContext2D, width: number, height: number): boolean => {
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    // Jeden 4. Wert (Alpha) pruefen; aus Performancegruenden in groben Schritten.
    const step = Math.max(4, Math.floor(data.length / 4 / 50000) * 4);
    for (let i = 3; i < data.length; i += step) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // getImageData kann bei sehr grossen Canvases scheitern -> sicherheitshalber
    // Transparenz annehmen (PNG behalten).
    return true;
  }
};

const changeExtension = (name: string, ext: string): string => {
  const base = name.replace(/\.[^/.]+$/, '');
  return `${base}.${ext}`;
};

/**
 * Komprimiert/skaliert ein Bild-File fuer den Upload. Gibt das (ggf.
 * unveraenderte) File samt frischer Preview-URL zurueck. Nicht-Bilder werden
 * unveraendert durchgereicht.
 */
/**
 * Kompression + Groessen-Gate fuer Foto-Uploads (Aktivitaetsantraege etc.):
 * erst verkleinern, DANN gegen maxBytes pruefen — Live-Kamerafotos (8-16 MB)
 * wuerden einen vorgezogenen Check sonst immer reissen, obwohl sie nach der
 * Kompression locker passen. Die Preview-URL aus compressImage wird hier
 * sofort freigegeben (die Aufrufer bauen ihre eigene Vorschau).
 * Wirft bei Ueberschreitung einen Error mit deutscher Meldung.
 */
export const compressForUpload = async (file: File, maxBytes = 5 * 1024 * 1024): Promise<File> => {
  const { file: compressed, previewUrl } = await compressImage(file);
  URL.revokeObjectURL(previewUrl);
  if (compressed.size > maxBytes) {
    throw new Error(`Foto ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  }
  return compressed;
};

export const compressImage = async (file: File): Promise<CompressResult> => {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    // GIFs (moeglw. animiert) und Nicht-Bilder nicht anfassen.
    return { file, previewUrl: URL.createObjectURL(file) };
  }

  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(srcUrl);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);

    // Klein genug UND nicht zu gross? -> nichts tun.
    if (longEdge <= MAX_EDGE && file.size <= SIZE_THRESHOLD) {
      return { file, previewUrl: srcUrl };
    }

    const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
    const targetW = Math.round(img.naturalWidth * scale);
    const targetH = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { file, previewUrl: srcUrl };
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const keepPng = file.type === 'image/png' && hasTransparency(ctx, targetW, targetH);
    const outType = keepPng ? 'image/png' : 'image/jpeg';
    const quality = keepPng ? undefined : JPEG_QUALITY;

    const blob = await canvasToBlob(canvas, outType, quality as number);
    if (!blob) return { file, previewUrl: srcUrl };

    // Falls die Kompression das File nicht kleiner macht (z.B. kleines PNG),
    // Original behalten.
    if (blob.size >= file.size && longEdge <= MAX_EDGE) {
      return { file, previewUrl: srcUrl };
    }

    const outName = keepPng ? file.name : changeExtension(file.name, 'jpg');
    const outFile = new File([blob], outName, { type: outType });

    // Alte Quell-URL freigeben, frische Preview-URL fuer das komprimierte File.
    URL.revokeObjectURL(srcUrl);
    return { file: outFile, previewUrl: URL.createObjectURL(outFile) };
  } catch (err) {
    console.warn('Bild-Kompression fehlgeschlagen, Original wird verwendet:', err);
    return { file, previewUrl: srcUrl };
  }
};
