import type {
  CiJob,
  CiRun,
  CommitsView,
  Overview,
  PullRequest,
  SourceProbe,
  StoredEvent,
  UpdateMessage,
} from '@labwatch/shared';

// The router depends only on these interfaces, not on Nest classes: its exported type
// (AppRouter, used by the web app) then pulls in nothing but plain data types.

export interface DashboardApi {
  overview(): Promise<Overview>;
  ciRuns(limit: number): Promise<CiRun[]>;
  ciJobs(runId: number): Promise<CiJob[]>;
  commits(limit: number): Promise<CommitsView>;
  pulls(limit: number): Promise<PullRequest[]>;
  sourceProbes(limit: number): Promise<SourceProbe[]>;
  events(limit: number): Promise<StoredEvent[]>;
}

export interface UpdatesSource {
  /** Update notifications until the signal aborts (client disconnected). */
  stream(signal: AbortSignal | undefined): AsyncIterable<UpdateMessage>;
}

export interface Context {
  api: DashboardApi;
  updates: UpdatesSource;
}
