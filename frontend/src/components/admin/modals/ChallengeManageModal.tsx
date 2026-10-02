import { fehlerText } from '../../../utils/fehler';
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
  ICON_ABZEICHEN,
  ICON_AUFKLAPPEN,
  ICON_CHALLENGE_GEFUELLT,
  ICON_GALERIE,
  ICON_GRUPPE,
  ICON_HAKEN,
  ICON_JAHRGANG,
  ICON_SCHLIESSEN,
  ICON_SICHTBAR,
  ICON_TERMIN,
} from '../../shared/icons';
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
import { ICON_CHOICES, getIconFromString } from '../../../utils/badgeIcons';
import {
  baueChallengePayload,
  istChallengeFormularGueltig,
  audienceFuerFormular,
  istNurTeam,
  zeitraumFehler
} from '../../../utils/challengeForm';
import { tastaturKlick } from '../../../utils/tastatur';

// Icon-Auswahl: gemeinsamer Vorrat aus utils/badgeIcons, damit
// Challenge-Stempel, Abzeichen und Zertifikate dieselbe Bildsprache haben.
// Rueckfall bleibt die Flagge (frueher lokal in CHALLENGE_ICONS).
export const getChallengeIcon = (iconName?: string): string => getIconFromString(iconName, ICON_CHALLENGE_GEFUELLT);

