"use client";

import { useState, type FormEvent } from "react";
import { Braces, Play } from "lucide-react";
import { api, count, json, message, ms, type Metric, type Models } from "@/lib/api";
import { knowledgePath, type ProfileSummary } from "@/lib/knowledge";
import { useResource } from "@/lib/use-resource";
import { Button } from "./ui/button";
import { Alert, Badge, Empty, Heading, Loading, Panel } from "./shared";

const samples = {
  company: {
    fields: [{ id: "f1", label: "Name of your company", type: "text" },
      { id: "f2", label: "How many employees work here?", type: "select", options: ["1-10", "11-50", "51+"] }],
    profile: { company: "Zorax AI" },
  },
  vendor: {
    fields: [{ id: "f1", label: "Where can we read about your company online?", type: "url" },
      { id: "f2", label: "Business name", type: "text" },
      { id: "f3", label: "I accept the vendor terms", type: "checkbox" }],
    profile: { company: "Northwind", website: "https://example.com" },
  },
  onboarding: {
    fields: [{ id: "first", label: "Given name", type: "text" },
      { id: "title", label: "What do people call your role at work?", type: "text" },
      { id: "code", label: "Verification code", type: "text", autocomplete: "one-time-code" }],
    profile: { first_name: "Avery", job_title: "Operations lead" }, context: "example.com/onboarding", step: "2",
  },
};
type Sample = keyof typeof samples;
type Result = {
  fill: { field_id: string; value: string | number | boolean; source: string; resolved_by: string }[];
  ask: { field_id: string; question: string }[];
  skip: unknown[]; requires_review: unknown[];
  request_id: string; warning?: { code: string; retry_after: string | null; http_status: number };
  usage: {
    model: string; provider_model?: string; route: string; status: string; latency_ms: number;
    provider_latency_ms?: Metric; verified_input?: Metric; verified_output?: Metric;
    verified_cached_input?: Metric; verified_total: Metric; estimated_input?: Metric; estimated_output?: Metric;
    local_fields: number; cache_fields: number; estimated_cost?: Metric;
  };
};
const pretty = (data: unknown) => JSON.stringify(data, null, 2);

