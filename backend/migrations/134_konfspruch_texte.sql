-- 134_konfspruch_texte.sql
--
-- Fuellt die Konfispruch-Texte fuer Lutherbibel 2017 und Gute Nachricht Bibel.
--
-- Migration 093 hat 2026 fuer jeden der 32 Sprueche vier Uebersetzungszeilen
-- mit LEEREM Text angelegt, mit dem Vermerk, der Betreiber trage sie "aus den
-- lizenzierten Quellen" nach. Passiert ist es nie: 127 von 128 Zeilen standen
-- leer, und die App zeigte den Konfis in der Auswahl nur "Text wird noch
-- ergaenzt" — sie waehlten also aus blanken Stellenangaben.
--
--   luther2017      Lutherbibel 2017        Deutsche Bibelgesellschaft
--   gute_nachricht  Gute Nachricht Bibel    Deutsche Bibelgesellschaft
--
-- Beide fallen unter die ACK-Ausnahme der Deutschen Bibelgesellschaft:
-- Einzelverse duerfen in kostenlosen Veroeffentlichungen einer Gemeinde einer
-- ACK-Mitgliedskirche ohne vorherige Anfrage genutzt werden, gegen
-- Quellenangabe. Der Copyright-Vermerk steht in der App bei der Auswahl.
--
-- BIGS und ELBERFELDER bleiben bewusst leer. Sie gehoeren anderen Verlagen
-- (Guetersloher Verlagshaus bzw. SCM Brockhaus) mit eigenen Bedingungen; die
-- Elberfelder traegt zusaetzlich einen ausdruecklichen Vorbehalt gegen
-- automatisiertes Auslesen nach Paragraph 44b UrhG. Fuer beide steht eine
-- Verlagsanfrage aus. Bis dahin zeigt die App dort weiter den Hinweis, dass
-- der Text fehlt — das ist gewolltes Verhalten, kein Fehler.
--
-- HERKUNFT DER TEXTE: ueber die ketiv-Schnittstelle des Betreibers bezogen
-- (bible_search.php), die ihrerseits ERF Bibleserver als Quelle nennt. Wer
-- die Texte spaeter aus einer anderen Quelle beziehen will, ersetzt schlicht
-- die Werte unten — Struktur und Abfragen bleiben gleich.
--
-- Bei den Psalmen wurden die Ueberschriften abgetrennt ("Ein Psalm Davids.",
-- "Ein Wallfahrtslied."). Sie gehoeren zum Bibeltext, sind aber kein
-- Konfispruch und stuenden sonst auf der Urkunde.
--
-- Idempotent: laeuft mehrfach ohne Schaden, ueberschreibt nur leere Texte.
-- Ein vom Betreiber selbst eingetragener Text bleibt damit unangetastet.

