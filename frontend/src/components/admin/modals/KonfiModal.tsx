import React, { useState } from 'react';
import { useActionGuard } from '../../../hooks/useActionGuard';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
  IonItem,
  IonLabel,
  IonInput,
  IonList,
  IonListHeader,
  IonIcon,
  IonCard,
  IonCardContent,
  IonSpinner
} from '@ionic/react';
import { closeOutline, checkmarkOutline, personOutline, informationCircleOutline, cloudOfflineOutline, schoolOutline, checkmark, warningOutline } from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';

interface Jahrgang {
  id: number;
  name: string;
  // Punktearten des Jahrgangs. Sie kommen aus GET /jahrgaenge (SELECT j.*)
  // und werden fuer die Warnung beim Wechsel gebraucht.
  gottesdienst_enabled?: boolean;
  gemeinde_enabled?: boolean;
}

interface KonfiModalProps {
  jahrgaenge: Jahrgang[];
  onClose: () => void;
  onSave: (konfiData: any) => void;
  dismiss?: () => void;
  /**
   * Gesetzt = BEARBEITEN, nicht gesetzt = ANLEGEN.
   *
   * Das Modal kann beides, statt zweimal fast dasselbe zu sein: Die Felder,
   * die Jahrgangs-Auswahl und die Prueflogik sind identisch, nur Ueberschrift,
   * Hinweis und die Warnungen unterscheiden sich. Zwei Dateien waeren genau
   * die Kopie, die in diesem Projekt regelmaessig auseinanderlaeuft.
   */
  konfi?: {
    id: number;
    display_name: string;
    jahrgang_id: number | null;
    gottesdienst_points?: number;
    gemeinde_points?: number;
  };
  /** Jahrgaenge, denen die angemeldete Person zugewiesen ist (nur `admin`). */
  eigeneJahrgangIds?: number[];
}

