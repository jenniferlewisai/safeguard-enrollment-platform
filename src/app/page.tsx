import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { LeadTable } from '@/components/lead-table';
import { getCurrentUser, canWrite } from '@/lib/auth';
import { listLeads, leadCounts } from '@/lib/leads';
export const dynamic='force-dynamic';
export default async function DashboardPage() {
  const user=await getCurrentUser();if(!user) redirect('/login');
  let leads,counts;
  try {[leads,counts]=await Promise.all([listLeads(user),leadCounts(user)])} catch {return <AppShell active="Dashboard"><h1>Enrollment dashboard</h1><p role="alert">Lead storage is unavailable. Please retry later.</p></AppShell>}
  const total=counts.reduce((sum,row)=>sum+Number(row.count),0);
  return <AppShell active="Dashboard"><section className="hero-row"><div><p className="eyebrow">Enrollment command center</p><h1>Welcome, {user.name}.</h1><p className="muted">Your accessible lead pipeline, including saved drafts.</p></div>{canWrite(user)?<Link className="button primary" href="/intake">+ New ACA intake</Link>:null}</section><section className="metric-grid" aria-label="Pipeline summary">{[{stage:'All leads',count:String(total)},...counts].map(row=><article className="metric-card" key={row.stage}><div><p>{row.stage}</p><strong>{row.count}</strong></div></article>)}</section><section className="panel table-panel"><div className="panel-heading"><h2>Recently updated leads</h2><Link href="/leads">View all</Link></div><LeadTable leads={leads.slice(0,10)} canEdit={canWrite(user)}/></section></AppShell>;
}
