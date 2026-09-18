import React from 'react';
import { IonCard, IonCardContent, IonIcon, IonLabel, IonList, IonListHeader } from '@ionic/react';
import { ICON_ABSAGE, ICON_PERSON } from './icons';
import { absageUrheberZeile, absagegrundUrheberZeile, absageUrheberName, absagegrundUrheberName, AbsageAngabe } from '../../utils/anwesenheitUrheber';
import { istAbgesagt } from './eventFormatting';

// DER ABGESAGTE TERMIN, EINMAL GESCHRIEBEN
//
// Jede dieser Abweichungen war fuer sich klein und keine davon war
// beabsichtigt -- sie entstanden, weil derselbe Block fuenfmal von Hand
// nachgebaut wurde. Deshalb steht er jetzt einmal hier.
//
// WAS DIE VARIANTEN UNTERSCHEIDET: nur der Rahmen, nicht der Inhalt.
// 'kasten' ist der Abschnitt der Detailansichten, 'zeile' die kompakte
// Form fuer Listeneintraege und Dashboard-Kacheln, wo kein Platz fuer einen
// Kasten ist. Beide zeigen dieselben drei Aussagen in derselben Reihenfolge:
// Grund, wer abgesagt hat, wer den Grund zuletzt geaendert hat.
//
// WIE VIEL ROT BLEIBT: der Kreis im Kopf (app-section-icon--danger) und die
// beiden Zeilen-Icons (app-icon-color--danger). Die FLAECHE ist weiss wie
// ueberall -- die rote Tonung (app-reason-box--danger) faellt weg, sonst
// waere es wieder ein Kasten in der Karte.
//
// KEINE KNOEPFE MEHR IN DER KARTE: "grund und ruecknahme machen
// wir nur per slide auf der liste nicht im termin unter absage." Der Termin
// zeigt den Stand, geaendert wird er ueber den Wisch an der Zeile in der
// Liste -- Leitung wie Team. Die Karte ist damit reine Auskunft, und es gibt
// nur noch EINEN Ort fuer beide Aktionen statt zweier, die auseinanderlaufen.

interface AbsageBlockProps {
  /**
   * Der Termin. Muss cancelled ODER registration_status === 'cancelled'
   * tragen -- welches der beiden, haengt an der Route, deshalb prueft
   * istAbgesagt() beide.
   */
  event: (AbsageAngabe & {
    cancelled?: boolean;
    registration_status?: string;
    cancelled_reason?: string | null;
  }) | null | undefined;

  /** 'kasten' fuer Detailansichten, 'zeile' fuer Listen und Kacheln. */
  variante?: 'kasten' | 'zeile';

  /**
   * Text ohne Grund anzeigen? In den Detailansichten ja: Dort ist der
   * Unterschied zwischen "kein Grund angegeben" und "alte Absage ohne
   * Datenbankfeld" fuer die Lesenden nicht zu erkennen, und ohne den Satz
   * gaebe es beim Nachtragen auch keinen Ort fuer den Knopf. In Listen und
   * auf Kacheln nein -- dort sagt das Badge "Abgesagt" schon, und eine leere
   * Zeile zwischen Zaehlern und Kategorien traegt nichts bei.
   */
  zeigePlatzhalter?: boolean;

  /** Hell auf dunklem Grund (Dashboard-Kacheln mit Farbverlauf). */
  aufDunkel?: boolean;
}

