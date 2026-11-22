"use client";

import { useDeferredValue, useState, type FormEvent } from "react";
import { BookOpen, Download, Plus, Search, Upload } from "lucide-react";
import { api, json, message } from "@/lib/api";
import { knowledgePath, type ProfileRecord, type ProfileSummary, type ProfileTransfer } from "@/lib/knowledge";
import { useResource } from "@/lib/use-resource";
import { KnowledgeEditor } from "./knowledge-editor";
import { Alert, Badge, Empty, Heading, Loading, Panel } from "./shared";
import { Button } from "./ui/button";

function Transfer({ records, onImported }: { records: ProfileSummary[]; onImported: (id: string) => void }) {
  const [text, setText] = useState("");
  const [exportId, setExportId] = useState("");
  const [issue, setIssue] = useState("");
  const [pending, setPending] = useState(false);

  async function importProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setIssue(""); setPending(true);
    try {
      const payload = JSON.parse(text);
      const result = await api<{ id: string }>(knowledgePath + "/import", json("POST", payload));
      onImported(result.id);
    } catch (error) {
      setIssue(error instanceof SyntaxError ? "Enter valid profile JSON." : message(error));
    } finally { setPending(false); }
  }

  async function exportProfile() {
    setIssue(""); setPending(true);
    try {
      const payload = await api<ProfileTransfer>(knowledgePath + "/" + exportId + "/export");
      const file = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
      const href = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = href;
      link.download = "zorax-profile-" + (payload.profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export") + ".json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (error) { setIssue(message(error)); }
    finally { setPending(false); }
  }

  return <div className="knowledge-editor">
    <Panel title="Import / Export" caption="Use JSON to move a profile between installations. Exported files contain readable profile content.">
      {issue && <Alert>{issue}</Alert>}
      <form className="form-stack knowledge-transfer" onSubmit={importProfile}>
        <label>Profile JSON file<input type="file" accept=".json,application/json" onChange={async e => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 65536) { setIssue("Choose a JSON file under 64 KiB."); return; }
          try { setText(await file.text()); setIssue(""); }
          catch (error) { setIssue(message(error)); }
        }} /></label>
        <label>Paste or edit JSON<textarea rows={10} value={text} onChange={e => setText(e.target.value)} required maxLength={65536}
          placeholder={'{"format_version":1,"profile":{"name":"Example","business":{"company":"Example Inc"}}}'} /></label>
        <Button type="submit" disabled={pending}><Upload size={15} /> Import as new profile</Button>
      </form>
      <div className="form-stack knowledge-transfer">
        <label>Profile to export<select value={exportId} onChange={e => setExportId(e.target.value)}>
          <option value="">Select a profile</option>{records.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <Button variant="outline" disabled={!exportId || pending} onClick={exportProfile}><Download size={15} /> Export JSON</Button>
      </div>
    </Panel>
  </div>;
}

export function KnowledgeBase() {
  const [query, setQuery] = useState("");
  const [selection, select] = useState<string | null>(null);
  const [refresh, reload] = useState(0);
  const [notice, setNotice] = useState("");
  const search = useDeferredValue(query.trim());
  const catalog = useResource<ProfileSummary[]>(knowledgePath, refresh);
  const results = useResource<ProfileSummary[]>(search ? knowledgePath + "?" + new URLSearchParams({ q: search }) : null, refresh);
  const current = useResource<ProfileRecord>(selection && !["new", "transfer"].includes(selection)
    ? knowledgePath + "/" + selection : null, refresh);
  const shown = search ? results : catalog;

  function open(id: string) { select(id); setNotice(""); }
  function saved(id: string) {
    select(id); reload(value => value + 1); setNotice("Profile saved.");
  }
  function deleted() {
    select(null); reload(value => value + 1); setNotice("Profile deleted.");
  }

  return <>
    <Heading title="Knowledge Base" detail="Manage the profiles and reference answers Zorax uses to fill forms.">
      <Button variant="outline" onClick={() => open("transfer")}><Download size={15} /> Import / Export</Button>
      <Button onClick={() => open("new")}><Plus size={16} /> New profile</Button>
    </Heading>
    {notice && <p className="knowledge-notice" role="status">{notice}</p>}
    <div className="knowledge-grid">
      <Panel title="Profiles">
        <label className="knowledge-search"><span className="sr-only">Search profiles</span><Search size={15} aria-hidden="true" />
          <input type="search" placeholder="Search profiles" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} />
        </label>
        {shown.loading && <Loading />}{shown.error && <Alert>{shown.error}</Alert>}
        {shown.data && shown.data.length > 0 && <ul className="knowledge-profile-list">{shown.data.map(row => <li key={row.id}>
          <button type="button" aria-pressed={selection === row.id} onClick={() => open(row.id)}>
            <span><strong>{row.name}</strong>{row.category && <small>{row.category}</small>}</span>
            {row.is_default && <Badge variant="verified">Default</Badge>}
          </button>
        </li>)}</ul>}
        {shown.data?.length === 0 && <p className="muted knowledge-empty-list">{search ? "No profiles match this search." : "No profiles yet."}</p>}
      </Panel>
      {selection === "transfer" && <Transfer records={catalog.data ?? []} onImported={saved} />}
      {selection === "new" && <KnowledgeEditor key="new" onSaved={saved} onDeleted={deleted} />}
      {current.loading && <Loading />}{current.error && <Alert>{current.error}</Alert>}
      {current.data && <KnowledgeEditor key={current.data.id + ":" + current.data.version} record={current.data} onSaved={saved} onDeleted={deleted} />}
      {!selection && <Panel title="Profile editor">
        <Empty title={catalog.data?.length ? "Select a profile to get started" : "Create your first profile"}
          detail={catalog.data?.length ? "Choose a profile to edit its information, preview answers, or manage extension access."
            : "Save your business details and reusable answers once, then choose when the extension can use them."} icon={BookOpen} />
      </Panel>}
    </div>
  </>;
}
