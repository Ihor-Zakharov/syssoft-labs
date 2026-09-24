import type { CiJob, CiRun } from '@labwatch/shared';
import { duration, formatDate, shortSha, timeAgo } from '../format';
import { Badge, runLabel, runTone } from './Badge';

function runDuration(run: CiRun, now: number): string {
  const end = run.status === 'completed' ? new Date(run.updatedAt).getTime() : now;
  return duration(run.runStartedAt ?? run.createdAt, end);
}

function Jobs({ jobs }: { jobs: CiJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <div className="jobs">
      {jobs.map((j) => (
        <Badge key={j.id} tone={runTone(j.status, j.conclusion)}>
          {j.name}: {runLabel(j.status, j.conclusion)}
        </Badge>
      ))}
    </div>
  );
}

export function CiRuns({ runs, jobs, now }: { runs: CiRun[]; jobs: Record<string, CiJob[]>; now: number }) {
  return (
    <section className="card wide">
      <div className="card-head">
        <h2>CI runs</h2>
        <span className="muted small">{runs.filter((r) => r.status !== 'completed').length} active</span>
      </div>
      {runs.length === 0 ? (
        <p className="muted">No runs collected yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Workflow</th>
                <th>Branch</th>
                <th>Title</th>
                <th>Duration</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={r.status === 'in_progress' ? 'row-run' : undefined}>
                  <td>
                    <Badge tone={runTone(r.status, r.conclusion)}>{runLabel(r.status, r.conclusion)}</Badge>
                  </td>
                  <td>
                    <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                      {r.workflowName} #{r.runNumber}
                      {r.runAttempt > 1 ? ` (attempt ${r.runAttempt})` : ''}
                    </a>
                  </td>
                  <td className="mono small">{r.branch ?? '—'}</td>
                  <td>
                    <span className="clip">{r.title}</span>
                    <span className="muted small"> · {shortSha(r.headSha)} · {r.event}</span>
                    <Jobs jobs={jobs[String(r.id)] ?? []} />
                  </td>
                  <td className="mono small">{runDuration(r, now)}</td>
                  <td className="small" title={formatDate(r.createdAt)}>
                    {timeAgo(r.createdAt, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
