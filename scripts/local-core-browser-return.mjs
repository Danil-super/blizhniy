// Runs against the already paid synthetic draft in the HTTPS acceptance suite.
import assert from 'node:assert/strict';

export async function checkBrowserReturn(page, origin, author, kind, order, title) {
  assert.equal(origin, 'https://127.0.0.1:3045');
  if (page.url() === 'about:blank') {
    const reply = await page.request.post(origin + '/api/account/login', {
      headers: {Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-Blizhniy-Request': '1'},
      data: {email: author.email, password: author.password, captchaToken: ''},
    });
    assert.equal(reply.status(), 200);
    assert.equal((await reply.json()).user.id, author.id);
  }
  const section = {listing: 'obyavleniya', vacancy: 'vakansii', workRequest: 'zakazy'}[kind];
  assert.ok(section);
  const path = '/oplata/' + order.id + (kind === 'listing' ? '' : '?type=' + kind);
  const status = page.getByRole('region', {name: 'Статус оплаты'});
  await page.goto(origin + path);
  await status.getByRole('heading', {name: 'Размещение выполнено'}).waitFor();
  assert.equal(await status.getByRole('button', {name: 'Проверить статус'}).count(), 0);
  await page.waitForURL(origin + '/cabinet/' + section);
  const card = page.getByRole('article').filter({hasText: title});
  await card.getByText('Опубликовано', {exact: true}).waitFor();
  assert.equal(await card.count(), 1);
  await page.reload();
  await card.getByText('Опубликовано', {exact: true}).waitFor();
  assert.equal(await card.count(), 1);
}
