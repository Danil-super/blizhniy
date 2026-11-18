// Temporary HTTPS front end for the isolated HTTP Next process. Reporting endpoints require HTTPS.
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:https';
import {request} from 'node:http';

export async function startReportTestTls(upstreamPort) {
  const dir = mkdtempSync(join(tmpdir(),'blizhniy-report-tls-'));
  let server;
  try {
    const key = join(dir,'key.pem'), cert = join(dir,'cert.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'});
    server = createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
      const upstream = request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:req.headers},reply=>{
        res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
      });
      upstream.on('error',()=>res.destroy());
      req.pipe(upstream);
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    return {origin:'https://127.0.0.1:'+server.address().port,close:()=>{server.closeAllConnections();server.close();}};
  } catch (error) {
    server?.close();throw error;
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
}
