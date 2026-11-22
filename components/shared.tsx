import type { LucideIcon } from "lucide-react";
import { Activity, CircleAlert, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function Brand() {
  return <div className="brand"><span aria-hidden="true" className="brand-mark">Z</span>
    <span>Zorax<span className="brand-light"> Cloud</span></span></div>;
}

export function Heading({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return <header className="page-heading">
    <div><h1>{title}</h1><p>{detail}</p></div>
    {children && <div className="heading-actions">{children}</div>}
  </header>;
}

export function Panel({ title, caption, action, children }: {
  title: string; caption?: string; action?: ReactNode; children: ReactNode;
}) {
  return <section className="panel">
    <header className="panel-heading">
      <div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{action}
    </header>{children}
  </section>;
}

export function Badge({ variant = "neutral", children }: {
  variant?: "neutral" | "verified" | "estimated" | "bad"; children: ReactNode;
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function Stat({ title, value, source, icon: Icon = Activity }: {
  title: string; value: string; source: string; icon?: LucideIcon;
}) {
  return <article className="stat">
    <div className="stat-caption"><span>{title}</span><Icon size={16} aria-hidden="true" /></div>
    <strong>{value}</strong><span className="stat-source">{source}</span>
  </article>;
}

export function Empty({ title, detail, icon: Icon = Activity }: { title: string; detail: string; icon?: LucideIcon }) {
  return <div className="empty"><span className="empty-icon"><Icon size={20} aria-hidden="true" /></span>
    <strong>{title}</strong><p>{detail}</p></div>;
}
export function Alert({ children }: { children: ReactNode }) {
  return <p className="alert" role="alert"><CircleAlert size={17} />{children}</p>;
}
export function Loading() {
  return <p className="loading" role="status"><LoaderCircle size={16} className="animate-spin" /> Loading…</p>;
}
