import { fehlerTextOderMessage } from '../../../utils/fehler';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonLabel,
  IonItem,
  IonTextarea,
  IonInput,
  IonProgressBar,
  IonSpinner
} from '@ionic/react';
import {
  ICON_BILD,
  ICON_GALERIE,
  ICON_HAKEN_GEFUELLT,
  ICON_KAMERA_GEFUELLT,
  ICON_LINK,
  ICON_LOESCHEN_GEFUELLT,
  ICON_MIKROFON,
  ICON_MIKROFON_GEFUELLT,
  ICON_MUSIK,
  ICON_PROFIL,
  ICON_SCHLIESSEN_GEFUELLT,
  ICON_SICHTBAR,
  ICON_SPERRE,
  ICON_TEXTDOKUMENT,
  ICON_VERBORGEN,
  ICON_VIDEO,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { track } from '../../../services/analytics';
import { compressImage } from '../../../services/mediaCompression';
import { pruefeMusikLink, ERLAUBTE_DIENSTE_TEXT } from '../../../utils/musikLinks';
import { getVisibilityInfo, getSuccessMessage } from '../../../utils/challengeTexte';
import { AudioPlayer } from '../../shared';
import { ohneSperre } from '../../../services/appSperre';
import type {
  KonfiChallenge,
  ChallengeMediaType,
  ChallengeConsent
} from '../../../types/challenges';

// Einreich-Modal für eine Challenge. Zeigt nur die von der Challenge erlaubten
// Medienarten (allowed_media). Bei visibility='konfi_choice' entscheidet der
// Konfi selbst über die Sichtbarkeit — Voreinstellung ist "Mit meinem Namen
// veroeffentlichen". Bei 'public'/'private' gibt es keine Wahl, sondern einen
// kompakten Hinweis-Chip im Kopf.

const MEDIA_OPTIONS: { value: ChallengeMediaType; label: string; icon: string; hint: string }[] = [
  { value: 'text', label: 'Text', icon: ICON_TEXTDOKUMENT, hint: 'Schreib deine Gedanken auf' },
  { value: 'photo', label: 'Foto', icon: ICON_BILD, hint: 'Aufnehmen oder aus der Galerie' },
  { value: 'audio', label: 'Audio', icon: ICON_MIKROFON, hint: 'Direkt aufnehmen' },
  { value: 'video', label: 'Video', icon: ICON_VIDEO, hint: 'Aufnehmen oder aus der Galerie' },
  { value: 'link', label: 'Link', icon: ICON_LINK, hint: 'Ein Lied von Spotify, Apple Music, YouTube Music oder Deezer' }
];

// Kurze Labels + kurzer Untertitel statt langer Erklaersaetze.
const CONSENT_OPTIONS: { value: ChallengeConsent; label: string; hint: string; icon: string }[] = [
  { value: 'publish', label: 'Öffentlich', hint: 'mit deinem Namen', icon: ICON_PROFIL },
  { value: 'anonymous', label: 'Anonym', hint: 'ohne Namen', icon: ICON_VERBORGEN },
  { value: 'private', label: 'Nur Leitung', hint: 'nicht in der Galerie', icon: ICON_SPERRE }
];

// Serverlimit laut Spec: 50 MB pro Datei.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Bevorzugter MIME-Type für die Audioaufnahme: audio/mp4 läuft auf iOS-WebView
// zuverlaessig (AVFoundation-Unterbau), audio/webm ist der Chromium/Android-Fallback.
const AUDIO_MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

const pickSupportedAudioMime = (): string | null => {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  return AUDIO_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) || null;
};

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

