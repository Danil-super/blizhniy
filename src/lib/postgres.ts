// Node-only module. Browser code must use same-origin API handlers, never this client.
import { X509Certificate } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import pg from "pg";
import type { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

function assertServer(): void {
  if (typeof window !== "undefined") throw new Error("PostgreSQL is server-only");
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
      const path = required("CA_FILE");
      if (statSync(path).size > 65536) throw invalid();
      const ca = readFileSync(path, "utf8");
      if (!new X509Certificate(ca).ca) throw invalid();
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
    this.code = typeof code === "string" && (/^[0-9A-Z]{5}$/.test(code) || connectionCodes.includes(code))
      ? code : undefined;
  }
}

export interface PostgresQueries {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

async function query<Row extends QueryResultRow>(
  connection: Pool | PoolClient, text: string, values: unknown[] = [],
): Promise<QueryResult<Row>> {
  try {
    // Extended protocol rejects multiple statements, even when values is empty.
    // @types/pg does not yet declare pg's supported queryMode option.
    const statement = { text, values, queryMode: "extended" };
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

  close(): Promise<void> { return this.pool.end(); }
}

export function createPostgresDatabase(env: NodeJS.ProcessEnv = process.env): PostgresDatabase {
  // pg reads ambient PG* variables independently of its config object.
  if (Object.keys(process.env).some((key) => key.startsWith("PG"))) {
    throw new Error("Invalid PostgreSQL configuration");
  }
  return new PostgresDatabase(new pg.Pool(readPostgresConfig(env)));
}
