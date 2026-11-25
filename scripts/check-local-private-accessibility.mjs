// Authenticated axe checks using only the owned local synthetic account fixture.
import assert from 'node:assert/strict';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { stateFile, stateDirectory, docker } from './local-primary-fixture.mjs';
import { readLocalPrimaryState, validateLocalPrimaryContainer } from './local-primary-config.mjs';

const root = process.cwd(), state = readLocalPrimaryState(stateFile, root);
assert.deepEqual(process.argv.slice(2), ['--run']);
assert.equal(process.env.NODE_ENV, 'test');
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect', state.containerId]))[0], state);
const buildId = (await readFile(join(root,'.next/BUILD_ID'),'utf8')).trim();
const accounts = JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8'));
const demo = JSON.parse(await readFile(join(stateDirectory,'demo-seed-plan.json'),'utf8'));
const published = demo.items.find(item => item.target === 'published');
assert.ok(demo.phase === 'completed' && /^[a-f0-9-]{36}$/.test(published?.id) && /^[a-f0-9-]{36}$/.test(published?.orderId));
const certificate = new X509Certificate(await readFile(join(stateDirectory,'tls-cert.pem')));
const spki = createHash('sha256').update(certificate.publicKey.export({ format:'der', type:'spki' })).digest('base64');
const fields = { Origin:state.origin, 'X-Blizhniy-Request':'1', 'Sec-Fetch-Site':'same-origin' };
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const cases = {
  user: ['/cabinet','/cabinet/organization','/cabinet/obyavleniya','/cabinet/chernoviki','/cabinet/bronirovaniya','/cabinet/otkliki',
    '/cabinet/oplata','/cabinet/oplata-uslugi','/cabinet/prodlit','/cabinet/phone','/cabinet/udalit-akkaunt',
    '/razmestit/obyavlenie','/rabota/vakansii/sozdat','/rabota/zakazy/sozdat','/oplata/'+published.orderId],
  admin: ['/admin','/admin/users','/admin/categories','/admin/tariffs','/admin/payments','/admin/obyavleniya','/admin/obyavleniya/'+published.id,'/admin/account-deletion'],
};
const missingCheckoutParameters = new Set(['/cabinet/oplata-uslugi','/cabinet/prodlit']);
const profiles = [
  { name:'mobile', width:375, height:812, isMobile:true },
  { name:'reflow', width:720, height:900, isMobile:false },
  { name:'desktop', width:1440, height:1000, isMobile:false },
];

const browser = await chromium.launch({ headless:true, args:['--ignore-certificate-errors-spki-list='+spki] });
const results = [];
try {
  for (const [role, paths] of Object.entries(cases)) {
    const actor = accounts.find(account => account.role === role && account.email.endsWith('@local.invalid'));
    assert.ok(actor && /^[a-f0-9-]{36}$/.test(actor.id));
    for (const { name, width, height, isMobile } of profiles) {
      const context = await browser.newContext({ serviceWorkers:'block', viewport:{ width,height }, isMobile, hasTouch:isMobile });
      await context.route('**/*', route => new URL(route.request().url()).origin === state.origin ? route.continue() : route.abort());
      const page = await context.newPage();
      try {
        await page.goto(state.origin+'/auth');
        const session = await page.evaluate(async ({ email, password, fields }) => {
          const response = await fetch('/api/account/login',{ method:'POST',headers:{...fields,'Content-Type':'application/json'},
            body:JSON.stringify({email,password,captchaToken:''}),credentials:'same-origin' });
          return {status:response.status,id:(await response.json()).user?.id};
        }, { email:actor.email,password:actor.password,fields });
        assert.deepEqual(session,{status:200,id:actor.id});
        for (const path of paths) {
          const errors = [], onError = error => errors.push(error.name);
          page.on('pageerror',onError);
          try {
            const response = await page.goto(state.origin+path,{waitUntil:'networkidle',timeout:30000});
            await page.addScriptTag({ path:axePath });
            const checked = await page.evaluate(async () => ({
              overflow:document.documentElement.scrollWidth>innerWidth,
              hasMain:document.querySelectorAll('main').length===1,
              violations:(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations
                .filter(item=>['serious','critical'].includes(item.impact))
                .map(item=>({id:item.id,impact:item.impact,targets:item.nodes.map(node=>node.target)})),
            }));
            const expectedStatus = missingCheckoutParameters.has(path) ? 404 : 200;
            const expectedPath = path === '/admin/categories' ? '/admin' : path;
            results.push({ role,layout:name,path,status:response.status(),expectedStatus,
              arrived:new URL(page.url()).pathname===expectedPath,errors,...checked });
          } finally { page.off('pageerror',onError); }
        }
        const logout = await page.evaluate(async fields => (await fetch('/api/account/logout',{
          method:'POST',headers:{...fields,'Content-Type':'application/json'},body:'{}',credentials:'same-origin',
        })).status, fields);
        assert.equal(logout,200);
      } finally { await context.close(); }
    }
  }
} finally {
  await browser.close();
  const path = join(stateDirectory,'private-accessibility-'+randomUUID()+'.json');
  await writeFile(path,JSON.stringify({buildId,results},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({buildId,checks:results.length,report:path}));
}
assert.deepEqual(results.filter(row=>row.status!==row.expectedStatus||!row.arrived||!row.hasMain||row.errors.length||row.overflow||row.violations.length),[]);
