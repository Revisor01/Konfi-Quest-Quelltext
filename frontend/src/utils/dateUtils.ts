export const getYearWeek = (date: Date): string => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const yearWeek = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${yearWeek.toString().padStart(2, '0')}`;
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

export const isToday = (date: Date | string): boolean => {
  const today = new Date();
  const d = new Date(date);
  return today.toDateString() === d.toDateString();
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



