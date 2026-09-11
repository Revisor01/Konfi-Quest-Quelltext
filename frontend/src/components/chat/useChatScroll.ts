import { useState, useEffect, useRef } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import type { PluginListenerHandle } from '@capacitor/core';
import { Message } from '../../types/chat';

/**
 * Scroll-Verhalten des Chatraums (beim Aufteilen von ChatRoom.tsx hierher
 * gezogen, Verhalten unveraendert):
 * - Initial-Scroll ans Listenende bzw. zum "Neue Nachrichten"-Trenner
 * - Auto-Scroll bei neuen Nachrichten (WhatsApp-Verhalten inkl. "Parken"
 *   am Trenner, solange der Nutzer dort liest)
 * - schwebender Tages-Chip (Tag der obersten sichtbaren Nachricht)
 * - "Nach unten"-Button ab SCROLL_DOWN_THRESHOLD Abstand zum Ende
 * - ans Ende scrollen, wenn die Tastatur auf-/zugeht
 */

// Ab welchem Abstand zum Listenende (in px) der "Nach unten"-Button erscheint.
const SCROLL_DOWN_THRESHOLD = 300;

interface ChatScrollDeps {
  messages: Message[];
  // Beim Oeffnen eingefrorene Ungelesen-Anzahl -> Scrollziel des Initial-Loads.
  initialUnreadRef: React.MutableRefObject<number | null>;
  // DOM-Knoten des "Neue Nachrichten"-Trenners (steht in der Nachrichtenliste).
  newDividerRef: React.RefObject<HTMLDivElement | null>;
}