export function Playground() {
  const models = useResource<Models>("/api/admin/models");
  const knowledge = useResource<ProfileSummary[]>(knowledgePath);
  const [example, setExample] = useState<Sample>("company");
  const [fields, setFields] = useState(pretty(samples.company.fields));
  const [profile, setProfile] = useState(pretty(samples.company.profile));
  const [profileSource, setProfileSource] = useState("example");
  const [model, setModel] = useState("");
  const [context, setContext] = useState("");
  const [step, setStep] = useState("");
  const [result, setResult] = useState<Result>();
  const [runs, setRuns] = useState<Result[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function load(key: Sample) {
    const sample = samples[key];
    setExample(key); setFields(pretty(sample.fields)); setProfile(pretty(sample.profile));
    setContext("context" in sample ? sample.context : "");
    setStep("step" in sample ? sample.step : "");
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setResult(undefined); setPending(true);
    try {
      const output = await api<Result>("/api/admin/playground", json("POST", {
        fields: JSON.parse(fields), context, ...(step && { step }), ...(model && { model }),
        ...(profileSource === "example" ? { profile: JSON.parse(profile) } : profileSource === "default" ? {} : { profile_id: profileSource }),
      }));
      setResult(output); setRuns(previous => [output, ...previous].slice(0, 12));
    } catch (error) {
      setError(error instanceof SyntaxError ? "Enter valid JSON for fields and profile." : message(error));
    } finally {
      setPending(false);
    }
  }

  return <>
    <Heading title="AI Playground" detail="Test how the gateway interprets fields before connecting the extension." />
    {models.error && <Alert>{models.error}</Alert>}
    {knowledge.error && <Alert>{knowledge.error}</Alert>}
    <div className="play-grid">
      <Panel title="Form input" caption="Start with an example or enter your own fields.">
        <form onSubmit={run} className="form-stack">
          <div className="form-grid">
            <label>Example<select value={example} onChange={e => load(e.target.value as Sample)}>
              <option value="company">Company signup</option><option value="vendor">Vendor application</option><option value="onboarding">Employee onboarding</option>
            </select></label>
            <label>Model<select value={model} onChange={e => setModel(e.target.value)}>
              <option value="">Default{models.data ? " · " + models.data.default : ""}</option>
              {models.data?.models.map(item => <option key={item}>{item}</option>)}
            </select></label>
          </div>
          <label>Fields <textarea value={fields} onChange={e => setFields(e.target.value)} rows={13} spellCheck={false} required /></label>
          <label>Profile source<select value={profileSource} onChange={e => setProfileSource(e.target.value)}>
            <option value="example">Inline example data</option>
            <option value="default" disabled={!knowledge.data?.some(row => row.is_default)}>Default knowledge profile</option>
            {knowledge.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>
          {profileSource === "example" && <label>Profile JSON<textarea value={profile} onChange={e => setProfile(e.target.value)} rows={5} spellCheck={false} required /></label>}
          <div className="form-grid"><label>Context<input value={context} onChange={e => setContext(e.target.value)} maxLength={256} placeholder="example.com/application" /></label>
            <label>Step<input value={step} onChange={e => setStep(e.target.value)} maxLength={80} placeholder="Optional" /></label></div>
          <Button type="submit" disabled={pending}><Play size={15} /> {pending ? "Running…" : "Run form"}</Button>
        </form>
      </Panel>
      <Panel title="Structured response" caption="Field decisions and telemetry from this request.">
        {pending && <Loading />}{error && <Alert>{error}</Alert>}
        {!result && !pending && <Empty title="Ready for a test run" detail="Run the form to inspect field decisions and usage." icon={Braces} />}
        {result && <>
          {result.warning && <Alert>{result.warning.code.replaceAll("_", " ")}
            {result.warning.retry_after && " · Retry after " + result.warning.retry_after + " seconds"}</Alert>}
          <div className="link-row"><Badge>{result.usage.route}</Badge>
            <span className="muted">{result.usage.provider_model || result.usage.model} · {ms(result.usage.latency_ms)}</span></div>
          <dl className="detail-list">
            <div><dt>Verified input / output</dt><dd>{count(result.usage.verified_input)} / {count(result.usage.verified_output)}</dd></div>
            <div><dt>Verified cached input</dt><dd>{count(result.usage.verified_cached_input)}</dd></div>
            <div><dt>Estimated input / output</dt><dd>{count(result.usage.estimated_input)} / {count(result.usage.estimated_output)}</dd></div>
            <div><dt>Local / cached fields</dt><dd>{result.usage.local_fields} / {result.usage.cache_fields}</dd></div>
          </dl>
          {result.ask.length > 0 && <div className="questions"><h3>Missing information</h3>
            <ul>{result.ask.map(row => <li key={row.field_id}>{row.question}</li>)}</ul></div>}
          <pre className="code">{pretty(result)}</pre>
        </>}
      </Panel>
    </div>
    {runs.length > 0 && <Panel title="Run comparison" caption="Runs in this tab. Local and cached responses use no Groq inference.">
      <div className="table-wrap"><table><thead><tr><th>Model</th><th>Route</th><th>Latency</th><th>Verified total</th><th>Estimated input / output</th><th>Status</th></tr></thead>
        <tbody>{runs.map(({ request_id, usage }) => <tr key={request_id}><th>{usage.provider_model || usage.model}</th>
          <td>{usage.route}</td><td>{ms(usage.latency_ms)}</td><td>{count(usage.verified_total)}</td>
          <td>{count(usage.estimated_input)} / {count(usage.estimated_output)}</td><td>{usage.status}</td></tr>)}</tbody>
      </table></div>
    </Panel>}
  </>;
}
