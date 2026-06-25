import { getYearWeek } from './dateUtils';

interface Activity {
  id: number;
  created_at: string;
  type?: string;
}

interface Konfi {
  id: number;
  name: string;
  total_points?: number;
  activities_count?: number;
  activities?: Activity[];
  konfi_days_attended?: number;
  jahrgang?: string;
}

interface Badge {
  id: number;
  criteria_type: string;
  criteria_value: number;
  criteria_activity_id?: number;
}

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const getProgressColor = (current: number, target: number): string => {
  const percentage = (current / target) * 100;
  if (percentage >= 100) return 'success';
  if (percentage >= 75) return 'warning';
  return 'primary';
};

export const getProgressPercentage = (current: number, target: number): number => {
  return Math.min((current / target) * 100, 100);
};

export const generatePassword = (): string => {
  const books = [
    'Genesis', 'Exodus', 'Levitikus', 'Numeri', 'Deuteronomium',
    'Josua', 'Richter', 'Ruth', 'Samuel', 'Koenige', 'Chronik',
    'Matthaeus', 'Markus', 'Lukas', 'Johannes', 'Roemer', 'Korinther'
  ];
  
  const book = books[Math.floor(Math.random() * books.length)];
  const chapter = Math.floor(Math.random() * 50) + 1;
  const verse = Math.floor(Math.random() * 30) + 1;
  
  return `${book}${chapter},${verse}`;
};

export const calculateBadgeProgress = (konfi: Konfi, badge: Badge) => {
  if (!konfi || !badge) return { current: 0, target: badge?.criteria_value || 0, percentage: 0 };
  
  const target = parseInt(badge.criteria_value.toString()) || 0;
  let current = 0;
  
  switch (badge.criteria_type) {
    case 'total_points':
      current = konfi.total_points || 0;
      break;
    case 'activities_count':
      current = konfi.activities_count || 0;
      break;
    case 'specific_activity':
      current = konfi.activities?.filter(a => a.id === badge.criteria_activity_id).length || 0;
      break;
    case 'streak':
      current = calculateWeekStreak(konfi.activities || []);
      break;
    case 'konfi_days':
      current = konfi.konfi_days_attended || 0;
      break;
    default:
      current = 0;
  }
  
  const percentage = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  
  return { current, target, percentage };
};

export const calculateWeekStreak = (activities: Activity[]): number => {
  if (!activities || activities.length === 0) return 0;
  
  const sortedActivities = activities
    .map(a => new Date(a.created_at))
    .sort((a, b) => b.getTime() - a.getTime());
  
  let streak = 0;
  let currentWeek = getYearWeek(new Date());
  
  for (const activityDate of sortedActivities) {
    const activityWeek = getYearWeek(activityDate);
    
    if (activityWeek === currentWeek) {
      streak++;
      currentWeek = `${parseInt(currentWeek.split('-W')[0])}-W${(parseInt(currentWeek.split('-W')[1]) - 1).toString().padStart(2, '0')}`;
    } else if (activityWeek < currentWeek) {
      break;
    }
  }
  
  return streak;
};

export const filterByJahrgang = <T extends { jahrgang?: string }>(items: T[], selectedJahrgang: string): T[] => {
  if (selectedJahrgang === 'alle' || !selectedJahrgang) {
    return items;
  }
  return items.filter(item => item.jahrgang === selectedJahrgang);
};

export const filterBySearchTerm = <T extends Record<string, any>>(
  items: T[], 
  searchTerm: string, 
  searchFields: string[] = ['name']
): T[] => {
  if (!searchTerm) return items;
  
  const lowerSearch = searchTerm.toLowerCase();
  return items.filter(item => 
    searchFields.some(field => 
      item[field]?.toLowerCase().includes(lowerSearch)
    )
  );
};

export const sortByDate = <T extends Record<string, any>>(
  items: T[], 
  field: string = 'created_at', 
  ascending: boolean = false
): T[] => {
  return [...items].sort((a, b) => {
    const dateA = new Date(a[field]);
    const dateB = new Date(b[field]);
    return ascending ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
  });
};

export const groupByType = (activities: Activity[]): Record<string, Activity[]> => {
  return activities.reduce((groups, activity) => {
    const type = activity.type || 'unknown';
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(activity);
    return groups;
  }, {} as Record<string, Activity[]>);
};