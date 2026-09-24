import { INTEGRATION_IDS, INTEGRATION_NAMES, type IntegrationLevel, type IntegrationStatus, type VendorStatus } from '@labwatch/shared';
import { formatDate, timeAgo } from '../format';
import { Badge, Dot, type Tone } from './Badge';

const LEVEL_TONE: Record<IntegrationLevel, Tone> = { connected: 'ok', degraded: 'warn', error: 'bad', inactive: 'muted' };

const COMPONENT_TONE: Record<string, Tone> = {
  operational: 'ok',
  degraded_performance: 'warn',
  partial_outage: 'partial',
  major_outage: 'bad',
  under_maintenance: 'run',
};

const INDICATOR_TONE: Record<VendorStatus['indicator'], Tone> = {
  none: 'ok',
  minor: 'warn',
  major: 'partial',
  critical: 'bad',
  maintenance: 'run',
  unknown: 'muted',
};

function Vendor({ vendor, now }: { vendor: VendorStatus | null; now: number }) {
  if (!vendor) return <p className="muted small">Vendor status: not checked yet</p>;
  return (
    <>
      <p className="vendor-line">
        <Dot tone={INDICATOR_TONE[vendor.indicator]} />
        <span>{vendor.error ? 'Vendor status: n/a' : vendor.description}</span>
        <a className="muted small" href={vendor.url} target="_blank" rel="noreferrer" title={`checked ${formatDate(vendor.checkedAt)}`}>
          {vendor.source} ↗
        </a>
      </p>
      {vendor.error && <p className="muted small">Could not read the vendor page ({vendor.error}), checked {timeAgo(vendor.checkedAt, now)}.</p>}
      {vendor.components.length > 0 && (
        <ul className="components">
          {vendor.components.map((c) => (
            <li key={c.name}>
              <Dot tone={COMPONENT_TONE[c.status] ?? 'muted'} />
              <span className="clip">{c.name}</span>
              <span className="muted small">{c.status.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      )}
      {vendor.incidents.length > 0 && (
        <ul className="list incidents">
          {vendor.incidents.map((i) => (
            <li key={`${i.name}/${i.startedAt}`} className="small">
              <Badge tone={INDICATOR_TONE[i.impact as VendorStatus['indicator']] ?? 'warn'}>{i.status}</Badge>{' '}
              {i.url ? (
                <a href={i.url} target="_blank" rel="noreferrer">
                  {i.name}
                </a>
              ) : (
                i.name
              )}
              {i.startedAt && <span className="muted"> · since {timeAgo(i.startedAt, now)}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function IntegrationCard({ status, now }: { status: IntegrationStatus; now: number }) {
  const { ours } = status;
  const tone = LEVEL_TONE[status.level];
  return (
    <article className={`card integration integration-${status.level}`}>
      <div className="card-head">
        <h2>
          <Dot tone={tone} /> {status.name}
        </h2>
        <Badge tone={tone}>{status.label}</Badge>
      </div>

      <h3 className="level-title">Our connection</h3>
      <p>{ours.summary}</p>
      {ours.facts.length > 0 && (
        <dl className="facts small">
          {ours.facts.map((f) => (
            <div key={f.label} className="fact">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {ours.workspaces && ours.workspaces.length > 0 && (
        <table className="compact small">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Mode</th>
              <th className="num">Resources</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {ours.workspaces.map((w) => (
              <tr key={w.name}>
                <td className="mono">
                  {w.name} {w.locked && <Badge tone="warn">locked</Badge>}
                </td>
                <td>{w.executionMode}</td>
                <td className="num">{w.resourceCount}</td>
                <td title={w.stateCreatedAt ? formatDate(w.stateCreatedAt) : undefined}>
                  {w.stateSerial !== null ? `#${w.stateSerial}, ${timeAgo(w.stateCreatedAt, now)}` : 'no state'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ours.hint && <p className="hint small">{ours.hint}</p>}

      <h3 className="level-title">Vendor status</h3>
      <Vendor vendor={status.vendor} now={now} />

      <p className="muted small checked">Checked {timeAgo(status.checkedAt, now)}</p>
    </article>
  );
}

/** Always three cards in a fixed order, even before the first check, so the grid never reflows. */
export function Integrations({ statuses, now }: { statuses: IntegrationStatus[] | undefined; now: number }) {
  const byId = new Map((statuses ?? []).map((s) => [s.id, s]));
  return (
    <section aria-label="Integrations" className="integrations-section">
      <h2 className="section-title">Integrations</h2>
      <div className="integrations">
        {INTEGRATION_IDS.map((id) => {
          const status = byId.get(id);
          return status ? (
            <IntegrationCard key={id} status={status} now={now} />
          ) : (
            <article key={id} className="card integration">
              <div className="card-head">
                <h2>
                  <Dot tone="muted" /> {INTEGRATION_NAMES[id]}
                </h2>
                <Badge tone="muted">not checked yet</Badge>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
