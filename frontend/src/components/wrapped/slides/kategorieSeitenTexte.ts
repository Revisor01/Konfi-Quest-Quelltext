// kategorieSeitenTexte.ts -- die Sprueche der Kategorie- und Datums-Seiten.
//
// SIE STEHEN IN EINER EIGENEN DATEI, weil zwei Bauteile sie brauchen: die
// Seite im Rueckblick (KategorieSeiteSlide) und die Teilen-Karte
// (share/ShareCard). Beide muessen denselben Satz zeigen -- was jemand auf
// dem Bildschirm sieht, soll auch auf dem geteilten Bild stehen.

export interface SeitenText {
  /** Kleines Label ganz oben. */
  auge: string;
  /**
   * Reihenfolge: [>=10, >=5, >=3, ==2, ==1]. Vorher gab es je Seite hoechstens
   * zwei Varianten -- eine 2 und eine 12 bekamen denselben Satz, und der
   * passte dann fuer eine von beiden nicht.
   */
  stufen: [string, string, string, string, string];
  /** Warmer Nachsatz darunter. */
  nachsatz: (n: number) => string;
}

/**
 * Waehlt die Stufe zur Zahl.
 */
export function stufeFuer(stufen: SeitenText['stufen'], n: number): string {
  if (n >= 10) return stufen[0];
  if (n >= 5) return stufen[1];
  if (n >= 3) return stufen[2];
  if (n === 2) return stufen[3];
  return stufen[4];
}

