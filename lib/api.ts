export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { ...(init.method && init.method !== "DELETE" ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, typeof body.detail === "string"
      ? body.detail.replaceAll("_", " ") : "Request failed");
  }
  return response.json();
}

export function json(method: string, data: unknown = {}) {
  return { method, body: JSON.stringify(data) };
}

export type Metric = number | null;
export type Totals = {
  requests: number; successful: number; failed: number; pending: number; needed_ai: number; cloud: number; without_ai: number;
  cache_hits: number; verified_input: Metric; verified_output: Metric; verified_cached_input: Metric;
  verified_total: Metric; verified_complete: number; estimated_tokens: Metric;
  average_ms: Metric; p50_ms: Metric; p95_ms: Metric; tokens_per_request: Metric;
  estimated_cost: Metric; priced_requests: number;
};
export type Analytics = {
  from: string; until: string; total: Totals;
  days: (Totals & { day: string })[]; models: (Totals & { model: string; provider: string | null })[];
  sources: Record<string, string>;
};
export type HistoryRow = {
  id: string; key_name: string | null; endpoint: string; created_at: string; status: string; route: string | null;
  model: string | null; provider_model: string | null; latency_ms: Metric; verified_input: Metric;
  verified_output: Metric; estimated_input: Metric; estimated_output: Metric; error_code: string | null;
  provider_latency_ms: Metric; provider_attempts: number; verified_cached_input: Metric;
  timings: Record<string, number> | null; field_count: number; local_fields: number; cache_fields: number;
};
export type Pricing = {
  model: string; input_per_million: number;
  output_per_million: number; checked_on: string; source: string;
};
export type Models = { models: string[]; default: string; pricing: Pricing[] };
export type Settings = {
  model: string; max_output: number; context_size: number; groq_configured: boolean;
  retention_days: number; concurrency: number;
};
export type Budget = { daily_tokens: Metric; monthly_tokens: Metric; daily_used: number; monthly_used: number };
export type KeyInput = {
  name: string; requests_per_minute: number; daily_requests: number; daily_tokens: Metric; monthly_tokens: Metric;
};
export type KeyRow = KeyInput & {
  id: string; prefix: string; created_at: string; last_used_at: string | null;
  revoked_at: string | null; requests: number; verified_input: Metric; verified_output: Metric;
};
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export const count = (value?: Metric) => value == null ? "—" : number.format(value);
export const ms = (value?: Metric) => value == null ? "—" : count(value) + " ms";
export const usd = (value?: Metric) => value == null ? "—" : "$" + Number(value).toLocaleString("en", {
  minimumFractionDigits: 2, maximumFractionDigits: 10,
});
export const stamp = (value?: string | null) => value && !isNaN(Date.parse(value)) ? dateTime.format(new Date(value)) : "—";
export const message = (error: unknown) => error instanceof Error ? error.message : "Request failed";
