import {
  thumbsUpOutline, thumbsUp,
  heartOutline, heart,
  happyOutline, happy,
  alertCircleOutline, alertCircle,
  sadOutline, sad,
  handLeftOutline, handLeft
} from 'ionicons/icons';
import { ReactionEmojiData } from '../../types/chat';

export const REACTION_EMOJIS: Record<string, ReactionEmojiData> = {
  like: { outline: thumbsUpOutline, filled: thumbsUp, label: 'Gefaellt mir', color: '#3b82f6' },
  heart: { outline: heartOutline, filled: heart, label: 'Liebe', color: '#ef4444' },
  laugh: { outline: happyOutline, filled: happy, label: 'Lustig', color: '#f59e0b' },
  wow: { outline: alertCircleOutline, filled: alertCircle, label: 'Wow', color: '#5b21b6' },
  sad: { outline: sadOutline, filled: sad, label: 'Traurig', color: '#6b7280' },
  pray: { outline: handLeftOutline, filled: handLeft, label: 'Beten', color: '#10b981' }
};
