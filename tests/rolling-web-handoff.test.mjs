import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWebHandoff} from '../scripts/rolling-web-handoff.mjs';

const plan = () => ({operationId:'00000000-0000-4000-8000-000000000001',
  previous:{slot:'blue',port:3000,buildId:'old-build'},next:{slot:'green',port:3001,buildId:'new-build'}});
function fixture(options = {}) {
  const p = plan(), events = [], live = new Set(['blue']);
  let route = {port:3000,etag:'initial'}, revision = 0;
  const log = (name, value) => events.push({name,value});
  const adapters = {
    journal:{record:async event => {log('journal',event);return true;}},
    admission:async () => {log('admission');return true;},
    start:async slot => {log('start',slot.slot);live.add(slot.slot);return true;},
    probe:async slot => {log('probe',slot.slot);return {ready:live.has(slot.slot),buildId:slot.buildId};},
    route:{
      read:async () => {log('read');return {...route};},
      switch:async (expected,port) => {
        log('switch',{expected,port});assert.deepEqual(expected,route,'CAS must use the exact current snapshot');
        route = {port,etag:`revision-${++revision}`};return {...route};
      },
    },
    confirm:async () => {log('confirm');assert.ok(live.has('blue'),'old web must survive confirmation');return true;},
    promote:async () => {log('promote');assert.ok(live.has('blue'),'old web must survive promotion');return true;},
    drain:async slot => {log('drain',slot.slot);live.delete(slot.slot);return true;},
  };
  const context = {p,adapters,events,live,getRoute:() => ({...route}),setRoute:value => {route = value;},log};
  options.configure?.(context);
  context.controller = createWebHandoff(p,adapters);
  return context;
}
const names = f => f.events.map(event => event.name);
const drained = f => f.events.filter(event => event.name === 'drain').map(event => event.value);
const run = async f => (await f.controller.run()).state;

