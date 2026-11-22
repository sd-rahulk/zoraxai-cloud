import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export class Fault extends Error {
  constructor(status, code, retryAfter = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const config = () => {
  const env = process.env;
  const credential = name => env["ZORAX_LITERAL_"+name] ?? env[name] ?? "";
  const production = env.APP_ENV === "production" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
  const models = (env.GROQ_MODELS || "openai/gpt-oss-20b,openai/gpt-oss-120b").split(",").map(x => x.trim()).filter(Boolean);
  const model = env.GROQ_MODEL || models[0];
  const number = (name, fallback, min, max) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Fault(503, "invalid_server_configuration");
    return value;
  };
  const secret = credential("ZORAX_SECRET");
  const password = credential("ADMIN_PASSWORD_HASH");
  const encryptionKey = credential("KNOWLEDGE_ENCRYPTION_KEY");
  const database = credential("DATABASE_URL");
  if (!database || secret.length < 32 || !/^[a-f\d]{32}\$(?:[a-f\d]{64}|[a-f\d]{128})$/i.test(password)
      || !models.includes(model) || (encryptionKey && encryptionKey.length < 32)) {
    throw new Fault(503, "invalid_server_configuration");
  }
  const digest = (namespace, value) => createHmac("sha256", secret).update(namespace + ":" + value).digest("hex");
  return {
    database, production, password, digest, models, model,
    origin: (env.PUBLIC_ORIGIN || (env.VERCEL_URL && "https://" + env.VERCEL_URL) || "http://127.0.0.1:8000").replace(/\/$/, ""),
    origins: (env.EXTENSION_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean),
    username: env.ADMIN_USERNAME || "admin", monitor: env.READINESS_MONITOR_TOKEN || "",
    encryptionKey: encryptionKey || digest("knowledge-encryption", "v1"),
    groq: credential("GROQ_API_KEY"),
    maxOutput: number("GROQ_MAX_OUTPUT", 384, 64, 1024),
    contextSize: number("GROQ_CONTEXT_SIZE", 8192, 1024, 32768),
    concurrency: number("MAX_CLOUD_CONCURRENCY", 2, 1, 10),
    retention: number("RETENTION_DAYS", 90, 32, 3650),
  };
};

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function passwordHash(password, salt = randomBytes(16), length = 32) {
  const value = await derive(password, salt, length, options);
  return salt.toString("hex") + "$" + value.toString("hex");
}

export async function verifyPassword(password, hash) {
  const [salt, value] = hash.split("$");
  const computed = await passwordHash(password, Buffer.from(salt, "hex"), value.length / 2);
  return timingSafeEqual(Buffer.from(hash.toLowerCase()), Buffer.from(computed));
}

export const token = (prefix = "") => prefix + randomBytes(32).toString("base64url");
