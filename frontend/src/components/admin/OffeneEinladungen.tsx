import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon, useIonAlert } from '@ionic/react';
import api from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { fehlerText } from '../../utils/fehler';
import { offlineBlockiert } from '../../utils/offlineAktion';
import { datumKurz } from '../../utils/dateUtils';
import { rollenName, rollenFarbeVar, rollenTextFarbeVar } from '../../utils/rollenNamen';
import { ListSection } from '../shared';
import {
  ICON_AT_ZEICHEN,
  ICON_MAIL_GEFUELLT,
  ICON_PERSON_GEFUELLT,
  ICON_PERSON_HINZUFUEGEN,
  ICON_RUECKGAENGIG,
  ICON_SCHILD_GEFUELLT,
  ICON_SENDEN_GEFUELLT,
  ICON_WARTEND_GEFUELLT,
} from '../shared/icons';

/**
 * Offene Einladungen der Gemeinde -- einsehen und zurueckziehen.
 *
 * NUR FUER ORG-ADMINS: Einladen, die Liste sehen und zurueckziehen verlangt
 * serverseitig requireOrgAdmin -- die Seite bindet den Abschnitt deshalb nur
 * bei role_name 'org_admin' ein, derselben Bedingung wie beim Einladen-Knopf.
 * Fuer alle anderen wird GET /einladungen gar nicht erst gerufen (es gaebe
 * nur 403).
 *
 * Blendet sich aus, wenn nichts offen ist -- wie die Einladungs-Karte im
 * Profil der eingeladenen Person (shared/EinladungenKarte.tsx). Nach der
 * Zusage steht die Person ohnehin in der Liste darueber.
 *
 * Antwortform von GET /einladungen: ein Array, jede Zeile mit den Feldern
 * unten (routes/einladungen.js, EINLADUNG_FELDER plus display_name und
 * username der eingeladenen Person).
 */

export interface OffeneEinladungDerGemeinde {
  id: number;
  user_id: number;
  display_name: string;
  username: string;
  role_name: string;
  role_display_name: string | null;
  created_at: string;
  expires_at: string;
  eingeladen_von_name?: string | null;
}

interface Props {
  /**
   * Zaehlt hoch, wenn die Liste neu geladen werden soll: nach einer neuen
   * Einladung, beim Live-Signal 'users' (etwa nach einer Zusage) und beim
   * Ziehen zum Aktualisieren.
   */
  aktualisierung: number;
}

// Dieselben Rollenfarben und -woerter wie in der Benutzerliste (UsersView),
// beide aus utils/rollenNamen. Das Wort nach role_name: role_display_name
// traegt in bestehenden Gemeinden noch die alten Namen aus der Datenbank.

