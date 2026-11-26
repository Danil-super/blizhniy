import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import {Socket} from 'node:net';

// Keep the package's certificate checks while confining connections to disposable PostgreSQL.
const port=Number(process.env.BLIZHNIY_FIXTURE_PORT);
assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const connect=Socket.prototype.connect;
Socket.prototype.connect=function(service,destination,...args){
 assert.equal(service,5432);
 assert.equal(destination,'127.0.0.1');
 return connect.call(this,port,destination,...args);
};
globalThis.fetch=async()=>{
 appendFileSync(process.env.BLIZHNIY_FIXTURE_PROVIDER_LOG,'unexpected provider call\n');
 throw Error('Provider access forbidden in startup fixture');
};