export const TEXTE: Record<string, SeitenText> = {
  'kategorie:fest': {
    auge: 'Gefeiert',
    stufen: [
      'Kein Fest\nohne dich.',
      'Du feierst\ngern mit.',
      'Mehrfach\nmitgefeiert.',
      'Zweimal\nmitgefeiert.',
      'Ein Fest.\nUnd du\nmittendrin.'
    ],
    nachsatz: (n) => n === 1 ? 'Einmal dabei — und alle haben es gemerkt.' : `${n} Feste, bei denen du dabei warst.`
  },
  'kategorie:senioren': {
    auge: 'Zeit verschenkt',
    stufen: [
      'Du bist\ndort\nzu Hause.',
      'Sie kennen\ndich\ninzwischen.',
      'Du kommst\nwieder.',
      'Zweimal\nZeit\nmitgebracht.',
      'Du hast\nzugehört.'
    ],
    nachsatz: (n) => n === 1 ? 'Einmal Zeit mitgebracht — die zählt doppelt.' : `${n} Mal bei denen, die sich über Besuch freuen.`
  },
  'kategorie:jugend': {
    auge: 'Deine Leute',
    stufen: [
      'Da, wo\ndeine Leute\nsind.',
      'Stammgast\nbei der\nJugend.',
      'Oft genug\nbei deinen\nLeuten.',
      'Zweimal\nbei der\nJugend.',
      'Einmal\nreingeschaut.'
    ],
    nachsatz: (n) => `${n} Mal bei der Jugend — freiwillig, versteht sich.`
  },
  'kategorie:oeffentlichkeit': {
    auge: 'Nach draußen',
    stufen: [
      'Du bist\ndas Gesicht\nnach außen.',
      'Du hast es\nnach draußen\ngetragen.',
      'Mehrfach\nsichtbar\ngemacht.',
      'Zweimal\nnach\ndraußen.',
      'Einmal\ngezeigt,\nwas läuft.'
    ],
    nachsatz: (n) => `${n} Mal hast du gezeigt, was hier passiert.`
  },
  'kategorie:freizeit': {
    auge: 'Unterwegs',
    stufen: [
      'Der Koffer\nsteht\nbereit.',
      'Koffer packen\nkannst du.',
      'Mehrfach\nraus\naus dem Alltag.',
      'Zweimal\nunterwegs.',
      'Einmal raus.\nUnd was für\nein Mal.'
    ],
    nachsatz: (n) => n === 1 ? 'Eine Fahrt, die bleibt.' : `${n} Mal ging es raus aus dem Alltag.`
  },
  'kategorie:weihnachten': {
    auge: 'Zwischen den Lichtern',
    stufen: [
      'Die ganze\nWeihnachtszeit\nhindurch.',
      'Zwischen\nden Lichtern.',
      'Mehrfach\nim Kerzen-\nschein.',
      'Zweimal\nim Advent.',
      'Einmal,\nals es\nleuchtete.'
    ],
    nachsatz: (n) => `${n} Mal in der Advents- und Weihnachtszeit.`
  },
  'kategorie:konzert': {
    auge: 'Volle Töne',
    stufen: [
      'Du kennst\njeden Ton\nim Haus.',
      'Volle Kirche,\nvolle Töne.',
      'Mehrfach\nzugehört.',
      'Zweimal\nMusik.',
      'Ein Konzert.\nGänsehaut\ninklusive.'
    ],
    nachsatz: (n) => n === 1 ? 'Einmal Musik, die im Raum stand.' : `${n} Konzerte, bei denen du zugehört hast.`
  },
  'kategorie:kinder': {
    auge: 'Bei den Kleinen',
    stufen: [
      'Für die\nKleinen bist\ndu jemand.',
      'Die Kleinen\nkennen\ndeinen Namen.',
      'Mehrfach\nfür sie\nda gewesen.',
      'Zweimal\nbei den\nKleinen.',
      'Einmal\nfür sie\nda gewesen.'
    ],
    nachsatz: (n) => `${n} Mal warst du für sie da.`
  },
  'kategorie:kreativ': {
    auge: 'Selbst gemacht',
    stufen: [
      'Bei dir\nentsteht\nständig was.',
      'Aus nichts\nwurde\netwas.',
      'Mehrfach\nselbst\ngemacht.',
      'Zweimal\nwas\ngebaut.',
      'Einmal\nselbst\ngemacht.'
    ],
    nachsatz: (n) => `${n} Mal hast du etwas entstehen lassen.`
  },
  'kategorie:seelsorge': {
    auge: 'Zugehört',
    stufen: [
      'Du bist\njemand,\nder bleibt.',
      'Manchmal\nreicht\ndasein.',
      'Mehrfach\nzugehört.',
      'Zweimal\nZeit\ngehabt.',
      'Einmal\nwirklich\nzugehört.'
    ],
    nachsatz: (n) => `${n} Mal ging es um das, was wirklich trägt.`
  },
  // Ruhiger Ton -- hier wird nicht gescherzt.
  'kategorie:kasualien': {
    auge: 'Dabei, wenn es zählte',
    stufen: [
      'Da, wenn es\ndarauf\nankam.',
      'Du warst da,\nals es\ndarauf ankam.',
      'Mehrfach\ndabei, wenn\nes zählte.',
      'Zweimal\ndabei, wenn\nes zählte.',
      'Du warst da.'
    ],
    nachsatz: (n) => n === 1
      ? 'Einmal bei Taufe, Trauung oder Abschied.'
      : `${n} Mal bei Taufe, Trauung oder Abschied.`
  },
  'kategorie:gottesdienst': {
    auge: 'Sonntagstreu',
    stufen: [
      'Der Sonntag\ngehört dir.',
      'Sonntags\nwarst du da.',
      'Mehrfach\nsonntags\ndabei.',
      'Zweimal\nim\nGottesdienst.',
      'Einmal\nim\nGottesdienst.'
    ],
    nachsatz: (n) => `${n} Mal im Gottesdienst — und keiner war umsonst.`
  },
  'kategorie:gemeinde': {
    auge: 'Mit angepackt',
    stufen: [
      'Ohne Leute\nwie dich\nläuft nichts.',
      'Du packst\neinfach\nmit an.',
      'Mehrfach\nmit\nangepackt.',
      'Zweimal\nmit\nangepackt.',
      'Einmal\nmit\nangepackt.'
    ],
    nachsatz: (n) => `${n} Mal hast du mit angepackt.`
  },

  'datum:weihnachten': {
    auge: 'Weihnachten',
    stufen: [
      'Weihnachten\nist bei dir\nein Marathon.',
      'Die ganzen\nFeiertage\nüber da.',
      'Mehrfach\nüber\nWeihnachten.',
      'Zweimal\nüber die\nFeiertage.',
      'Weihnachten.\nDu warst\nin der Kirche.'
    ],
    nachsatz: (n) => n === 1 ? 'Während andere die Geschenke suchten.' : `${n} Mal zwischen dem 24. und 26.`
  },
  'datum:advent': {
    auge: 'Advent',
    stufen: [
      'Der ganze\nAdvent\ngehört dir.',
      'Der Kerzenschein\nkennt dich\ninzwischen.',
      'Mehrfach\nim\nKerzenschein.',
      'Zweimal\nim Advent.',
      'Es wurde dunkel.\nDu kamst\ntrotzdem.'
    ],
    nachsatz: (n) => n === 1 ? 'Einmal im Advent — mitten in der vollsten Zeit des Jahres.' : `${n} Mal im Advent dabei.`
  },
  'datum:jahreswechsel': {
    auge: 'Zwischen den Jahren',
    stufen: [
      'Zwischen\nden Jahren\nimmer da.',
      'Zwischen\nden Jahren.',
      'Mehrfach\nzwischen\nden Jahren.',
      'Zweimal\nzwischen\nden Jahren.',
      'Einmal,\nals keiner\nwusste, welcher\nTag ist.'
    ],
    nachsatz: (n) => `${n} Mal in den Tagen zwischen den Jahren.`
  },
  'datum:ostern': {
    auge: 'Passion und Ostern',
    stufen: [
      'Den ganzen\nWeg.\nBis Ostern.',
      'Durch die\nPassionszeit\ngegangen.',
      'Mehrfach\nauf dem Weg\nnach Ostern.',
      'Zweimal\nauf dem\nWeg.',
      'Einmal\nauf dem Weg\nnach Ostern.'
    ],
    nachsatz: (n) => `${n} Mal auf dem Weg durch die Passionszeit.`
  },
  // ERNTEDANK IST EIN TAG IM JAHR -- "dreimal Erntedank" gibt es im
  // Rueckblick eines Jahres nicht. Die hohen Stufen greifen nur, wenn eine
  // Ausgabe mehrere Jahre umfasst (was bei einem Abschluss-Rueckblick
  // vorkommt). Deshalb sind sie hier auf Jahre formuliert, nicht auf Male.
  'datum:erntedank': {
    auge: 'Erntedank',
    stufen: [
      'Erntedank\nohne dich?\nUndenkbar.',
      'Jahr für Jahr\nDanke\ngesagt.',
      'Mehrfach\nDanke\ngesagt.',
      'Zweimal\nDanke\ngesagt.',
      'Danke sagen\nfür das,\nwas da ist.'
    ],
    nachsatz: (n) => n === 1 ? 'Beim Erntedankfest warst du dabei.' : `${n} Mal beim Erntedank.`
  },
  'datum:sommer': {
    auge: 'Sommer',
    stufen: [
      'Dein Sommer\nwar\nrandvoll.',
      'Sommer.\nUnd du\nmittendrin.',
      'Mehrfach\nim\nSommer.',
      'Zweimal,\nals es\nwarm war.',
      'Einmal,\nals es draußen\nam schönsten war.'
    ],
    nachsatz: (n) => `${n} Mal, als es draußen am schönsten war.`
  },

  'kategorie-allgemein': {
    auge: 'Dein Schwerpunkt',
    stufen: [
      'Du hast\ndein Ding\ngefunden.',
      'Da bist du\nzu Hause.',
      'Mehrfach\nin deinem\nBereich.',
      'Zweimal\nin deinem\nBereich.',
      'Ein Anfang\nin deinem\nBereich.'
    ],
    nachsatz: (n) => `${n} Mal in deinem Bereich unterwegs.`
  }
};