export function useChatScroll({ messages, initialUnreadRef, newDividerRef }: ChatScrollDeps) {
  const contentRef = useRef<HTMLIonContentElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  // Schwebender Tages-Chip oben (WhatsApp-Style): zeigt den Tag der obersten
  // sichtbaren Nachricht. Genau EIN Chip -> kein Ueberlagern mehrerer Sticky-Trenner.
  const [floatingDay, setFloatingDay] = useState<string>('');
  // "Nach unten"-Button: erscheint erst, wenn der Nutzer spuerbar weiter oben
  // steht (Schwelle SCROLL_DOWN_THRESHOLD). Nahe am Ende wäre er nur Ballast,
  // weil dort ohnehin automatisch nachgescrollt wird.
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Track previous message count to only scroll on NEW messages
  const prevMessageCountRef = useRef(0);
  // Beim Initial-Load am "Neu"-Trenner geparkt? Dann KEIN Auto-Scroll nach unten,
  // bis der Nutzer selbst nach unten scrollt. Verhindert, dass die API-
  // Revalidierung (2. messages-Update nach Cache-Treffer) die Divider-Position
  // mit einem Sprung ans Listenende überschreibt.
  const parkedAtDividerRef = useRef(false);

  useEffect(() => {
    // Always scroll to bottom on initial load or new messages
    if (contentRef.current && messages.length > 0) {
      if (isInitialLoad) {
        // Initial load: wenn ungelesene Nachrichten existieren, zur ERSTEN neuen
        // scrollen (so kann man von dort nach unten lesen). Sonst ganz nach unten.
        // WICHTIG: isInitialLoad erst NACH erfolgreichem Scroll abschalten, sonst
        // überschreibt die API-Revalidierung (2. messages-Update) die Position
        // mit einem Auto-Scroll nach unten.
        const unread = initialUnreadRef.current ?? 0;
        const targetDivider = unread > 0 && unread <= messages.length;
        // requestAnimationFrame: warten bis der Divider wirklich im DOM gerendert ist.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (targetDivider && newDividerRef.current) {
              newDividerRef.current.scrollIntoView({ block: 'center' });
              // Geparkt am Trenner: nachfolgende Updates duerfen nicht nach unten springen.
              parkedAtDividerRef.current = true;
            } else {
              contentRef.current?.scrollToBottom(0);
            }
            setIsInitialLoad(false);
            // Schwebenden Tages-Chip initial befuellen.
            handleScroll();
          });
        });
      } else if (shouldAutoScroll && !parkedAtDividerRef.current && messages.length > prevMessageCountRef.current) {
        // Neue Nachricht: SOFORT ans Ende springen (0ms). Die 300ms-Animation
        // wirkte in Kombination mit dem Rendern der neuen Bubble ruckelig —
        // lieber zackig einmalig da sein.
        contentRef.current.scrollToBottom(0);
      } else if (messages.length > prevMessageCountRef.current) {
        // Neue Nachricht, aber KEIN Auto-Scroll (Nutzer liest weiter oben):
        // Der Abstand zum Ende hat sich geändert, ohne dass ein Scroll-Event
        // feuert -> Sichtbarkeit des "Nach unten"-Buttons nachziehen.
        handleScroll();
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, shouldAutoScroll, isInitialLoad]);

  // Sobald der Nutzer selbst bis ans (nahe) Listenende scrollt, "entparken" -> ab
  // dann folgen neue Nachrichten wieder automatisch nach unten (WhatsApp-Verhalten).
  // Zusaetzlich: schwebenden Tages-Chip aktualisieren (oberster sichtbarer Tag).
  const handleScroll = async () => {
    if (!contentRef.current) return;
    const scrollEl = await contentRef.current.getScrollElement();

    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;

    if (parkedAtDividerRef.current) {
      if (distanceFromBottom < 80) parkedAtDividerRef.current = false;
    }

    // "Nach unten"-Button ein-/ausblenden. Grosszuegigere Schwelle als beim
    // Entparken (80px): der Button soll erst auftauchen, wenn man wirklich
    // weiter oben liest, nicht schon bei einer halb sichtbaren Bubble.
    setShowScrollDown(prev => {
      const next = distanceFromBottom > SCROLL_DOWN_THRESHOLD;
      return prev === next ? prev : next;
    });

    // Obersten Tages-Trenner finden, der gerade noch oberhalb der Sichtgrenze
    // liegt -> dessen Tag im schwebenden Chip anzeigen.
    // WICHTIG: Marker liegen im LIGHT DOM (geslotteter ion-content-Inhalt), NICHT
    // im scrollEl (.inner-scroll im Shadow DOM) -> über contentRef suchen, sonst
    // findet querySelectorAll nichts und floatingDay bleibt leer.
    const markers = contentRef.current.querySelectorAll<HTMLElement>('[data-day-divider]');
    const containerTop = scrollEl.getBoundingClientRect().top;
    let current = '';
    for (const m of Array.from(markers)) {
      const top = m.getBoundingClientRect().top - containerTop;
      // 40px Toleranz = ungefaehre Hoehe des schwebenden Chips.
      if (top <= 40) current = m.getAttribute('data-day-divider') || '';
      else break;
    }
    // Fallback: vor dem ersten Trenner -> Tag des ersten Trenners zeigen.
    if (!current && markers.length > 0) current = markers[0].getAttribute('data-day-divider') || '';
    setFloatingDay(prev => (prev === current ? prev : current));
  };

  // Klick auf den "Nach unten"-Button: ans Listenende springen. Dabei
  // "entparken" und Auto-Scroll wieder scharf schalten — wer bewusst ans Ende
  // springt, will auch neuen Nachrichten folgen.
  const handleScrollDownClick = () => {
    parkedAtDividerRef.current = false;
    setShouldAutoScroll(true);
    setShowScrollDown(false);
    contentRef.current?.scrollToBottom(300);
  };

  // Tastatur oeffnet sich (Eingabefeld fokussiert): ans LISTENENDE scrollen, damit
  // die letzte Nachricht über der Tastatur sichtbar bleibt (WhatsApp-Verhalten).
  // Sonst verdeckt die Tastatur das Chat-Ende. Mehrere Scroll-Versuche, weil die
  // Tastatur-/Viewport-Animation je nach Plattform ~150-350ms dauert.
  const handleTextareaFocus = async () => {
    if (!contentRef.current) return;
    // Beim Tippen wollen wir immer am Ende sein -> entparken + Auto-Scroll erlauben.
    parkedAtDividerRef.current = false;
    const scrollEnd = () => contentRef.current?.scrollToBottom(250);
    // Direkt + nach der Keyboard-Animation nochmal (Viewport hat sich dann verkleinert).
    scrollEnd();
    setTimeout(scrollEnd, 150);
    setTimeout(scrollEnd, 350);
  };

  // Robuster Trigger: wenn die Tastatur auf-/zugeht (nativ), ans Listenende
  // scrollen, damit die letzte Nachricht NICHT von der Tastatur verdeckt wird.
  // Bei resize:'ionic' passt Ionic die ion-content-Hoehe an — aber teils ERST
  // nach keyboardDidShow. Ein einzelnes scrollToBottom landet dann noch am alten
  // Ende (hinter der Tastatur). Darum: mehrfach über rAF + kurze Timeouts ans
  // Ende scrollen, sodass nach dem Layout-Reflow nachgezogen wird.
  useEffect(() => {
    const handles: PluginListenerHandle[] = [];

    const scrollToEndRepeated = () => {
      parkedAtDividerRef.current = false;
      const el = contentRef.current;
      if (!el) return;
      const go = () => el.scrollToBottom(150);
      // Sofort, im nächsten Frame (nach Reflow) und nochmal verzoegert, weil die
      // Keyboard-/Resize-Animation je nach Geraet ~150-400ms dauert.
      go();
      requestAnimationFrame(() => { go(); requestAnimationFrame(go); });
      setTimeout(go, 120);
      setTimeout(go, 300);
      setTimeout(go, 500);
    };

    Keyboard.addListener('keyboardWillShow', scrollToEndRepeated)
      .then(h => handles.push(h)).catch(() => { /* Web/kein nativer Keyboard */ });
    Keyboard.addListener('keyboardDidShow', scrollToEndRepeated)
      .then(h => handles.push(h)).catch(() => { /* Web/kein nativer Keyboard */ });

    return () => { handles.forEach(h => h?.remove?.()); };
  }, []);

  return {
    contentRef,
    setShouldAutoScroll,
    floatingDay,
    showScrollDown,
    parkedAtDividerRef,
    handleScroll,
    handleScrollDownClick,
    handleTextareaFocus,
  };
}
