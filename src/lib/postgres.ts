// Node-only module. Browser code must use same-origin API handlers, never this client.
import { X509Certificate } from "node:crypto";
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { isIP } from "node:net";
import pg from "pg";
import type { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("PostgreSQL is server-only");
}

function readCertificateAuthority(path: string): string {
  let descriptor: number | undefined;
  const invalid = () => new Error("Invalid certificate authority");
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor), uid = process.getuid?.();
    if (!info.isFile() || info.size < 1 || info.size > 65536 || uid === undefined ||
        (info.uid !== 0 && info.uid !== uid) || (info.mode & 0o022) !== 0) throw invalid();
    // The path may be replaced after open. Metadata and bounded reads refer
    // to the same inode; a special file cannot block waiting for a writer.
    const bytes = Buffer.alloc(65537);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (!length || length > 65536) throw invalid();
    const ca = bytes.subarray(0, length).toString("utf8");
    if (!new X509Certificate(ca).ca) throw invalid();
    return ca;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export function readPostgresConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  assertServer();
  const invalid = () => new Error("Invalid PostgreSQL configuration");
  if (Object.keys(env).some((key) => key.startsWith("PG"))) throw invalid();
  const required = (key: string): string => {
    const value = env[`BLIZHNIY_DB_${key}`];
    if (!value || value.includes("\0")) throw invalid();
    return value;
  };
  const host = required("HOST");
  const portText = required("PORT");
  if ((!isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)) ||
      !/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw invalid();
  const database = required("NAME");
  const user = required("USER");
  const password = required("PASSWORD");
  const mode = env.BLIZHNIY_DB_SSL_MODE ?? "verify-full";
  let ssl: PoolConfig["ssl"];
  if (mode === "disable") {
    if (!["development", "test"].includes(env.NODE_ENV ?? "") || !["127.0.0.1", "::1"].includes(host)) throw invalid();
    ssl = false;
  } else if (mode === "verify-full") {
    try {
      // Includes cleanup failures: no filesystem details leave this boundary.
      const ca = readCertificateAuthority(required("CA_FILE"));
      // pg supplies the connection hostname to Node TLS for certificate identity checks.
      ssl = { ca, rejectUnauthorized: true };
    } catch { throw invalid(); }
  } else throw invalid();
  return {
    host, port: Number(portText), database, user, password, ssl,
    application_name: "blizhniy-app", options: "-c search_path=pg_catalog,public",
    client_encoding: "UTF8", sslnegotiation: "postgres",
    max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
    maxLifetimeSeconds: 300, statement_timeout: 8000, lock_timeout: 3000,
    idle_in_transaction_session_timeout: 10000,
  };
}

export class PostgresError extends Error {
  readonly code: string | undefined;

  constructor(error: unknown) {
    super("PostgreSQL operation failed");
    this.name = "PostgresError";
    // Never retain raw messages/details. These TLS/network codes and SQLSTATE are safe.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const connectionCodes = ["ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED",
      "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"];
    const safeCode = (value: unknown): value is string => typeof value === 'string' &&
      (/^[0-9A-Z]{5}$/.test(value) || connectionCodes.includes(value));
    this.code = safeCode(code) ? code : undefined;
    if (code === undefined && error instanceof Error) {
      // pg/pg-pool emit these exact transport errors without a code. Normalize
      // before discarding messages; explicit SQL/TLS codes always take precedence.
      const cause = error.cause;
      const causeCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
      if (safeCode(causeCode)) this.code = causeCode;
      else if (causeCode === undefined) {
        this.code = new Map([
          ['Connection terminated due to connection timeout', 'ETIMEDOUT'],
          ['timeout exceeded when trying to connect', 'ETIMEDOUT'],
          ['timeout expired', 'ETIMEDOUT'],
          ['Connection terminated unexpectedly', 'ECONNRESET'],
          ['Query read timeout', 'ETIMEDOUT'],
        ]).get(error.message);
      }
    }
  }
}

