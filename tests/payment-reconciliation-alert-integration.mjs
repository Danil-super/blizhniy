import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import pg from 'pg';
import { runPaymentReconciliationAlert } from '../scripts/payment-reconciliation-alert.mjs';

export async function reconciliationAlertFixture(t, { admin, config, load, shop }) {
  const login = 'blizhniy_reconciliation_monitor', password = randomBytes(24).toString('hex');
  await admin.query(await readFile(new URL('../database/candidates/0073-payment-reconciliation-alert.sql', import.meta.url), 'utf8'));
  await admin.query(`create role ${login} login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(password)};
    grant connect on database blizhniy_test to ${login}`);
  await admin.query(await readFile(new URL('../database/permissions/payment-reconciliation-alert.sql', import.meta.url), 'utf8'));
  const { PostgresDatabase } = load('postgres');
  const db = new PostgresDatabase(new pg.Pool({ ...config, user: login, password, max: 1 }));
  t.after(() => db.close());
  const directory = await mkdtemp(join(tmpdir(), 'blizhniy-paid-alert-smtp-'));
  t.after(() => rm(directory, { recursive: true }));

  const messages = [], recipient = 'responsible@example.invalid';
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 smtp.example.invalid ready\r\n');
    let buffer = '', data = null, to;
    socket.on('data', chunk => {
      buffer += chunk;
      for (let newline = buffer.indexOf('\r\n'); newline !== -1; newline = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (data && line === '.') {
          messages.push({ to, raw: data.join('\r\n') });
          data = null;
          socket.write('250 message received\r\n');
        } else if (data) data.push(line);
        else if (/^(EHLO |HELO |MAIL FROM:)/.test(line)) socket.write('250 smtp.example.invalid\r\n');
        else if (line.startsWith('RCPT TO:')) {
          to = line;
          socket.write('250 recipient accepted\r\n');
        } else if (line === 'DATA') {
          data = [];
          socket.write('354 send message\r\n');
        } else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('500 unexpected command\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  const failure = error => { for (const socket of sockets) socket.destroy(error); };
  server.on('error', failure);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  await once(server, 'listening');
  const transport = nodemailer.createTransport({
    host: '127.0.0.1', port: server.address().port, secure: false,
    connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 2500,
  });
  t.after(() => transport.close());
  const { createTimewebMailer } = load('timeweb-mail');
  const mailer = createTimewebMailer({
    BLIZHNIY_MAIL_MODE: 'timeweb', BLIZHNIY_SMTP_USER: 'notifications@xn----9sbphbgks4a4a.xn--p1ai',
    BLIZHNIY_SMTP_PASSWORD: 'test-synthetic-smtp-only',
  }, () => transport);

  await assert.rejects(db.query('select intent_id from app.payment_reconciliation_jobs'), { code: '42501' });
  await assert.rejects(db.query("update app.payment_reconciliation_jobs set state='queued'"), { code: '42501' });
  await assert.rejects(db.query('select app.read_payment_reconciliation_recovery_status(null,null,null)'), { code: '42501' });
  await assert.rejects(db.query('select app.payment_reconciliation_alert_needed($1)', ['ошибка']), { code: '22023' });
  const otherShop = await db.query("select app.payment_reconciliation_alert_needed('synthetic-other-shop') as blocked");
  assert.equal(otherShop.rows[0].blocked, false);
  return { run: () => runPaymentReconciliationAlert({ db, shop, directory, recipient, mailer }), messages, recipient };
}
