import type { TestAnnotation, TestReportFile, TestSuiteSummary, TestTotals } from '@labwatch/shared';

/**
 * Parses the Markdown summary of a test-report check run as written by dorny/test-reporter:
 *
 *   |Report|Passed|Failed|Skipped|Time|                      ← only with several report files
 *   ## ✅ <a id="r0">TestResults/Task1.Downloader.Tests.trx</a>
 *   **48** tests were completed in **1s** with **48** passed, **0** failed and **0** skipped.
 *   |Test suite|Passed|Failed|Skipped|Time|
 *   |[Task1.Downloader.Tests.CliOptionsTests](#r0s0)|20 ✅|||5ms|
 *
 * Only structure that is stable across versions is relied on; anything unparsable yields
 * parsed = false and the UI shows the title and a link instead.
 */
export interface ParsedTestSummary extends TestTotals {
  parsed: boolean;
  files: TestReportFile[];
}

const COMPLETED =
  /\*\*(\d+)\*\*\s+tests? were completed in \*\*([^*]+)\*\*\s+with \*\*(\d+)\*\*\s+passed, \*\*(\d+)\*\*\s+failed and \*\*(\d+)\*\*\s+skipped/i;

/** Markdown/HTML decoration → plain text: links, tags, icons, surrounding spaces. */
export function plainText(cell: string): string {
  return cell
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[✅❌⚪✔✖️⚠]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function count(cell: string | undefined): number {
  const match = /\d+/.exec(cell ?? '');
  return match ? Number(match[0]) : 0;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|');
}

function isSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}/.test(line.trim());
}

/** "TestResults/Task1.Downloader.Tests.trx" → "Task1.Downloader.Tests" */
export function reportName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.(trx|xml|json)$/i, '') || path;
}

export function parseTestSummary(summary: string | null | undefined): ParsedTestSummary {
  const lines = (summary ?? '').split(/\r?\n/);
  const files: TestReportFile[] = [];
  const overview: TestReportFile[] = [];
  let heading: string | null = null;
  let current: TestReportFile | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const head = /^#{1,3}\s+(.*)$/.exec(line.trim());
    if (head) {
      heading = plainText(head[1]!);
      continue;
    }

    const done = COMPLETED.exec(line);
    if (done) {
      current = {
        name: reportName(heading ?? `report ${files.length + 1}`),
        total: Number(done[1]),
        time: done[2]!.trim(),
        passed: Number(done[3]),
        failed: Number(done[4]),
        skipped: Number(done[5]),
        suites: [],
      };
      files.push(current);
      continue;
    }

    if (isTableRow(line)) {
      const header = cells(line).map((c) => plainText(c).toLowerCase());
      if (!isSeparator(lines[i + 1] ?? '')) continue;
      const kind = header[0];
      if (kind !== 'test suite' && kind !== 'report') continue;
      i += 2;
      for (; i < lines.length && isTableRow(lines[i]!); i++) {
        const row = cells(lines[i]!);
        const entry = {
          name: plainText(row[0] ?? ''),
          passed: count(row[1]),
          failed: count(row[2]),
          skipped: count(row[3]),
          time: plainText(row[4] ?? '') || null,
        };
        if (kind === 'test suite') {
          (current?.suites as TestSuiteSummary[] | undefined)?.push(entry);
        } else {
          overview.push({ ...entry, name: reportName(entry.name), total: entry.passed + entry.failed + entry.skipped, suites: [] });
        }
      }
      i--;
    }
  }

  // Older/other formats: only the overview table
  const result = files.length > 0 ? files : overview;
  const totals = result.reduce(
    (sum, f) => ({ total: sum.total + f.total, passed: sum.passed + f.passed, failed: sum.failed + f.failed, skipped: sum.skipped + f.skipped }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  return { ...totals, parsed: result.length > 0, files: result };
}

/** Is this check run a test report (and not, e.g., the job "build-test")? */
export function isTestReportCheckRun(run: { name: string; summary: string | null }, namePattern: RegExp): boolean {
  if (namePattern.test(run.name)) return true;
  const summary = run.summary ?? '';
  return COMPLETED.test(summary) || /\|\s*Test suite\s*\|/i.test(summary);
}

export interface RawAnnotation {
  path: string;
  start_line: number | null;
  annotation_level: string;
  title: string | null;
  message: string;
}

export function mapAnnotation(raw: RawAnnotation): TestAnnotation {
  return {
    path: raw.path,
    startLine: raw.start_line,
    level: raw.annotation_level,
    title: raw.title,
    message: raw.message,
  };
}