interface ChallengeSubmitModalProps {
  // Kann im ersten Render-Frame null sein: useIonModal reicht die Props des
  // Renders durch, in dem present() gerufen wurde — die im selben Handler
  // gesetzte Challenge kommt erst im Folge-Render an (Ionic rendert den
  // Modal-Inhalt bei Prop-Änderung neu). Deshalb ueberall null-sicher.
  challenge: KonfiChallenge | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface ChallengeSubmitFormProps {
  challenge: KonfiChallenge;
  onClose: () => void;
  onSuccess: () => void;
}

const ChallengeSubmitForm: React.FC<ChallengeSubmitFormProps> = ({
  challenge,
  onClose,
  onSuccess
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();

  const allowedMedia = useMemo<ChallengeMediaType[]>(() => {
    const list = Array.isArray(challenge.allowed_media) ? challenge.allowed_media : [];
    return list.length > 0 ? list : ['text'];
  }, [challenge.allowed_media]);

  const availableOptions = useMemo(
    () => MEDIA_OPTIONS.filter((o) => allowedMedia.includes(o.value)),
    [allowedMedia]
  );

  const [mediaType, setMediaType] = useState<ChallengeMediaType>(
    availableOptions[0]?.value || 'text'
  );
  const [textContent, setTextContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pickingMedia, setPickingMedia] = useState(false);
  const [consent, setConsent] = useState<ChallengeConsent>('publish');

  // --- Audio-Aufnahme (MediaRecorder) ---
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const isChoice = challenge.visibility === 'konfi_choice';
  const visibilityInfo = getVisibilityInfo(challenge);

  const resetMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    setFile(null);
    setLinkUrl('');
    setUploadProgress(0);
  };

  const stopRecordingTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const stopAudioStream = () => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  };

  // Aufräumen beim Unmount (Modal geschlossen während Aufnahme läuft).
  useEffect(() => {
    return () => {
      stopRecordingTimer();
      stopAudioStream();
    };
  }, []);

