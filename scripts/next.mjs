import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Next expands dollar signs in values from .env. Keep a private copy of
// literal credentials before it loads that file.
for (const file of [".env.local",".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
for (const name of ["DATABASE_URL","ADMIN_PASSWORD_HASH","ZORAX_SECRET","KNOWLEDGE_ENCRYPTION_KEY","GROQ_API_KEY"]) {
  if (process.env[name] !== undefined) process.env["ZORAX_LITERAL_"+name] = process.env[name];
}
const next = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});
if (next.error) console.error(next.error.message);
process.exitCode = next.status ?? (next.signal === "SIGINT" ? 130 : 1);
