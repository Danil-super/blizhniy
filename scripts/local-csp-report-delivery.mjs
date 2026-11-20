// Reporting API uploads run in Chromium's network service, outside page.on('response').
import assert from 'node:assert/strict';
import {once} from 'node:events';

export async function observeReportDelivery(page, origin) {
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  const browser = page.context().browser();
  const trace = await browser.newBrowserCDPSession();
  const network = await page.context().newCDPSession(page);
  const active = new Set(), statuses = [];
  let delivered = false;
  network.on('Network.reportingApiReportUpdated', ({report}) => {
    if (report.type === 'csp-violation' && report.destination === 'csp' &&
        new URL(report.initiatorUrl).origin === origin && report.status === 'Success') delivered = true;
  });
  await network.send('Network.enable');
  await network.send('Network.enableReportingApi', {enable:true});
  trace.on('Tracing.dataCollected', ({value}) => {
    for (const row of value) {
      if (row.args?.source_type !== 'URL_REQUEST') continue;
      const params = row.args.params, id = row.id2?.local;
      if (!id || !params) continue;
      if (row.name === 'URL_REQUEST_START_JOB') {
        active.delete(id);
        if (params.url === origin + '/api/csp-report' && params.method === 'POST') active.add(id);
      } else if (row.name === 'HTTP_TRANSACTION_READ_RESPONSE_HEADERS' && active.has(id)) {
        statuses.push(Number(params.headers[0].split(' ')[1]));
      }
    }
  });
  await trace.send('Tracing.start', {categories:'netlog',transferMode:'ReportEvents'});
  return async function collect() {
    try {
      const end = Date.now() + 5000;
      while (!delivered) {
        assert.ok(Date.now() < end, 'Chromium delivered the CSP report');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const complete = once(trace, 'Tracing.tracingComplete');
      await trace.send('Tracing.end');
      await complete;
      assert.ok(statuses.length > 0, 'Observed HTTP response for the background report POST');
      return statuses;
    } finally {
      await network.detach();
      await trace.detach();
    }
  };
}
