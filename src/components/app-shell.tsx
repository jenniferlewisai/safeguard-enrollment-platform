import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import type { ReactNode } from "react";

const links = [["Dashboard","/","▦"],["Leads","/leads","◉"],["Clients","/clients","♙"],["ACA Intake","/intake","✚"],["Enrollments","/clients","✓"]];

export async function AppShell({children,active}:{children:ReactNode;active:string}) {
  const user=await getCurrentUser();
  const integrationReady=Boolean(process.env.HEALTHSHERPA_API_KEY&&process.env.HEALTHSHERPA_API_BASE_URL);
  return <div className="app"><aside className="sidebar"><Link className="brand" href="/"><span className="shield">S</span><div><strong>SAFEGUARD</strong><small>Enrollment platform</small></div></Link><nav className="nav" aria-label="Main navigation">{links.map(([label,href,icon])=><Link className={active===label?"active":""} href={href} key={label}><span className="icon">{icon}</span><span>{label}</span></Link>)}</nav><div className="sidebar-footer"><div className="user-card"><span className="avatar">{user?.name.slice(0,1)??"S"}</span><div><strong>{user?.name??"Safeguard"}</strong><small>{user?.roles.join(", ")??"Signed out"}</small></div></div></div></aside><main className="main"><header className="topbar"><form action="/leads"><input className="search" name="q" aria-label="Search leads" placeholder="Search leads…"/></form><span className="topbar-badge">● HealthSherpa {integrationReady?"ready":"setup pending"}</span><span aria-label="Notifications">◌</span></header><div className="content">{children}</div></main></div>;
}