test('old web remains live until new build is probed, switched, confirmed and promoted',async () => {
  const f = fixture();assert.equal(await run(f),'complete');
  const order = names(f), index = name => order.indexOf(name);
  assert.ok(index('admission') < index('start'));
  assert.ok(f.events.findIndex(e => e.name === 'probe' && e.value === 'blue') < index('start'));
  assert.ok(index('read') < index('start'));
  assert.ok(index('start') < f.events.findIndex(e => e.name === 'probe' && e.value === 'green'));
  assert.ok(f.events.findIndex(e => e.name === 'probe' && e.value === 'green') < index('switch'));
  assert.ok(index('switch') < index('confirm') && index('confirm') < index('promote') && index('promote') < index('drain'));
  assert.equal(order.filter(name => name === 'start').length,1);assert.deepEqual(drained(f),['blue']);
  assert.deepEqual([...f.live],['green']);assert.equal(f.getRoute().port,3001);
  const consumed = new Set();
  for (let i = 0;i < f.events.length;i++) {
    const mutation = f.events[i];
    if (['start','switch','promote','drain'].includes(mutation.name)) {
      const intent = f.events.findIndex((e,j) => j < i && !consumed.has(j) && e.name === 'journal' && e.value.phase === 'intent' && e.value.action === mutation.name);
      assert.ok(intent >= 0,
        `${mutation.name} must have a durable intent before it runs`);
      consumed.add(intent);
    }
  }
});
test('resource refusal and truthy admission objects never start candidate',async () => {
  for (const result of [false,{approved:true}]) {
    const f = fixture({configure:({adapters}) => {adapters.admission = async () => result;}});
    assert.equal(await run(f),'not-started');assert.ok(!names(f).includes('start'));assert.deepEqual(drained(f),[]);
  }
});
test('old build mismatch or unready old web refuses start',async () => {
  for (const proof of [{ready:false,buildId:'old-build'},{ready:true,buildId:'unexpected'}]) {
    const f = fixture({configure:({adapters}) => {adapters.probe = async () => proof;}});
    assert.equal(await run(f),'not-started');assert.ok(!names(f).includes('start'));assert.deepEqual(drained(f),[]);
  }
});
test('failed start never stops the old web or changes ingress',async () => {
  const f = fixture({configure:({adapters,log}) => {adapters.start = async () => {log('start');return false;};}});
  assert.equal(await run(f),'not-promoted');assert.equal(f.getRoute().port,3000);
  assert.ok(f.live.has('blue'));assert.ok(!names(f).includes('switch'));assert.ok(!drained(f).includes('blue'));
});
test('unknown start result is retained for operator recovery without cleanup',async () => {
  const f = fixture({configure:({adapters}) => {const start = adapters.start;adapters.start = async slot => {
    await start(slot);throw new Error('synthetic process acknowledgement lost');
  };}});
  assert.equal(await run(f),'recovery-required');assert.equal(f.live.size,2);assert.deepEqual(drained(f),[]);
  assert.ok(!names(f).includes('switch'));
});
test('unready or wrong-build candidate is cleaned only with original route still intact',async () => {
  for (const proof of [{ready:false,buildId:'new-build'},{ready:true,buildId:'wrong-build'}]) {
    const f = fixture({configure:({adapters}) => {const probe = adapters.probe;adapters.probe = slot => slot.slot === 'green' ? proof : probe(slot);}});
    assert.equal(await run(f),'not-promoted');assert.deepEqual(drained(f),['green']);
    assert.ok(!names(f).includes('switch'));assert.ok(f.live.has('blue'));
  }
});
test('candidate cleanup refuses route changes including an ABA change to the old port',async () => {
  for (const port of [3000,3001,4444]) {
    const f = fixture({configure:({adapters,setRoute}) => {
      const probe = adapters.probe;adapters.probe = slot => {
        if (slot.slot === 'green') {setRoute({port,etag:'someone-else'});return {ready:false,buildId:slot.buildId};}
        return probe(slot);
      };
    }});
    assert.equal(await run(f),'recovery-required');assert.deepEqual(drained(f),[]);assert.equal(f.live.size,2);
  }
});
test('unsuccessful candidate cleanup preserves the recovery requirement',async () => {
  const f = fixture({configure:({adapters}) => {
    const probe = adapters.probe;adapters.probe = slot => slot.slot === 'green' ? {ready:false,buildId:slot.buildId} : probe(slot);
    adapters.drain = async () => false;
  }});
  assert.equal(await run(f),'recovery-required');assert.equal(f.live.size,2);assert.equal(f.getRoute().port,3000);
});
test('postcheck failure CAS-restores verified old web before draining candidate',async () => {
  const f = fixture({configure:({adapters,log}) => {adapters.confirm = async () => {log('confirm');return false;};}});
  assert.equal(await run(f),'rolled-back');assert.equal(f.getRoute().port,3000);assert.deepEqual(drained(f),['green']);
  const switches = f.events.filter(e => e.name === 'switch');assert.deepEqual(switches.map(e => e.value.port),[3001,3000]);
  assert.equal(switches[1].value.expected.etag,'revision-1');assert.ok(!names(f).includes('promote'));
  assert.equal(f.events.filter(e => e.name === 'probe' && e.value === 'blue').length,2);
  assert.ok(f.events.findLastIndex(e => e.name === 'read') < f.events.findIndex(e => e.name === 'drain'));
});
test('rollback retains both versions when old readiness has disappeared',async () => {
  const f = fixture({configure:({adapters,log}) => {adapters.confirm = async () => {
    log('confirm');adapters.probe = async slot => ({ready:false,buildId:slot.buildId});return false;
  };}});
  assert.equal(await run(f),'recovery-required');assert.equal(f.getRoute().port,3001);assert.deepEqual(drained(f),[]);
  assert.equal(names(f).filter(name => name === 'switch').length,1);
});
test('postcheck concurrent route modification is never overwritten by rollback',async () => {
  const f = fixture({configure:({adapters,setRoute}) => {adapters.confirm = async () => {setRoute({port:3001,etag:'foreign'});return false;};}});
  assert.equal(await run(f),'recovery-required');assert.deepEqual(f.getRoute(),{port:3001,etag:'foreign'});
  assert.deepEqual(drained(f),[]);assert.equal(names(f).filter(name => name === 'switch').length,1);
});
test('unknown switch result preserves both versions and never retries',async () => {
  const f = fixture({configure:({adapters}) => {const write = adapters.route.switch;adapters.route.switch = async (...args) => {
    await write(...args);throw new Error('synthetic lost response');
  };}});
  assert.equal(await run(f),'recovery-required');assert.equal(f.live.size,2);assert.deepEqual(drained(f),[]);
  assert.equal(names(f).filter(name => name === 'switch').length,1);assert.ok(!names(f).includes('promote'));
});
test('CAS rejection cannot trigger a blind retry or candidate drain',async () => {
  const f = fixture({configure:({adapters,log,setRoute}) => {adapters.route.switch = async () => {
    log('switch');setRoute({port:4444,etag:'foreign'});throw new Error('synthetic CAS conflict');
  };}});
  assert.equal(await run(f),'recovery-required');assert.equal(f.getRoute().port,4444);assert.deepEqual(drained(f),[]);
  assert.equal(names(f).filter(name => name === 'switch').length,1);
});
test('ambiguous promotion or non-boolean proof retains both versions',async () => {
  for (const value of [false,{promoted:true},new Error('synthetic unknown promotion')]) {
    const f = fixture({configure:({adapters,log}) => {adapters.promote = async () => {log('promote');if (value instanceof Error) throw value;return value;};}});
    assert.equal(await run(f),'recovery-required');assert.deepEqual(drained(f),[]);assert.equal(f.live.size,2);
  }
});
test('journal failure before mutation refuses start; failure after start retains both versions',async () => {
  for (const afterStart of [false,true]) {
    const f = fixture({configure:({adapters,events}) => {adapters.journal.record = async () => {
      if (!afterStart || events.some(e => e.name === 'start')) throw new Error('synthetic fsync failure');return true;
    };}});
    assert.equal(await run(f),afterStart ? 'recovery-required' : 'not-started');assert.deepEqual(drained(f),[]);
    assert.equal(names(f).filter(name => name === 'start').length,afterStart ? 1 : 0);
  }
});
test('journal loss after promotion never authorizes stopping old web',async () => {
  const f = fixture({configure:({adapters,events}) => {adapters.journal.record = async () => {
    if (events.some(e => e.name === 'promote')) throw new Error('synthetic promotion journal loss');return true;
  };}});
  assert.equal(await run(f),'recovery-required');assert.equal(f.getRoute().port,3001);assert.deepEqual(drained(f),[]);
  assert.equal(f.live.size,2);
});
test('route change during durable promotion intent prevents promotion',async () => {
  const f = fixture({configure:({adapters,setRoute}) => {
    const record = adapters.journal.record;
    adapters.journal.record = async event => {
      const result = await record(event);
      if (event.action === 'promote' && event.phase === 'intent') setRoute({port:4444,etag:'foreign-during-promotion-fsync'});
      return result;
    };
  }});
  assert.equal(await run(f),'recovery-required');assert.ok(!names(f).includes('promote'));
  assert.deepEqual(drained(f),[]);assert.equal(f.live.size,2);assert.equal(f.getRoute().port,4444);
});
test('drain timeout retains old web without kill or replay',async () => {
  const f = fixture({configure:({adapters,log}) => {adapters.drain = async slot => {log('drain',slot.slot);return false;};}});
  assert.equal(await run(f),'complete-old-retained');assert.equal(f.live.size,2);assert.equal(f.getRoute().port,3001);
  assert.deepEqual(drained(f),['blue']);assert.equal(names(f).filter(name => name === 'switch').length,1);
});
test('route change during durable drain intent preserves both processes',async () => {
  for (const branch of ['complete','candidate-unready','rollback']) {
    const f = fixture({configure:({adapters,setRoute}) => {
      const record = adapters.journal.record,probe = adapters.probe;
      adapters.journal.record = async event => {
        const result = await record(event);
        if (event.action === 'drain' && event.phase === 'intent') setRoute({port:event.port,etag:'concurrent-during-fsync'});
        return result;
      };
      if (branch === 'candidate-unready') adapters.probe = slot => slot.slot === 'green' ? {ready:false,buildId:slot.buildId} : probe(slot);
      if (branch === 'rollback') adapters.confirm = async () => false;
    }});
    assert.equal(await run(f),'recovery-required',branch);assert.deepEqual(drained(f),[],branch);assert.equal(f.live.size,2,branch);
  }
});
test('truthy journal or start responses do not authorize later mutations',async () => {
  for (const boundary of ['journal','start']) {
    const f = fixture({configure:({adapters}) => {
      if (boundary === 'journal') adapters.journal.record = async () => ({persisted:true});
      else adapters.start = async () => ({started:true});
    }});
    assert.equal(await run(f),boundary === 'journal' ? 'not-started' : 'recovery-required');
    assert.ok(!names(f).includes('switch'));assert.deepEqual(drained(f),[]);assert.ok(f.live.has('blue'));
  }
});
test('controller is one-shot after success or refusal',async () => {
  for (const refuse of [false,true]) {
    const f = fixture({configure:({adapters}) => {if (refuse) adapters.admission = async () => false;}});
    await run(f);const before = f.events.length;await assert.rejects(() => f.controller.run());assert.equal(f.events.length,before);
  }
});
test('invalid plan fails before any adapter callback',async () => {
  for (const mutate of [p => {p.operationId = 'not-a-uuid';},p => {p.next.slot = p.previous.slot;},
    p => {p.next.port = p.previous.port;},p => {p.next.port = 1023;},p => {p.next.port = 65536;},
    p => {p.next.port = 3001.5;},p => {p.next.buildId = '../unsafe';},p => {p.previous.buildId = '';},p => {p.next.buildId = 123;},
    p => {p.next.buildId = 'x'.repeat(129);}]) {
    const f = fixture(), invalid = plan();mutate(invalid);
    await assert.rejects(async () => {await createWebHandoff(invalid,f.adapters).run();});assert.deepEqual(f.events,[]);
  }
});
test('trailing newlines in build IDs and operation IDs fail before callbacks',async () => {
  for (const mutate of [p => {p.next.buildId = 'build\n';},p => {p.operationId += '\n';}]) {
    const f = fixture(),invalid = plan();mutate(invalid);
    await assert.rejects(async () => {await createWebHandoff(invalid,f.adapters).run();});assert.deepEqual(f.events,[]);
  }
});
