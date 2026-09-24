import { DEFAULT_VANTAGE, vantageLabel, type LabEvent, type StatusOutcome } from '@labwatch/shared';
import type { HttpCheckResult } from './http-check.js';

export interface ClassifyOptions {
  degradedMs: number;
  /** Extra "up" statuses for this target (2xx and 3xx always are). */
  okStatuses?: readonly number[];
}

/**
 * down: timeout, connection error, 5xx, unexpected 4xx. degraded: answered, but slower than the
 * threshold. TLS problems are NOT an outage (recorded separately as tls_ok / tls_error).
 */
export function classifyCheck(result: Pick<HttpCheckResult, 'httpStatus' | 'latencyMs' | 'error' | 'timedOut'>, options: ClassifyOptions): StatusOutcome {
  if (result.timedOut || result.error !== null || result.httpStatus === null) return 'down';
  const status = result.httpStatus;
  const ok = (status >= 200 && status < 400) || (options.okStatuses?.includes(status) ?? false);
  if (!ok) return 'down';
  return result.latencyMs !== null && result.latencyMs > options.degradedMs ? 'degraded' : 'operational';
}

/** Short reason for a failed check, e.g. "HTTP 503" or "timeout after 10000 ms". */
export function failureReason(result: Pick<HttpCheckResult, 'httpStatus' | 'error'>): string {
  return result.error ?? (result.httpStatus !== null ? `HTTP ${result.httpStatus}` : 'no response');
}

export type IncidentAction = 'open' | 'extend' | 'resolve' | 'none';

/** Incidents open on the transition to down and resolve on the first check that is not down. */
export function incidentAction(outcome: StatusOutcome, hasOpenIncident: boolean): IncidentAction {
  if (outcome === 'down') return hasOpenIncident ? 'extend' : 'open';
  return hasOpenIncident ? 'resolve' : 'none';
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** " (from AWS Frankfurt)" for vantages other than this PC, so the events tell the vantages apart. */
function fromVantage(vantage: string): string {
  return vantage === DEFAULT_VANTAGE ? '' : ` (from ${vantageLabel(vantage)})`;
}

export function statusDownEvent(target: { id: string; name: string; url: string }, vantage: string, reason: string, at: Date): LabEvent {
  return {
    kind: 'status.down',
    severity: 'error',
    title: `${target.name} is down${fromVantage(vantage)}: ${reason}`,
    at: at.toISOString(),
    data: { target: target.id, vantage, url: target.url, reason },
  };
}

export function statusUpEvent(target: { id: string; name: string; url: string }, vantage: string, downForS: number, at: Date): LabEvent {
  return {
    kind: 'status.up',
    severity: 'info',
    title: `${target.name} recovered${fromVantage(vantage)} after ${formatDuration(downForS)}`,
    at: at.toISOString(),
    data: { target: target.id, vantage, url: target.url, downForS },
  };
}
