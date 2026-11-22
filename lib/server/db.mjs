import pg from "pg";
import { Fault } from "./config.mjs";

const { Pool, types } = pg;
types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

export function makePool(connectionString, requireTls = false) {
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Fault(503, "invalid_database_url"); }
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname) {
    throw new Fault(503, "invalid_database_url");
  }
  if (requireTls
      && !["require","verify-ca","verify-full"].includes(url.searchParams.get("sslmode"))) {
    url.searchParams.set("sslmode", "verify-full");
  }
  const pool = new Pool({ connectionString: url.toString(), max: 4, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, statement_timeout: 10000, allowExitOnIdle: true });
  pool.on("error", () => console.error("Zorax database idle connection closed unexpectedly"));
  return pool;
}

export function database(cfg) {
  globalThis.zoraxDatabase ??= { url: cfg.database, pool: makePool(cfg.database, cfg.production) };
  const pool = globalThis.zoraxDatabase.pool;
  const query = (sql, values) => pool.query(sql, values);
  const one = async (sql, values) => (await query(sql, values)).rows[0];
  const all = async (sql, values) => (await query(sql, values)).rows;
  async function tx(operation) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await operation({
        query: (sql, values) => client.query(sql, values),
        one: async (sql, values) => (await client.query(sql, values)).rows[0],
      });
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }
  async function settings() {
    const row = await one("select model,max_output,context_size,daily_tokens,monthly_tokens from zorax.settings");
    return { ...row, model: cfg.models.includes(row?.model) ? row.model : cfg.model,
      max_output: row?.max_output ?? cfg.maxOutput, context_size: row?.context_size ?? cfg.contextSize };
  }
  async function begin(keyId, endpoint, fields) {
    return tx(async db => {
      if (keyId) {
        const key = await db.one("select * from zorax.keys where id=$1 and revoked_at is null for update", [keyId]);
        if (!key) throw new Fault(401, "key_revoked");
        const counts = await db.one(`select count(*) filter (where created_at>=date_trunc('day',now(),'UTC')) as today,
          count(*) filter (where created_at>=now()-interval '1 minute') as minute from zorax.requests
          where key_id=$1 and created_at >= least(date_trunc('day',now(),'UTC'),now()-interval '1 minute')`, [keyId]);
        if (counts.minute >= key.requests_per_minute) throw new Fault(429,"request_rate_limit","60");
        if (counts.today >= key.daily_requests) throw new Fault(429,"daily_request_limit");
        await db.query("update zorax.keys set last_used_at=now() where id=$1", [keyId]);
      }
      return (await db.one("insert into zorax.requests (key_id,endpoint,field_count) values ($1,$2,$3) returning id",
        [keyId,endpoint,fields])).id;
    });
  }
  async function reserve(id, keyId, model, amount) {
    await tx(async db => {
      await db.query("select pg_advisory_xact_lock(4090101)");
      const limits = await db.one("select daily_tokens,monthly_tokens from zorax.settings for update");
      const active = await db.one("select count(*) as count from zorax.requests where status='pending' and route='cloud' and created_at > now()-interval '2 minutes'");
      if (active.count >= cfg.concurrency) throw new Fault(429,"cloud_concurrency_limit","2");
      const key = keyId && await db.one("select daily_tokens,monthly_tokens from zorax.keys where id=$1 and revoked_at is null for update", [keyId]);
      if (keyId && !key) throw new Fault(401,"key_revoked");
      const usage = await db.one(`select coalesce(sum(charge) filter (where today),0) as daily,
        coalesce(sum(charge),0) as monthly, coalesce(sum(charge) filter (where key_id=$1 and today),0) as key_daily,
        coalesce(sum(charge) filter (where key_id=$1),0) as key_monthly
        from (select key_id,created_at >= date_trunc('day',now(),'UTC') as today,
        case when status='pending' then reserved_tokens else budget_charge end as charge
        from zorax.requests where created_at >= date_trunc('month',now(),'UTC')) period`, [keyId]);
      for (const period of ["daily","monthly"]) {
        if (limits[period+"_tokens"] && usage[period]+amount>limits[period+"_tokens"]) throw new Fault(429,"gateway_"+period+"_token_budget");
        if (key?.[period+"_tokens"] && usage["key_"+period]+amount>key[period+"_tokens"]) throw new Fault(429,"key_"+period+"_token_budget");
      }
      await db.query("update zorax.requests set route='cloud',provider='groq',model=$1,reserved_tokens=$2 where id=$3",[model,amount,id]);
    });
  }
  async function finish(id, record) {
    const keys = Object.keys(record);
    if (keys.some(key => !/^[a-z_]+$/.test(key))) throw new Error("Invalid internal request columns");
    await query("update zorax.requests set "+keys.map((key,i)=>key+"=$"+(i+1)).join(",")+",finished_at=now() where id=$"+(keys.length+1),[...Object.values(record),id]);
  }
  async function cleanup() {
    await tx(async db => {
      const lock = await db.one("select pg_try_advisory_xact_lock(4090104) as acquired");
      if (!lock.acquired) return;
      const marker = await db.one("select next_run from zorax.maintenance where singleton and next_run>now()");
      if (marker) return;
      await db.query("update zorax.maintenance set next_run=now()+interval '30 minutes' where singleton");
      await db.query("update zorax.requests set status='failed',error_code='interrupted',finished_at=now(),budget_charge=reserved_tokens where status='pending' and created_at<now()-interval '2 minutes'");
      await db.query("delete from zorax.requests where created_at<now()-make_interval(days=>$1)",[cfg.retention]);
      await db.query("delete from zorax.audit where created_at<now()-make_interval(days=>$1)",[cfg.retention]);
      for (const table of ["sessions","extension_credentials","field_cache"]) await db.query("delete from zorax."+table+" where expires_at<now()");
      await db.query("delete from zorax.login_attempts where attempted_at<now()-interval '15 minutes'");
    });
  }
  return {query,one,all,tx,settings,begin,reserve,finish,cleanup};
}
