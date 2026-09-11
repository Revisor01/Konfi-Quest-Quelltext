import React, { forwardRef } from 'react';
import type { KonfiWrappedData, TeamerWrappedData } from '../../../types/wrapped';
import { TEXTE, stufeFuer } from '../slides/kategorieSeitenTexte';
import { tageBis } from '../../shared/eventFormatting';
import { hintergrundFuer } from '../hintergrundbilder';
import './ShareCard.css';

interface ShareCardProps {
  slideKey: string;
  data: KonfiWrappedData | TeamerWrappedData;
  wrappedType: 'konfi' | 'teamer';
  displayName: string;
  jahrgangName?: string;
  year: number;
  /**
   * Das Motiv dieser Seite, wie es der Rueckblick gerade zeigt. Es kommt aus
   * der Verteilung des GANZEN Rueckblicks (verteileMotive), damit das
   * geteilte Bild dasselbe Foto traegt wie die Seite auf dem Bildschirm.
   * Ohne Angabe greift die feste Zuordnung.
   */
  motiv?: string;
}

const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(
  ({ slideKey, data, wrappedType, displayName, jahrgangName, year, motiv }, ref) => {
    const isTeamer = wrappedType === 'teamer';
    const konfi = !isTeamer ? (data as KonfiWrappedData) : null;
    const teamer = isTeamer ? (data as TeamerWrappedData) : null;

    // Die dynamischen Seiten ('kategorie:fest', 'datum:advent') koennen
    // keinen eigenen Klassennamen bekommen -- der Doppelpunkt ist in CSS
    // kein gueltiges Zeichen und die Liste waechst mit jeder Kategorie, die
    // eine Gemeinde anlegt. Sie teilen sich deshalb je eine Sammelklasse.
    const klassenName = slideKey.startsWith('kategorie:')
      ? 'kategorie-seite'
      : slideKey.startsWith('datum:')
        ? 'datums-seite'
        : slideKey === 'kategorie-allgemein'
          ? 'kategorie-seite'
          : slideKey;

    const bgClass = `share-card share-card--${klassenName}${isTeamer ? ' share-card--teamer' : ''}`;

    // DAS FOTO DER SEITE.
    //
    // Warum als Inline-Stil und nicht als CSS-Regel: Welche Seite welches
    // Motiv bekommt, entscheidet sich zur Laufzeit (verteileMotive verteilt
    // sie so, dass sich in einem Rueckblick keines wiederholt). Eine feste
    // Regel je Seite koennte das nicht abbilden.
    //
    // Der Farbverlauf der Seite liegt als eigene Schicht DARUEBER -- unten
    // dicht, oben offen. Genau wie im Rueckblick selbst: Ohne diese Schicht
    // waere weisser Text auf einem hellen Himmel auf dem Handy in der Sonne
    // nicht zu lesen.
    const bild = motiv || hintergrundFuer(slideKey);

    /**
     * Wie viele Termine stecken hinter einer Kategorie- oder Datums-Seite?
     * Dieselbe Rechnung wie in WrappedModal -- die Zahl steht auf der Seite
     * und muss auf dem geteilten Bild dieselbe sein.
     */
    const kategorieZahl = (kachel: string): number => {
      if (!konfi) return 0;
      const verteilung = konfi.slides.kategorie?.verteilung || [];
      if (kachel.startsWith('datum:')) {
        const fenster = (konfi.slides as { datums_fenster?: Record<string, number> }).datums_fenster || {};
        return fenster[kachel.slice('datum:'.length)] || 0;
      }
      if (kachel === 'kategorie-allgemein') return verteilung[0]?.count || 0;
      return verteilung
        .filter(v => (v as { seite?: string | null }).seite === kachel)
        .reduce((n, v) => n + (v.count || 0), 0);
    };

    /**
     * Die Kategorie- und Datums-Seiten. Sie werden als MUSTER behandelt,
     * nicht aufgezaehlt: Welche es gibt, entscheidet die Gemeinde-Verwaltung
     * -- eine Aufzaehlung waere beim naechsten neuen Eintrag veraltet.
     *
     * Slogan und Nachsatz kommen aus derselben Quelle wie die Seite selbst
     * (KategorieSeiteSlide), damit das geteilte Bild dasselbe sagt wie das,
     * was die Konfi vor sich sieht.
     */
    const renderKategorieSeite = () => {
      const text = TEXTE[slideKey];
      if (!text) return null;
      const anzahl = kategorieZahl(slideKey);
      return (
        <>
          <div className="share-auge">{text.auge}</div>
          <div className="share-zahl">
            {anzahl}<span className="share-zahl-mal">×</span>
          </div>
          <div className="share-slogan">
            {stufeFuer(text.stufen, anzahl).split('\n').map((zeile, i) => (
              <span key={i} style={{ display: 'block' }}>{zeile}</span>
            ))}
          </div>
          <div className="share-nachsatz">{text.nachsatz(anzahl)}</div>
        </>
      );
    };

    const renderContent = () => {
      if (
        slideKey.startsWith('kategorie:')
        || slideKey.startsWith('datum:')
        || slideKey === 'kategorie-allgemein'
      ) {
        return renderKategorieSeite();
      }

      switch (slideKey) {
        case 'intro':
          return (
            <>
              <div style={{ fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
                Deine Konfi-Zeit
              </div>
              <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
                {displayName}
              </div>
              {jahrgangName && (
                <div style={{ fontSize: 36, color: 'rgba(255,255,255,0.7)', marginTop: 24 }}>
                  {jahrgangName}
                </div>
              )}
            </>
          );

        case 'punkte':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Deine Punkte</div>
              <div className="share-big-number">{konfi.slides.punkte.total}</div>
              <div className="share-subtitle">Punkte gesammelt</div>
              <div style={{ display: 'flex', gap: 48, marginTop: 48 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: 'var(--app-color-wrapped-hell)' }}>{konfi.slides.punkte.gottesdienst}</div>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Gottesdienst</div>
                </div>
                <div style={{ width: 2, height: 80, background: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: 'var(--app-color-wrapped-hell)' }}>{konfi.slides.punkte.gemeinde}</div>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Gemeinde</div>
                </div>
              </div>
            </>
          );

        case 'events':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Events</div>
              <div className="share-big-number">{konfi.slides.events.total_attended}</div>
              <div className="share-subtitle">Events besucht</div>
            </>
          );

        case 'badges':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Badges</div>
              <div className="share-big-number">{konfi.slides.badges.total_earned}</div>
              <div className="share-subtitle">Badges verdient</div>
              {konfi.slides.badges.badges.length > 0 && (
                <div style={{ display: 'flex', gap: 24, marginTop: 48, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 600 }}>
                  {konfi.slides.badges.badges.slice(0, 6).map((b, i) => (
                    <div key={i} style={{ width: 80, height: 80, borderRadius: '50%', background: b.color || 'rgba(var(--app-color-wrapped-rgb), 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 28, fontWeight: 700 }}>{b.name.charAt(0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          );

        case 'aktivster-monat':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Aktivster Monat</div>
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>{konfi.slides.aktivster_monat.monat_name}</div>
              <div className="share-subtitle">{konfi.slides.aktivster_monat.aktivitaeten} Aktivitäten</div>
            </>
          );

        // Challenge-Momente: BEWUSST nur Text und Challenge-Titel. Fotos, Audio
        // und Video der Konfis werden NIE in ein Teilen-Bild eingebettet
        // (Datenschutz — das Bild verlässt die App).
        // Die ZAHL der Challenges (die Bilder stehen im Zweig darunter).
        case 'warteliste': {
          if (!konfi) return null;
          const w = konfi.slides.warteliste;
          if (!w?.nachgerueckt) return null;
          return (
            <>
              <div className="share-label">Nachgerückt</div>
              <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.15 }}>
                Gewartet.<br />Und dabei.
              </div>
              <div className="share-subtitle">
                {w.nachgerueckt === 1 ? 'Ein Platz wurde frei' : `${w.nachgerueckt} Mal nachgerückt`}
              </div>
            </>
          );
        }

        case 'langer-atem': {
          if (!konfi) return null;
          const la = konfi.slides.langer_atem;
          if (!la) return null;
          return (
            <>
              <div className="share-label">Vom ersten bis zum letzten Mal</div>
              <div className="share-big-number">{la.tage}</div>
              <div className="share-subtitle">Tage lang dabei</div>
            </>
          );
        }

        case 'wochentag': {
          if (!konfi) return null;
          const wt = konfi.slides.wochentag;
          if (!wt) return null;
          return (
            <>
              <div className="share-label">Dein Tag</div>
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>{wt.name}</div>
              <div className="share-subtitle">{wt.anzahl} von {wt.gesamt} Terminen</div>
            </>
          );
        }

        case 'vielseitig': {
          if (!konfi) return null;
          const arten = konfi.slides.medienarten || [];
          if (arten.length === 0) return null;
          return (
            <>
              <div className="share-label">Nicht auf einen Weg festgelegt</div>
              <div className="share-big-number">{arten.length}</div>
              <div className="share-subtitle">Arten, auf die ich geantwortet habe</div>
            </>
          );
        }

        case 'challenges':
        case 'teamer-challenge-beitraege': {
          const ch = konfi?.slides.challenges || teamer?.slides.challenges;
          if (!ch) return null;
          return (
            <>
              <div className="share-label">Meine Kraftproben</div>
              <div style={{ fontSize: 220, fontWeight: 800, lineHeight: 1 }}>{ch.beitraege}</div>
              <div className="share-sub">Mal mitgemacht</div>
              {ch.top_challenge && (
                <div className="share-sub" style={{ marginTop: 24, opacity: 0.85 }}>
                  Am liebsten bei „{ch.top_challenge.title}“
                </div>
              )}
            </>
          );
        }

        case 'challenge-momente': {
          if (!konfi) return null;
          const momente = (konfi.slides.challenge_momente || []).slice(0, 4);
          return (
            <>
              <div className="share-label">Challenges</div>
              <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.1 }}>Meine Momente</div>
              {momente.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 48, maxWidth: 820, width: '100%' }}>
                  {momente.map((m, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '24px 32px',
                        background: 'rgba(var(--app-color-teamer-rgb), 0.18)',
                        border: '1px solid rgba(var(--app-color-teamer-rgb), 0.4)',
                        borderRadius: 24,
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: 26, color: 'rgba(255,255,255,0.6)' }}>{m.challenge_title}</div>
                      {m.text_content && (
                        <div style={{ fontSize: 32, fontWeight: 500, marginTop: 8, lineHeight: 1.3 }}>
                          {m.text_content.length > 110 ? m.text_content.slice(0, 110).trimEnd() + '…' : m.text_content}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        }

        case 'endspurt':
          if (!konfi) return null;
          return (
            <>
              <div className="share-label">Endspurt</div>
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>
                {konfi.slides.endspurt.fehlende_punkte}
              </div>
              <div className="share-subtitle">Punkte bis zum Ziel</div>
              <div style={{ width: '80%', maxWidth: 600, marginTop: 48 }}>
                <div style={{ height: 20, background: 'rgba(255,255,255,0.15)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (konfi.slides.endspurt.aktuell_total / Math.max(1, konfi.slides.endspurt.ziel_total)) * 100)}%`,
                    background: 'linear-gradient(90deg, var(--app-color-wrapped), var(--app-color-wrapped-hell))',
                    borderRadius: 10,
                  }} />
                </div>
              </div>
            </>
          );

        // VIER ANGABEN, MEHR NICHT: Gemeinde, Punkte, Konfirmationstermin,
        // Slogan. Die frueheren drei Zahlen nebeneinander (Punkte, Events,
        // Badges) sind auf eine reduziert -- ein Bild, das jemand in seine
        // Story stellt, wird im Vorbeiscrollen gelesen, und drei
        // gleichgrosse Zahlen sagen darin weniger als eine.
        case 'abschluss': {
          if (!konfi) return null;
          const zA = konfi.slides.zeitraum;
          const konfiDatum = zA && 'konfirmation' in zA ? (zA.konfirmation || null) : null;
          return (
            <>
              {konfi.slides.gemeinde && (
                <div style={{ fontSize: 34, fontWeight: 500, color: 'rgba(255,255,255,0.75)', marginBottom: 20 }}>
                  {konfi.slides.gemeinde}
                </div>
              )}

              {/* Eigene Groesse statt der Klasse `share-slogan` (130px):
                  Die reinen Slogan-Seiten tragen nichts ausser dem Spruch,
                  diese Karte traegt darunter noch Punktzahl und Datum. Bei
                  130px in Grossbuchstaben stiessen die drei Zeilen und die
                  Zahl aneinander -- 96px lassen beidem Platz und der Slogan
                  bleibt das Groesste auf der Karte. */}
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
                <span style={{ display: 'block' }}>Dein Weg.</span>
                <span style={{ display: 'block' }}>Deine Zeit.</span>
                <span style={{ display: 'block' }}>Dein Glaube.</span>
              </div>

              {/* DAS KONFIRMATIONSDATUM IST DIE HAUPTSACHE:
                  "Da soll auch nicht die Punktezahl in
                  irgendeiner grossen Weise drauf stehen, sondern das
                  Konfirmationsdatum, also deine Konfirmation, damit die das
                  quasi teilen koennen als 'Das ist meine Konfirmation'."
                  Vorher stand die Punktzahl mit 120px in der Mitte und das
                  Datum klein darunter -- eine Zahl, die ausserhalb der App
                  niemandem etwas sagt.

                  OHNE KONFIRMATIONSTERMIN faellt der Block weg: "wenn sie die
                  nicht ueber die App gebucht haben und keine Konfirmation
                  eventuell gebucht ist, dann machen wir es nicht darueber,
                  sondern sagen wir nur Kirchengemeinde und das
                  Konfirmationsdatum." Dann traegt die Karte den Slogan, die
                  Gemeinde und das Logo -- das genuegt. */}
              {konfiDatum && (
                <div style={{ marginTop: 64, textAlign: 'center' }}>
                  <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)' }}>
                    Meine Konfirmation
                  </div>
                  <div style={{ fontSize: 104, fontWeight: 800, lineHeight: 1.05, marginTop: 14, color: 'var(--app-color-wrapped-hell)' }}>
                    {new Date(konfiDatum).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}
                  </div>
                  <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, color: 'rgba(255,255,255,0.85)' }}>
                    {new Date(konfiDatum).getFullYear()}
                  </div>
                </div>
              )}
            </>
          );
        }

        // Teamer-Slides
        case 'teamer-intro':
          return (
            <>
              <div style={{ fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
                Dein Teamer-Jahr {year}
              </div>
              <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
                {displayName}
              </div>
            </>
          );

        case 'teamer-events':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Events geleitet</div>
              <div className="share-big-number">{teamer.slides.events_geleitet.total}</div>
              <div className="share-subtitle">Events geleitet</div>
              {teamer.slides.events_geleitet.meiste_teilnehmer_event && (
                <div style={{ marginTop: 48, padding: '24px 36px', background: 'rgba(225,29,72,0.15)', borderRadius: 24, border: '1px solid rgba(225,29,72,0.3)' }}>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)' }}>Größtes Event</div>
                  <div style={{ fontSize: 36, fontWeight: 600, marginTop: 8 }}>{teamer.slides.events_geleitet.meiste_teilnehmer_event.name}</div>
                  <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                    {teamer.slides.events_geleitet.meiste_teilnehmer_event.teilnehmer} Teilnehmer:innen
                  </div>
                </div>
              )}
            </>
          );

        case 'teamer-konfis':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Konfis betreut</div>
              <div className="share-big-number">{teamer.slides.konfis_betreut.total_konfis}</div>
              <div className="share-subtitle">Konfis betreut</div>
              {teamer.slides.konfis_betreut.jahrgaenge.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 32, justifyContent: 'center' }}>
                  {teamer.slides.konfis_betreut.jahrgaenge.map((j, i) => (
                    <div key={i} style={{ background: 'rgba(225,29,72,0.2)', border: '1px solid rgba(225,29,72,0.4)', borderRadius: 16, padding: '8px 20px', fontSize: 28 }}>
                      {j}
                    </div>
                  ))}
                </div>
              )}
            </>
          );

        case 'teamer-badges':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Badges</div>
              <div className="share-big-number">{teamer.slides.badges.total_earned}</div>
              <div className="share-subtitle">Badges verdient</div>
            </>
          );

        case 'teamer-zertifikate':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Zertifikate</div>
              <div className="share-big-number">{teamer.slides.zertifikate.total}</div>
              <div className="share-subtitle">Zertifikate erhalten</div>
            </>
          );

        case 'teamer-jahre':
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Engagement</div>
              <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.1 }}>
                {teamer.slides.engagement.jahre_aktiv}
              </div>
              <div className="share-subtitle">
                {teamer.slides.engagement.jahre_aktiv === 1 ? 'Jahr' : 'Jahre'} als Teamer:in
              </div>
            </>
          );

        case 'teamer-team': {
          if (!teamer) return null;
          const tm = teamer.slides.team;
          if (!tm) return null;
          return (
            <>
              <div className="share-label">Nicht allein</div>
              <div className="share-big-number">{tm.mitstreitende}</div>
              <div className="share-subtitle">andere waren mit mir da</div>
            </>
          );
        }

        case 'teamer-neu-dabei': {
          if (!teamer) return null;
          return (
            <>
              <div className="share-label">Dein erstes Jahr</div>
              <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.15 }}>
                Angefangen
              </div>
              <div className="share-subtitle">Mein erstes Jahr im Team</div>
            </>
          );
        }

        case 'teamer-anfang': {
          if (!teamer) return null;
          const an = teamer.slides.anfang;
          if (!an) return null;
          return (
            <>
              <div className="share-label">So fing es an</div>
              <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.15 }}>{an.name}</div>
              <div className="share-subtitle">Dein erster Termin</div>
            </>
          );
        }


        case 'teamer-antworten': {
          if (!teamer) return null;
          const ant = teamer.slides.chat?.antworten;
          if (!ant) return null;
          return (
            <>
              <div className="share-label">Im Gespräch</div>
              <div className="share-big-number">{ant}</div>
              <div className="share-subtitle">Mal geantwortet</div>
            </>
          );
        }

        case 'teamer-konfi-zeit': {
          if (!teamer) return null;
          const kz = teamer.slides.konfi_zeit;
          if (!kz) return null;
          return (
            <>
              <div className="share-label">Wie alles anfing</div>
              <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.1 }}>
                Vom Konfi<br />ins Team
              </div>
              <div className="share-subtitle">
                {kz.jahrgang ? `Selbst Konfi im Jahrgang ${kz.jahrgang}` : 'Selbst Konfi in dieser Gemeinde'}
              </div>
            </>
          );
        }

        case 'teamer-challenges': {
          const gestellt = teamer?.slides.challenges_gestellt;
          if (!gestellt?.total) return null;
          const titel = (gestellt.titel || []).filter(Boolean);
          return (
            <>
              <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)', marginBottom: 32 }}>
                Meine Challenges
              </div>
              <div style={{ fontSize: 140, fontWeight: 700, lineHeight: 1 }}>{gestellt.total}</div>
              <div style={{ fontSize: 36, marginTop: 32 }}>
                Aufgaben, die ich gestellt habe
              </div>
              {titel.length > 0 && (
                <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.7)', marginTop: 32, maxWidth: 820 }}>
                  {titel.join(' · ')}
                </div>
              )}
            </>
          );
        }

        // DER ZUSPRUCH statt eines leeren Rueckblicks.
        // Er ist teilbar wie jede andere Seite -- gerade er: Ein Segensspruch
        // ist das, was man weiterschickt.
        case 'teamer-segen': {
          if (!teamer?.slides.segen) return null;
          const { text, quelle } = teamer.slides.segen;
          return (
            <>
              <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)', marginBottom: 48 }}>
                Für dich
              </div>
              <div style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.4, maxWidth: 820 }}>
                „{text}"
              </div>
              {quelle ? (
                <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 40 }}>
                  {quelle}
                </div>
              ) : null}
            </>
          );
        }

        case 'teamer-segen-abschluss':
          if (!teamer) return null;
          return (
            <>
              <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)', marginBottom: 48 }}>
                Dein Teamerjahr {year}
              </div>
              <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.3 }}>
                Danke, dass es dich gibt.
              </div>
              <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)', marginTop: 40 }}>
                Ohne Leute wie dich gäbe es keine Konfi-Zeit.
              </div>
            </>
          );

        case 'teamer-abschluss':
          if (!teamer) return null;
          return (
            <>
              <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 48 }}>
                Dein Teamer-Jahr {year}
              </div>
              <div style={{ display: 'flex', gap: 48 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: 'var(--app-wrapped-rose)' }}>{teamer.slides.events_geleitet.total}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Events</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: 'var(--app-wrapped-rose)' }}>{teamer.slides.konfis_betreut.total_konfis}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Konfis</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 64, fontWeight: 700, color: 'var(--app-wrapped-rose)' }}>{teamer.slides.badges.total_earned}</div>
                  <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>Badges</div>
                </div>
              </div>
            </>
          );

        case 'highlight': {
          // Persoenliches Highlight (ab Snapshot-Version 3).
          if (!konfi || !konfi.slides.highlight) return null;
          const h = konfi.slides.highlight;
          const texte: Record<string, { label: string; sub: string }> = {
            chat_star: { label: 'Mein Ding: der Chat', sub: 'Nachrichten geschrieben' },
            reaktions_magnet: { label: 'Meine Nachrichten kamen an', sub: 'Reaktionen bekommen' },
            challenge_fan: { label: 'Mein Ding: Challenges', sub: 'Beiträge eingereicht' },
            verlaesslich: { label: 'Auf mich war Verlass', sub: 'Anmeldungen, keine Absage' },
          };
          const t = texte[h.type];
          if (!t) return null;
          return (
            <>
              <div className="share-label">{t.label}</div>
              <div className="share-big-number">{h.wert}</div>
              <div className="share-subtitle">{t.sub}</div>
            </>
          );
        }

        // "Dein Schwerpunkt": die Balken der Seite, auf Teilen-Groesse.
        case 'kategorie': {
          if (!konfi) return null;
          const kat = konfi.slides.kategorie;
          if (!kat?.top_kategorie) return null;
          const top = kat.verteilung.slice(0, 5);
          const max = top.length > 0 ? Math.max(...top.map(k => k.count)) : 1;
          const gross = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
          return (
            <>
              <div className="share-label">Dein Schwerpunkt</div>
              <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.1, marginBottom: 48 }}>
                {gross(kat.top_kategorie)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 820 }}>
                {top.map((k) => (
                  <div key={k.kategorie} style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    <span style={{ fontSize: 30, width: 260, textAlign: 'left' }}>{gross(k.kategorie)}</span>
                    <div style={{ flex: 1, height: 24, background: 'rgba(255,255,255,0.18)', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${(k.count / Math.max(1, max)) * 100}%`,
                        background: 'rgba(255,255,255,0.85)',
                        borderRadius: 12,
                      }} />
                    </div>
                    <span style={{ fontSize: 30, fontWeight: 700, width: 70, textAlign: 'right' }}>{k.count}</span>
                  </div>
                ))}
              </div>
            </>
          );
        }

        // Die Konfirmation. Der Ton haengt daran, ob der Termin noch
        // bevorsteht -- nach der Feier waere "bald ist es so weit" falsch.
        // Dieselbe Staffelung wie auf der Seite (KonfirmationsSlide).
        case 'konfirmation': {
          if (!konfi) return null;
          const z = konfi.slides.zeitraum;
          const roh = z && 'konfirmation' in z ? (z.konfirmation || z.ende) : z?.ende;
          if (!roh) return null;
          const termin = new Date(roh);
          const tage = tageBis(termin);
          const datum = termin.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
          const slogan = tage < 0
            ? ['Du bist', 'konfirmiert.']
            : tage === 0
              ? ['Heute', 'ist es', 'so weit.']
              : tage <= 30
                ? ['Bald', 'ist es', 'so weit.']
                : ['Noch', `${tage}`, tage === 1 ? 'Tag.' : 'Tage.'];
          const nachsatz = tage < 0
            ? `Am ${datum} war es so weit.`
            : tage === 0
              ? 'Heute. Genau heute.'
              : tage <= 30
                ? `Noch ${tage} ${tage === 1 ? 'Tag' : 'Tage'} bis zum ${datum}.`
                : `Deine Konfirmation ist am ${datum}.`;
          return (
            <>
              <div className="share-auge">Deine Konfirmation</div>
              {tage > 0 && (
                <div className="share-zahl">
                  {tage}<span className="share-zahl-mal">{tage === 1 ? ' Tag' : ' Tage'}</span>
                </div>
              )}
              <div className="share-slogan">
                {slogan.map((zeile, i) => <span key={i} style={{ display: 'block' }}>{zeile}</span>)}
              </div>
              <div className="share-nachsatz">{nachsatz}</div>
            </>
          );
        }

        // Ziel uebertroffen. Die Zahl ist der Ueberschuss, nicht der Stand --
        // das ist die Nachricht, die man teilt.
        case 'ueber-das-ziel': {
          if (!konfi) return null;
          const e = konfi.slides.endspurt;
          const ueberschuss = Math.max(0, e.aktuell_total - e.ziel_total);
          return (
            <>
              <div className="share-label">Geschafft!</div>
              <div className="share-big-number">+{ueberschuss}</div>
              <div className="share-subtitle">Punkte über dem Ziel!</div>
              <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.7)', marginTop: 32 }}>
                {e.aktuell_total} / {e.ziel_total} Punkte
              </div>
            </>
          );
        }

        case 'seltenstes': {
          if (!konfi) return null;
          const selt = konfi.slides.badges?.seltenstes;
          if (!selt?.name) return null;
          const auge = selt.prozent <= 10
            ? 'Fast niemand hat das'
            : selt.prozent <= 25
              ? 'Selten'
              : selt.prozent <= 50
                ? 'Nicht selbstverständlich'
                : 'Dein seltenstes';
          return (
            <>
              <div className="share-label">{auge}</div>
              <div style={{
                width: 220, height: 220, borderRadius: '50%', marginBottom: 32,
                background: selt.color || 'rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 96, fontWeight: 800,
              }}>
                {selt.name.charAt(0)}
              </div>
              <div style={{ fontSize: 44, fontWeight: 600, marginBottom: 24 }}>{selt.name}</div>
              <div className="share-big-number">{selt.prozent}<span style={{ fontSize: 80 }}>%</span></div>
              <div className="share-subtitle">haben das auch</div>
            </>
          );
        }

        case 'werde-teamer':
          return (
            <>
              <div className="share-auge">Und jetzt?</div>
              <div className="share-slogan">
                <span style={{ display: 'block' }}>Bleib</span>
                <span style={{ display: 'block' }}>dabei.</span>
              </div>
              <div className="share-nachsatz">
                Schreib einfach jemandem aus dem Team. Und gestalte mit —
                die Kirche und den Glauben von morgen.
              </div>
            </>
          );

        // Der Blick nach vorn waehrend der Konfizeit. Dieselben drei Stufen
        // wie in WeiterSoSlide -- der Text muss mitgepflegt werden, wenn sich
        // dort etwas aendert.
        case 'weiter-so': {
          if (!konfi) return null;
          const e = konfi.slides.endspurt;
          const ziel = e?.ziel_total ?? 0;
          const fehlend = e?.fehlende_punkte ?? 0;
          const geschafft = ziel > 0 && fehlend === 0;
          const nahDran = ziel > 0 && fehlend > 0 && fehlend <= 5;
          return (
            <>
              <div className="share-auge">
                {geschafft ? 'Dein Ziel' : nahDran ? 'Fast geschafft' : 'Und weiter'}
              </div>
              <div className="share-slogan">
                {(geschafft
                  ? ['Du hast', 'dein Ziel.']
                  : nahDran
                    ? ['Der Rest', 'ist ein', 'Katzensprung.']
                    : ['Deine Zeit', 'geht', 'weiter.']
                ).map((z, i) => (
                  <span key={i} style={{ display: 'block' }}>{z}</span>
                ))}
              </div>
              <div className="share-nachsatz">
                {geschafft
                  ? 'Alles, was jetzt noch kommt, machst du, weil du willst — nicht, weil du musst.'
                  : nahDran
                    ? `Noch ${fehlend} ${fehlend === 1 ? 'Punkt' : 'Punkte'}.`
                    : 'Es ist noch Zeit. Und es zählt nicht, wie schnell du bist — sondern dass du da bist.'}
              </div>
            </>
          );
        }

        // Die Sonderseite zur Sommerfreizeit 2026 (Stavanger). Sie steht
        // in BEIDEN Rueckblicken -- Konfis wie Team -- und braucht deshalb
        // keine Unterscheidung nach `konfi`/`teamer`: Sie zeigt in beiden
        // Faellen denselben Text, weil es dieselbe Fahrt war.
        //
        // Keine Zahl: Die 14 Tage sind fester Text (siehe
        // Stavanger2026Slide), gezaehlt wird hier nichts.
        case 'stavanger-2026':
          return (
            <>
              <div className="share-auge">Stavanger 2026</div>
              <div className="share-slogan">
                <span style={{ display: 'block' }}>Du warst</span>
                <span style={{ display: 'block' }}>dabei.</span>
              </div>
              <div className="share-nachsatz">
                14 unvergessliche Tage in Himmel og Hav.
              </div>
            </>
          );

        default:
          return null;
      }
    };

    // Der Verweis (ref) zeigt auf die KARTE, nicht mehr auf die versteckte
    // Huelle. Das ist kein Schoenheitsfehler, sondern war die Ursache des
    // gemeldeten schwarzen Bildes:
    //
    // html-to-image klont den Knoten in ein <foreignObject> und uebernimmt
    // dabei seinen berechneten Stil -- `position: fixed` bleibt, `left`
    // faellt weg. Der Inhalt landet damit ausserhalb des sichtbaren
    // Bereichs, und heraus kommt ein vollstaendig durchsichtiges Bild.
    // Gemessen: Aus der versteckten Huelle kamen 0 % gefuellte Bildpunkte,
    // aus der Karte darin 96 %. Dasselbe gilt fuer `opacity: 0` --
    // die Durchsichtigkeit wandert mit in den Klon.
    //
    // Die Huelle darf weiterhin verschoben sein: Was auf IHR steht, wird
    // nicht mitgeklont.
    return (
      <div className="share-card-container">
        <div className={bgClass} ref={ref}>
          {bild && (
            <>
              <div
                className="share-card-foto"
                style={{ backgroundImage: `url(${bild})` }}
              />
              <div className="share-card-schleier" />
              <div className="share-card-abdunklung" />
            </>
          )}
          <div className="share-card-inhalt">
            {renderContent()}
          </div>
          <div className="share-card-watermark">
            <img src="/assets/icon/icon-192x192.png" alt="" width={40} height={40} />
            <span>Konfi Quest</span>
          </div>
        </div>
      </div>
    );
  }
);

ShareCard.displayName = 'ShareCard';

export default ShareCard;
