"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, FileCode2, List, RefreshCw, Server } from "lucide-react";
import { api, count, json, message, ms, stamp, usd, type Budget, type HistoryRow, type Models, type Settings } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { Alert, Badge, Empty, Heading, Loading, Panel } from "./shared";
import { Button } from "./ui/button";

export function History({ keyId }: { keyId?: string }) {
  const [page, setPage] = useState(0);
  const [nonce, refresh] = useState(0);
  const [selected, choose] = useState<HistoryRow>();
  const { data, loading, error } = useResource<HistoryRow[]>("/api/admin/requests?" + new URLSearchParams({
    limit: "25", offset: String(page * 25), ...(keyId && { key_id: keyId }),
  }), nonce);
  return <>
    <Heading title="Request History" detail={keyId ? "Requests associated with the selected API key." : "Inspect routing, elapsed time, and recorded usage for individual requests."}>
      {keyId && <a href="#requests" className="text-link">All requests</a>}
      <Button variant="outline" onClick={() => refresh(previous => previous + 1)}><RefreshCw size={15} />Refresh</Button>
    </Heading>
    {error && <Alert>{error}</Alert>}{loading && <Loading />}
    {selected && <Panel title="Request details" caption={selected.id}
      action={<Button variant="ghost" onClick={() => choose(undefined)}>Close</Button>}>
      <pre className="code">{JSON.stringify(selected, null, 2)}</pre>
    </Panel>}
    {data && <Panel title="Inference requests" caption="UTC timestamps. Form text and profile values are excluded.">
      {data.length ? <div className="table-wrap"><table>
        <thead><tr><th>Time (UTC)</th><th>Client</th><th>Route</th><th>Status</th><th>Verified in / out</th><th>Latency</th><th><span className="sr-only">Details</span></th></tr></thead>
        <tbody>{data.map(row => <tr key={row.id}><th>{stamp(row.created_at)}</th>
          <td>{row.key_name || "Playground"}</td><td>{row.route || "—"}</td>
          <td><Badge variant={row.status === "ok" ? "verified" : row.status === "failed" ? "bad" : "neutral"}>
            {row.status === "ok" ? "Succeeded" : row.status === "failed" ? "Failed" : "Pending"}</Badge></td>
          <td>{count(row.verified_input)} / {count(row.verified_output)}</td><td>{ms(row.latency_ms)}</td>
          <td><Button variant="ghost" size="sm" onClick={() => choose(row)}>Inspect</Button></td></tr>)}</tbody>
      </table></div> : <Empty title="No requests found" detail="Run the playground or send a request from a connected client." icon={List} />}
      <div className="link-row pagination"><Button variant="outline" size="sm" disabled={!page}
        onClick={() => { setPage(page - 1); choose(undefined); }}>Previous</Button><span>Page {page + 1}</span>
        <Button variant="outline" size="sm" disabled={data.length < 25}
          onClick={() => { setPage(page + 1); choose(undefined); }}>Next</Button></div>
    </Panel>}
  </>;
}

export function ModelCatalog() {
  const { data, error, loading } = useResource<Models>("/api/admin/models");
  return <>
    <Heading title="Models" detail="Manage the models Zorax is allowed to call through GroqCloud.">
      <a className="button button-outline button-normal" href="https://console.groq.com/docs/models" target="_blank" rel="noreferrer">Cloud catalog <ArrowUpRight size={15} /></a>
    </Heading>
    {error && <Alert>{error}</Alert>}{loading && <Loading />}
    {data && <div className="model-grid">{data.models.map(model => {
      const pricing = data.pricing.find(row => row.model === model);
      return <Panel key={model} title={model} caption="GroqCloud" action={model === data.default && <Badge variant="verified">Default</Badge>}>
        <Server size={24} className="model-icon" />
        {pricing ? <>
          <dl className="detail-list">
            <div><dt>Input / million tokens</dt><dd>{usd(pricing.input_per_million)}</dd></div>
            <div><dt>Output / million</dt><dd>{usd(pricing.output_per_million)}</dd></div>
          </dl>
          <a href={pricing.source} className="text-link" target="_blank" rel="noreferrer">Pricing verified {pricing.checked_on} <ArrowUpRight size={15} /></a>
        </> : <p className="muted">Monetary cost unavailable — token consumption is being tracked.</p>}
      </Panel>;
    })}</div>}
    <a href="#settings" className="text-link">Change default model <ArrowUpRight size={15} /></a>
  </>;
}

