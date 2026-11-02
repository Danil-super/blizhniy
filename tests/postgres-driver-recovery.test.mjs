import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:net';
import {once} from 'node:events';
import pg from 'pg';
import {PostgresDatabase,PostgresError} from '../src/lib/postgres.ts';
import {ReadOnlyInitialization} from '../src/lib/read-only-initialization.ts';

for(const mode of ['stall','disconnect'])test(`actual pg ${mode} during startup can retry after bounded backoff`,async()=>{
 const sockets=new Set();
 const server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));if(mode==='disconnect')socket.destroy();});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 let calls=0,now=0;
 const init=new ReadOnlyInitialization(async()=>{
  calls++;
  const db=new PostgresDatabase(new pg.Pool({host:'127.0.0.1',port:server.address().port,user:'synthetic',
   database:'synthetic',password:'synthetic-only',ssl:false,connectionTimeoutMillis:50}));
  try{await db.query('select 1');assert.fail('Synthetic transport never provides a PostgreSQL handshake');}
  finally{await db.close();}
 },()=>now);
 try{
  const code=mode==='stall'?'ETIMEDOUT':'ECONNRESET';
  await assert.rejects(init.get(),{name:'PostgresError',code});
  now=4999;await assert.rejects(init.get());assert.equal(calls,1);
  now=5000;await assert.rejects(init.get(),{name:'PostgresError',code});assert.equal(calls,2);
 }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});
test('driver error normalization keeps SQL/TLS failures permanent and never retains private error text',()=>{
 for(const code of ['42501','42P01','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID']){
  const error=new PostgresError(Object.assign(new Error('Connection terminated due to connection timeout'),{code}));
  assert.equal(error.code,code);assert.equal(error.message,'PostgreSQL operation failed');assert.equal(error.cause,undefined);
 }
 const wrapped=new Error('Connection terminated due to connection timeout',{cause:Object.assign(new Error('synthetic TLS failure'),{code:'CERT_HAS_EXPIRED'})});
 assert.equal(new PostgresError(wrapped).code,'CERT_HAS_EXPIRED');
 assert.equal(new PostgresError(new Error('private account value: timeout expired')).code,undefined);
 assert.equal(new PostgresError(new Error('Connection terminated')).code,undefined);
});
