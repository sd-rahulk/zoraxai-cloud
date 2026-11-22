"use client";

import { useState } from "react";
import { Activity, ArrowUpRight, ChartNoAxesCombined, Clock3, Database, KeyRound, Layers3, RefreshCw, Zap } from "lucide-react";
import { count, ms, usd, type Analytics } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { Alert, Empty, Heading, Loading, Panel, Stat } from "./shared";
import { Button } from "./ui/button";

function Chart({ data }: { data: Analytics }) {
  const days = new Map(data.days.map(day => [day.day, day]));
  const points = [];
  if (data.days.length) {
    const date = new Date(data.from);
    date.setUTCHours(0, 0, 0, 0);
    const until = Date.parse(data.until);
    while (date.getTime() < until) {
      const key = date.toISOString().slice(0, 10);
      const day = days.get(key);
      points.push({ date: key, input: day?.verified_input ?? 0, output: day?.verified_output ?? 0,
        estimated: day?.estimated_tokens ?? 0 });
      date.setUTCDate(date.getUTCDate() + 1);
    }
  }
  const denominator = Math.max(1, ...points.map(d => d.input + d.output + d.estimated));
  return <Panel title="Token activity" caption="Daily counts in UTC" action={<div className="legend">
    <span><i className="input-dot" />Input</span><span><i className="output-dot" />Output</span>
    <span><i className="estimate-dot" />Estimated</span>
  </div>}>
    {points.some(d => d.input || d.output || d.estimated) ? <>
      <div className="plot" role="img" aria-label="Daily token counts. Numerical values are available in the table below.">
        {points.map(d => <div key={d.date} className="bar-track" title={d.date + " · " + count(d.input + d.output + d.estimated) + " recorded tokens"}>
          <i className="input-dot" style={{ height: d.input / denominator * 96 + "%" }} />
          <i className="output-dot" style={{ height: d.output / denominator * 96 + "%" }} />
          <i className="estimate-dot" style={{ height: d.estimated / denominator * 96 + "%" }} />
        </div>)}
      </div>
      <div className="plot-labels"><span>{points[0]?.date}</span><span>{points.at(-1)?.date}</span></div>
    </> : <Empty title="No token activity yet" detail="Token counts will appear after a Groq request through Zorax." icon={ChartNoAxesCombined} />}
  </Panel>;
}