  const handleMediaTypeChange = (value: ChallengeMediaType) => {
    if (value === mediaType) return;
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      stopAudioStream();
      stopRecordingTimer();
      setIsRecording(false);
    }
    resetMedia();
    setMediaType(value);
  };

  // --- Gemeinsamer Datei-Picker für Foto und Video.
  //
  // Der Abbruch muss erkannt werden, weil manche WebViews kein 'cancel'-Event
  // feuern — sonst bliebe der Spinner nach einem Abbruch stehen. Frueher loeste
  // ein Fokus-Timeout nach 1 s pauschal mit null auf; dauerte die Auswahl laenger
  // (iOS-HEIC-Konvertierung, grosse Videos), war das Promise bereits erledigt und
  // die Auswahl wurde still verworfen — ohne Datei, ohne Fehlermeldung.
  //
  // Jetzt gewinnt immer die echte Auswahl: das native 'cancel'-Event löst sofort
  // auf, der Fokus-Fallback wartet grosszuegig (15 s) und prüft davor noch
  // einmal, ob inzwischen doch eine Datei angekommen ist.
  // ohneSperre: Die Dateiauswahl legt die App in den Hintergrund, ohne dass die
  // Person sie verlaesst — wer laenger in der Fotomediathek blaettert, saesse
  // beim Zurueckkommen sonst vor dem Sperrbildschirm (siehe services/appSperre).
  // Die Klammer endet genau dann, wenn das Versprechen einloest: Datei da,
  // abgebrochen oder Frist abgelaufen.
  const openFilePicker = (accept: string): Promise<File | null> => ohneSperre(() => {
    return new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;

      let settled = false;
      let focusTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (file: File | null) => {
        if (settled) return;
        settled = true;
        if (focusTimer) clearTimeout(focusTimer);
        window.removeEventListener('focus', onFocus);
        resolve(file);
      };

      const onFocus = () => {
        // Fokus zurück in der App: entweder wurde abgebrochen, oder die Auswahl
        // läuft noch (Konvertierung/Kopieren). Den Spinner nach kurzer Zeit
        // beenden, damit die Oberflaeche bei einem Abbruch nicht blockiert —
        // das Warten auf die Datei läuft davon unabhaengig weiter.
        setTimeout(() => { if (!settled) setPickingMedia(false); }, 1200);
        // Erst nach grosszuegiger Frist als Abbruch werten; 'onchange' darf
        // jederzeit vorher gewinnen.
        focusTimer = setTimeout(() => {
          const late = input.files?.[0];
          finish(late || null);
        }, 15000);
      };

      input.onchange = (event: Event) => {
        const target = event.target as HTMLInputElement;
        finish(target.files?.[0] || null);
      };
      // Natives Abbruch-Event (moderne WebViews) — sofortige, verlaessliche Antwort.
      input.oncancel = () => finish(null);

      window.addEventListener('focus', onFocus, { once: true });
      input.click();
    });
  });

  // --- Foto: verstecktes <input type="file"> statt Capacitor Camera.getPhoto.
  // Camera.getPhoto mit CameraSource.Prompt schlug in TestFlight beim Antippen
  // sofort mit "Foto konnte nicht ausgewaehlt werden" fehl. Die Anträge
  // (ActivityRequestModal) nutzen erwiesenermassen zuverlaessig dieses
  // input-file-Muster — iOS zeigt damit nativ Fotomediathek/Kamera/Datei an. ---
  const pickPhoto = async () => {
    setPickingMedia(true);
    try {
      const selected = await openFilePicker('image/*');
      if (!selected) return;
      // Spaet eingetroffene Auswahl: Spinner wieder anzeigen (der Fokus-Fallback
      // hat ihn ggf. schon beendet), das finally setzt ihn zuverlaessig zurück.
      setPickingMedia(true);
      const { file: compressed, previewUrl } = await compressImage(selected);
      if (compressed.size > MAX_UPLOAD_BYTES) {
        URL.revokeObjectURL(previewUrl);
        setError('Datei ist zu groß (max. 50 MB).');
        return;
      }
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
      setFile(compressed);
      setMediaPreview(previewUrl);
    } catch {
      setError('Foto konnte nicht ausgewählt werden');
    } finally {
      setPickingMedia(false);
    }
  };

  // --- Video: natives Picker-Sheet (kein capture-Attribut, damit iOS die
  // volle Auswahl "Fotomediathek / Kamera aufnehmen / Datei waehlen" zeigt) ---
  const pickVideo = async () => {
    setPickingMedia(true);
    try {
      const selected = await openFilePicker('video/*');
      if (!selected) return;
      setPickingMedia(true);
      if (selected.size > MAX_UPLOAD_BYTES) {
        setError('Datei ist zu groß (max. 50 MB).');
        return;
      }
      if (mediaPreview) URL.revokeObjectURL(mediaPreview);
      setFile(selected);
      setMediaPreview(URL.createObjectURL(selected));
    } catch {
      setError('Video konnte nicht ausgewählt werden');
    } finally {
      setPickingMedia(false);
    }
  };

  // --- Audio: Direktaufnahme ---
  const startRecording = async () => {
    try {
      const mimeType = pickSupportedAudioMime();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopAudioStream();
        const usedMime = recorder.mimeType || mimeType || 'audio/mp4';
        const extension = usedMime.includes('webm') ? 'webm' : 'm4a';
        const blob = new Blob(recordedChunksRef.current, { type: usedMime });
        const audioFile = new File([blob], `challenge-audio.${extension}`, { type: usedMime });
        if (mediaPreview) URL.revokeObjectURL(mediaPreview);
        setFile(audioFile);
        setMediaPreview(URL.createObjectURL(audioFile));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      stopRecordingTimer();
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (/permission|denied/i.test(message)) {
        setError('Zugriff aufs Mikrofon wurde nicht erlaubt.');
      } else {
        setError('Aufnahme konnte nicht gestartet werden');
      }
    }
  };

  const stopRecording = () => {
    stopRecordingTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const removeFile = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
    setFile(null);
    setRecordSeconds(0);
  };

  const isValid = (): boolean => {
    if (mediaType === 'text') return textContent.trim().length > 0;
    if (mediaType === 'link') return linkUrl.trim().length > 0;
    return !!file;
  };

  const handleSubmit = () => {
    if (!isOnline) {
      setError('Einreichen nicht möglich — du bist offline');
      return;
    }
    if (!isValid()) {
      if (mediaType === 'text') setError('Bitte schreib etwas, bevor du einreichst');
      else if (mediaType === 'link') setError('Bitte gib einen Link an');
      else setError('Bitte wähle eine Datei aus');
      return;
    }
    // Vorab-Pruefung gegen die Erlaubnisliste — verbindlich prueft der Server
    // noch einmal dasselbe. So kommt die Rueckmeldung, ohne dass der Beitrag
    // erst abgeschickt werden muss.
    if (mediaType === 'link' && !pruefeMusikLink(linkUrl).ok) {
      setError(`Hier gehen nur Musik-Links: ${ERLAUBTE_DIENSTE_TEXT}. Bitte teile den Link direkt aus einer dieser Apps.`);
      return;
    }

    guard(async () => {
      setUploadProgress(0);
      try {
        if (mediaType === 'text' || mediaType === 'link') {
          // JSON-Pfad (kein Upload)
          await api.post(`/challenges/konfi/${challenge.id}/submissions`, {
            media_type: mediaType,
            text_content: textContent.trim() || null,
            link_url: mediaType === 'link' ? linkUrl.trim() : null,
            konfi_consent: isChoice ? consent : null
          });
        } else {
          // Multipart-Pfad (Feld 'file' laut API-Vertrag)
          const formData = new FormData();
          formData.append('file', file as File);
          formData.append('media_type', mediaType);
          if (textContent.trim()) formData.append('text_content', textContent.trim());
          if (isChoice) formData.append('konfi_consent', consent);

          await api.post(`/challenges/konfi/${challenge.id}/submissions`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            // Medien-Uploads können auf Mobilfunk deutlich laenger dauern als
            // die globalen 20s.
            timeout: 180000,
            onUploadProgress: (event) => {
              if (event.total) {
                setUploadProgress(Math.round((event.loaded * 100) / event.total));
              }
            }
          });
        }

        // Anonyme Messung: WELCHE Medienart wird genutzt und wie entscheiden
        // sich die Konfis bei der Sichtbarkeit. Kein Inhalt, keine Kennung.
        track('challenge-beitrag', {
          medium: mediaType,
          sichtbarkeit: isChoice ? consent : 'publish'
        });
        setSuccess(getSuccessMessage(challenge, isChoice ? consent : 'publish'));
        if (mediaPreview) URL.revokeObjectURL(mediaPreview);
        onSuccess();
      } catch (err) {
        setError(fehlerTextOderMessage(err, 'Fehler beim Einreichen'));
      } finally {
        setUploadProgress(0);
      }
    }).catch(() => {
      // guard wirft, wenn bereits eine Aktion läuft — bewusst ignorieren.
    });
  };

  const currentOption = availableOptions.find((o) => o.value === mediaType);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Dein Beitrag</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={ICON_SCHLIESSEN_GEFUELLT} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Beitrag einreichen"
              className="app-modal-submit-btn app-modal-submit-btn--challenges"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              <IonIcon icon={ICON_HAKEN_GEFUELLT} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
        {isSubmitting && uploadProgress > 0 && (
          <IonProgressBar value={uploadProgress / 100} />
        )}
      </IonHeader>

      <IonContent className="app-gradient-background">

        <div className="app-header-banner app-header-banner--challenges">
          <div className="app-header-banner__circle-top" />
          <div className="app-header-banner__circle-bottom" />
          <div className="app-header-banner__header">
            <div className="app-header-banner__icon">
              <IonIcon icon={ICON_TEXTDOKUMENT} />
            </div>
            <div>
              <h2 className="app-header-banner__title">{challenge.title}</h2>
              <p className="app-header-banner__subtitle">{visibilityInfo}</p>
            </div>
          </div>
        </div>

        {/* Medienart */}
        {availableOptions.length > 1 && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--challenges">
                <IonIcon icon={ICON_GALERIE} />
              </div>
              <IonLabel>Wie möchtest du antworten?</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {availableOptions.map((option) => {
                    const isSelected = option.value === mediaType;
                    return (
                      <div
                        key={option.value}
                        className={`app-list-item app-list-item--challenges${isSelected ? ' app-list-item--selected' : ''}`}
                        onClick={() => handleMediaTypeChange(option.value)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="app-list-item__row">
                          <div className="app-list-item__main">
                            <div className="app-icon-circle app-icon-circle--challenges">
                              <IonIcon icon={option.icon} />
                            </div>
                            <div className="app-list-item__content">
                              <div className="app-list-item__title">{option.label}</div>
                              <div className="app-list-item__subtitle">{option.hint}</div>
                            </div>
                            {isSelected && (
                              <IonIcon
                                icon={ICON_ZUSAGE_GEFUELLT}
                                className="app-icon-color--challenges"
                                style={{ fontSize: 'var(--app-text-titel)', flexShrink: 0 }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Eingabe je nach Medienart */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--challenges">
              <IonIcon icon={currentOption?.icon || ICON_TEXTDOKUMENT} />
            </div>
            <IonLabel>
              {mediaType === 'text' ? 'Dein Text'
                : mediaType === 'link' ? 'Dein Link'
                : mediaType === 'photo' ? 'Dein Foto'
                : mediaType === 'audio' ? 'Deine Aufnahme'
                : 'Dein Video'}
            </IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>

              {mediaType === 'text' && (
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonTextarea
                    value={textContent}
                    onIonInput={(e) => setTextContent(e.detail.value || '')}
                    placeholder="Schreib hier deinen Beitrag..."
                    autoGrow={true}
                    rows={5}
                  />
                </IonItem>
              )}

              {mediaType === 'link' && (
                <>
                  {/* Was geht, steht HIER — bevor jemand einen Link einwirft
                      und erst die Fehlermeldung es ihm sagt. */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 'var(--app-abstand-kompakt)',
                      padding: 'var(--app-abstand-winzig) var(--app-abstand-basis) var(--app-abstand-kompakt) var(--app-abstand-basis)',
                      fontSize: 'var(--app-text-hinweis)', color: 'var(--ion-color-medium)', lineHeight: 1.4
                    }}
                  >
                    <IonIcon icon={ICON_MUSIK} style={{ flexShrink: 0, marginTop: 'var(--app-abstand-winzig)' }} />
                    <span>
                      Erlaubt sind Musik-Links von {ERLAUBTE_DIENSTE_TEXT}.
                      Titel und Interpret werden automatisch dazugeschrieben.
                    </span>
                  </div>
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonInput
                      type="url"
                      inputmode="url"
                      value={linkUrl}
                      onIonInput={(e) => setLinkUrl(e.detail.value || '')}
                      placeholder="https://..."
                      autocapitalize="off"
                    />
                  </IonItem>
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonTextarea
                      value={textContent}
                      onIonInput={(e) => setTextContent(e.detail.value || '')}
                      placeholder="Warum dieser Link? (optional)"
                      autoGrow={true}
                      rows={2}
                    />
                  </IonItem>
                </>
              )}

              {mediaType === 'photo' && (
                <>
                  <div
                    onClick={() => !pickingMedia && !mediaPreview && pickPhoto()}
                    style={{
                      padding: mediaPreview ? '0' : 'var(--app-abstand-basis)',
                      backgroundColor: 'transparent',
                      borderRadius: 'var(--app-radius-knopf)',
                      border: mediaPreview ? 'none' : '1px dashed var(--app-border-strong)',
                      cursor: mediaPreview ? 'default' : 'pointer',
                      overflow: 'hidden'
                    }}
                  >
                    {mediaPreview ? (
                      <div style={{ position: 'relative' }}>
                        <img
                          src={mediaPreview}
                          alt="Dein Foto"
                          style={{
                            width: '100%', maxHeight: '280px', objectFit: 'cover',
                            borderRadius: 'var(--app-radius-knopf)', display: 'block'
                          }}
                        />
                        <IonButton
                          fill="solid"
                          color="danger"
                          size="small"
                          onClick={(e) => { e.stopPropagation(); removeFile(); }}
                          aria-label="Bild entfernen"
                          style={{ position: 'absolute', top: '8px', right: '8px', '--border-radius': '8px' }}
                        >
                          <IonIcon icon={ICON_LOESCHEN_GEFUELLT} slot="icon-only" />
                        </IonButton>
                      </div>
                    ) : (
                      <div className="app-settings-item" style={{ justifyContent: 'center' }}>
                        {pickingMedia ? (
                          <IonSpinner name="dots" />
                        ) : (
                          <>
                            <IonIcon
                              icon={ICON_KAMERA_GEFUELLT}
                              className="app-icon-color--challenges"
                              style={{ fontSize: 'var(--app-text-untertitel)' }}
                            />
                            <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)' }}>
                              Foto hinzufügen
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <IonItem lines="none" style={{ '--background': 'transparent', marginTop: 'var(--app-abstand-eng)' }}>
                    <IonTextarea
                      value={textContent}
                      onIonInput={(e) => setTextContent(e.detail.value || '')}
                      placeholder="Etwas dazu sagen? (optional)"
                      autoGrow={true}
                      rows={2}
                    />
                  </IonItem>
                </>
              )}

              {mediaType === 'video' && (
                <>
                  <div
                    onClick={() => !pickingMedia && !mediaPreview && pickVideo()}
                    style={{
                      padding: mediaPreview ? '0' : 'var(--app-abstand-basis)',
                      backgroundColor: 'transparent',
                      borderRadius: 'var(--app-radius-knopf)',
                      border: mediaPreview ? 'none' : '1px dashed var(--app-border-strong)',
                      cursor: mediaPreview ? 'default' : 'pointer',
                      overflow: 'hidden'
                    }}
                  >
                    {mediaPreview ? (
                      <div style={{ position: 'relative' }}>
                        <video
                          src={mediaPreview}
                          controls
                          style={{
                            width: '100%', maxHeight: '280px',
                            borderRadius: 'var(--app-radius-knopf)', display: 'block', background: 'black'
                          }}
                        />
                        <IonButton
                          fill="solid"
                          color="danger"
                          size="small"
                          onClick={(e) => { e.stopPropagation(); removeFile(); }}
                          aria-label="Video entfernen"
                          style={{ position: 'absolute', top: '8px', right: '8px', '--border-radius': '8px' }}
                        >
                          <IonIcon icon={ICON_LOESCHEN_GEFUELLT} slot="icon-only" />
                        </IonButton>
                      </div>
                    ) : (
                      <div className="app-settings-item" style={{ justifyContent: 'center' }}>
                        {pickingMedia ? (
                          <IonSpinner name="dots" />
                        ) : (
                          <>
                            <IonIcon
                              icon={ICON_VIDEO}
                              className="app-icon-color--challenges"
                              style={{ fontSize: 'var(--app-text-untertitel)' }}
                            />
                            <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)' }}>
                              Video hinzufügen
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <IonItem lines="none" style={{ '--background': 'transparent', marginTop: 'var(--app-abstand-eng)' }}>
                    <IonTextarea
                      value={textContent}
                      onIonInput={(e) => setTextContent(e.detail.value || '')}
                      placeholder="Etwas dazu sagen? (optional)"
                      autoGrow={true}
                      rows={2}
                    />
                  </IonItem>
                </>
              )}

              {mediaType === 'audio' && (
                <>
                  <div
                    onClick={() => {
                      if (mediaPreview) return;
                      if (isRecording) stopRecording();
                      else startRecording();
                    }}
                    style={{
                      padding: mediaPreview ? 'var(--app-abstand-schmal) var(--app-abstand-mittel)' : 'var(--app-abstand-basis)',
                      backgroundColor: mediaPreview
                        ? 'rgba(0, 0, 0, 0.04)'
                        : isRecording
                          ? 'rgba(var(--app-color-danger-rgb), 0.08)'
                          : 'transparent',
                      borderRadius: 'var(--app-radius-knopf)',
                      border: mediaPreview || isRecording ? 'none' : '1px dashed var(--app-border-strong)',
                      cursor: mediaPreview ? 'default' : 'pointer'
                    }}
                  >
                    {mediaPreview ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-eng)' }}>
                          <span style={{ fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-ios)', flex: 1, fontSize: 'var(--app-text-basis)' }}>
                            Aufnahme bereit
                          </span>
                          <IonButton fill="clear" color="danger" size="small" onClick={(e) => { e.stopPropagation(); removeFile(); }} aria-label="Aufnahme entfernen">
                            <IonIcon icon={ICON_LOESCHEN_GEFUELLT} slot="icon-only" />
                          </IonButton>
                        </div>
                        <AudioPlayer src={mediaPreview} />
                      </>
                    ) : isRecording ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-schmal)', justifyContent: 'center' }}>
                        <span
                          style={{
                            width: '10px', height: '10px', borderRadius: 'var(--app-radius-kreis)',
                            background: 'var(--app-color-danger)', flexShrink: 0
                          }}
                          className="app-recording-dot"
                        />
                        <span style={{ fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-color-danger)' }}>
                          {formatDuration(recordSeconds)}
                        </span>
                        <span style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-color-danger)' }}>
                          Antippen zum Stoppen
                        </span>
                      </div>
                    ) : (
                      <div className="app-settings-item" style={{ justifyContent: 'center' }}>
                        <IonIcon
                          icon={ICON_MIKROFON_GEFUELLT}
                          className="app-icon-color--challenges"
                          style={{ fontSize: 'var(--app-text-untertitel)' }}
                        />
                        <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)' }}>
                          Tippen zum Aufnehmen
                        </span>
                      </div>
                    )}
                  </div>
                  <IonItem lines="none" style={{ '--background': 'transparent', marginTop: 'var(--app-abstand-eng)' }}>
                    <IonTextarea
                      value={textContent}
                      onIonInput={(e) => setTextContent(e.detail.value || '')}
                      placeholder="Etwas dazu sagen? (optional)"
                      autoGrow={true}
                      rows={2}
                    />
                  </IonItem>
                </>
              )}

            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Sichtbarkeit */}
        {isChoice && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--challenges">
                <IonIcon icon={ICON_SICHTBAR} />
              </div>
              <IonLabel>Wer sieht deinen Beitrag?</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {CONSENT_OPTIONS.map((option) => {
                    const isSelected = option.value === consent;
                    return (
                      <div
                        key={option.value}
                        className={`app-list-item app-list-item--challenges${isSelected ? ' app-list-item--selected' : ''}`}
                        onClick={() => setConsent(option.value)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="app-list-item__row">
                          <div className="app-list-item__main">
                            <div className="app-icon-circle app-icon-circle--challenges">
                              <IonIcon icon={option.icon} />
                            </div>
                            <div className="app-list-item__content">
                              <div className="app-list-item__title">{option.label}</div>
                              <div className="app-list-item__subtitle">{option.hint}</div>
                            </div>
                            {isSelected && (
                              <IonIcon
                                icon={ICON_ZUSAGE_GEFUELLT}
                                className="app-icon-color--challenges"
                                style={{ fontSize: 'var(--app-text-titel)', flexShrink: 0 }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

      </IonContent>
    </IonPage>
  );
};

/**
 * Huelle um das Formular. Solange die Challenge noch nicht durchgereicht ist,
 * wird nur ein leerer Rahmen gezeigt; über den key remountet das Formular
 * sauber, sobald (bzw. wenn eine andere) Challenge ankommt — so starten
 * Medienauswahl und Sichtbarkeits-Vorauswahl mit den richtigen Werten.
 */
const ChallengeSubmitModal: React.FC<ChallengeSubmitModalProps> = ({
  challenge,
  onClose,
  onSuccess
}) => {
  if (!challenge) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Dein Beitrag</IonTitle>
            <IonButtons slot="start">
              <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose}>
                <IonIcon icon={ICON_SCHLIESSEN_GEFUELLT} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="app-gradient-background">
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-riesig)' }}>
            <IonSpinner name="crescent" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <ChallengeSubmitForm
      key={challenge.id}
      challenge={challenge}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
};

export default ChallengeSubmitModal;
