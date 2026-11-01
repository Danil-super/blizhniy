import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readlinkSync,symlinkSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const scripts = fileURLToPath(new URL('../scripts/',import.meta.url));
const failedSha = 'a'.repeat(40);
function fixture(kind,options = {}) {
  const root = mkdtempSync(join(tmpdir(),'rollback-readiness-'));
  try {
    const releases = join(root,'releases'),previous = join(releases,'previous-old'),failed = join(releases,`failed-${failedSha.slice(0,12)}`);
    const candidate = join(root,'source'),app = join(root,'app'),bin = join(root,'bin'),trace = join(root,'trace');
    for (const release of [previous,failed,candidate]) {
      mkdirSync(join(release,'.next'),{recursive:true,mode:0o700});
      writeFileSync(join(release,'.next','BUILD_ID'),release === previous ? 'old-build' : 'new-build');
      writeFileSync(join(release,'ecosystem.config.cjs'),'module.exports = {};\n');
    }
    writeFileSync(join(failed,'.previous-release'),previous+'\n');
    symlinkSync(kind === 'manual' ? failed : previous,app);
    if (options.throughApp) {
      mkdirSync(join(failed,'scripts'),{mode:0o700});
      copyFileSync(join(scripts,'rollback-release.sh'),join(failed,'scripts','rollback-release.sh'));
      writeFileSync(join(failed,'scripts','check-rollback-readiness.mjs'),'// synthetic helper, executed through fake node only\n');
    }
    mkdirSync(bin,{mode:0o700});writeFileSync(trace,'');
    const command = (name,body) => writeFileSync(join(bin,name),'#!/usr/bin/env bash\nset -eu\n'+body,{mode:0o700});
    command('node',`printf '%s\\n' "node $*" >> "$TRACE"
case " $* " in
  *' --build-id '*) [[ -f "$1" ]] || exit 9; if [[ "$BAD_BUILD" == 1 ]]; then exit 2; fi; printf 'old-build\\n';;
  *' --probe '*)
    [[ -f "$1" ]] || exit 9
    if [[ "$CHANGE_DURING_PROBE" == 1 ]]; then ln -sfn "$FAILED_RELEASE" "$APP_DIR"; fi
    exit "$PROBE_STATUS";;
  *) exit 0;;
esac
`);
    command('pm2',`printf '%s\\n' "pm2 $*" >> "$TRACE"
if [[ "$1" == start ]]; then
  if [[ "$2" == "$PREVIOUS_RELEASE"/* ]]; then
    printf 'previous\\n' > "$ACTIVE_PROCESS"
    if [[ "$FAIL_OLD_START" == 1 ]]; then exit 1; fi
  else printf 'candidate\\n' > "$ACTIVE_PROCESS"; fi
fi
`);
    command('curl',`printf '%s\\n' "curl $*" >> "$TRACE"
if [[ -f "$ACTIVE_PROCESS" && "$(cat "$ACTIVE_PROCESS")" == previous ]]; then exit 0; fi
exit 22
`);
    command('npm','exit 0\n');command('sleep','exit 0\n');
    for (const name of ['ln','mv','mkdir']) command(name,`if [[ "$FAIL_RESTORE" == '${name}' ]]; then
  case " $* " in
    *" $PREVIOUS_RELEASE "*|*" $PREVIOUS_RELEASE/.pm2 "*|*" $APP_DIR.next "*) printf '%s\\n' 'failed-restore ${name}' >> "$TRACE";exit 1;;
  esac
fi
exec /usr/bin/${name} "$@"
`);
    const env = {...process.env,PATH:bin+':'+process.env.PATH,APP_DIR:app,APP_NAME:'synthetic-rollback-web',
      RELEASES_DIR:releases,SOURCE_DIR:candidate,PREBUILT_RELEASE:'false',PORT:'3000',COMMIT_SHA:options.sha ?? failedSha,
      TRACE:trace,PREVIOUS_RELEASE:previous,ACTIVE_PROCESS:join(root,'active'),BAD_BUILD:options.badBuild ? '1' : '0',
      FAIL_OLD_START:options.failStart ? '1' : '0',PROBE_STATUS:options.unready ? '1' : '0',
      FAIL_RESTORE:options.failRestore ?? '',CHANGE_DURING_PROBE:options.changeDuringProbe ? '1' : '0',FAILED_RELEASE:failed,
      HEALTH_URL:'http://127.0.0.1:3000/api/health',READY_URL:'http://127.0.0.1:3000/api/ready'};
    for (const key of ['SOURCE_ARCHIVE','SOURCE_ARCHIVE_SHA256','DEPLOY_RECORD']) delete env[key];
    const invoked = options.throughApp ? join(app,'scripts','rollback-release.sh') : join(scripts,kind === 'manual' ? 'rollback-release.sh' : 'deploy-release.sh');
    const result = spawnSync('bash',[invoked],
      {env,encoding:'utf8',timeout:5000});
    assert.equal(result.error,undefined,'shell fixture must complete without timeout or spawn failure');
    return {...result,lines:readFileSync(trace,'utf8').trim().split('\n').filter(Boolean),
      target:readlinkSync(app),previous,failed,previousHasHelper:existsSync(join(previous,'scripts','check-rollback-readiness.mjs'))};
  } finally {rmSync(root,{recursive:true,force:true});}
}
const isSave = line => line === 'pm2 save';
const probeIndex = result => result.lines.findIndex(line => line.startsWith('node ') && line.includes(' --probe 3000 old-build'));
const buildIndex = result => result.lines.findIndex(line => line.startsWith('node ') && line.includes(' --build-id '));