export function Usage({ overview = false }: { overview?: boolean }) {
  const [period, setPeriod] = useState("7d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [refresh, setRefresh] = useState(0);
  const valid = period !== "custom" || Boolean(start && end && start <= end);
  const path = valid ? "/api/admin/usage?" + new URLSearchParams({
    period, ...(period === "custom" ? { start, end } : {}),
  }) : null;
  const { data, error, loading } = useResource<Analytics>(path, refresh);
  const metrics = data?.total;
  return <>
    <Heading title={overview ? "Overview" : "Provider Usage"} detail={overview
      ? "Inference activity for your Zorax Filler gateway."
      : "Verified and estimated token counts from requests through Zorax."}>
      <label className="range"><span className="sr-only">Time range</span>
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="24h">Past 24 hours</option><option value="7d">Past 7 days</option>
          <option value="30d">Past 30 days</option><option value="custom">Custom dates</option>
        </select></label>
      <Button variant="outline" size="icon" aria-label="Refresh usage" title="Refresh usage"
        onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} /></Button>
      {overview && <a className="button button-primary button-normal" href="#playground"><Zap size={16} /> Open playground</a>}
    </Heading>
    {period === "custom" && <div className="dates">
      <label>Start date <input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label>End date <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>
    </div>}
    {loading && <Loading />}{error && <Alert>{error}</Alert>}
    {data && metrics && <>
      <div className="stat-grid">
        <Stat title="Total requests" value={count(metrics.requests)} source="Zorax request ledger" icon={Layers3} />
        <Stat title="Verified input tokens" value={count(metrics.verified_input)} source={metrics.verified_input == null ? "Unavailable" : "Provider reported"} icon={Database} />
        <Stat title="Verified output tokens" value={count(metrics.verified_output)} source={metrics.verified_output == null ? "Unavailable" : "Provider reported"} icon={Activity} />
        <Stat title={overview ? "Avg. response time" : "Estimated tokens"} value={overview ? ms(metrics.average_ms) : count(metrics.estimated_tokens)}
          source={overview ? "Zorax wall-clock latency" : metrics.estimated_tokens == null ? "Unavailable" : "Estimated locally"} icon={Clock3} />
      </div>
      <div className="usage-grid">
        <Chart data={data} />
        <Panel title="Request routing" caption="Accepted inference requests">
          <dl className="detail-list">
            <div><dt><i className="input-dot" /> Reached provider</dt><dd>{count(metrics.cloud)}</dd></div>
            <div><dt>Needed AI</dt><dd>{count(metrics.needed_ai)}</dd></div>
            <div><dt><i className="output-dot" /> Resolved without AI</dt><dd>{count(metrics.without_ai)}</dd></div>
            <div><dt><i className="estimate-dot" /> Cache hit rate</dt><dd>{metrics.requests ? count(metrics.cache_hits / metrics.requests * 100) + "%" : "—"}</dd></div>
            <div><dt>Successful / failed</dt><dd>{count(metrics.successful)} / {count(metrics.failed)}</dd></div>
            <div><dt>Pending</dt><dd>{count(metrics.pending)}</dd></div>
          </dl>
        </Panel>
      </div>
      {overview && metrics.requests === 0 && <Panel title="Connect Zorax Filler" caption="Create an API key, then use its pairing code in your browser extension.">
        <div className="link-row"><a href="#keys" className="button button-outline button-normal"><KeyRound size={15} /> Manage API keys</a>
          <a href="#docs" className="text-link">Read the API docs <ArrowUpRight size={15} /></a></div>
      </Panel>}
      {!overview && <>
        <Panel title="Performance and cost" caption="Zorax traffic in the selected range">
          <div className="inline-metrics">
            <div><span>Average latency</span><strong>{ms(metrics.average_ms)}</strong></div>
            <div><span>P50 latency</span><strong>{ms(metrics.p50_ms)}</strong></div>
            <div><span>P95 latency</span><strong>{ms(metrics.p95_ms)}</strong></div>
            <div><span>Verified tokens / complete request</span><strong>{count(metrics.tokens_per_request)}</strong></div>
            <div><span>Verified total tokens</span><strong>{count(metrics.verified_total)}</strong></div>
            <div><span>Estimated monetary cost</span><strong>{usd(metrics.estimated_cost)}</strong></div>
          </div>
          <p className="muted">{metrics.estimated_cost == null
            ? "Monetary cost unavailable — token consumption is being tracked."
            : "Published rates applied to " + count(metrics.priced_requests) + " requests with verified counts."}</p>
          <p className="muted">{data.sources.reasoning}</p>
        </Panel>
        <Breakdown data={data} kind="models" />
        <Breakdown data={data} kind="days" />
      </>}
      {!overview && <Panel title="Metric sources">
        <dl className="source-list">{Object.entries(data.sources).map(([key, value]) => <div key={key}>
          <dt>{key.replaceAll("_", " ")}</dt><dd>{value}</dd></div>)}</dl>
      </Panel>}
    </>}
    {!overview && <Panel title="Groq account" caption="Review organization-wide usage and limits in GroqCloud."><a className="text-link" href="https://console.groq.com/" target="_blank" rel="noreferrer">Open Groq Console <ArrowUpRight size={15} /></a></Panel>}
  </>;
}

function Breakdown({ data, kind }: { data: Analytics; kind: "models" | "days" }) {
  const rows = kind === "models" ? data.models.map(row => ({ ...row, label: row.provider ? row.model + " · " + row.provider : row.model })) : data.days.map(row => ({ ...row, label: row.day }));
  return <Panel title={kind === "models" ? "Usage by cloud model" : "Daily token totals"}>
    {rows.length ? <div className="table-wrap"><table>
      <thead><tr><th>{kind === "models" ? "Model" : "Day (UTC)"}</th><th>Requests</th><th>Verified input</th><th>Verified output</th><th>Cached input</th><th>Estimated</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.label}><th>{row.label}</th><td>{count(row.requests)}</td>
        <td>{count(row.verified_input)}</td><td>{count(row.verified_output)}</td><td>{count(row.verified_cached_input)}</td>
        <td>{count(row.estimated_tokens)}</td></tr>)}</tbody>
    </table></div> : <Empty title="No usage in this range" detail="Choose a different date range or send a request." />}
  </Panel>;
}
