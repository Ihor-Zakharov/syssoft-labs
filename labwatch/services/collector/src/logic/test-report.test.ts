import { describe, expect, it } from 'vitest';
import { isTestReportCheckRun, parseTestSummary, plainText, reportName } from './test-report.js';

// Shape of the summary dorny/test-reporter writes for .NET trx files (two report files)
const MULTI = `|Report|Passed|Failed|Skipped|Time|
|:---|---:|---:|---:|---:|
|[TestResults/Task1.Downloader.Tests.trx](#user-content-r0)|48 ✅|||1s|
|[TestResults/Task2.CitiesDb.Tests.trx](#user-content-r1)|10 ✅|1 ❌|1 ⚪|2s|
## ✅ <a id="user-content-r0" href="#user-content-r0">TestResults/Task1.Downloader.Tests.trx</a>
**48** tests were completed in **1s** with **48** passed, **0** failed and **0** skipped.
|Test suite|Passed|Failed|Skipped|Time|
|:---|---:|---:|---:|---:|
|[Task1.Downloader.Tests.CliOptionsTests](#user-content-r0s0)|20 ✅|||5ms|
|[Task1.Downloader.Tests.ManualLightenerTests](#user-content-r0s1)|28 ✅|||12ms|
## ❌ <a id="user-content-r1" href="#user-content-r1">TestResults/Task2.CitiesDb.Tests.trx</a>
**12** tests were completed in **2s** with **10** passed, **1** failed and **1** skipped.
|Test suite|Passed|Failed|Skipped|Time|
|:---|---:|---:|---:|---:|
|[Task2.CitiesDb.Tests.RepositoryTests](#user-content-r1s0)|10 ✅|1 ❌|1 ⚪|1s|
### ❌ <a id="user-content-r1s0" href="#user-content-r1s0">Task2.CitiesDb.Tests.RepositoryTests</a>
\`\`\`
❌ ReadsThreeCities
	Assert.Equal() Failure
\`\`\`
`;

describe('parseTestSummary', () => {
  it('reads totals, report files and suites', () => {
    const r = parseTestSummary(MULTI);
    expect(r).toMatchObject({ parsed: true, total: 60, passed: 58, failed: 1, skipped: 1 });
    expect(r.files.map((f) => [f.name, f.total, f.passed, f.failed, f.skipped, f.time])).toEqual([
      ['Task1.Downloader.Tests', 48, 48, 0, 0, '1s'],
      ['Task2.CitiesDb.Tests', 12, 10, 1, 1, '2s'],
    ]);
    expect(r.files[0]!.suites).toEqual([
      { name: 'Task1.Downloader.Tests.CliOptionsTests', passed: 20, failed: 0, skipped: 0, time: '5ms' },
      { name: 'Task1.Downloader.Tests.ManualLightenerTests', passed: 28, failed: 0, skipped: 0, time: '12ms' },
    ]);
    expect(r.files[1]!.suites).toEqual([{ name: 'Task2.CitiesDb.Tests.RepositoryTests', passed: 10, failed: 1, skipped: 1, time: '1s' }]);
  });

  it('reads a single report without the overview table', () => {
    const single = MULTI.split('\n').slice(4, 10).join('\n');
    expect(parseTestSummary(single)).toMatchObject({ parsed: true, total: 48, passed: 48, files: [{ name: 'Task1.Downloader.Tests' }] });
  });

  it('falls back to the overview table when there are no detail sections', () => {
    const r = parseTestSummary(MULTI.split('\n').slice(0, 4).join('\n'));
    expect(r).toMatchObject({ parsed: true, total: 60, failed: 1 });
    expect(r.files.map((f) => f.name)).toEqual(['Task1.Downloader.Tests', 'Task2.CitiesDb.Tests']);
  });

  it('handles CRLF and "no tests found"', () => {
    const r = parseTestSummary(MULTI.replace(/\n/g, '\r\n'));
    expect(r.total).toBe(60);
    expect(parseTestSummary('## ⚪ Empty.trx\nNo tests found')).toMatchObject({ parsed: false, total: 0 });
  });

  it('degrades gracefully on unknown input', () => {
    expect(parseTestSummary(null)).toEqual({ parsed: false, total: 0, passed: 0, failed: 0, skipped: 0, files: [] });
    expect(parseTestSummary('All good!')).toMatchObject({ parsed: false });
  });
});

describe('test report helpers', () => {
  it('cleans cells and names', () => {
    expect(plainText('[A.B](#x) ✅ ')).toBe('A.B');
    expect(plainText('<a id="r0">x.trx</a>')).toBe('x.trx');
    expect(reportName('TestResults\\Task1.Downloader.Tests.trx')).toBe('Task1.Downloader.Tests');
  });

  it('recognises test-report check runs', () => {
    const pattern = /^test results/i;
    expect(isTestReportCheckRun({ name: 'Test results', summary: null }, pattern)).toBe(true);
    expect(isTestReportCheckRun({ name: 'dotnet tests', summary: MULTI }, pattern)).toBe(true);
    expect(isTestReportCheckRun({ name: 'build-test', summary: null }, pattern)).toBe(false);
    expect(isTestReportCheckRun({ name: 'review', summary: 'Looks good' }, pattern)).toBe(false);
  });
});
