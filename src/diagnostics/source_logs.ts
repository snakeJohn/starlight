export type SourceDiagnosticOperation = 'playback' | 'download';
export type SourceDiagnosticStage = 'resolve' | 'native-download' | 'speaker-play';
export type SourceDiagnosticStatus = 'success' | 'failed';

export interface SourceDiagnosticInput {
  operation: SourceDiagnosticOperation;
  stage: SourceDiagnosticStage;
  status: SourceDiagnosticStatus;
  sourceId?: string;
  sourceName?: string;
  platform: string;
  quality: string;
  title?: string;
  artist?: string;
  durationMs?: number;
  message?: string;
}

export interface SourceDiagnosticLog extends Required<Omit<SourceDiagnosticInput, 'durationMs' | 'message'>> {
  id: string;
  time: string;
  durationMs: number;
  message: string;
}

export interface SourceDiagnosticFilter {
  operation?: SourceDiagnosticOperation | 'all' | '';
  status?: SourceDiagnosticStatus | 'all' | '';
  limit?: number;
}

const MAX_LOGS = 300;

class SourceDiagnostics {
  private logs: SourceDiagnosticLog[] = [];
  private sequence = 0;

  record(input: SourceDiagnosticInput): SourceDiagnosticLog {
    this.sequence += 1;
    const log: SourceDiagnosticLog = {
      id: `${Date.now().toString(36)}_${this.sequence.toString(36)}`,
      time: new Date().toISOString(),
      operation: input.operation,
      stage: input.stage,
      status: input.status,
      sourceId: input.sourceId || '',
      sourceName: input.sourceName || input.sourceId || '',
      platform: input.platform,
      quality: input.quality,
      title: input.title || '',
      artist: input.artist || '',
      durationMs: Math.max(0, Math.round(input.durationMs || 0)),
      message: input.message || (input.status === 'success' ? '解析成功' : '未知错误'),
    };

    this.logs.push(log);
    if (this.logs.length > MAX_LOGS) {
      this.logs.splice(0, this.logs.length - MAX_LOGS);
    }
    return log;
  }

  list(filter: SourceDiagnosticFilter = {}): SourceDiagnosticLog[] {
    const operation = filter.operation || 'all';
    const status = filter.status || 'all';
    const limit = normalizeLimit(filter.limit);
    const filtered = this.logs.filter((log) => {
      if (operation !== 'all' && log.operation !== operation) return false;
      if (status !== 'all' && log.status !== status) return false;
      return true;
    });
    return filtered.slice(Math.max(0, filtered.length - limit));
  }

  clear(): void {
    this.logs = [];
  }
}

function normalizeLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return MAX_LOGS;
  }
  return Math.min(MAX_LOGS, Math.floor(numeric));
}

export const sourceDiagnostics = new SourceDiagnostics();