UPDATE konfspruch_uebersetzungen ku
   SET text = q.text
  FROM (VALUES
  (1, 'gute_nachricht', 'Der HERR ist mein Hirt; darum leide ich keine Not.'),
  (1, 'luther2017', 'Der HERR ist mein Hirte, mir wird nichts mangeln.'),
  (2, 'gute_nachricht', 'Du gibst mir Halt, du bietest mir Schutz. Geh mit mir und führe mich, denn du bist mein Gott!'),
  (2, 'luther2017', 'Denn du bist mein Fels und meine Burg, und um deines Namens willen wollest du mich leiten und führen.'),
  (3, 'gute_nachricht', 'Überlass dem HERRN die Führung in deinem Leben; vertrau doch auf ihn, er macht es richtig!'),
  (3, 'luther2017', 'Befiehl dem HERRN deine Wege und hoffe auf ihn, er wird’s wohlmachen'),
  (4, 'gute_nachricht', 'Gott hat seinen Engeln befohlen, dich zu beschützen, wohin du auch gehst.'),
  (4, 'luther2017', 'Denn er hat seinen Engeln befohlen, dass sie dich behüten auf allen deinen Wegen,'),
  (5, 'gute_nachricht', 'Vom HERRN kommt meine Kraft, ihm singe ich mein Lied, denn er hat mich gerettet.'),
  (5, 'luther2017', 'Der HERR ist meine Macht und mein Psalm und ist mein Heil.'),
  (6, 'gute_nachricht', 'Dein Wort ist eine Leuchte für mein Leben, es gibt mir Licht für jeden nächsten Schritt.'),
  (6, 'luther2017', 'Dein Wort ist meines Fußes Leuchte und ein Licht auf meinem Wege.'),
  (7, 'gute_nachricht', '»Ich blicke hinauf zu den Bergen: Woher wird mir Hilfe kommen?« »Meine Hilfe kommt vom HERRN, der Himmel und Erde gemacht hat!'),
  (7, 'luther2017', 'Ich hebe meine Augen auf zu den Bergen. Woher kommt mir Hilfe? Meine Hilfe kommt vom HERRN, der Himmel und Erde gemacht hat.'),
  (8, 'gute_nachricht', 'Von allen Seiten umgibst du mich, ich bin ganz in deiner Hand.'),
  (8, 'luther2017', 'Von allen Seiten umgibst du mich und hältst deine Hand über mir.'),
  (9, 'gute_nachricht', 'Dafür danke ich dir, es erfüllt mich mit Ehrfurcht. An mir selber erkenne ich: Alle deine Taten sind Wunder!'),
  (9, 'luther2017', 'Ich danke dir dafür, dass ich wunderbar gemacht bin; wunderbar sind deine Werke; das erkennt meine Seele.'),
  (10, 'gute_nachricht', 'Ich will dich segnen und dich zum Stammvater eines mächtigen Volkes machen. Dein Name soll in aller Welt berühmt sein. An dir soll sichtbar werden, was es bedeutet, wenn ich jemand segne.'),
  (10, 'luther2017', 'Und ich will dich zum großen Volk machen und will dich segnen und dir einen großen Namen machen, und du sollst ein Segen sein.'),
  (11, 'gute_nachricht', 'Ich sage dir noch einmal: Sei mutig und entschlossen! Hab keine Angst und lass dich durch nichts erschrecken; denn ich, der HERR, dein Gott, bin bei dir, wohin du auch gehst!«'),
  (11, 'luther2017', 'Habe ich dir nicht geboten: Sei getrost und unverzagt? Lass dir nicht grauen und entsetze dich nicht; denn der HERR, dein Gott, ist mit dir in allem, was du tun wirst.'),
  (12, 'gute_nachricht', 'Doch der HERR sagte zu Samuel: »Lass dich nicht davon beeindrucken, dass er groß und stattlich ist. Er ist nicht der Erwählte. Ich urteile anders als die Menschen. Ein Mensch sieht, was in die Augen fällt; ich aber sehe ins Herz.«'),
  (12, 'luther2017', 'Aber der HERR sprach zu Samuel: Sieh nicht an sein Aussehen und seinen hohen Wuchs; ich habe ihn verworfen. Denn es ist nicht so, wie ein Mensch es sieht: Ein Mensch sieht, was vor Augen ist; der HERR aber sieht das Herz an.'),
  (13, 'gute_nachricht', 'Fürchte dich nicht, ich stehe dir bei! Hab keine Angst, ich bin dein Gott! Ich mache dich stark, ich helfe dir, ich schütze dich mit meiner siegreichen Hand!'),
  (13, 'luther2017', 'fürchte dich nicht, ich bin mit dir; weiche nicht, denn ich bin dein Gott. Ich stärke dich, ich helfe dir auch, ich halte dich durch die rechte Hand meiner Gerechtigkeit.'),
  (14, 'gute_nachricht', 'Jetzt aber sagt der HERR, der dich ins Leben gerufen hat, Volk Israel, du Nachkommenschaft Jakobs: »Fürchte dich nicht, ich habe dich befreit! Ich habe dich bei deinem Namen gerufen, du gehörst mir!'),
  (14, 'luther2017', 'Und nun spricht der HERR, der dich geschaffen hat, Jakob, und dich gemacht hat, Israel: Fürchte dich nicht, denn ich habe dich erlöst; ich habe dich bei deinem Namen gerufen; du bist mein!'),
  (15, 'gute_nachricht', 'Aber alle, die auf den HERRN vertrauen, bekommen immer wieder neue Kraft, es wachsen ihnen Flügel wie dem Adler. Sie gehen und werden nicht müde, sie laufen und brechen nicht zusammen.'),
  (15, 'luther2017', 'aber die auf den HERRN harren, kriegen neue Kraft, dass sie auffahren mit Flügeln wie Adler, dass sie laufen und nicht matt werden, dass sie wandeln und nicht müde werden.'),
  (16, 'gute_nachricht', 'denn mein Plan mit euch steht fest: Ich will euer Glück und nicht euer Unglück. Ich habe im Sinn, euch eine Zukunft zu schenken, wie ihr sie erhofft. Das sage ich, der HERR.'),
  (16, 'luther2017', 'Denn ich weiß wohl, was ich für Gedanken über euch habe, spricht der HERR: Gedanken des Friedens und nicht des Leides, dass ich euch gebe Zukunft und Hoffnung.'),
  (17, 'gute_nachricht', 'Der HERR hat dich wissen lassen, Mensch, was gut ist und was er von dir erwartet: Halte dich an das Recht, sei menschlich zu deinen Mitmenschen und lebe in steter Verbindung mit deinem Gott!'),
  (17, 'luther2017', 'Es ist dir gesagt, Mensch, was gut ist und was der HERR von dir fordert: nichts als Gottes Wort halten und Liebe üben und demütig sein vor deinem Gott.'),
  (18, 'gute_nachricht', 'Freuen dürfen sich alle, die Frieden stiften – Gott wird sie als seine Söhne und Töchter annehmen.'),
  (18, 'luther2017', 'Selig sind, die Frieden stiften; denn sie werden Gottes Kinder heißen.'),
  (19, 'gute_nachricht', 'Sorgt euch zuerst darum, dass ihr euch seiner Herrschaft unterstellt, und tut, was er verlangt, dann wird er euch schon mit all dem anderen versorgen.'),
  (19, 'luther2017', 'Trachtet zuerst nach dem Reich Gottes und nach seiner Gerechtigkeit, so wird euch das alles zufallen.'),
  (20, 'gute_nachricht', 'und lehrt sie, alles zu befolgen, was ich euch aufgetragen habe. Und das sollt ihr wissen: Ich bin immer bei euch, jeden Tag, bis zum Ende der Welt.«'),
  (20, 'luther2017', 'und lehret sie halten alles, was ich euch befohlen habe. Und siehe, ich bin bei euch alle Tage bis an der Welt Ende.'),
  (21, 'gute_nachricht', 'Gott hat die Menschen so sehr geliebt, dass er seinen einzigen Sohn hergab. Nun werden alle, die sich auf den Sohn Gottes verlassen, nicht zugrunde gehen, sondern ewig leben.'),
  (21, 'luther2017', 'Denn also hat Gott die Welt geliebt, dass er seinen eingeborenen Sohn gab, auf dass alle, die an ihn glauben, nicht verloren werden, sondern das ewige Leben haben.'),
  (22, 'gute_nachricht', 'Jesus sprach weiter zu den Leuten: »Ich bin das Licht für die Welt. Wer mir folgt, tappt nicht mehr im Dunkeln, sondern hat das Licht und mit ihm das Leben.«'),
  (22, 'luther2017', 'Da redete Jesus abermals zu ihnen und sprach: Ich bin das Licht der Welt. Wer mir nachfolgt, der wird nicht wandeln in der Finsternis, sondern wird das Licht des Lebens haben.'),
  (23, 'gute_nachricht', 'Ich gebe euch jetzt ein neues Gebot: Ihr sollt einander lieben! Genauso wie ich euch geliebt habe, sollt ihr einander lieben!'),
  (23, 'luther2017', 'Ein neues Gebot gebe ich euch, dass ihr euch untereinander liebt, wie ich euch geliebt habe, damit auch ihr einander lieb habt.'),
  (24, 'gute_nachricht', 'Ich bin der Weinstock und ihr seid die Reben. Wer mit mir verbunden bleibt, so wie ich mit ihm, bringt reiche Frucht. Denn ohne mich könnt ihr nichts ausrichten.'),
  (24, 'luther2017', 'Ich bin der Weinstock, ihr seid die Reben. Wer in mir bleibt und ich in ihm, der bringt viel Frucht; denn ohne mich könnt ihr nichts tun.'),
  (25, 'gute_nachricht', 'Was auch geschieht, das eine wissen wir: Für die, die Gott lieben, muss alles zu ihrem Heil dienen. Es sind die Menschen, die er nach seinem freien Entschluss berufen hat.'),
  (25, 'luther2017', 'Wir wissen aber, dass denen, die Gott lieben, alle Dinge zum Besten dienen, denen, die nach seinem Ratschluss berufen sind.'),
  (26, 'gute_nachricht', 'Seid fröhlich als Menschen der Hoffnung, bleibt standhaft in aller Bedrängnis, lasst nicht nach im Gebet.'),
  (26, 'luther2017', 'Seid fröhlich in Hoffnung, geduldig in Trübsal, beharrlich im Gebet.'),
  (27, 'gute_nachricht', 'Auch wenn alles einmal aufhört – Glaube, Hoffnung und Liebe nicht. Diese drei werden immer bleiben; doch am höchsten steht die Liebe.'),
  (27, 'luther2017', 'Nun aber bleiben Glaube, Hoffnung, Liebe, diese drei; aber die Liebe ist die größte unter ihnen.'),
  (28, 'gute_nachricht', 'Alles, was ihr tut, soll von der Liebe bestimmt sein.'),
  (28, 'luther2017', 'Alle eure Dinge lasst in der Liebe geschehen!'),
  (29, 'gute_nachricht', 'Der Geist Gottes dagegen lässt als Frucht eine Fülle von Gutem wachsen, nämlich: Liebe, Freude und Frieden, Geduld, Freundlichkeit und Güte, Treue,'),
  (29, 'luther2017', 'Die Frucht aber des Geistes ist Liebe, Freude, Friede, Geduld, Freundlichkeit, Güte, Treue,'),
  (30, 'gute_nachricht', 'Allem bin ich gewachsen durch den, der mich stark macht.'),
  (30, 'luther2017', 'ich vermag alles durch den, der mich mächtig macht.'),
  (31, 'gute_nachricht', 'Wir jedenfalls haben erkannt und halten im Glauben daran fest, dass Gott uns liebt. Gott ist Liebe. Wer in der Liebe lebt, lebt in Gott und Gott lebt in ihm.'),
  (31, 'luther2017', 'Und wir haben erkannt und geglaubt die Liebe, die Gott zu uns hat: Gott ist Liebe; und wer in der Liebe bleibt, der bleibt in Gott und Gott in ihm.'),
  (32, 'gute_nachricht', 'Wir lieben, weil Gott uns zuerst geliebt hat.'),
  (32, 'luther2017', 'Lasst uns lieben, denn er hat uns zuerst geliebt.')
  ) AS q(spruch_id, translation, text)
 WHERE ku.spruch_id = q.spruch_id
   AND ku.translation = q.translation
   AND ku.text = '';