for (const kind of ['manual','automatic']) {
  test(`${kind} rollback refuses to save health-only old release when readiness fails`,() => {
    const result = fixture(kind,{unready:true});
    assert.notEqual(result.status,0);assert.ok(!result.lines.some(isSave),'unready rollback must not save the PM2 state');
    assert.doesNotMatch(result.stdout,/previous release is healthy/);
    assert.ok(probeIndex(result) >= 0,'rollback must check readiness beyond curl health');
  });
  test(`${kind} rollback never saves after the previous process fails to start`,() => {
    const result = fixture(kind,{failStart:true});
    assert.notEqual(result.status,0);assert.ok(!result.lines.some(isSave),'failed old start must not be saved as recovery');
    assert.doesNotMatch(result.stdout,/previous release is healthy/);
    assert.equal(probeIndex(result),-1,'failed start must stop before readiness and save');
  });
  test(`${kind} rollback checks fixed helper and old build before saving successful restoration`,() => {
    const result = fixture(kind),probe = probeIndex(result),save = result.lines.findIndex(isSave);
    if (kind === 'manual') assert.equal(result.status,0,result.stderr);
    assert.ok(buildIndex(result) >= 0,'old immutable build ID is validated');
    assert.ok(probe >= 0 && save > probe,'successful readiness proof must precede PM2 save');
    assert.equal(result.target,result.previous);
    for (const line of result.lines.filter(line => / --(?:build-id|probe) /.test(line))) {
      assert.ok(line.startsWith(`node ${join(scripts,'check-rollback-readiness.mjs')} `),'helper must live beside invoking script, not inside old release');
    }
  });
  test(`${kind} rollback validates old build before restoration mutations`,() => {
    const result = fixture(kind,{badBuild:true});
    assert.notEqual(result.status,0);assert.ok(!result.lines.some(isSave));
    assert.ok(buildIndex(result) >= 0,'build validation must be attempted');
    assert.ok(!result.lines.some(line => line.startsWith(`pm2 start ${result.previous}/`)));
    if (kind === 'manual') {
      assert.equal(result.target,result.failed);assert.ok(!result.lines.some(line => line.startsWith('pm2 ')));
    } else {
      assert.equal(result.lines.filter(line => line.startsWith('pm2 delete ')).length,1,'only initial candidate replacement may delete a process');
    }
  });
}
test('manual rollback preserves failed-SHA guard before helper calls or mutations',() => {
  const result = fixture('manual',{sha:'b'.repeat(40)});
  assert.equal(result.status,3);assert.equal(result.target,result.failed);assert.deepEqual(result.lines,[]);
});
test('rollback invoked through APP_DIR retains physical failed-release helper after symlink flip',() => {
  const result = fixture('manual',{throughApp:true}),probe = probeIndex(result),save = result.lines.findIndex(isSave);
  assert.equal(result.status,0,result.stderr);assert.equal(result.target,result.previous);assert.equal(result.previousHasHelper,false);
  assert.ok(buildIndex(result) >= 0 && probe > buildIndex(result) && save > probe);
  for (const line of result.lines.filter(line => / --(?:build-id|probe) /.test(line))) {
    assert.ok(line.startsWith(`node ${join(result.failed,'scripts','check-rollback-readiness.mjs')} `),'fixed helper must resolve physically before APP_DIR flips');
  }
});
for (const command of ['ln','mv','mkdir']) test(`automatic rollback stops after ${command} restoration failure`,() => {
  const result = fixture('automatic',{failRestore:command});
  assert.notEqual(result.status,0);assert.ok(result.lines.includes(`failed-restore ${command}`),'requested failure must occur inside rollback');
  assert.ok(!result.lines.some(line => line.startsWith(`pm2 start ${result.previous}/`)));
  assert.equal(probeIndex(result),-1);assert.ok(!result.lines.some(isSave));
  assert.doesNotMatch(result.stdout,/previous release passed readiness checks/);
});
for (const kind of ['manual','automatic']) test(`${kind} rollback refuses save after concurrent APP_DIR change during probe`,() => {
  const result = fixture(kind,{changeDuringProbe:true});
  assert.notEqual(result.status,0);assert.ok(probeIndex(result) >= 0);assert.equal(result.target,result.failed);
  assert.ok(!result.lines.some(isSave));assert.doesNotMatch(result.stdout,/previous release is healthy|previous release passed readiness checks/);
});
