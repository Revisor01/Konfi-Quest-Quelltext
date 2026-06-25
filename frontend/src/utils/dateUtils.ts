export const getYearWeek = (date: Date): string => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const yearWeek = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${yearWeek.toString().padStart(2, '0')}`;
};

export const getWeekOfYear = (date: Date): number => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

export const formatDate = (date: Date | string, format: string = 'DD.MM.YYYY'): string => {
  if (!date) return '';
  
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  
  switch (format) {
    case 'DD.MM.YYYY':
      return `${day}.${month}.${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD.MM.':
      return `${day}.${month}.`;
    default:
      return d.toLocaleDateString('de-DE');
  }
};

export const formatDateTime = (date: Date | string): string => {
  if (!date) return '';
  
  const d = new Date(date);
  const dateStr = formatDate(d);
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  
  return `${dateStr} ${hours}:${minutes}`;
};

export const getRelativeTime = (date: Date | string): string => {
  if (!date) return '';
  
  const now = new Date();
  const d = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000);
  
  if (diffInSeconds < 60) {
    return 'gerade eben';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `vor ${minutes} Minute${minutes !== 1 ? 'n' : ''}`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `vor ${hours} Stunde${hours !== 1 ? 'n' : ''}`;
  } else if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400);
    return `vor ${days} Tag${days !== 1 ? 'en' : ''}`;
  } else {
    return formatDate(d);
  }
};

export const isToday = (date: Date | string): boolean => {
  const today = new Date();
  const d = new Date(date);
  return today.toDateString() === d.toDateString();
};

export const isThisWeek = (date: Date | string): boolean => {
  const today = new Date();
  const d = new Date(date);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  weekStart.setHours(0, 0, 0, 0);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  return d >= weekStart && d <= weekEnd;
};

/**
 * Gets the user's local timezone
 */
export const getUserTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Converts a UTC date string to user's local time
 */
export const parseLocalTime = (dateString: string): Date => {
  if (!dateString) return new Date();
  
  // Create date from UTC string - this automatically converts to local time
  const date = new Date(dateString);
  return date;
};

/**
 * Gets current time in user's timezone
 */
export const getLocalNow = (): Date => {
  return new Date();
};

