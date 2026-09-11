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

export const REACTION_EMOJIS: Record<string, ReactionEmojiData> = {
  like: { outline: ICON_DAUMEN_HOCH, filled: ICON_DAUMEN_HOCH_GEFUELLT, label: 'Gefaellt mir', color: '#3b82f6' },
  heart: { outline: ICON_HERZ, filled: ICON_HERZ_GEFUELLT, label: 'Liebe', color: '#ef4444' },
  laugh: { outline: ICON_FROEHLICH, filled: ICON_FROEHLICH_GEFUELLT, label: 'Lustig', color: '#f59e0b' },
  wow: { outline: ICON_WARNHINWEIS, filled: ICON_WARNHINWEIS_GEFUELLT, label: 'Wow', color: '#5b21b6' },
  sad: { outline: ICON_TRAURIG, filled: ICON_TRAURIG_GEFUELLT, label: 'Traurig', color: '#6b7280' },
  pray: { outline: ICON_HAND, filled: ICON_HAND_GEFUELLT, label: 'Beten', color: '#10b981' }
};