const OffeneEinladungen: React.FC<Props> = ({ aktualisierung }) => {
  const { setError, setSuccess, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const [einladungen, setEinladungen] = useState<OffeneEinladungDerGemeinde[]>([]);
  const [laeuft, setLaeuft] = useState<number | null>(null);

  // Nur die Antwort des JUENGSTEN Abrufs zaehlt: Kommen Live-Signal und
  // eigenes Neuladen kurz nacheinander, darf der aeltere Stand den neueren
  // nicht ueberschreiben.
  const abrufNummer = useRef(0);

  const laden = useCallback(async () => {
    const nummer = ++abrufNummer.current;
    try {
      const res = await api.get('/einladungen');
      if (nummer !== abrufNummer.current) return;
      setEinladungen(Array.isArray(res.data) ? res.data : []);
    } catch {
      // Still: Eine fehlende Einladungsliste darf die Benutzerliste nicht
      // stoeren. Der zuletzt geladene Stand bleibt stehen.
    }
  }, []);

  useEffect(() => { void laden(); }, [laden, aktualisierung]);

  const zurueckziehen = (einladung: OffeneEinladungDerGemeinde) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Einladung zurückziehen',
      message: `Die Einladung an "${einladung.display_name}" (@${einladung.username}) zurückziehen? Die Person kann sie danach nicht mehr annehmen. Einladen lässt sie sich jederzeit neu.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Zurückziehen',
          role: 'destructive',
          handler: async () => {
            setLaeuft(einladung.id);
            try {
              await api.delete(`/einladungen/${einladung.id}`);
              setEinladungen((liste) => liste.filter((e) => e.id !== einladung.id));
              setSuccess(`Die Einladung an ${einladung.display_name} ist zurückgezogen.`);
            } catch (err) {
              // 404: inzwischen angenommen, abgelehnt oder von einer anderen
              // Leitung zurueckgezogen. Die Liste zeigt danach den echten
              // Stand.
              const status = (err as { response?: { status?: number } })?.response?.status;
              setError(status === 404
                ? 'Diese Einladung ist nicht mehr offen. Sie wurde inzwischen beantwortet oder zurückgezogen.'
                : fehlerText(err, 'Die Einladung konnte nicht zurückgezogen werden'));
              await laden();
            } finally {
              setLaeuft(null);
            }
          }
        }
      ]
    });
  };

  if (einladungen.length === 0) return null;

  return (
    <ListSection
      icon={ICON_PERSON_HINZUFUEGEN}
      title="Offene Einladungen"
      count={einladungen.length}
      iconColorClass="users"
    >
      {einladungen.map((einladung, index) => {
        const farbe = rollenFarbeVar(einladung.role_name);
        const rolle = rollenName(einladung.role_name, einladung.role_display_name ?? undefined);
        return (
          <div
            key={einladung.id}
            className="app-list-item app-list-item--users"
            style={{
              borderLeftColor: farbe,
              marginBottom: index < einladungen.length - 1 ? 'var(--app-abstand-eng)' : '0'
            }}
          >
            <div className="app-list-item__row">
              <div className="app-list-item__main">
                <div className="app-icon-circle app-icon-circle--lg" style={{ backgroundColor: farbe }}>
                  <IonIcon icon={ICON_MAIL_GEFUELLT} aria-hidden="true" />
                </div>
                <div className="app-list-item__content">
                  <div className="app-list-item__title">{einladung.display_name}</div>
                  <div className="app-list-item__meta">
                    <span className="app-list-item__meta-item">
                      <IonIcon icon={ICON_AT_ZEICHEN} className="app-icon-color--jahrgang" aria-hidden="true" />
                      {einladung.username}
                    </span>
                    <span className="app-list-item__meta-item">
                      <IonIcon
                        icon={einladung.role_name === 'teamer' ? ICON_PERSON_GEFUELLT : ICON_SCHILD_GEFUELLT}
                        style={{ color: rollenTextFarbeVar(einladung.role_name) }}
                        aria-hidden="true"
                      />
                      als {rolle}
                    </span>
                  </div>
                  <div className="app-list-item__meta">
                    <span className="app-list-item__meta-item">
                      <IonIcon icon={ICON_SENDEN_GEFUELLT} className="app-icon-color--time" aria-hidden="true" />
                      eingeladen am {datumKurz(einladung.created_at)}
                    </span>
                    <span className="app-list-item__meta-item">
                      <IonIcon icon={ICON_WARTEND_GEFUELLT} className="app-icon-color--warning" aria-hidden="true" />
                      gültig bis {datumKurz(einladung.expires_at)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', marginTop: 'var(--app-abstand-mittel)' }}>
              <IonButton
                size="small"
                fill="outline"
                color="danger"
                expand="block"
                style={{ flex: 1 }}
                aria-label={`Einladung an ${einladung.display_name} zurückziehen`}
                disabled={laeuft === einladung.id}
                onClick={() => zurueckziehen(einladung)}
              >
                <IonIcon icon={ICON_RUECKGAENGIG} slot="start" aria-hidden="true" />
                Zurückziehen
              </IonButton>
            </div>
          </div>
        );
      })}
    </ListSection>
  );
};

export default OffeneEinladungen;