export function Budgets() {
  const [nonce, refresh] = useState(0);
  const { data, error, loading } = useResource<Budget>("/api/admin/budgets", nonce);
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setIssue(""); setSaved(false);
    const form = new FormData(event.currentTarget);
    const get = (key: string) => form.get(key) ? Number(form.get(key)) : null;
    try {
      await api("/api/admin/budgets", json("PUT", { daily_tokens: get("daily_tokens"), monthly_tokens: get("monthly_tokens") }));
      refresh(previous => previous + 1); setSaved(true);
    } catch (error) { setIssue(message(error)); }
    finally { setPending(false); }
  }
  return <>
    <Heading title="Token Budgets" detail="Control how many tokens Zorax can use per UTC day and month." />
    {loading && <Loading />}{(error || issue) && <Alert>{error || issue}</Alert>}
    {data && <>
      <div className="model-grid">
        {(["daily", "monthly"] as const).map(period => {
          const used = data[period + "_used" as "daily_used" | "monthly_used"];
          const limit = data[period + "_tokens" as "daily_tokens" | "monthly_tokens"];
          return <Panel key={period} title={period === "daily" ? "Daily usage" : "Monthly usage"} caption="Zorax budget accounting">
            <div className="budget-value"><strong>{count(used)}</strong><span>{limit ? " / " + count(limit) + " tokens" : " tokens · no limit"}</span></div>
            {limit && <progress aria-label={period + " token budget"} value={Math.min(used, limit)} max={limit} />}
          </Panel>;
        })}
      </div>
      <Panel title="Gateway limits" caption="Applies to all keys and the playground. Per-key limits are available in API Keys.">
        <form className="form-stack" onSubmit={save}>
          <div className="form-grid"><label>Daily tokens<input name="daily_tokens" type="number" min="1" max="1000000000000" defaultValue={data.daily_tokens ?? ""} placeholder="Unlimited" /></label>
            <label>Monthly tokens<input name="monthly_tokens" type="number" min="1" max="1000000000000" defaultValue={data.monthly_tokens ?? ""} placeholder="Unlimited" /></label></div>
          <p className="muted">Usage includes active reservations. Zorax reconciles them with verified counts or estimates after inference.</p>
          <div className="link-row"><Button type="submit" disabled={pending}>Save budgets</Button>{saved && <span role="status">Saved</span>}</div>
        </form>
      </Panel>
      <a href="#usage" className="text-link">View provider usage <ArrowUpRight size={15} /></a>
    </>}
  </>;
}

