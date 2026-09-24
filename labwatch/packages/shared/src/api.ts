import type { Branch, CiStatus, Commit, RateLimit, SourceStatus } from './schemas.js';

/** A tile on the dashboard: an app service (heartbeat) or a store (direct ping). */
export interface ServiceHealth {
  name: string;
  kind: 'service' | 'store';
  up: boolean;
  /** Last heartbeat (services) or the time of the ping (stores). */
  lastSeen: string | null;
  latencyMs: number | null;
  version: string | null;
  detail: string | null;
}

export interface Overview {
  generatedAt: string;
  repos: string[];
  services: ServiceHealth[];
  source: SourceStatus | null;
  ci: CiStatus[];
  rateLimit: RateLimit | null;
}

export interface CommitsView {
  /** Current branches (from the last poll). */
  branches: Branch[];
  /** Commit history, newest first. */
  commits: Commit[];
}
