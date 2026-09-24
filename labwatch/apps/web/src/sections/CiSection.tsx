import type { CiJob, CiRunRow, TestReport } from '@labwatch/shared';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Badge, ReviewBadge, TestsBadge, runLabel, runTone } from '../components/Badge';
import { duration, durationBetween, formatDate, shortSha, timeAgo } from '../format';
import { useTRPC } from '../trpc';

function runDuration(run: CiRunRow, now: number): string {
  const end = run.status === 'completed' ? new Date(run.updatedAt).getTime() : now;
  return duration(run.runStartedAt ?? run.createdAt, end);
}

function Jobs({ jobs, now }: { jobs: CiJob[]; now: number }) {
  if (jobs.length === 0) return <p className="muted small">Jobs not fetched yet.</p>;
  return (
    <div className="jobs-detail">
      {jobs.map((job) => (
        <div key={job.id} className="job">
          <div className="job-head">
            <Badge tone={runTone(job.status, job.conclusion)}>{runLabel(job.status, job.conclusion)}</Badge>
            <strong>{job.name}</strong>
            <span className="muted small mono">
              {job.completedAt ? durationBetween(job.startedAt, job.completedAt) : duration(job.startedAt, now)}
            </span>
            {job.htmlUrl && (
              <a className="small" href={job.htmlUrl} target="_blank" rel="noreferrer">
                View log ↗
              </a>
            )}
          </div>
          {job.steps.length > 0 && (
            <ol className="steps">
              {job.steps.map((step) => (
                <li key={step.number} className={`step step-${runTone(step.status, step.conclusion)}`}>
                  <span className={`dot dot-${runTone(step.status, step.conclusion)}`} aria-hidden />
                  <span className="step-name">{step.name}</span>
                  <span className="muted small">{step.conclusion ?? step.status}</span>
                  <span className="muted small mono">{durationBetween(step.startedAt, step.completedAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

function TestReportView({ report }: { report: TestReport }) {
  return (
    <div className="report">
      <div className="report-head">
        <strong>{report.name}</strong>
        {report.parsed ? (
          <>
            <Badge tone={report.failed > 0 ? 'bad' : 'ok'}>
              {report.passed} passed · {report.failed} failed · {report.skipped} skipped
            </Badge>
          </>
        ) : (
          <span className="muted small">{report.title ?? 'summary not recognised'}</span>
        )}
        {report.htmlUrl && (
          <a className="small" href={report.htmlUrl} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
        )}
      </div>
      {report.files.length > 0 && (
        <table className="compact">
          <thead>
            <tr>
              <th>Test assembly / suite</th>
              <th className="num">Passed</th>
              <th className="num">Failed</th>
              <th className="num">Skipped</th>
              <th className="num">Time</th>
            </tr>
          </thead>
          <tbody>
            {report.files.map((file) => (
              <Fragment key={file.name}>
                <tr className="report-file">
                  <td>
                    <strong>{file.name}</strong> <span className="muted small">{file.passed}/{file.total}</span>
                  </td>
                  <td className="num">{file.passed}</td>
                  <td className={`num${file.failed ? ' text-bad' : ''}`}>{file.failed}</td>
                  <td className="num">{file.skipped}</td>
                  <td className="num muted">{file.time ?? ''}</td>
                </tr>
                {file.suites.map((suite) => (
                  <tr key={`${file.name}/${suite.name}`} className="report-suite">
                    <td className="mono small">{suite.name}</td>
                    <td className="num">{suite.passed}</td>
                    <td className={`num${suite.failed ? ' text-bad' : ''}`}>{suite.failed}</td>
                    <td className="num">{suite.skipped}</td>
                    <td className="num muted">{suite.time ?? ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {report.annotations.length > 0 && (
        <ul className="annotations">
          {report.annotations.map((a, i) => (
            <li key={i} className={`annotation annotation-${a.level}`}>
              <span className="mono small">
                {a.path}
                {a.startLine !== null ? `:${a.startLine}` : ''}
              </span>
              {a.title && <strong> {a.title}</strong>}
              <pre>{a.message}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunDetail({ runId, now }: { runId: number; now: number }) {
  const trpc = useTRPC();
  const detail = useQuery(trpc.ciRun.queryOptions({ runId }));
  if (detail.isPending) return <p className="muted small">Loading…</p>;
  if (!detail.data) return <p className="muted small">Run not found.</p>;
  const { run, testReports, pr } = detail.data;
  return (
    <div className="detail">
      <div className="detail-grid">
        <section>
          <h3>Jobs</h3>
          <Jobs jobs={run.jobs} now={now} />
        </section>
        <section>
          <h3>
            Test results <span className="muted small">for commit {shortSha(run.headSha)}</span>
          </h3>
          {testReports.length === 0 ? (
            <p className="muted small">No test report for this commit.</p>
          ) : (
            testReports.map((r) => <TestReportView key={r.checkRunId} report={r} />)
          )}
          {run.review && (
            <>
              <h3>Code review</h3>
              <p>
                <ReviewBadge outcome={run.review} />{' '}
                {pr && (
                  <a className="small" href={pr.htmlUrl} target="_blank" rel="noreferrer">
                    PR #{pr.number} ↗
                  </a>
                )}
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export function CiSection({ branch, now }: { branch: string | null; now: number }) {
  const trpc = useTRPC();
  const runs = useQuery(trpc.ciRuns.queryOptions({ branch, limit: branch ? 30 : 40 }));
  const [expanded, setExpanded] = useState<number | null>(null);
  const data = runs.data ?? [];
  const columns = branch ? 7 : 8;

  return (
    <section className="card" aria-label="CI runs">
      <div className="card-head">
        <h2>{branch ? `CI runs on ${branch}` : 'CI runs · all branches'}</h2>
        <span className="muted small">{data.filter((r) => r.status !== 'completed').length} active</span>
      </div>
      {runs.isPending ? (
        <p className="muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="muted">No runs collected{branch ? ' for this branch' : ''} yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-label="Details" />
                <th>Status</th>
                <th>Workflow</th>
                {!branch && <th>Branch</th>}
                <th>Commit</th>
                <th>Results</th>
                <th>Duration</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const open = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={r.status === 'in_progress' ? 'row-run' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="expander"
                          aria-expanded={open}
                          aria-label={`${open ? 'Hide' : 'Show'} details of ${r.workflowName} #${r.runNumber}`}
                          onClick={() => setExpanded(open ? null : r.id)}
                        >
                          {open ? '▾' : '▸'}
                        </button>
                      </td>
                      <td>
                        <Badge tone={runTone(r.status, r.conclusion)}>{runLabel(r.status, r.conclusion)}</Badge>
                      </td>
                      <td>
                        <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                          {r.workflowName} #{r.runNumber}
                          {r.runAttempt > 1 ? ` (attempt ${r.runAttempt})` : ''}
                        </a>
                      </td>
                      {!branch && <td className="mono small">{r.branch ?? '—'}</td>}
                      <td>
                        <span className="clip">{r.title}</span>
                        <span className="muted small">
                          {' '}
                          · {shortSha(r.headSha)} · {r.event}
                        </span>
                        {r.jobs.length > 0 && (
                          <div className="jobs">
                            {r.jobs.map((j) => (
                              <Badge key={j.id} tone={runTone(j.status, j.conclusion)}>
                                {j.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <TestsBadge tests={r.tests} /> <ReviewBadge outcome={r.review} />
                      </td>
                      <td className="mono small">{runDuration(r, now)}</td>
                      <td className="small" title={formatDate(r.createdAt)}>
                        {timeAgo(r.createdAt, now)}
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={columns}>
                          <RunDetail runId={r.id} now={now} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
