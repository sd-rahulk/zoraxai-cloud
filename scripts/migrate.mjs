import { readdir, readFile } from "node:fs/promises";
import { makePool } from "../lib/server/db.mjs";

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL in .env before migrating.");
    process.exitCode=1;
    return;
  }
  const pool=makePool(process.env.DATABASE_URL,process.env.APP_ENV==="production");
  try {
    const db=await pool.connect();
    try {
      await db.query("begin");
      await db.query("select pg_advisory_xact_lock(4090100)");
      await db.query("create schema if not exists zorax");
      await db.query("create table if not exists zorax.migrations (name text primary key)");
      const directory=new URL("../supabase/migrations/",import.meta.url);
      for (const name of (await readdir(directory)).filter(name=>name.endsWith(".sql")).sort()) {
        const found=await db.query("select 1 from zorax.migrations where name=$1",[name]);
        if (found.rowCount) continue;
        await db.query(await readFile(new URL(name,directory),"utf8"));
        await db.query("insert into zorax.migrations values ($1)",[name]);
        console.log("Applied "+name);
      }
      await db.query("commit");
      console.log("Database schema is current.");
    } catch (error) {
      await db.query("rollback");
      throw error;
    } finally { db.release(); }
  } finally { await pool.end(); }
}

migrate().catch(error => {
  if (error.code==="invalid_database_url") {
    console.error("DATABASE_URL must be a PostgreSQL connection string starting with postgresql:// or postgres://. In Supabase, open Connect, choose Session pooler, and copy its connection string.");
  } else {
    const hints={
      "28P01":"Check the database password and URL-encode any reserved characters.",
      "42501":"Use a database role that can manage the Zorax schema and install pgcrypto.",
      "ENOTFOUND":"Check the hostname copied from Supabase Connect.",
      "ENETUNREACH":"For an IPv4-only network, use the Supabase Session pooler.",
    };
    const hint=hints[error.code] || (/timeout/i.test(error.message) ? "The PostgreSQL connection timed out. Check whether the database is running and use the Supabase Session pooler for IPv4." : "");
    const code=/^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "";
    console.error("Migration failed"+(code ? " ("+code+")":"")+".",hint);
  }
  process.exitCode=1;
});
