import type {
  BranchesView,
  CiJob,
  CiRunDetail,
  CiRunRow,
  CommitsView,
  IntegrationStatus,
  PageArgs,
  Paged,
  Overview,
  PullDetail,
  PullRow,
  SourceProbe,
  StatusIncident,
  StatusPageView,
  StatusScale,
  StoredEvent,
  UpdateMessage,
} from '@labwatch/shared';

// The router depends only on these interfaces, not on Nest classes: its exported type
// (AppRouter, used by the web app) then pulls in nothing but plain data types.

export interface DashboardApi {
  overview(): Promise<Overview>;
  branches(): Promise<BranchesView>;
  ciRuns(args: { branch: string | null } & PageArgs): Promise<Paged<CiRunRow>>;
  ciRun(runId: number): Promise<CiRunDetail | null>;
  ciJobs(runId: number): Promise<CiJob[]>;
  commits(args: { branch: string | null; area: string | null } & PageArgs): Promise<CommitsView>;
  pulls(args: { branch: string | null } & PageArgs): Promise<Paged<PullRow>>;
  pull(number: number): Promise<PullDetail | null>;
  sourceProbes(limit: number): Promise<SourceProbe[]>;
  events(args: PageArgs): Promise<Paged<StoredEvent>>;
  statusPage(scale: StatusScale, vantage: string): Promise<StatusPageView>;
  incidents(args: PageArgs): Promise<Paged<StatusIncident>>;
  integrations(): Promise<IntegrationStatus[]>;
}

export interface UpdatesSource {
  /** Update notifications until the signal aborts (client disconnected). */
  stream(signal: AbortSignal | undefined): AsyncIterable<UpdateMessage>;
}

export interface Context {
  api: DashboardApi;
  updates: UpdatesSource;
}
