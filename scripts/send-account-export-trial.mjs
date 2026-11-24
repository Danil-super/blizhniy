import { createHash, randomUUID } from 'node:crypto';
import { createPostgresDatabase } from '../src/lib/postgres.ts';
import { readProductionAuthConfig } from '../src/lib/production-auth-config.ts';
import { createTimewebMailer, MailError } from '../src/lib/timeweb-mail.ts';

let db;
try {
  const [action, recipientHash] = process.argv.slice(2);
  const ownerId = process.env.BLIZHNIY_PAYMENT_TEST_USER_ID;
  if (process.argv.length !== 4 || !['--check-recipient', '--send'].includes(action) ||
      !/^[a-f0-9]{64}$/.test(recipientHash) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ownerId ?? '') ||
      process.env.BLIZHNIY_APPLICATION_PAYMENT !== 'account-response-test' || !readProductionAuthConfig())
    throw new Error('TEST mail unavailable');

  let archive;
  if (action === '--send') {
    let size = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('TEST attachment too large');
      chunks.push(chunk);
    }
    archive = Buffer.concat(chunks, size);
  }
  db = createPostgresDatabase();
  const { rows: [account] } = await db.readTransaction(tx => tx.query(
    'select email from app.users where id=$1 and email_verified_at is not null and not is_blocked', [ownerId]
  ), { timeoutMs: 5000 });
  if (!account || createHash('sha256').update(account.email).digest('hex') !== recipientHash) throw new Error('TEST recipient changed');

  if (archive) {
    const mailer = createTimewebMailer();
    if (!mailer) throw new Error('TEST mail unavailable');
    await mailer.sendAccountTrialArchive({ id: randomUUID(), to: account.email,
      subject: 'БЛИЖНИЙ · Проверка доставки архива',
      text: 'Это контрольное письмо с синтетическими данными. ZIP зашифрован. Пароль передаётся отдельно.',
    }, archive);
  }
  console.log(archive ? 'TEST mail accepted' : 'TEST recipient matched');
} catch (error) {
  console.error(error instanceof MailError ? 'TEST mail failed: ' + error.code : 'TEST mail unavailable');
  process.exitCode = 1;
} finally {
  await db?.close();
}
