/**
 * IANA timezone helpers for scheduling.
 * Falls back to host-local Date getters when the zone is invalid.
 */

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0=Sunday … 6=Saturday */
  weekday: number;
  /** YYYY-MM-DD */
  dateStr: string;
  /** HH:MM */
  timeStr: string;
  /** YYYY-MM-DD HH:MM */
  minuteKey: string;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function fromHostLocal(date: Date): ZonedDateTimeParts {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const weekday = date.getDay();
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    dateStr,
    timeStr,
    minuteKey: `${dateStr} ${timeStr}`,
  };
}

/**
 * Derive calendar parts for `date` in the given IANA timezone.
 */
export function getZonedParts(date: Date, timeZone?: string): ZonedDateTimeParts {
  const zone = (timeZone || '').trim();
  if (!zone) {
    return fromHostLocal(date);
  }

  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    const parts = dtf.formatToParts(date);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value || '';

    const year = Number(get('year'));
    const month = Number(get('month'));
    const day = Number(get('day'));
    // Some engines use "24" for midnight — normalize to 0.
    let hour = Number(get('hour'));
    if (hour === 24) hour = 0;
    const minute = Number(get('minute'));
    const weekdayToken = get('weekday');
    const weekday = WEEKDAY_MAP[weekdayToken] ?? fromHostLocal(date).weekday;

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return fromHostLocal(date);
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return {
      year,
      month,
      day,
      hour,
      minute,
      weekday,
      dateStr,
      timeStr,
      minuteKey: `${dateStr} ${timeStr}`,
    };
  } catch {
    return fromHostLocal(date);
  }
}
