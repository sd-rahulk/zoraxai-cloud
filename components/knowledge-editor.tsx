"use client";

import { useState, type FormEvent } from "react";
import { Eye, Plus, Save, Trash2, X } from "lucide-react";
import { api, json, message, stamp, type KeyRow } from "@/lib/api";
import { businessFields, knowledgePath, type Answer, type ProfileContent, type ProfileRecord, type ProfileValue, type Revision } from "@/lib/knowledge";
import { useResource } from "@/lib/use-resource";
import { Alert, Badge, Empty, Loading, Panel } from "./shared";
import { Button } from "./ui/button";

type FieldRow = { id: number; label: string; value: ProfileValue };
type AnswerRow = Answer & { id: number };
const emptyProfile: ProfileContent = { name: "", category: "", business: {}, custom: {}, answers: [], context: "" };
const tabs = ["Business Information", "Custom Fields", "FAQs & Saved Answers", "Additional Context"] as const;
type EditorTab = (typeof tabs)[number];

function Preview({ profile }: { profile: ProfileContent }) {
  const attributes = businessFields.flatMap(([id, label]) => profile.business[id] ? [[label, profile.business[id]]] : []);
  const items = [...attributes, ...Object.entries(profile.custom)];
  const answers = profile.answers.filter(row => row.question && row.answer);
  const hasData = Boolean(items.length || answers.length || profile.context.trim());
  return hasData ? <div className="knowledge-preview">
    {items.length > 0 && <dl className="detail-list">{items.map(([name, value]) => (
      <div key={name}><dt>{name}</dt><dd>{String(value)}</dd></div>
    ))}</dl>}
    {answers.length > 0 && <div className="knowledge-preview-block"><h3>FAQs &amp; saved answers</h3>
      <dl>{answers.map((row, index) => <div key={index}><dt>{row.question}</dt><dd>{row.answer}</dd></div>)}</dl></div>}
    {profile.context.trim() && <div className="knowledge-preview-block"><h3>Additional context</h3><p>{profile.context}</p></div>}
  </div> : <Empty title="No reference information" detail="Add business details, a saved answer, or context to preview this profile." />;
}

function ProfileHistory({ id }: { id: string }) {
  const [selected, select] = useState<number>();
  const root = knowledgePath + "/" + id + "/history";
  const history = useResource<Revision[]>(root);
  const snapshot = useResource<Revision & { profile: ProfileContent }>(selected ? root + "/" + selected : null);
  return <Panel title="Editing history" caption="The latest 30 saved versions for this profile. Times are UTC.">
    {history.loading && <Loading />}{history.error && <Alert>{history.error}</Alert>}
    {history.data && <div className="knowledge-history">{history.data.map(row => <button key={row.version} type="button"
      className="knowledge-revision" aria-pressed={selected === row.version}
      onClick={() => select(selected === row.version ? undefined : row.version)}>
      <strong>Version {row.version}</strong><span>{stamp(row.created_at)}</span><Eye size={15} aria-hidden="true" />
    </button>)}</div>}
    {snapshot.loading && <Loading />}{snapshot.error && <Alert>{snapshot.error}</Alert>}
    {snapshot.data && <section className="knowledge-preview-block"><h3>{snapshot.data.profile.name} · Version {snapshot.data.version}</h3>
      <Preview profile={snapshot.data.profile} /></section>}
  </Panel>;
}