const KonfiModal: React.FC<KonfiModalProps> = ({ jahrgaenge, onClose, onSave, dismiss, konfi, eigeneJahrgangIds }) => {
  const { isOnline } = useApp();
  const bearbeiten = !!konfi;
  const [name, setName] = useState(konfi?.display_name ?? '');
  const [jahrgangId, setJahrgangId] = useState<number | null>(konfi?.jahrgang_id ?? null);
  const { isSubmitting, guard } = useActionGuard();

  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };

  const handleSave = async () => {
    if (!name.trim() || jahrgangId === null) return;

    await guard(async () => {
      const konfiData = {
        name: name.trim(),
        jahrgang_id: jahrgangId
      };

      await onSave(konfiData);
    });
  };

  const isValid = name.trim().length > 0 && jahrgangId !== null;

  // Beide warnen nur, sie blockieren nicht: Der Wechsel ist ein legitimer
  // Vorgang — meist "falsch angelegt, muss in den richtigen Jahrgang".
  // Ueberraschend sind nur die Folgen, und genau die stehen hier.
  const wechselt = bearbeiten && jahrgangId !== null && jahrgangId !== konfi!.jahrgang_id;
  const ziel = jahrgaenge.find((jg) => jg.id === jahrgangId);

  // 1. Punktearten: Ist im Ziel-Jahrgang eine Punkteart abgeschaltet, die die
  //    Konfi schon gesammelt hat, verschwinden diese Punkte aus jeder Anzeige.
  //    Sie bleiben in der Datenbank — sichtbar sind sie dort nicht mehr.
  const verlorenePunkte: string[] = [];
  if (wechselt && ziel) {
    if (ziel.gottesdienst_enabled === false && (konfi!.gottesdienst_points ?? 0) > 0) {
      verlorenePunkte.push(`${konfi!.gottesdienst_points} Gottesdienstpunkte`);
    }
    if (ziel.gemeinde_enabled === false && (konfi!.gemeinde_points ?? 0) > 0) {
      verlorenePunkte.push(`${konfi!.gemeinde_points} Gemeindepunkte`);
    }
  }

  // 2. Eigene Zuweisung: Ein `admin` sieht nur Konfis seiner Jahrgaenge. Schiebt
  //    er eine Konfi in einen fremden, verschwindet sie aus seiner Liste.
  //    `eigeneJahrgangIds` bleibt fuer org_admin leer — dort gibt es die Grenze
  //    nicht, also auch keine Warnung.
  const verliertSicht = wechselt
    && Array.isArray(eigeneJahrgangIds)
    && eigeneJahrgangIds.length > 0
    && !eigeneJahrgangIds.includes(jahrgangId!);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{bearbeiten ? 'Konfi bearbeiten' : 'Konfi erstellen'}</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={handleClose} disabled={isSubmitting} className="app-modal-close-btn">
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label={bearbeiten ? "Aenderungen speichern" : "Konfi speichern"} onClick={handleSave} disabled={!isValid || isSubmitting || !isOnline} className="app-modal-submit-btn app-modal-submit-btn--konfi">
              {!isOnline ? <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</> : isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Name Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--purple">
              <IonIcon icon={personOutline} />
            </div>
            <IonLabel>Konfi Daten</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              <IonList style={{ background: 'transparent' }}>
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Name *</IonLabel>
                  <IonInput
                    value={name}
                    onIonInput={(e) => setName(e.detail.value!)}
                    placeholder="Vor- und Nachname"
                    disabled={isSubmitting}
                    clearInput={true}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Jahrgang - als antippbare Liste wie beim Anlegen von Teamer:innen.
            Anders als dort ist es eine EINFACH-Auswahl: Ein Konfi gehoert zu
            genau einem Jahrgang (jahrgang_id). */}
        <IonList inset={true} className="app-modal-section">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--purple">
              <IonIcon icon={schoolOutline} />
            </div>
            <IonLabel>Jahrgang *</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '16px' }}>
              {jahrgaenge.length === 0 ? (
                <IonItem lines="none" style={{ '--background': 'transparent' }}>
                  <IonLabel style={{ textAlign: 'center' }}>
                    <p style={{ color: '#999', margin: 0 }}>Keine Jahrgänge verfügbar</p>
                  </IonLabel>
                </IonItem>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {jahrgaenge.map((jg, index) => {
                    const isSelected = jahrgangId === jg.id;

                    return (
                      <div
                        key={jg.id}
                        className={`app-list-item app-list-item--purple${isSelected ? ' app-list-item--selected' : ''}`}
                        onClick={() => !isSubmitting && setJahrgangId(jg.id)}
                        style={{
                          cursor: isSubmitting ? 'default' : 'pointer',
                          opacity: isSubmitting ? 0.6 : 1,
                          position: 'relative',
                          overflow: 'hidden',
                          marginBottom: index < jahrgaenge.length - 1 ? '8px' : '0'
                        }}
                      >
                        {isSelected && (
                          <div className="app-corner-badges">
                            <div
                              className="app-corner-badge"
                              style={{ backgroundColor: 'var(--app-color-konfis)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                              title="Ausgewählt"
                            >
                              <IonIcon icon={checkmark} style={{ color: '#fff', fontSize: '0.85rem' }} />
                            </div>
                          </div>
                        )}
                        <div className="app-list-item__row">
                          <div className="app-list-item__main">
                            <div className="app-list-item__content">
                              <div className="app-list-item__title" style={{ paddingRight: isSelected ? '40px' : '0' }}>{jg.name}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Was ein Jahrgangswechsel ausloest. Erscheint nur, wenn wirklich
            gewechselt wird — beim Anlegen und beim reinen Namensfix nicht. */}
        {wechselt && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--purple">
                <IonIcon icon={warningOutline} />
              </div>
              <IonLabel>Was der Wechsel bewirkt</IonLabel>
            </IonListHeader>
            <IonCard className="app-card" style={{ background: 'rgba(190, 24, 93, 0.08)', border: '1px solid rgba(190, 24, 93, 0.2)' }}>
              <IonCardContent style={{ padding: '16px' }}>
                <p style={{ margin: '0 0 10px', fontSize: '0.9rem', lineHeight: '1.5' }}>
                  Es gelten die Regeln des neuen Jahrgangs:
                </p>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.9rem', lineHeight: '1.6' }}>
                  <li>Anmeldungen zu künftigen Terminen des alten Jahrgangs fallen weg.</li>
                  <li>Pflichttermine des neuen Jahrgangs kommen dazu.</li>
                  <li>Der Jahrgangs-Chat wechselt mit.</li>
                  <li>Der Jahresrückblick erscheint erst wieder, wenn der neue
                      Jahrgang freigegeben ist.</li>
                </ul>
                <p style={{ margin: '10px 0 0', fontSize: '0.85rem', lineHeight: '1.5', opacity: 0.85 }}>
                  Bereits erfasste Anwesenheiten und vergangene Termine bleiben
                  unberührt.
                </p>

                {verlorenePunkte.length > 0 && (
                  <p style={{ margin: '12px 0 0', fontSize: '0.9rem', lineHeight: '1.5', fontWeight: 600 }}>
                    Achtung: In {ziel?.name} {verlorenePunkte.length === 1 ? 'ist diese Punkteart' : 'sind diese Punktearten'} abgeschaltet
                    — {verlorenePunkte.join(' und ')} werden dort nicht mehr angezeigt.
                  </p>
                )}

                {verliertSicht && (
                  <p style={{ margin: '12px 0 0', fontSize: '0.9rem', lineHeight: '1.5', fontWeight: 600 }}>
                    Achtung: Du bist {ziel?.name} nicht zugewiesen — nach dem
                    Speichern siehst du {name.trim() || 'diese Konfi'} nicht mehr
                    in deiner Liste.
                  </p>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Hinweis Sektion - iOS26 Pattern in Lila */}
        {!bearbeiten && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--purple">
                <IonIcon icon={informationCircleOutline} />
              </div>
              <IonLabel>Hinweis</IonLabel>
            </IonListHeader>
            <IonCard className="app-card" style={{ background: 'rgba(91, 33, 182, 0.08)', border: '1px solid rgba(91, 33, 182, 0.2)' }}>
              <IonCardContent style={{ padding: '16px' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5', color: 'var(--app-color-konfis)' }}>
                  Benutzername und Passwort werden automatisch generiert. Du kannst das Passwort später in der Detailansicht einsehen oder zurücksetzen.
                </p>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Beim Bearbeiten: Der Benutzername bleibt, was er ist. Das Backend
            generiert ihn bewusst NICHT neu — das ueberschrieb frueher still
            selbstgewaehlte Namen aus der Registrierung. */}
        {bearbeiten && (
          <IonList inset={true} className="app-modal-section">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--purple">
                <IonIcon icon={informationCircleOutline} />
              </div>
              <IonLabel>Hinweis</IonLabel>
            </IonListHeader>
            <IonCard className="app-card" style={{ background: 'rgba(91, 33, 182, 0.08)', border: '1px solid rgba(91, 33, 182, 0.2)' }}>
              <IonCardContent style={{ padding: '16px' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5', color: 'var(--app-color-konfis)' }}>
                  Der Benutzername zum Anmelden ändert sich nicht — auch dann
                  nicht, wenn du den Namen korrigierst.
                </p>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default KonfiModal;