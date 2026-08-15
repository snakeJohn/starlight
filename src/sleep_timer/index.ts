export type SleepTimerMode = 'time' | 'songs';

export interface SleepTimerState {
  active: boolean;
  mode: SleepTimerMode;
  remaining: number;
  startedAt: number;
  total: number;
}

type ExpireCallback = () => void | Promise<void>;

/** A per-device timer that expires by wall clock time or by completed songs. */
export class SleepTimer {
  private timeout: any = null;
  private active = false;
  private mode: SleepTimerMode = 'time';
  private remaining = 0;
  private total = 0;
  private startedAt = 0;
  private generation = 0;

  constructor(private readonly onExpire: ExpireCallback) {}

  setTime(minutes: number): void {
    this.cancel();
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    this.active = true;
    this.mode = 'time';
    this.total = minutes * 60_000;
    this.remaining = this.total;
    this.startedAt = Date.now();
    const generation = ++this.generation;
    this.timeout = setTimeout(() => this.expire(generation), this.total);
  }

  setSongs(count: number): void {
    this.cancel();
    if (!Number.isFinite(count) || count <= 0) return;

    this.active = true;
    this.mode = 'songs';
    this.total = Math.floor(count);
    this.remaining = this.total;
    this.startedAt = Date.now();
  }

  onSongAdvanced(): boolean {
    if (!this.active || this.mode !== 'songs') return false;
    this.remaining -= 1;
    if (this.remaining > 0) return false;

    this.expire();
    return true;
  }

  cancel(): void {
    this.generation += 1;
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.active = false;
    this.remaining = 0;
    this.total = 0;
    this.startedAt = 0;
  }

  getState(): SleepTimerState {
    if (!this.active) {
      return { active: false, mode: 'time', remaining: 0, startedAt: 0, total: 0 };
    }
    if (this.mode === 'time') {
      return {
        active: true,
        mode: 'time',
        remaining: Math.max(0, this.total - (Date.now() - this.startedAt)),
        startedAt: this.startedAt,
        total: this.total,
      };
    }
    return { active: true, mode: 'songs', remaining: this.remaining, startedAt: this.startedAt, total: this.total };
  }

  isActive(): boolean {
    return this.active;
  }

  private expire(generation?: number): void {
    if (generation !== undefined && generation !== this.generation) return;
    if (!this.active) return;
    this.cancel();
    try {
      const result = this.onExpire();
      if (result && typeof result.then === 'function') {
        result.catch(error => songloft.log.warn('[SleepTimer] Expire callback failed: ' + String(error)));
      }
    } catch (error) {
      songloft.log.warn('[SleepTimer] Expire callback failed: ' + String(error));
    }
  }
}

function chineseToNumber(text: string): string {
  const digits: Record<string, number> = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  return text.replace(/[零一二两三四五六七八九十]+/g, (value) => {
    let total = 0;
    let current = 0;
    for (const char of Array.from(value)) {
      if (char === '十') {
        total += (current || 1) * 10;
        current = 0;
      } else {
        current = digits[char];
      }
    }
    return String(total + current);
  });
}

export function parseTimeDuration(text: string): number {
  const normalized = chineseToNumber(text);
  const halfHour = normalized.match(/(\d+(?:\.\d+)?)\s*(?:个)?半\s*小时/);
  if (halfHour) return Math.round(Number(halfHour[1]) * 60 + 30);
  if (/半\s*(?:个)?小时/.test(normalized)) return 30;

  const hours = normalized.match(/(\d+(?:\.\d+)?)\s*(?:个)?小时/);
  const minutes = normalized.match(/(\d+)\s*分(?:钟)?/);
  if (hours || minutes) {
    return Math.round((hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0));
  }
  return 0;
}

export function parseSongsCount(text: string): number {
  const match = chineseToNumber(text).match(/(\d+)\s*首/);
  return match ? Number(match[1]) : 0;
}

export function detectSleepTimerMode(text: string): SleepTimerMode | null {
  if (/首/.test(text)) return 'songs';
  if (/小时|分钟|分|半/.test(text)) return 'time';
  return null;
}

export function formatRemaining(state: SleepTimerState): string {
  if (!state.active) return '当前没有定时任务';
  if (state.mode === 'songs') return `还剩${state.remaining}首后停止`;
  const minutes = Math.ceil(state.remaining / 60_000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const extraMinutes = minutes % 60;
    return extraMinutes ? `还剩${hours}小时${extraMinutes}分钟后停止` : `还剩${hours}小时后停止`;
  }
  return `还剩${minutes}分钟后停止`;
}
