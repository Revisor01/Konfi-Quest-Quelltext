import React, { useState, useEffect, useRef } from 'react';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonPage,
  IonButtons,
  IonButton,
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonToggle,
  IonCard,
  IonCardContent,
  IonIcon,
  IonText,
  IonSpinner,
  IonList,
  IonListHeader,
  IonAccordion,
  IonAccordionGroup,
  IonDatetime,
  IonDatetimeButton,
  IonModal
} from '@ionic/react';
import {
  checkmarkOutline,
  closeOutline,
  flag,
  eyeOutline,
  imagesOutline,
  peopleOutline,
  calendarOutline,
  chevronDownOutline,
  ribbonOutline,
  schoolOutline,
  // Icon-Auswahl (identische Auswahl wie im Badge-Modal)
  trophy,
  medal,
  ribbon,
  star,
  checkmarkCircle,
  diamond,
  shield,
  flame,
  flash,
  rocket,
  sparkles,
  thumbsUp,
  heart,
  people,
  personAdd,
  chatbubbles,
  gift,
  book,
  school,
  construct,
  brush,
  colorPalette,
  sunny,
  moon,
  leaf,
  rose,
  calendar,
  today,
  time,
  timer,
  stopwatch,
  restaurant,
  fitness,
  bicycle,
  car,
  airplane,
  boat,
  camera,
  image,
  musicalNote,
  balloon,
  home,
  business,
  location,
  navigate,
  compass,
  pin,
  informationCircle,
  helpCircle,
  alertCircle,
  hammer
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import type {
  AdminChallenge,
  ChallengeAudience,
  ChallengeVisibility,
  ChallengeMediaType
} from '../../../types/challenges';
import { getChallengeStatus } from '../views/ChallengesManageView';
import {
  baueChallengePayload,
  istChallengeFormularGueltig,
  istNurTeam,
  zeitraumFehler
} from '../../../utils/challengeForm';

// Icon-Auswahl: identisches Pattern und identischer Vorrat wie BadgeManagementModal,
// damit Challenge-Stempel und Abzeichen dieselbe Bildsprache haben.
const CHALLENGE_ICONS: Record<string, { icon: string; name: string; category: string }> = {
  flag: { icon: flag, name: 'Flagge', category: 'Challenge' },
  sparkles: { icon: sparkles, name: 'Funken', category: 'Challenge' },
  compass: { icon: compass, name: 'Kompass', category: 'Challenge' },
  rocket: { icon: rocket, name: 'Rakete', category: 'Challenge' },
  flame: { icon: flame, name: 'Flamme', category: 'Challenge' },

  trophy: { icon: trophy, name: 'Pokal', category: 'Erfolg' },
  medal: { icon: medal, name: 'Medaille', category: 'Erfolg' },
  ribbon: { icon: ribbon, name: 'Band', category: 'Erfolg' },
  star: { icon: star, name: 'Stern', category: 'Erfolg' },
  checkmarkCircle: { icon: checkmarkCircle, name: 'Bestanden', category: 'Erfolg' },
  diamond: { icon: diamond, name: 'Diamant', category: 'Erfolg' },
  shield: { icon: shield, name: 'Schild', category: 'Erfolg' },

  flash: { icon: flash, name: 'Blitz', category: 'Engagement' },
  thumbsUp: { icon: thumbsUp, name: 'Daumen hoch', category: 'Engagement' },
  heart: { icon: heart, name: 'Herz', category: 'Gemeinschaft' },
  people: { icon: people, name: 'Gruppe', category: 'Gemeinschaft' },
  personAdd: { icon: personAdd, name: 'Neue Person', category: 'Gemeinschaft' },
  chatbubbles: { icon: chatbubbles, name: 'Chat', category: 'Gemeinschaft' },
  gift: { icon: gift, name: 'Geschenk', category: 'Gemeinschaft' },

  book: { icon: book, name: 'Buch', category: 'Lernen' },
  school: { icon: school, name: 'Schule', category: 'Lernen' },
  construct: { icon: construct, name: 'Werkzeug', category: 'Lernen' },
  brush: { icon: brush, name: 'Pinsel', category: 'Lernen' },
  colorPalette: { icon: colorPalette, name: 'Farbpalette', category: 'Lernen' },

  sunny: { icon: sunny, name: 'Sonne', category: 'Natur' },
  moon: { icon: moon, name: 'Mond', category: 'Natur' },
  leaf: { icon: leaf, name: 'Blatt', category: 'Natur' },
  rose: { icon: rose, name: 'Rose', category: 'Natur' },

  calendar: { icon: calendar, name: 'Kalender', category: 'Zeit' },
  today: { icon: today, name: 'Heute', category: 'Zeit' },
  time: { icon: time, name: 'Uhr', category: 'Zeit' },
  timer: { icon: timer, name: 'Timer', category: 'Zeit' },
  stopwatch: { icon: stopwatch, name: 'Stoppuhr', category: 'Zeit' },

  restaurant: { icon: restaurant, name: 'Restaurant', category: 'Aktivitäten' },
  fitness: { icon: fitness, name: 'Fitness', category: 'Aktivitäten' },
  bicycle: { icon: bicycle, name: 'Fahrrad', category: 'Aktivitäten' },
  car: { icon: car, name: 'Auto', category: 'Aktivitäten' },
  airplane: { icon: airplane, name: 'Flugzeug', category: 'Aktivitäten' },
  boat: { icon: boat, name: 'Boot', category: 'Aktivitäten' },
  camera: { icon: camera, name: 'Kamera', category: 'Aktivitäten' },
  image: { icon: image, name: 'Bild', category: 'Aktivitäten' },
  musicalNote: { icon: musicalNote, name: 'Musik', category: 'Aktivitäten' },
  balloon: { icon: balloon, name: 'Ballon', category: 'Aktivitäten' },

  home: { icon: home, name: 'Zuhause', category: 'Orte' },
  business: { icon: business, name: 'Gebäude', category: 'Orte' },
  location: { icon: location, name: 'Standort', category: 'Orte' },
  navigate: { icon: navigate, name: 'Navigation', category: 'Orte' },
  pin: { icon: pin, name: 'Pin', category: 'Orte' },

  informationCircle: { icon: informationCircle, name: 'Info', category: 'Sonstiges' },
  helpCircle: { icon: helpCircle, name: 'Hilfe', category: 'Sonstiges' },
  alertCircle: { icon: alertCircle, name: 'Warnung', category: 'Sonstiges' },
  hammer: { icon: hammer, name: 'Hammer', category: 'Sonstiges' }
};

export const getChallengeIcon = (iconName?: string): string =>
  CHALLENGE_ICONS[iconName || '']?.icon || flag;

const AUDIENCE_OPTIONS: { value: ChallengeAudience; label: string; hint: string }[] = [
  {
    value: 'konfis_und_team',
    label: 'Jahrgang und Team',
    hint: 'Die Konfis der gewählten Jahrgänge und ihr im Team — alle reichen gleichberechtigt ein.'
  },
  {
    value: 'nur_team',
    label: 'Nur das Team',
    hint: 'Eine Runde für euch im Team. Die Konfis sehen diese Challenge nicht, eine Jahrgangs-Auswahl entfällt.'
  }
];

const VISIBILITY_OPTIONS: { value: ChallengeVisibility; label: string; hint: string }[] = [
  {
    value: 'public',
    label: 'Öffentlich',
    hint: 'Freigegebene Beiträge sind für alle Konfis der zugewiesenen Jahrgänge sichtbar.'
  },
  {
    value: 'konfi_choice',
    label: 'Selbst entscheiden',
    hint: 'Wer einreicht, wählt selbst: nur für die Leitung, mit Namen oder anonym.'
  },
  {
    value: 'private',
    label: 'Nur Leitung',
    hint: 'Beiträge sehen nur die Leitung und der Konfi selbst — es gibt keine Galerie.'
  }
];

const MEDIA_OPTIONS: { value: ChallengeMediaType; label: string; hint: string }[] = [
  { value: 'text', label: 'Text', hint: 'Geschriebene Beiträge' },
  { value: 'photo', label: 'Foto', hint: 'Aufnahme oder Bild aus der Galerie' },
  { value: 'audio', label: 'Audio', hint: 'Sprachaufnahme oder Musikdatei (Upload)' },
  { value: 'video', label: 'Video', hint: 'Videodatei (Upload)' },
  { value: 'link', label: 'Link', hint: 'Verweis auf eine Seite, ein Lied oder ein Video' }
];

interface Jahrgang {
  id: number;
  name: string;
}

interface ChallengeManageModalProps {
  challenge?: AdminChallenge | null;
  onClose: () => void;
  onSuccess: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

// Lokale Zeit im Format, das IonDatetime erwartet (ohne Zeitzonen-Versatz).
const toIonDatetimeISO = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
};

const ChallengeManageModal: React.FC<ChallengeManageModalProps> = ({
  challenge,
  onClose,
  onSuccess,
  onDirtyChange
}) => {
  const { setError } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const initializedRef = useRef(false);

  const isEditMode = !!challenge;
  // Nach dem Start sind visibility/moderated/starts_at/allowed_media gesperrt —
  // das Backend antwortet dort mit 409. Entwuerfe und noch nicht gestartete
  // (geplante) Challenges bleiben vollstaendig editierbar.
  // Das Backend liefert `locked` bereits mit — dessen Urteil hat Vorrang, die
  // lokale Ableitung ist nur der Fallback (z.B. bei Offline-Cache ohne Feld).
  const challengeStatus = challenge ? getChallengeStatus(challenge) : null;
  const isStarted = typeof challenge?.locked === 'boolean'
    ? challenge.locked
    : (challengeStatus === 'active' || challengeStatus === 'ended');

  const [jahrgaenge, setJahrgaenge] = useState<Jahrgang[]>([]);

  // Bewusst OHNE challenge_type: die Typen (Wahrnehmung/Beitrag/Praxis) hatten
  // nie einen funktionalen Effekt und sind aus dem Formular gestrichen
  // (User-Entscheid 07.08.). Die Spalte bleibt im Backend bestehen.
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    // Standard: das Team ist immer dabei (User-Entscheid 09.08.).
    audience: 'konfis_und_team' as ChallengeAudience,
    visibility: 'konfi_choice' as ChallengeVisibility,
    moderated: true,
    allowed_media: ['text', 'photo'] as ChallengeMediaType[],
    allow_multiple: true,
    badge_icon: 'flag',
    badge_name: '',
    // Urheber ist ein OPTIONALES Freitextfeld (User-Entscheid 06.08.) — die
    // fruehere User-Auswahl war zu lang/komplex fuers Modal. author_user_id
    // wird beim Speichern immer auf null gesetzt, der Name lebt im Freitext.
    author_freetext: '',
    jahrgang_ids: [] as number[],
    starts_at: '',
    ends_at: '',
    is_draft: false
  });

  useEffect(() => {
    if (initializedRef.current) setIsDirty(true);
  }, [formData]);

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      await loadInitialData();
      if (challenge) {
        setFormData({
          title: challenge.title || '',
          description: challenge.description || '',
          // Alt-Challenges ohne Team-Teilnahme ('konfis') gibt es noch in der DB;
          // im Formular werden sie als "Jahrgang und Team" angezeigt und beim
          // nächsten Speichern (vor Start) auch so uebernommen.
          audience: challenge.audience === 'nur_team' ? 'nur_team' : 'konfis_und_team',
          visibility: (challenge.visibility as ChallengeVisibility) || 'konfi_choice',
          moderated: challenge.moderated !== false,
          allowed_media: (challenge.allowed_media as ChallengeMediaType[]) || ['text', 'photo'],
          allow_multiple: challenge.allow_multiple !== false,
          badge_icon: challenge.badge_icon || 'flag',
          badge_name: challenge.badge_name || '',
          // Bestehende User-Urheber flieszen als aufgeloester Name (author_name)
          // in den Freitext ein — es geht beim Umstieg nichts verloren.
          author_freetext: challenge.author_freetext || challenge.author_name || '',
          jahrgang_ids: (challenge.jahrgaenge || []).map((j) => j.id),
          starts_at: challenge.starts_at ? toIonDatetimeISO(new Date(challenge.starts_at)) : '',
          ends_at: challenge.ends_at ? toIonDatetimeISO(new Date(challenge.ends_at)) : '',
          is_draft: challenge.is_draft === true
        });
      } else {
        // Neue Challenge: Start morgen, Ende in zwei Wochen — bewusst runde Zeiten.
        const start = new Date();
        start.setDate(start.getDate() + 1);
        start.setHours(9, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 14);
        end.setHours(20, 0, 0, 0);
        setFormData((prev) => ({
          ...prev,
          starts_at: toIonDatetimeISO(start),
          ends_at: toIonDatetimeISO(end)
        }));
      }
      setInitialLoading(false);
      setTimeout(() => { initializedRef.current = true; }, 100);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id]);

  const loadInitialData = async () => {
    try {
      const jahrgaengeRes = await api.get('/admin/jahrgaenge').catch(() => ({ data: [] }));
      setJahrgaenge(Array.isArray(jahrgaengeRes.data) ? jahrgaengeRes.data : []);
    } catch (err) {
      console.error('Fehler beim Laden der Challenge-Stammdaten:', err);
    }
  };

  const toggleMedia = (value: ChallengeMediaType) => {
    if (isStarted || loading) return;
    setFormData((prev) => ({
      ...prev,
      allowed_media: prev.allowed_media.includes(value)
        ? prev.allowed_media.filter((m) => m !== value)
        : [...prev.allowed_media, value]
    }));
  };

  const toggleJahrgang = (id: number) => {
    if (loading) return;
    setFormData((prev) => ({
      ...prev,
      jahrgang_ids: prev.jahrgang_ids.includes(id)
        ? prev.jahrgang_ids.filter((j) => j !== id)
        : [...prev.jahrgang_ids, id]
    }));
  };

  const isTeamOnly = istNurTeam(formData);
  const isFormValid = istChallengeFormularGueltig(formData);

  const handleSave = async () => {
    if (!isFormValid) {
      // Der Zeitraum ist nur außerhalb des Entwurfs Pflicht.
      const felder = ['Titel', 'Beschreibung', 'Stempel-Name', 'Medienarten'];
      if (!isTeamOnly) felder.push('Jahrgänge');
      if (!formData.is_draft) felder.push('den Zeitraum');
      setError(`Bitte fülle ${felder.slice(0, -1).join(', ')} und ${felder[felder.length - 1]} aus.`);
      return;
    }
    const zeitFehler = zeitraumFehler(formData);
    if (zeitFehler) {
      setError(zeitFehler);
      return;
    }

    // guard() wirft bei Doppel-Tap ('Aktion läuft bereits'). Ungefangen
    // bliebe loading auf true hängen — dann liess sich das Modal nur
    // noch per Swipe schliessen (User-Hinweis 12.08.).
    try {
      await guard(async () => {
      setLoading(true);
      try {
        const payload = baueChallengePayload(formData, isStarted);
        if (isEditMode && challenge) {
          await api.put(`/challenges/admin/${challenge.id}`, payload);
        } else {
          await api.post('/challenges/admin', payload);
        }
        setIsDirty(false);
        // Dirty-Stand SYNCHRON melden, bevor onSuccess() über canDismiss schließt
        // (sonst blockiert canDismiss das Schliessen -> doppeltes Anlegen).
        onDirtyChange?.(false);
        onSuccess();
      } catch (err: any) {
        // 409 = nach Start gesperrtes Feld geändert (Backend erzwingt Konsens-Integritaet)
        setError(err.response?.data?.error || 'Fehler beim Speichern der Challenge');
      } finally {
        setLoading(false);
      }
      });
    } catch {
      // Zweiter Aufruf verworfen — Ladezustand sicher zuruecknehmen.
      setLoading(false);
    }
  };

  const selectedIconMeta = CHALLENGE_ICONS[formData.badge_icon];

  const iconGroups = Object.entries(CHALLENGE_ICONS).reduce<
    { category: string; icons: { key: string; data: { icon: string; name: string; category: string } }[] }[]
  >((acc, [key, data]) => {
    const group = acc.find((g) => g.category === data.category);
    if (group) group.icons.push({ key, data });
    else acc.push({ category: data.category, icons: [{ key, data }] });
    return acc;
  }, []);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{isEditMode ? 'Challenge bearbeiten' : 'Neue Challenge'}</IonTitle>
          <IonButtons slot="start">
            {/* NICHT an loading haengen: Bleibt der Ladezustand haengen,
                waere das Modal sonst nur noch per Swipe zu verlassen.
                Die Rueckfrage bei ungespeicherten Aenderungen laeuft
                ueber canDismiss der Seite. */}
            <IonButton aria-label="Schließen" onClick={onClose} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              onClick={() => handleSave()}
              disabled={loading || isSubmitting || !isFormValid}
              className="app-modal-submit-btn app-modal-submit-btn--challenges"
            >
              {loading ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {initialLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            {/* SEKTION: Die Challenge */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={flag} />
                </div>
                <IonLabel>Die Challenge</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonList>
                    <IonItem lines="inset">
                      <IonLabel position="stacked">Titel *</IonLabel>
                      <IonInput
                        value={formData.title}
                        onIonInput={(e) => setFormData({ ...formData, title: e.detail.value! })}
                        placeholder="Worum geht es?"
                        clearInput={true}
                        disabled={loading}
                        maxlength={200}
                      />
                    </IonItem>

                    <IonItem lines="inset">
                      <IonLabel position="stacked">Beschreibung *</IonLabel>
                      <IonTextarea
                        value={formData.description}
                        onIonInput={(e) => setFormData({ ...formData, description: e.detail.value! })}
                        placeholder="Was sollen die Konfis tun?"
                        rows={5}
                        autoGrow={true}
                        disabled={loading}
                      />
                    </IonItem>
                    <IonItem lines="none">
                      <IonLabel position="stacked">Gestellt von (optional)</IonLabel>
                      <IonInput
                        value={formData.author_freetext}
                        onIonInput={(e) => setFormData({ ...formData, author_freetext: e.detail.value! })}
                        placeholder="z.B. Pastorin Müller, Konfi-Team Nord"
                        clearInput={true}
                        disabled={loading}
                        maxlength={200}
                      />
                    </IonItem>
                  </IonList>
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* Der Hinweis, was mit den Beitraegen passiert, steht im Handbuch
                (Kapitel Challenges) — nicht mehr als Kasten im Formular. */}

            {/* SEKTION: Wer macht mit? (Teilnahme-Kreis) */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={peopleOutline} />
                </div>
                <IonLabel>Wer macht mit?</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {AUDIENCE_OPTIONS.map((option) => (
                      <div
                        key={option.value}
                        className={`app-list-item app-list-item--challenges${formData.audience === option.value ? ' app-list-item--selected' : ''}`}
                        onClick={() => !loading && !isStarted && setFormData({ ...formData, audience: option.value })}
                        style={{
                          cursor: loading || isStarted ? 'default' : 'pointer',
                          opacity: isStarted && formData.audience !== option.value ? 0.4 : loading ? 0.6 : 1,
                          marginBottom: '0'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="app-list-item__title">{option.label}</div>
                          <div className="app-list-item__subtitle" style={{ whiteSpace: 'normal' }}>
                            {option.hint}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* SEKTION: Medienarten */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={imagesOutline} />
                </div>
                <IonLabel>Erlaubte Medienarten</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonItem lines="none" style={{ '--background': 'transparent', paddingBottom: '8px' }}>
                    <IonLabel style={{ fontSize: '0.9rem', fontWeight: '500', color: formData.allowed_media.length === 0 ? '#dc3545' : '#666' }}>
                      Mehrere möglich *
                      {formData.allowed_media.length > 0 && (
                        <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--app-color-challenges)', fontWeight: 'normal' }}>
                          ({formData.allowed_media.length} ausgewählt)
                        </span>
                      )}
                    </IonLabel>
                  </IonItem>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {MEDIA_OPTIONS.map((option) => {
                      const isSelected = formData.allowed_media.includes(option.value);
                      return (
                        <div
                          key={option.value}
                          className={`app-list-item app-list-item--challenges${isSelected ? ' app-list-item--selected' : ''}`}
                          onClick={() => toggleMedia(option.value)}
                          style={{
                            cursor: loading || isStarted ? 'default' : 'pointer',
                            opacity: isStarted && !isSelected ? 0.4 : loading ? 0.6 : 1,
                            marginBottom: '0'
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="app-list-item__title">{option.label}</div>
                            <div className="app-list-item__subtitle" style={{ whiteSpace: 'normal' }}>
                              {option.hint}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* SEKTION: Sichtbarkeit */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={eyeOutline} />
                </div>
                <IonLabel>Sichtbarkeit der Beiträge</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {VISIBILITY_OPTIONS.map((option) => (
                      <div
                        key={option.value}
                        className={`app-list-item app-list-item--challenges${formData.visibility === option.value ? ' app-list-item--selected' : ''}`}
                        onClick={() => !loading && !isStarted && setFormData({ ...formData, visibility: option.value })}
                        style={{
                          cursor: loading || isStarted ? 'default' : 'pointer',
                          opacity: isStarted && formData.visibility !== option.value ? 0.4 : loading ? 0.6 : 1,
                          marginBottom: '0'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="app-list-item__title">{option.label}</div>
                          <div className="app-list-item__subtitle" style={{ whiteSpace: 'normal' }}>
                            {option.hint}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <IonItem lines="none" style={{ marginTop: '16px' }}>
                    <IonLabel>
                      <h3 style={{ color: '#333', margin: '0 0 4px 0', fontWeight: '600' }}>
                        Beiträge erst nach Freigabe zeigen
                      </h3>
                      <p style={{ color: '#666', margin: '0', fontSize: '0.85rem', whiteSpace: 'normal' }}>
                        Ist das aus, erscheinen Beiträge sofort in der Galerie. Ausblenden geht
                        immer noch nachträglich.
                      </p>
                    </IonLabel>
                    <IonToggle
                      slot="end"
                      className="app-toggle--challenges"
                      checked={formData.moderated}
                      disabled={loading || isStarted}
                      onIonChange={(e) => setFormData({ ...formData, moderated: e.detail.checked })}
                    />
                  </IonItem>

                  <IonItem lines="none">
                    <IonLabel>
                      <h3 style={{ color: '#333', margin: '0 0 4px 0', fontWeight: '600' }}>
                        Mehrere Beiträge erlauben
                      </h3>
                      <p style={{ color: '#666', margin: '0', fontSize: '0.85rem', whiteSpace: 'normal' }}>
                        Konfis können mehr als einen Beitrag zu dieser Challenge einreichen.
                      </p>
                    </IonLabel>
                    <IonToggle
                      slot="end"
                      className="app-toggle--challenges"
                      checked={formData.allow_multiple}
                      disabled={loading}
                      onIonChange={(e) => setFormData({ ...formData, allow_multiple: e.detail.checked })}
                    />
                  </IonItem>
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* SEKTION: Stempel */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={ribbonOutline} />
                </div>
                <IonLabel>Stempel</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonList>
                    <IonItem lines="inset">
                      <IonLabel position="stacked">Name des Stempels *</IonLabel>
                      <IonInput
                        value={formData.badge_name}
                        onIonInput={(e) => setFormData({ ...formData, badge_name: e.detail.value! })}
                        placeholder="z.B. Hingeschaut"
                        clearInput={true}
                        disabled={loading}
                        maxlength={100}
                      />
                    </IonItem>
                  </IonList>

                  <div style={{ marginTop: '16px' }}>
                    <IonAccordionGroup>
                      <IonAccordion value="icon-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                        <IonItem slot="header" lines="none">
                          <IonLabel>
                            <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                              Icon *
                            </h3>
                            {selectedIconMeta && (
                              <p style={{ fontSize: '0.85rem', color: '#333', margin: '0', fontWeight: '500' }}>
                                {selectedIconMeta.name} ({selectedIconMeta.category})
                              </p>
                            )}
                          </IonLabel>
                        </IonItem>
                        <div slot="content" style={{ padding: '16px' }}>
                          {iconGroups.map((group) => (
                            <div key={group.category} style={{ marginBottom: '16px' }}>
                              <IonText style={{ fontSize: '0.85rem', fontWeight: '600', color: '#666', marginBottom: '8px', display: 'block' }}>
                                {group.category}
                              </IonText>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: '8px' }}>
                                {group.icons.map(({ key, data }) => (
                                  <div
                                    key={key}
                                    onClick={() => !loading && setFormData({ ...formData, badge_icon: key })}
                                    style={{
                                      width: '100%',
                                      aspectRatio: '1',
                                      backgroundColor: formData.badge_icon === key ? 'var(--app-color-challenges)' : '#f8f9fa',
                                      borderRadius: '12px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      border: '1px solid #e0e0e0',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                      transition: 'all 0.2s'
                                    }}
                                  >
                                    <IonIcon
                                      icon={data.icon}
                                      style={{
                                        fontSize: '1.5rem',
                                        color: formData.badge_icon === key ? 'white' : '#666'
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </IonAccordion>
                    </IonAccordionGroup>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* SEKTION: Jahrgaenge — bei 'nur_team' entfaellt sie (org-weit) */}
            {!isTeamOnly && (
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={schoolOutline} />
                </div>
                <IonLabel>Zielgruppe</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonItem lines="none" style={{ '--background': 'transparent', paddingBottom: '8px' }}>
                    <IonLabel style={{ fontSize: '0.9rem', fontWeight: '500', color: formData.jahrgang_ids.length === 0 ? '#dc3545' : '#666' }}>
                      Jahrgänge (mehrere möglich) *
                      {formData.jahrgang_ids.length > 0 && (
                        <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--app-color-jahrgang)', fontWeight: 'normal' }}>
                          ({formData.jahrgang_ids.length} ausgewählt)
                        </span>
                      )}
                    </IonLabel>
                  </IonItem>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {jahrgaenge.map((jahrgang) => {
                      const isSelected = formData.jahrgang_ids.includes(jahrgang.id);
                      return (
                        <div
                          key={jahrgang.id}
                          className={`app-list-item app-list-item--jahrgang${isSelected ? ' app-list-item--selected' : ''}`}
                          onClick={() => toggleJahrgang(jahrgang.id)}
                          style={{
                            cursor: loading ? 'default' : 'pointer',
                            opacity: loading ? 0.6 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            marginBottom: '0'
                          }}
                        >
                          <span style={{ fontWeight: '500', color: '#333' }}>{jahrgang.name}</span>
                        </div>
                      );
                    })}
                    {jahrgaenge.length === 0 && (
                      <div style={{ padding: '8px', color: '#999', fontSize: '0.85rem' }}>
                        Keine Jahrgänge verfügbar
                      </div>
                    )}
                  </div>
                </IonCardContent>
              </IonCard>
            </IonList>
            )}

            {/* SEKTION: Zeitraum */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={calendarOutline} />
                </div>
                {/* Beim Entwurf gibt es keinen Zeitraum zu sehen — dann
                    trägt der Abschnitt den Namen dessen, was er zeigt. */}
                <IonLabel>{formData.is_draft ? 'Entwurf' : 'Zeitraum'}</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  {!formData.is_draft && (
                    <IonList>
                      <IonItem lines="inset">
                        <IonLabel>Start{isStarted ? ' (gesperrt)' : ' *'}</IonLabel>
                        <IonDatetimeButton datetime="challenge-start-picker" disabled={loading || isStarted} slot="end" />
                      </IonItem>
                      <IonItem lines="none">
                        <IonLabel>Ende *</IonLabel>
                        <IonDatetimeButton datetime="challenge-end-picker" disabled={loading} slot="end" />
                      </IonItem>
                    </IonList>
                  )}

                  {/* Entwurf-Haken statt eigener Footer-Buttons: gespeichert wird
                      ausschliesslich ueber den Bestätigen-Button oben rechts. */}
                  {!isStarted && (
                    <IonItem lines="none" style={{ marginTop: '8px' }}>
                      <IonLabel>
                        <h3 style={{ color: '#333', margin: '0 0 4px 0', fontWeight: '600' }}>
                          Als Entwurf speichern
                        </h3>
                        <p style={{ color: '#666', margin: '0', fontSize: '0.85rem', whiteSpace: 'normal' }}>
                          Entwürfe sehen nur du und dein Team.
                        </p>
                      </IonLabel>
                      <IonToggle
                        slot="end"
                        className="app-toggle--challenges"
                        checked={formData.is_draft}
                        disabled={loading}
                        onIonChange={(e) => setFormData({ ...formData, is_draft: e.detail.checked })}
                      />
                    </IonItem>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>

            <div className="ion-padding-bottom" />
          </>
        )}
      </IonContent>

      {/* DateTime-Modals — wie im Event-Modal direkt unter IonPage, nicht im Content */}
      <IonModal keepContentsMounted={true}>
        <IonDatetime
          id="challenge-start-picker"
          value={formData.starts_at}
          presentation="date-time"
          minuteValues="0,15,30,45"
          firstDayOfWeek={1}
          onIonChange={(e) => setFormData({ ...formData, starts_at: e.detail.value as string })}
          style={{ '--background': '#f8f9fa', '--border-radius': '12px', '--box-shadow': '0 4px 16px rgba(0,0,0,0.1)' }}
        />
      </IonModal>
      <IonModal keepContentsMounted={true}>
        <IonDatetime
          id="challenge-end-picker"
          value={formData.ends_at}
          presentation="date-time"
          minuteValues="0,15,30,45"
          firstDayOfWeek={1}
          onIonChange={(e) => setFormData({ ...formData, ends_at: e.detail.value as string })}
          style={{ '--background': '#f8f9fa', '--border-radius': '12px', '--box-shadow': '0 4px 16px rgba(0,0,0,0.1)' }}
        />
      </IonModal>
    </IonPage>
  );
};

export default ChallengeManageModal;