const AUDIENCE_OPTIONS: { value: ChallengeAudience; label: string; hint: string }[] = [
  {
    value: 'konfis_und_team',
    label: 'Jahrgang und Team',
    hint: 'Die Konfis der gewählten Jahrgänge und ihr im Team — alle reichen gleichberechtigt ein.'
  },
  {
    value: 'konfis',
    label: 'Nur die Konfis',
    hint: 'Die Konfis der gewählten Jahrgänge reichen ein. Ihr im Team seht die Beiträge und begleitet die Challenge, reicht aber selbst nichts ein.'
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
          audience: audienceFuerFormular(challenge.audience),
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
      } catch (err) {
        // 409 = nach Start gesperrtes Feld geändert (Backend erzwingt Konsens-Integritaet)
        setError(fehlerText(err, 'Fehler beim Speichern der Challenge'));
      } finally {
        setLoading(false);
      }
      });
    } catch {
      // Zweiter Aufruf verworfen — Ladezustand sicher zuruecknehmen.
      setLoading(false);
    }
  };

  const selectedIconMeta = ICON_CHOICES[formData.badge_icon];

  const iconGroups = Object.entries(ICON_CHOICES).reduce<
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
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              onClick={() => handleSave()}
              disabled={loading || isSubmitting || !isFormValid}
              className="app-modal-submit-btn app-modal-submit-btn--challenges"
            >
              {loading ? <IonSpinner name="crescent" /> : <IonIcon icon={ICON_HAKEN} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {initialLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--app-abstand-block)' }}>
            <IonSpinner name="crescent" />
          </div>
        ) : (
          <>
            {/* SEKTION: Die Challenge */}
            <IonList inset={true} className="app-modal-section">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--challenges">
                  <IonIcon icon={ICON_CHALLENGE_GEFUELLT} />
                </div>
                <IonLabel>Die Challenge</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonList>
                    <IonItem lines="inset">
                      <IonLabel position="stacked">Titel *</IonLabel>
                      <IonInput aria-label="Titel" aria-required="true"
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
                      <IonTextarea aria-label="Beschreibung" aria-required="true"
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
                      <IonInput aria-label="Gestellt von (optional)"
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
                  <IonIcon icon={ICON_GRUPPE} />
                </div>
                <IonLabel>Wer macht mit?</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {AUDIENCE_OPTIONS.map((option) => (
                      <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={formData.audience === option.value}
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
                  <IonIcon icon={ICON_GALERIE} />
                </div>
                <IonLabel>Erlaubte Medienarten</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonItem lines="none" style={{ '--background': 'transparent', paddingBottom: 'var(--app-abstand-eng)' }}>
                    <IonLabel style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: formData.allowed_media.length === 0 ? 'var(--app-color-danger)' : 'var(--app-text-secondary)' }}>
                      Mehrere möglich *
                      {formData.allowed_media.length > 0 && (
                        <span style={{ marginLeft: 'var(--app-abstand-eng)', fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-challenges)', fontWeight: 'var(--app-schrift-normal)' }}>
                          ({formData.allowed_media.length} ausgewählt)
                        </span>
                      )}
                    </IonLabel>
                  </IonItem>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {MEDIA_OPTIONS.map((option) => {
                      const isSelected = formData.allowed_media.includes(option.value);
                      return (
                        <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={isSelected}
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
                  <IonIcon icon={ICON_SICHTBAR} />
                </div>
                <IonLabel>Sichtbarkeit der Beiträge</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {VISIBILITY_OPTIONS.map((option) => (
                      <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={formData.visibility === option.value}
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

                  <IonItem lines="none" style={{ marginTop: 'var(--app-abstand-basis)' }}>
                    <IonLabel>
                      <h3 style={{ color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-mini) 0', fontWeight: 'var(--app-schrift-halbfett)' }}>
                        Beiträge erst nach Freigabe zeigen
                      </h3>
                      <p style={{ color: 'var(--app-text-secondary)', margin: '0', fontSize: 'var(--app-text-sekundaer)', whiteSpace: 'normal' }}>
                        Ist das aus, erscheinen Beiträge sofort in der Galerie. Ausblenden geht
                        immer noch nachträglich.
                      </p>
                    </IonLabel>
                    <IonToggle aria-label="Beiträge erst nach Freigabe zeigen"
                      slot="end"
                      className="app-toggle--challenges"
                      checked={formData.moderated}
                      disabled={loading || isStarted}
                      onIonChange={(e) => setFormData({ ...formData, moderated: e.detail.checked })}
                    />
                  </IonItem>

                  <IonItem lines="none">
                    <IonLabel>
                      <h3 style={{ color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-mini) 0', fontWeight: 'var(--app-schrift-halbfett)' }}>
                        Mehrere Beiträge erlauben
                      </h3>
                      <p style={{ color: 'var(--app-text-secondary)', margin: '0', fontSize: 'var(--app-text-sekundaer)', whiteSpace: 'normal' }}>
                        Konfis können mehr als einen Beitrag zu dieser Challenge einreichen.
                      </p>
                    </IonLabel>
                    <IonToggle aria-label="Mehrere Beiträge erlauben"
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
                  <IonIcon icon={ICON_ABZEICHEN} />
                </div>
                <IonLabel>Stempel</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonList>
                    <IonItem lines="inset">
                      <IonLabel position="stacked">Name des Stempels *</IonLabel>
                      <IonInput aria-label="Name des Stempels" aria-required="true"
                        value={formData.badge_name}
                        onIonInput={(e) => setFormData({ ...formData, badge_name: e.detail.value! })}
                        placeholder="z.B. Hingeschaut"
                        clearInput={true}
                        disabled={loading}
                        maxlength={100}
                      />
                    </IonItem>
                  </IonList>

                  <div style={{ marginTop: 'var(--app-abstand-basis)' }}>
                    <IonAccordionGroup>
                      <IonAccordion value="icon-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                        <IonItem slot="header" lines="none">
                          <IonLabel>
                            <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                              Icon *
                            </h3>
                            {selectedIconMeta && (
                              <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0', fontWeight: 'var(--app-schrift-mittel)' }}>
                                {selectedIconMeta.name} ({selectedIconMeta.category})
                              </p>
                            )}
                          </IonLabel>
                        </IonItem>
                        <div slot="content" style={{ padding: 'var(--app-abstand-basis)' }}>
                          {iconGroups.map((group) => (
                            <div key={group.category} style={{ marginBottom: 'var(--app-abstand-basis)' }}>
                              <IonText style={{ fontSize: 'var(--app-text-sekundaer)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-secondary)', marginBottom: 'var(--app-abstand-eng)', display: 'block' }}>
                                {group.category}
                              </IonText>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 'var(--app-abstand-eng)' }}>
                                {group.icons.map(({ key, data }) => (
                                  <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-label={data.name} aria-pressed={formData.badge_icon === key}
                                    key={key}
                                    onClick={() => !loading && setFormData({ ...formData, badge_icon: key })}
                                    style={{
                                      width: '100%',
                                      aspectRatio: '1',
                                      backgroundColor: formData.badge_icon === key ? 'var(--app-color-challenges)' : 'var(--app-surface-soft)',
                                      borderRadius: 'var(--app-radius-karte)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      border: '1px solid var(--app-border)',
                                      boxShadow: 'var(--app-schatten-flach)',
                                      transition: 'all 0.2s'
                                    }}
                                  >
                                    <IonIcon
                                      icon={data.icon}
                                      style={{
                                        fontSize: 'var(--app-text-ueberschrift)',
                                        color: formData.badge_icon === key ? 'white' : 'var(--app-text-secondary)'
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
                  <IonIcon icon={ICON_JAHRGANG} />
                </div>
                <IonLabel>Zielgruppe</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <IonItem lines="none" style={{ '--background': 'transparent', paddingBottom: 'var(--app-abstand-eng)' }}>
                    <IonLabel style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: formData.jahrgang_ids.length === 0 ? 'var(--app-color-danger)' : 'var(--app-text-secondary)' }}>
                      Jahrgänge (mehrere möglich) *
                      {formData.jahrgang_ids.length > 0 && (
                        <span style={{ marginLeft: 'var(--app-abstand-eng)', fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-jahrgang)', fontWeight: 'var(--app-schrift-normal)' }}>
                          ({formData.jahrgang_ids.length} ausgewählt)
                        </span>
                      )}
                    </IonLabel>
                  </IonItem>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {jahrgaenge.map((jahrgang) => {
                      const isSelected = formData.jahrgang_ids.includes(jahrgang.id);
                      return (
                        <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={isSelected}
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
                          <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-primary)' }}>{jahrgang.name}</span>
                        </div>
                      );
                    })}
                    {jahrgaenge.length === 0 && (
                      <div style={{ padding: 'var(--app-abstand-eng)', color: 'var(--app-text-muted)', fontSize: 'var(--app-text-sekundaer)' }}>
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
                  <IonIcon icon={ICON_TERMIN} />
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
                    <IonItem lines="none" style={{ marginTop: 'var(--app-abstand-eng)' }}>
                      <IonLabel>
                        <h3 style={{ color: 'var(--app-text-primary)', margin: '0 0 var(--app-abstand-mini) 0', fontWeight: 'var(--app-schrift-halbfett)' }}>
                          Als Entwurf speichern
                        </h3>
                        <p style={{ color: 'var(--app-text-secondary)', margin: '0', fontSize: 'var(--app-text-sekundaer)', whiteSpace: 'normal' }}>
                          Entwürfe sehen nur du und dein Team.
                        </p>
                      </IonLabel>
                      <IonToggle aria-label="Als Entwurf speichern"
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
      <IonModal aria-label="Start wählen" keepContentsMounted={true}>
        <IonDatetime
          aria-label="Start"
          id="challenge-start-picker"
          value={formData.starts_at}
          presentation="date-time"
          minuteValues="0,15,30,45"
          firstDayOfWeek={1}
          onIonChange={(e) => setFormData({ ...formData, starts_at: e.detail.value as string })}
          style={{ '--background': 'var(--app-surface-soft)', '--border-radius': 'var(--app-radius-karte)', '--box-shadow': 'var(--app-schatten-schwebend-weich)' }}
        />
      </IonModal>
      <IonModal aria-label="Ende wählen" keepContentsMounted={true}>
        <IonDatetime
          aria-label="Ende"
          id="challenge-end-picker"
          value={formData.ends_at}
          presentation="date-time"
          minuteValues="0,15,30,45"
          firstDayOfWeek={1}
          onIonChange={(e) => setFormData({ ...formData, ends_at: e.detail.value as string })}
          style={{ '--background': 'var(--app-surface-soft)', '--border-radius': 'var(--app-radius-karte)', '--box-shadow': 'var(--app-schatten-schwebend-weich)' }}
        />
      </IonModal>
    </IonPage>
  );
};

export default ChallengeManageModal;
