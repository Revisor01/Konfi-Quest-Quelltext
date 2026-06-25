export interface Badge {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  criteria_type: string;
  criteria_value: number;
  criteria_activity_id?: number;
  is_hidden?: boolean;
  sort_order?: number;
  awarded_date?: string;
  earned_at?: string;
}

// DashboardEvent ist jetzt ein Re-Export von Event
export type { Event as DashboardEvent } from './event';

export interface RankingEntry {
  user_id: number;
  display_name: string;
  total_points: number;
  rank: number;
  separator?: boolean;
  isCurrentUser?: boolean;
  isNeighbor?: boolean;
  initials?: string;
  actualRank?: number;
}
