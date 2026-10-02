import {
  ICON_DAUMEN_HOCH,
  ICON_DAUMEN_HOCH_GEFUELLT,
  ICON_FROEHLICH,
  ICON_FROEHLICH_GEFUELLT,
  ICON_HAND,
  ICON_HAND_GEFUELLT,
  ICON_HERZ,
  ICON_HERZ_GEFUELLT,
  ICON_TRAURIG,
  ICON_TRAURIG_GEFUELLT,
  ICON_WARNHINWEIS,
  ICON_WARNHINWEIS_GEFUELLT,
} from '../shared/icons';
import { ReactionEmojiData } from '../../types/chat';

/**
 * Reaktionsfarben als CSS-Variablen: Sie stehen als Symbol-
 * und Rahmenfarbe auf Karten und muessen im Dunkelmodus heller werden.
 * `rgb` ist das -rgb-Tripel desselben Tokens fuer den durchscheinenden
 * Hintergrund der gewaehlten Reaktion (`rgba(rgb, 0.1)`).
 */
const farbe = (token: string) => ({
  color: `var(--app-color-${token})`,
  rgb: `var(--app-color-${token}-rgb)`,
});

export const REACTION_EMOJIS: Record<string, ReactionEmojiData> = {
  like: { outline: ICON_DAUMEN_HOCH, filled: ICON_DAUMEN_HOCH_GEFUELLT, label: 'Gefällt mir', ...farbe('gottesdienst') },
  heart: { outline: ICON_HERZ, filled: ICON_HERZ_GEFUELLT, label: 'Liebe', ...farbe('danger-hell') },
  laugh: { outline: ICON_FROEHLICH, filled: ICON_FROEHLICH_GEFUELLT, label: 'Lustig', ...farbe('badges') },
  wow: { outline: ICON_WARNHINWEIS, filled: ICON_WARNHINWEIS_GEFUELLT, label: 'Wow', ...farbe('konfis') },
  sad: { outline: ICON_TRAURIG, filled: ICON_TRAURIG_GEFUELLT, label: 'Traurig', ...farbe('neutral') },
  pray: { outline: ICON_HAND, filled: ICON_HAND_GEFUELLT, label: 'Beten', ...farbe('success-fresh') }
};
