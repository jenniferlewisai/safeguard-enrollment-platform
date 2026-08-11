import Link from "next/link";
import type { ReactNode } from "react";

const links = [["Dashboard","/","▦"],["Leads","/leads","◉"],["Clients","/clients","♙"],["ACA Intake","/intake","✚"],["Enrollments","/clients","✓"]];

export function AppShell({children,active}:{children:ReactNode;active:string}) {
  const integrationReady=Boolean(process.env.HEALTHSHERPA_API_KEY&&process.env.HEALTHSHERPA_API_BASE_URL);
  return <div className="app"><aside className="sidebar"><Link className="brand" href="/"><span className="shield">S</span><div><strong>SAFEGUARD</strong><small>Enrollment platform</small></div></Link><nav className="nav" aria-label="Main navigation">{links.map(([label,href,icon])=><Link className={active===label?"active":""} href={href} key={label}><span className="icon">{icon}</span><span>{label}</span></Link>)}</nav><div className="sidebar-footer"><div className="user-card"><span className="avatar">JL</span><div><strong>Jennifer Lewis</strong><small>Agency administrator</small></div></div></div></aside><main className="main"><header className="topbar"><input className="search" aria-label="Search clients" placeholder="Search clients, leads, applications…"/><span className="topbar-badge">● HealthSherpa {integrationReady?"ready":"setup pending"}</span><span aria-label="Notifications">◌</span></header><div className="content">{children}</div></main></div>;
}
