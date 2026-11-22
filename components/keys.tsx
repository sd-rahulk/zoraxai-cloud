"use client";

import { useState, type FormEvent } from "react";
import { Copy, KeyRound, Plus, Smartphone } from "lucide-react";
import { api, count, json, message, stamp, type KeyInput, type KeyRow } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { Alert, Badge, Empty, Heading, Loading, Panel } from "./shared";
import { Button } from "./ui/button";

type Secret = { title: string; value: string; detail: string };
type Mutation = "rotate" | "pair" | "revoke";
const defaults: KeyInput = { name: "", requests_per_minute: 30, daily_requests: 500, daily_tokens: null, monthly_tokens: null };

export function Keys() {
  const [nonce, refresh] = useState(0);
  const { data, loading, error } = useResource<KeyRow[]>("/api/admin/keys", nonce);
  const [edit, setEdit] = useState<KeyRow | "new" | null>(null);
  const [secret, setSecret] = useState<Secret>();
  const [confirm, setConfirm] = useState<{ action: Mutation; key: KeyRow }>();
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState("");
  const [copied, setCopied] = useState(false);

  async function mutate(action: Mutation, key: KeyRow) {
    setIssue(""); setPending(true); setSecret(undefined); setCopied(false);
    try {
      const base = "/api/admin/keys/" + key.id;
      if (action === "revoke") await api(base, { method: "DELETE" });
      else if (action === "rotate") {
        const result = await api<{ key: string }>(base + "/rotate", json("POST"));
        setSecret({ title: "Rotated API key", value: result.key, detail: "Copy this key now. The previous key and extension credentials have expired." });
      } else {
        const result = await api<{ code: string }>(base + "/pair", json("POST"));
        setSecret({ title: "Extension pairing code", value: result.code, detail: "Paste this one-time code into Zorax Filler within five minutes." });
      }
      setConfirm(undefined); refresh(previous => previous + 1);
    } catch (error) { setIssue(message(error)); }
    finally { setPending(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIssue(""); setPending(true); setSecret(undefined); setCopied(false);
    const fields = new FormData(event.currentTarget);
    const numeric = (name: keyof KeyInput) => String(fields.get(name)) ? Number(fields.get(name)) : null;
    const payload = {
      name: String(fields.get("name")).trim(), requests_per_minute: numeric("requests_per_minute"),
      daily_requests: numeric("daily_requests"), daily_tokens: numeric("daily_tokens"), monthly_tokens: numeric("monthly_tokens"),
    };
    try {
      if (edit === "new") {
        const result = await api<{ key: string }>("/api/admin/keys", json("POST", payload));
        setSecret({ title: "New API key", value: result.key, detail: "Copy this key now. The full key is shown only once." });
      } else if (edit) await api("/api/admin/keys/" + edit.id, json("PUT", payload));
      setEdit(null); refresh(previous => previous + 1);
    } catch (error) { setIssue(message(error)); }
    finally { setPending(false); }
  }

  const values = edit && edit !== "new" ? edit : defaults;
  return <>
    <Heading title="API Keys" detail="Issue credentials, set limits, and review extension traffic.">
      <Button onClick={() => { setEdit("new"); setIssue(""); }}><Plus size={17} /> Create key</Button>
    </Heading>
    {error && <Alert>{error}</Alert>}{issue && <Alert>{issue}</Alert>}{loading && <Loading />}
    {secret && <Panel title={secret.title} caption={secret.detail}>
      <div className="secret-row"><code>{secret.value}</code><Button variant="outline" onClick={async () => {
        try { await navigator.clipboard.writeText(secret.value); setCopied(true); }
        catch { setIssue("Clipboard unavailable. Select and copy the credential."); }
      }}><Copy size={15} />{copied ? "Copied" : "Copy"}</Button><Button variant="ghost" onClick={() => setSecret(undefined)}>Dismiss</Button></div>
    </Panel>}
    {edit && <Panel title={edit === "new" ? "New API key" : "Edit " + edit.name} caption="Token limits apply to AI usage. Leave a token budget blank for no per-key limit.">
      <form key={edit === "new" ? "new" : edit.id} className="form-stack" onSubmit={save}>
        <label>Name<input name="name" required maxLength={160} defaultValue={values.name} placeholder="Zorax Filler" /></label>
        <div className="form-grid">
          <label>Requests per minute<input name="requests_per_minute" type="number" min="1" max="600" required defaultValue={values.requests_per_minute} /></label>
          <label>Daily requests<input name="daily_requests" type="number" min="1" max="100000" required defaultValue={values.daily_requests} /></label>
          <label>Daily token budget<input name="daily_tokens" type="number" min="1" max="1000000000000" defaultValue={values.daily_tokens ?? ""} /></label>
          <label>Monthly token budget<input name="monthly_tokens" type="number" min="1" max="1000000000000" defaultValue={values.monthly_tokens ?? ""} /></label>
        </div>
        <div className="link-row"><Button type="submit" disabled={pending}>{edit === "new" ? "Generate key" : "Save limits"}</Button>
          <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
      </form>
    </Panel>}
    {confirm && <Panel title={(confirm.action === "revoke" ? "Revoke " : "Rotate ") + confirm.key.name}
      caption="Clients using existing credentials for this key will lose access.">
      <div className="link-row"><Button variant="destructive" disabled={pending} onClick={() => mutate(confirm.action, confirm.key)}>Confirm {confirm.action}</Button>
        <Button variant="ghost" onClick={() => setConfirm(undefined)}>Cancel</Button></div>
    </Panel>}
    {data && <Panel title="Gateway credentials" caption="Usage reflects retained gateway records. Times are UTC.">
      {data.length ? <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Status</th><th>Requests</th><th>Verified in / out</th><th>Last used</th><th>Actions</th></tr></thead>
        <tbody>{data.map(key => <tr key={key.id}>
          <th><span>{key.name}</span><code className="cell-note">{key.prefix}…</code></th>
          <td><Badge variant={key.revoked_at ? "neutral" : "verified"}>{key.revoked_at ? "Revoked" : "Active"}</Badge></td>
          <td>{count(key.requests)}</td><td>{count(key.verified_input)} / {count(key.verified_output)}</td>
          <td>{stamp(key.last_used_at)}</td>
          <td><div className="table-actions">
            <a className="text-link" href={`#requests/${key.id}`}>History</a>
            {!key.revoked_at && <>
              <Button variant="ghost" size="sm" onClick={() => setEdit(key)}>Limits</Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => mutate("pair", key)}><Smartphone size={14} /> Pair</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm({ action: "rotate", key })}>Rotate</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm({ action: "revoke", key })}>Revoke</Button>
            </>}
          </div></td>
        </tr>)}</tbody></table></div> : <Empty title="No API keys yet" detail="Create a credential to connect the extension or another client." icon={KeyRound} />}
    </Panel>}
  </>;
}