export interface PostgresQueries {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

async function query<Row extends QueryResultRow>(
  connection: Pool | PoolClient, text: string, values: unknown[] = [], timeoutMs?:number,
): Promise<QueryResult<Row>> {
  try {
    // Extended protocol rejects multiple statements, even when values is empty.
    // @types/pg does not yet declare pg's supported queryMode option.
    const statement = { text, values, queryMode: "extended", ...(timeoutMs===undefined?{}:{query_timeout:timeoutMs}) };
    return await connection.query<Row>(statement);
  } catch (error) { throw new PostgresError(error); }
}

export class PostgresDatabase implements PostgresQueries {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    assertServer();
    this.pool = pool;
    pool.on("error", () => { console.error("PostgreSQL idle connection failed"); });
  }

  query<Row extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return query<Row>(this.pool, text, values);
  }

  async transaction<T>(
    work: (queries: PostgresQueries) => Promise<T>, options: { readOnly?: boolean } = {},
  ): Promise<T> {
    let client: PoolClient;
    try { client = await this.pool.connect(); }
    catch (error) { throw new PostgresError(error); }
    let began = false;
    let committing = false;
    let discard = false;
    try {
      await query(client, options.readOnly ? "BEGIN READ ONLY" : "BEGIN");
      began = true;
      const result = await work({ query: (text, values) => query(client, text, values) });
      committing = true;
      await query(client, "COMMIT");
      return result;
    } catch (error) {
      discard = !began || committing;
      if (began) {
        try { await query(client, "ROLLBACK"); }
        catch { discard = true; }
      }
      // No retries: a failed COMMIT response does not prove that the write failed.
      throw error;
    } finally { client.release(discard ? true : undefined); }
  }

  /** Public bounded reads only. Existing auth/payment transaction semantics stay separate. */
  async readTransaction<T>(work:(queries:PostgresQueries)=>Promise<T>,options:{timeoutMs:number;onComplete?:()=>void}):Promise<T>{
    if(!Number.isSafeInteger(options?.timeoutMs)||options.timeoutMs<1||options.timeoutMs>5000)throw Error('Invalid read deadline');
    const deadline=performance.now()+options.timeoutMs;
    const timeout=()=>new PostgresError({code:'ETIMEDOUT'});
    let expired=false,completed=false,released=false,client:PoolClient|undefined;
    const remaining=()=>{const value=Math.ceil(deadline-performance.now());if(expired||released||completed||value<=0)throw timeout();return value;};
    const complete=()=>{if(!completed){completed=true;options.onComplete?.();}};
    const release=(discard:boolean)=>{if(client&&!released){released=true;try{client.release(discard);}finally{complete();}}};
    return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{
        expired=true;release(true);reject(timeout());
        // Pending pool checkout retains its admission lease until the actual
        // callback settles. It cannot start SQL after this caller has timed out.
      },options.timeoutMs);
      try{this.pool.connect((error,connection)=>{
        if(expired){connection?.release(true);complete();return;}
        if(error||!connection){clearTimeout(timer);complete();reject(new PostgresError(error));return;}
        client=connection;
        const bounded:PostgresQueries={query:async<Row extends QueryResultRow>(text:string,values:unknown[]=[])=>{
          const result=await query<Row>(connection,text,values,remaining());remaining();return result;
        }};
        const run=async()=>{
          try{
            await bounded.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const budget=remaining();
            await bounded.query("select set_config('statement_timeout',$1,true),set_config('transaction_timeout',$2,true)",[String(Math.min(3000,budget)),String(budget)]);
            const result=await work(bounded);
            await bounded.query('COMMIT');release(false);return result;
          }catch(error){release(true);throw error;}
          finally{clearTimeout(timer);}
        };
        // Consume late completion/errors too. Timeout destroys the connection
        // before rejection; every later query and COMMIT checks the same latch.
        void run().then(resolve,reject);
      });}catch(error){clearTimeout(timer);complete();reject(new PostgresError(error));}
    });
  }

  close(): Promise<void> { return this.pool.end(); }
}

export function createPostgresDatabase(env: NodeJS.ProcessEnv = process.env): PostgresDatabase {
  // pg reads ambient PG* variables independently of its config object.
  if (Object.keys(process.env).some((key) => key.startsWith("PG"))) {
    throw new Error("Invalid PostgreSQL configuration");
  }
  return new PostgresDatabase(new pg.Pool(readPostgresConfig(env)));
}
