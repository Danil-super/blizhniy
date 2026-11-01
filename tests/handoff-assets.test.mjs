import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,statSync,symlinkSync,linkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {verifyHandoffAssets} from '../scripts/handoff-assets.mjs';

function fixture(run) {
  const parent = mkdtempSync(join(tmpdir(),'handoff-assets-'));
  const roots = ['old','new'].map(name => join(parent,name));
  for (const root of roots) mkdirSync(root,{mode:0o700});
  const write = (index,name,contents) => {
    const path = join(roots[index],name);mkdirSync(dirname(path),{recursive:true,mode:0o700});
    writeFileSync(path,contents,{mode:0o600});return path;
  };
  try {return run({parent,roots,write});} finally {rmSync(parent,{recursive:true,force:true});}
}

test('equal duplicate asset paths are shared without modifying trusted trees',() => fixture(({roots,write}) => {
  const oldAsset = write(0,'chunks/shared.js','synthetic shared bytes');write(1,'chunks/shared.js','synthetic shared bytes');
  assert.deepEqual(verifyHandoffAssets(roots),{files:2,shared:1});
  assert.equal(statSync(oldAsset).mode & 0o777,0o600);assert.equal(statSync(roots[0]).mode & 0o777,0o700);
}));
test('same asset path with different bytes refuses handoff',() => fixture(({roots,write}) => {
  write(0,'chunks/shared.js','old synthetic chunk');write(1,'chunks/shared.js','new synthetic chunk');
  assert.throws(() => verifyHandoffAssets(roots));
}));
test('old-only and new-only assets remain counted alongside shared assets',() => fixture(({roots,write}) => {
  write(0,'chunks/shared.js','shared');write(1,'chunks/shared.js','shared');
  write(0,'chunks/old-only.js','old');write(1,'chunks/new-only.js','new');
  assert.deepEqual(verifyHandoffAssets(roots),{files:4,shared:1});
}));
test('symlink assets and symlink roots are refused',() => {
  for (const rootLink of [false,true]) fixture(({parent,roots,write}) => {
    const asset = write(0,'chunks/valid.js','synthetic');write(1,'chunks/new.js','synthetic');
    if (rootLink) {const alias = join(parent,'alias');symlinkSync(roots[0],alias);roots[0] = alias;}
    else symlinkSync(asset,join(roots[1],'linked.js'));
    assert.throws(() => verifyHandoffAssets(roots));
  });
});
test('hard-linked assets cannot be admitted as immutable files',() => fixture(({roots,write}) => {
  const asset = write(0,'chunks/valid.js','synthetic');linkSync(asset,join(roots[1],'linked.js'));
  assert.throws(() => verifyHandoffAssets(roots));
}));
test('group-writable files, directories and roots are refused',() => {
  for (const target of ['file','directory','root']) fixture(({roots,write}) => {
    const asset = write(0,'chunks/valid.js','synthetic');write(1,'chunks/new.js','synthetic');
    chmodSync(target === 'file' ? asset : target === 'directory' ? dirname(asset) : roots[0],target === 'file' ? 0o660 : 0o770);
    assert.throws(() => verifyHandoffAssets(roots));
  });
});
test('unsafe inventory names and invalid root collections are refused',() => fixture(({roots,write}) => {
  write(0,'unsafe\n.js','synthetic');assert.throws(() => verifyHandoffAssets(roots));
  for (const invalid of [null,[],[roots[0]],[...roots,roots[0]],['relative',roots[1]]]) {
    assert.throws(() => verifyHandoffAssets(invalid));
  }
}));