type Audit = { id: number; action: string; key_id: string | null; created_at: string };
export function Preferences({ dark, setDark }: { dark: boolean; setDark: (dark: boolean) => void }) {
  const [nonce, refresh] = useState(0);
  const { data, error, loading } = useResource<Settings>("/api/admin/settings", nonce);
  const models = useResource<Models>("/api/admin/models", nonce);
  const audit = useResource<Audit[]>("/api/admin/audit", nonce);
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setIssue(""); setSaved(false);
    const values = new FormData(event.currentTarget);
    try {
      await api("/api/admin/settings", json("PUT", {
        model: values.get("model"), max_output: Number(values.get("max_output")), context_size: Number(values.get("context_size")),
      }));
      refresh(previous => previous + 1); setSaved(true);
    } catch (error) { setIssue(message(error)); }
    finally { setPending(false); }
  }
  return <>
    <Heading title="Settings" detail="Configure inference defaults and dashboard appearance." />
    {(loading || models.loading) && <Loading />}{(error || models.error || issue) && <Alert>{error || models.error || issue}</Alert>}
    {data && models.data && <Panel title="Groq gateway" caption="Changes apply to subsequent inference requests."
      action={<Badge variant={data.groq_configured ? "verified" : "neutral"}>{data.groq_configured ? "Key configured" : "Key missing"}</Badge>}>
      <form className="form-stack" onSubmit={save}>
        <label>Default model<select name="model" defaultValue={data.model}>{models.data.models.map(model => <option key={model}>{model}</option>)}</select></label>
        <div className="form-grid">
          <label>Maximum output tokens<input name="max_output" type="number" min="64" max="1024" defaultValue={data.max_output} required /></label>
          <label>Context size<input name="context_size" type="number" min="1024" max="32768" defaultValue={data.context_size} required /></label>
        </div>
        <p className="muted">Up to {data.concurrency} concurrent cloud calls. Request and audit history are retained for {data.retention_days} days.</p>
        <div className="link-row"><Button type="submit" disabled={pending}>Save settings</Button>{saved && <span role="status">Saved</span>}</div>
      </form>
    </Panel>}
    <Panel title="Appearance" caption="Saved in this browser.">
      <label className="check"><input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} /> Dark theme</label>
    </Panel>
    <Panel title="Audit log" caption="Recent administrator actions, in UTC.">
      {audit.loading && <Loading />}{audit.error && <Alert>{audit.error}</Alert>}
      {audit.data && <div className="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Key ID</th></tr></thead>
        <tbody>{audit.data.map(row => <tr key={row.id}><th>{stamp(row.created_at)}</th><td>{row.action.replaceAll("_", " ")}</td>
          <td><code>{row.key_id || "—"}</code></td></tr>)}</tbody></table></div>}
    </Panel>
  </>;
}

const endpoints = [
  ["GET", "/health", "Public liveness probe"],
  ["GET", "/ready", "Administrator or monitoring credential"],
  ["POST", "/api/v1/analyze-form", "Analyze a form and return field decisions"],
  ["POST", "/api/v1/answer-fields", "Re-evaluate fields after collecting more profile information"],
  ["GET", "/api/v1/usage", "Get usage scoped to the current API key"],
  ["GET", "/api/v1/models", "List enabled models and published pricing"],
  ["GET", "/api/v1/profiles", "List saved profiles granted to the requesting key"],
  ["POST", "/api/v1/extension/redeem", "Exchange a one-time code for a short-lived bearer token"],
];

export function Documentation() {
  return <>
    <Heading title="API Documentation" detail="Connect Zorax Filler or another client to the inference gateway.">
      <a className="button button-outline button-normal" href="/api/admin/openapi.json" target="_blank" rel="noreferrer"><FileCode2 size={16} /> OpenAPI JSON</a>
    </Heading>
    <Panel title="Endpoints" caption="The inference, usage, and model routes accept a Zorax bearer credential.">
      <div className="table-wrap"><table><thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
        <tbody>{endpoints.map(([method, path, purpose]) => <tr key={path}><td><Badge>{method}</Badge></td><th><code>{path}</code></th><td>{purpose}</td></tr>)}</tbody>
      </table></div>
    </Panel>
    <Panel title="Analyze a form" caption="Replace the origin and credential with your gateway settings.">
      <pre className="code">{[
        "curl https://YOUR_GATEWAY/api/v1/analyze-form \\",
        '  -H "Authorization: Bearer YOUR_ZORAX_API_KEY" \\',
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"fields":[{"id":"f1","label":"Name of your company","type":"text"}],"profile":{"company":"Zorax AI"}}\'',
      ].join("\n")}</pre>
    </Panel>
    <Panel title="Pair the extension" caption="Permanent keys embedded in distributed extensions can be extracted.">
      <ol className="steps"><li>Generate a pairing code for a key in API Keys.</li><li>Exchange the code within five minutes at <code>/api/v1/extension/redeem</code>.</li><li>Store the one-hour credential in extension session storage and pass it as an authorization bearer token.</li><li>Grant the key access in Knowledge Base. Fetch its profiles from <code>/api/v1/profiles</code> and pass the selected <code>profile_id</code> with the form.</li></ol>
    </Panel>
  </>;
}
