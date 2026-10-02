// Clientseitige Bild-Kompression vor dem Upload.
//
// Ziel: Chat-Uploads klein halten (Traffic + Speicher). Bilder werden auf eine
// maximale lange Kante von 1920px herunterskaliert und als JPEG (~0.8 Qualitaet)
// kodiert. PNGs mit Transparenz bleiben PNG (sonst wuerde der transparente
// Hintergrund schwarz), alle anderen werden zu JPEG konvertiert.
//
// Videos lassen sich im WebView nicht sinnvoll transkodieren (kein Canvas-Weg,
// ffmpeg.wasm wäre zu gross/langsam auf Mobilgeraeten) -> hier NICHT behandelt.
//
// Videos auch dort nicht: Im WebView gibt es keinen Weg, ein Video neu zu
// kodieren, der ohne neue Abhängigkeit trägt. MediaRecorder über ein Canvas
// nimmt in Echtzeit neu auf (ein 50-MB-Video dauert so lange, wie es läuft,
// der Ton muss getrennt mit), WebCodecs kodiert nur und bräuchte für die
// MP4-Datei einen eigenen Muxer, ffmpeg.wasm bringt rund 30 MB mit, ein
// natives Plugin wäre eine neue Abhängigkeit. Es bleibt bei der Grenze:
// Chat 5 MB, Challenges 50 MB — wie auf dem Server.

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.8;

// Bilder ab dieser Kantenlaenge ODER Größe werden überhaupt angefasst. Kleine
// Bilder (Screenshots, bereits komprimierte) bleiben unverändert -> kein
// Qualitaetsverlust durch unnoetiges Re-Encoding.
const SIZE_THRESHOLD = 500 * 1024; // 500 KB

/**
 * Größte Datei je Ziel, in Bytes — dieselben Werte wie auf dem Server
 * (backend/createApp.js: chatUpload 5 MB, CHALLENGE_UPLOAD_LIMIT 50 MB,
 * requestUpload 5 MB für das Nachweisfoto eines Antrags, materialUpload
 * 20 MB je Material-Datei).
 */
export const UPLOAD_GRENZE = {
  chat: 5 * 1024 * 1024,
  challenges: 50 * 1024 * 1024,
  nachweisfoto: 5 * 1024 * 1024,
  material: 20 * 1024 * 1024,
} as const;

/**
 * "Datei ist zu groß (max. 5 MB)." — für Chat und Challenges derselbe Satz,
 * wörtlich wie in der Antwort des Servers (createApp.js, LIMIT_FILE_SIZE).
 */
export const zuGrossText = (maxBytes: number): string =>
  `Datei ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).`;

/** Die Datei ist auch nach dem Verkleinern größer als erlaubt. */
export class DateiZuGrossFehler extends Error {
  constructor(maxBytes: number) {
    super(zuGrossText(maxBytes));
    this.name = 'DateiZuGrossFehler';
  }
}

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

// Prueft, ob ein Bild (teil-)transparente Pixel enthält. Nur dann muss PNG
// erhalten bleiben; sonst ist JPEG deutlich kleiner.
const hasTransparency = (ctx: CanvasRenderingContext2D, width: number, height: number): boolean => {
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    // Jeden 4. Wert (Alpha) prüfen; aus Performancegruenden in groben Schritten.
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
 * Eine ausgewählte Datei für den Upload vorbereiten — Chat, Challenges und
 * das Nachweisfoto eines Antrags derselbe Weg: Fotos verkleinern
 * (compressImage), DANN gegen die Grenze prüfen. Ein Handyfoto mit 8 MB passt
 * nach dem Verkleinern locker; eine Prüfung davor ließe es scheitern.
 *
 * Liefert bei Fotos eine Vorschau-URL (der Aufrufer gibt sie frei), sonst
 * null. Scheitert das Verkleinern, geht das Original weiter. Wirft
 * DateiZuGrossFehler, wenn die Datei danach noch zu groß ist.
 */
export const fuerUploadVorbereiten = async (
  file: File,
  maxBytes: number
): Promise<{ file: File; bildVorschau: string | null }> => {
  let fertig = file;
  let bildVorschau: string | null = null;
  if (file.type.startsWith('image/')) {
    try {
      const ergebnis = await compressImage(file);
      fertig = ergebnis.file;
      bildVorschau = ergebnis.previewUrl;
    } catch {
      fertig = file;
      bildVorschau = URL.createObjectURL(file);
    }
  }

  if (fertig.size > maxBytes) {
    if (bildVorschau) URL.revokeObjectURL(bildVorschau);
    throw new DateiZuGrossFehler(maxBytes);
  }
  return { file: fertig, bildVorschau };
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

    // Alte Quell-URL freigeben, frische Preview-URL für das komprimierte File.
    URL.revokeObjectURL(srcUrl);
    return { file: outFile, previewUrl: URL.createObjectURL(outFile) };
  } catch (err) {
    console.warn('Bild-Kompression fehlgeschlagen, Original wird verwendet:', err);
    return { file, previewUrl: srcUrl };
  }
};