export function KnowledgeEditor({ record, onSaved, onDeleted }: {
  record?: ProfileRecord;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const existing = record?.profile ?? emptyProfile;
  const [draft, setDraft] = useState(existing);
  const [fields, setFields] = useState<FieldRow[]>(() => Object.entries(existing.custom).map(([label, value], id) => ({ id, label, value })));
  const [answers, setAnswers] = useState<AnswerRow[]>(() => existing.answers.map((row, id) => ({ ...row, id })));
  const [nextId, setNextId] = useState(100);
  const [tab, chooseTab] = useState<EditorTab>(tabs[0]);
  const [makeDefault, setDefault] = useState(record?.is_default ?? false);
  const [keyIds, setKeyIds] = useState(record?.access_key_ids ?? []);
  const [showAccess, toggleAccess] = useState(false);
  const [showHistory, toggleHistory] = useState(false);
  const [showPreview, togglePreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState("");
  const keys = useResource<KeyRow[]>(showAccess ? "/api/admin/keys" : null);
  const content = { ...draft, custom: Object.fromEntries(fields.filter(row => row.label.trim()).map(row => [row.label.trim(), row.value])),
    answers: answers.map(({ question, answer }) => ({ question, answer })) };
  const root = record ? knowledgePath + "/" + record.id : knowledgePath;

  function changeField(id: number, patch: Partial<FieldRow>) {
    setFields(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }
  function changeAnswer(id: number, patch: Partial<Answer>) {
    setAnswers(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssue("");
    const names = fields.map(row => row.label.trim().toLocaleLowerCase());
    if (!draft.name.trim()) return setIssue("Enter a profile name.");
    if (names.some(name => !name) || new Set(names).size !== names.length) return setIssue("Give each custom field a unique name.");
    if (fields.some(row => typeof row.value === "string" ? !row.value.trim()
      : typeof row.value === "number" && !Number.isSafeInteger(row.value))) return setIssue("Enter a value for every custom field. Number fields require whole numbers.");
    if (answers.some(row => !row.question.trim() || !row.answer.trim())) return setIssue("Enter a question and answer for every saved answer.");
    setPending(true);
    try {
      const saved = await api<{ id: string }>(root, json(record ? "PUT" : "POST", {
        ...content, access_key_ids: keyIds, make_default: makeDefault, ...(record && { version: record.version }),
      }));
      onSaved(saved.id);
    } catch (error) { setIssue(message(error)); }
    finally { setPending(false); }
  }

  async function remove() {
    if (!record) return;
    setPending(true); setIssue("");
    try {
      await api(root + "?version=" + record.version, { method: "DELETE" });
      onDeleted();
    } catch (error) { setIssue(message(error)); }
    finally { setPending(false); }
  }

  return <div className="knowledge-editor">
    <Panel title={record?.name ?? "New profile"} caption={record ? "Last saved " + stamp(record.updated_at) + " UTC" : "Choose a name and add the facts Zorax should use."}
      action={record?.is_default ? <Badge variant="verified">Default</Badge> : undefined}>
      <form onSubmit={save} className="form-stack">
        <div className="form-grid">
          <label>Profile name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} maxLength={80} required /></label>
          <label>Category<input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} maxLength={60} placeholder="Optional" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={makeDefault} disabled={record?.is_default} onChange={e => setDefault(e.target.checked)} /> Default profile</label>
        <div className="knowledge-tabs" role="group" aria-label="Profile content">
          {tabs.map(item => <button type="button" key={item} aria-pressed={tab === item} onClick={() => chooseTab(item)}>{item}</button>)}
        </div>
        {tab === "Business Information" && <div className="form-grid">
          {businessFields.map(([key, label]) => <label key={key} className={key === "description" || key === "services" ? "knowledge-wide" : undefined}>{label}
            {key === "description" || key === "services"
              ? <textarea rows={3} maxLength={512} value={draft.business[key] ?? ""} onChange={e => setDraft({ ...draft, business: { ...draft.business, [key]: e.target.value } })} />
              : <input type={key === "email" ? "email" : key === "website" ? "url" : key === "phone" ? "tel" : "text"}
                maxLength={512} value={draft.business[key] ?? ""} onChange={e => setDraft({ ...draft, business: { ...draft.business, [key]: e.target.value } })} />}
          </label>)}
        </div>}
        {tab === "Custom Fields" && <div className="form-stack">
          <p className="muted">Add structured values for fields such as employee count, industry, or support hours.</p>
          {fields.map((row, i) => <div key={row.id} className="knowledge-custom-row">
            <label>Field {i + 1}<input value={row.label} maxLength={64} onChange={e => changeField(row.id, { label: e.target.value })} /></label>
            <label>Type<select value={typeof row.value} onChange={e => changeField(row.id, { value: e.target.value === "number" ? 0 : e.target.value === "boolean" ? false : "" })}>
              <option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option>
            </select></label>
            <label>Value{typeof row.value === "boolean"
              ? <select value={String(row.value)} onChange={e => changeField(row.id, { value: e.target.value === "true" })}>
                <option value="true">Yes</option><option value="false">No</option></select>
              : <input type={typeof row.value === "number" ? "number" : "text"} maxLength={512} value={Number.isNaN(row.value) ? "" : row.value}
                onChange={e => changeField(row.id, { value: typeof row.value === "number" ? e.target.valueAsNumber : e.target.value })} />}</label>
            <Button variant="ghost" size="icon" aria-label={"Remove field " + (i + 1)} onClick={() => setFields(rows => rows.filter(item => item.id !== row.id))}><X size={15} /></Button>
          </div>)}
          <Button variant="outline" disabled={fields.length >= 24} onClick={() => { setFields([...fields, { id: nextId, label: "", value: "" }]); setNextId(nextId + 1); }}><Plus size={15} /> Add field</Button>
        </div>}
        {tab === "FAQs & Saved Answers" && <div className="form-stack">
          <p className="muted">Save the answer as you want it entered when a form asks this question.</p>
          {answers.map((row, i) => <fieldset key={row.id} className="knowledge-answer">
            <legend>Answer {i + 1}</legend>
            <label>Question<input value={row.question} maxLength={160} onChange={e => changeAnswer(row.id, { question: e.target.value })} /></label>
            <label>Answer<textarea value={row.answer} rows={3} maxLength={512} onChange={e => changeAnswer(row.id, { answer: e.target.value })} /></label>
            <Button variant="ghost" size="sm" onClick={() => setAnswers(rows => rows.filter(item => item.id !== row.id))}><X size={14} /> Remove answer {i + 1}</Button>
          </fieldset>)}
          <Button variant="outline" disabled={answers.length >= 30} onClick={() => { setAnswers([...answers, { id: nextId, question: "", answer: "" }]); setNextId(nextId + 1); }}><Plus size={15} /> Add answer</Button>
        </div>}
        {tab === "Additional Context" && <div className="form-stack">
          <label>Background and reusable information<textarea className="knowledge-context" rows={15} maxLength={12000} value={draft.context}
            onChange={e => setDraft({ ...draft, context: e.target.value })}
            placeholder={"Shipping region: Western Europe\n\nAdd company background or other reusable information here."} /></label>
          <p className="muted">Use one fact per line. For a loan enquiry, add your actual preference, for example “Loan goal: Lower my monthly payment”. Zorax can match equivalent choices and use Other when available. {draft.context.length.toLocaleString()} / 12,000 characters.</p>
        </div>}
        <details className="knowledge-access" onToggle={e => toggleAccess(e.currentTarget.open)}>
          <summary>Extension access · {keyIds.length} {keyIds.length === 1 ? "key" : "keys"}</summary>
          {showAccess && <div className="form-stack">
            <p className="muted">Grant access only to keys you trust to use this profile’s answers.</p>
            {keys.loading && <Loading />}{keys.error && <Alert>{keys.error}</Alert>}
            {keys.data?.filter(key => !key.revoked_at).map(key => <label className="check" key={key.id}>
              <input type="checkbox" checked={keyIds.includes(key.id)} onChange={e => setKeyIds(ids => e.target.checked ? [...ids, key.id] : ids.filter(id => id !== key.id))} /> {key.name} <code>{key.prefix}…</code>
            </label>)}
            {keys.data && !keys.data.some(key => !key.revoked_at) && <a className="text-link" href="#keys">Create an API key</a>}
          </div>}
        </details>
        {issue && <Alert>{issue}</Alert>}
        <div className="link-row">
          <Button type="submit" disabled={pending}><Save size={15} /> {pending ? "Saving…" : "Save profile"}</Button>
          <Button variant="outline" aria-expanded={showPreview} onClick={() => togglePreview(!showPreview)}><Eye size={15} /> Preview</Button>
          {record && <Button variant="ghost" aria-expanded={showHistory} onClick={() => toggleHistory(!showHistory)}>Editing history</Button>}
          {record && <Button variant="ghost" className="knowledge-delete" disabled={pending} onClick={() => setConfirm(true)}><Trash2 size={15} /> Delete profile</Button>}
        </div>
      </form>
    </Panel>
    {confirm && <Panel title="Delete this profile?" caption="This removes the profile, its saved versions, and extension access.">
      <div className="link-row"><Button variant="destructive" disabled={pending} onClick={remove}>Delete permanently</Button>
        <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></div>
    </Panel>}
    {showPreview && <Panel title="Filling preview" caption="Review the values and reference text available to this profile.">
      <Preview profile={content} />
    </Panel>}
    {showHistory && record && <ProfileHistory id={record.id} />}
  </div>;
}
