"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { Activity, BookOpen, ChartNoAxesCombined, CircleGauge, FlaskConical, KeyRound, LibraryBig, List, LogOut, Menu, Moon, Server, Settings, Sun, Terminal, X } from "lucide-react";
import { Budgets, Documentation, History, ModelCatalog, Preferences } from "@/components/admin";
import { Keys } from "@/components/keys";
import { KnowledgeBase } from "@/components/knowledge";
import { Playground } from "@/components/playground";
import { Alert, Brand, Loading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Usage } from "@/components/usage";
import { api, ApiError, json, message } from "@/lib/api";

const navigation = [
  { id: "overview", label: "Overview", icon: CircleGauge },
  { id: "playground", label: "AI Playground", icon: FlaskConical },
  { id: "knowledge", label: "Knowledge Base", icon: LibraryBig },
  { id: "usage", label: "Provider Usage", icon: ChartNoAxesCombined },
  { id: "keys", label: "API Keys", icon: KeyRound },
  { id: "requests", label: "Request History", icon: List },
  { id: "models", label: "Models", icon: Server },
  { id: "budgets", label: "Token Budgets", icon: Activity },
  { id: "docs", label: "API Documentation", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings },
];

type Session = { username: string };
const THEME_EVENT = "zorax-theme";

function listenForNavigation(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function listenForTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

function Login({ onLogin, issue }: { onLogin: (session: Session) => void; issue: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError(""); setPending(true);
    try {
      onLogin(await api<Session>("/api/admin/login", json("POST", {
        username: values.get("username"), password: values.get("password"),
      })));
    } catch (error) {
      setError(error instanceof ApiError && error.status === 401 ? "Username or password is incorrect." : message(error));
    } finally { setPending(false); }
  }
  return <main className="login">
    <section className="login-feature" aria-labelledby="login-title">
      <Brand />
      <div className="login-copy"><span className="login-label"><Terminal size={15} /> Zorax Filler</span>
        <h1 id="login-title">Zorax AI <br />Cloud<span>.</span></h1>
        <p>Manage your inference gateway, track provider usage, and test how Zorax Filler handles a form.</p></div>
    </section>
    <section className="login-access">
      <div className="login-card"><h2>Admin sign in</h2>
        <p>Enter the credentials configured for this gateway.</p>
        {(error || issue) && <Alert>{error || issue}</Alert>}
        <form className="form-stack" onSubmit={submit}>
          <label>Username<input name="username" autoComplete="username" maxLength={128} required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required /></label>
          <Button type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
        </form>
      </div>
    </section>
  </main>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>();
  const section = useSyncExternalStore(listenForNavigation, () => window.location.hash.slice(1) || "overview", () => "overview");
  const dark = useSyncExternalStore(listenForTheme, () => localStorage.getItem("zorax-theme") !== "light", () => true);
  const [menu, setMenu] = useState(false);
  const [issue, setIssue] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<Session>("/api/admin/session", { signal: controller.signal })
      .then(setSession)
      .catch(error => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError && error.status === 401)) setIssue(message(error));
        setSession(null);
      });
    const unlisten = listenForNavigation(() => setMenu(false));
    return () => { controller.abort(); unlisten(); };
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      api<Session>("/api/admin/session").catch(error => {
        if (error instanceof ApiError && error.status === 401) {
          setSession(null); setIssue("Your session expired. Sign in again.");
        }
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      document.getElementById("show-navigation")?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menu]);

  function theme(value: boolean) {
    localStorage.setItem("zorax-theme", value ? "dark" : "light");
    window.dispatchEvent(new Event(THEME_EVENT));
  }
  async function logout() {
    try { await api("/api/admin/logout", json("POST")); setSession(null); setIssue(""); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) setSession(null);
      else setIssue(message(error));
    }
  }

  if (session === undefined) return <main className="initial"><Brand /><Loading /></main>;
  if (session === null) return <Login issue={issue} onLogin={value => { setIssue(""); setSession(value); }} />;

  const [pageId, keyId] = section.split("/");
  const page = navigation.find(item => item.id === pageId) ?? navigation[0];
  const sections = [navigation.slice(0, 5), navigation.slice(5)];
  const content = (() => {
    switch (page.id) {
      case "playground": return <Playground />;
      case "knowledge": return <KnowledgeBase />;
      case "usage": return <Usage />;
      case "keys": return <Keys />;
      case "requests": return <History key={keyId || "all"} keyId={keyId} />;
      case "models": return <ModelCatalog />;
      case "budgets": return <Budgets />;
      case "docs": return <Documentation />;
      case "settings": return <Preferences dark={dark} setDark={theme} />;
      default: return <Usage overview key="overview" />;
    }
  })();

  return <div className="shell" data-theme={dark ? "dark" : "light"}>
    <a className="skip-link" href="#dashboard-main" onClick={event => {
      event.preventDefault();
      document.getElementById("dashboard-main")?.focus();
    }}>Skip to content</a>
    <aside id="sidebar" className={"sidebar" + (menu ? " sidebar-open" : "")}>
      <div className="sidebar-brand"><a href="#overview" aria-label="Zorax AI Cloud overview"><Brand /></a>
        <Button className="mobile-toggle" size="icon" variant="ghost" aria-label="Close navigation" onClick={() => setMenu(false)}><X size={19} /></Button></div>
      <nav aria-label="Dashboard">
        {sections.map((items, index) => <div className="nav-group" key={index}>
          <div className="nav-label">{index === 0 ? "Workspace" : "Gateway"}</div>
          {items.map(({ id, label, icon: Icon }) => <a key={id} href={"#" + id}
            className={page.id === id ? "nav-link active" : "nav-link"} aria-current={page.id === id ? "page" : undefined}>
            <Icon size={17} aria-hidden="true" />{label}</a>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="account-user"><span className="avatar">{session.username.slice(0, 1).toUpperCase()}</span>
          <div><strong>{session.username}</strong><span>Administrator</span></div>
          <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={logout}><LogOut size={17} /></Button>
        </div>
      </div>
    </aside>
    {menu && <button className="backdrop" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <div className="workspace">
      <div className="topbar"><div className="crumb">
        <Button id="show-navigation" size="icon" variant="ghost" className="mobile-toggle" aria-label="Open navigation" aria-expanded={menu} aria-controls="sidebar" onClick={() => setMenu(true)}><Menu size={20} /></Button>
        <span>Zorax AI Cloud</span><span className="crumb-slash">/</span><strong>{page.label}</strong></div>
        <Button variant="ghost" size="icon" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => theme(!dark)}>
          {dark ? <Sun size={17} /> : <Moon size={17} />}</Button></div>
      <main className="content" id="dashboard-main" tabIndex={-1}>{issue && <Alert>{issue}</Alert>}{content}</main>
    </div>
  </div>;
}
