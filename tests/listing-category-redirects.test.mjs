import assert from 'node:assert/strict';
import {test} from 'node:test';

for (const kind of ['prodam', 'kuplyu', 'arenda', 'otdam-darom']) {
  test('legacy category redirects without a response body: ' + kind, async () => {
    const handlers = await import('../src/app/obyavleniya/' + kind + '/route.ts');
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const request = new Request('https://example.invalid/obyavleniya/' + kind + '?kind=other', { method });
      const response = handlers[method](request);
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('Location'), '/obyavleniya?kind=' + kind);
      assert.equal(response.body, null);
    }
  });
}