const AbsageBlock: React.FC<AbsageBlockProps> = ({
  event,
  variante = 'kasten',
  zeigePlatzhalter = variante === 'kasten',
  aufDunkel = false,
}) => {
  if (!istAbgesagt(event) || !event) return null;

  const grund = event.cancelled_reason?.trim() || '';
  const absager = absageUrheberZeile(event);
  const grundUrheber = absagegrundUrheberZeile(event);
  // Kurzformen fuer die Karte: dort steht das Label "Abgesagt von" daneben.
  const absagerName = absageUrheberName(event);
  const grundUrheberName = absagegrundUrheberName(event);

  if (!grund && !zeigePlatzhalter) return null;

  const leiseFarbe = aufDunkel ? 'rgba(255,255,255,0.75)' : 'var(--app-text-tertiary)';
  const textFarbe = aufDunkel ? 'rgba(255,255,255,0.9)' : 'var(--app-text-secondary)';

  const urheberZeilen = (
    <>
      {absager && (
        <div style={{ color: leiseFarbe, fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
          {absager}
        </div>
      )}
      {/* Zweite Zeile nur, wenn der Grund von jemand anderem stammt als die
          Absage (Migration 152) -- sonst staende hier zweimal derselbe Name.
          Die Entscheidung darueber faellt in absagegrundUrheberZeile(). */}
      {grundUrheber && (
        <div style={{ color: leiseFarbe, fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
          {grundUrheber}
        </div>
      )}
    </>
  );

  if (variante === 'zeile') {
    return (
      <>
        {grund && (
          <div style={{ color: textFarbe, fontSize: 'var(--app-text-hinweis)', marginTop: 'var(--app-abstand-winzig)' }}>
            <strong>Abgesagt: </strong>{grund}
          </div>
        )}
        {grund && urheberZeilen}
      </>
    );
  }

  return (
    <IonList className="app-section-inset" inset={true}>
      <IonListHeader>
        <div className="app-section-icon app-section-icon--danger">
          <IonIcon icon={ICON_ABSAGE} />
        </div>
        <IonLabel>Absage</IonLabel>
      </IonListHeader>
      <IonCard className="app-card">
        <IonCardContent className="app-card-content">
          {/* Zeile 1: der Grund -- Icon links, Label darueber, Text darunter,
              genau wie "Datum" und "Ort" im Abschnitt Details. */}
          <div className="app-info-row app-info-row--top">
            <IonIcon icon={ICON_ABSAGE} className="app-info-row__icon app-icon-color--danger app-event-detail__icon--align-top" />
            <div>
              <div className="app-info-row__label">Grund</div>
              {grund ? (
                <div className="app-info-row__value">{grund}</div>
              ) : (
                // Kein Grund ist kein Fehler (er war immer freiwillig, Migration 150)
                // -- der Satz sagt nur, dass hier einer stehen koennte. Er steht
                // ausdruecklich in ALLEN drei Rollen: Ohne ihn faellt der Block weg,
                // und dann ist "kein Grund angegeben" von "alte Absage" nicht zu
                // unterscheiden.
                <div className="app-info-row__value" style={{ color: 'var(--app-text-secondary)' }}>
                  Kein Grund zur Absage angegeben.
                </div>
              )}
            </div>
          </div>
          {/* Zeile 2: wer abgesagt hat und wer den Grund zuletzt geaendert hat.
              Eine Zeile mit einem Icon, weil beide Angaben dieselbe Frage
              beantworten -- "von wem". Fehlt beides (alte Absage vor
              Migration 150), faellt die Zeile ersatzlos weg statt "von
              unbekannt" zu behaupten. */}
          {(absager || grundUrheber) && (
            <div className="app-info-row app-info-row--top">
              <IonIcon icon={ICON_PERSON} className="app-info-row__icon app-icon-color--danger app-event-detail__icon--align-top" />
              <div>
                <div className="app-info-row__label">Abgesagt von</div>
                {/* Nur der Name, ohne Vorspann: "Abgesagt von" steht schon als
                    Label darueber. Der volle Satz ergaebe hier "Abgesagt von"
                    ueber "Abgesagt von Kathrin Möller". */}
                {absagerName && <div className="app-info-row__value">{absagerName}</div>}
                {/* Zweite Zeile nur, wenn der Grund von jemand anderem stammt
                    als die Absage (Migration 152) -- sonst staende hier zweimal
                    derselbe Name. Die Entscheidung faellt in
                    absagegrundUrheberName(). */}
                {grundUrheberName && <div className="app-info-row__value">{grundUrheberName}</div>}
              </div>
            </div>
          )}
        </IonCardContent>
      </IonCard>
    </IonList>
  );
};

export default AbsageBlock;
