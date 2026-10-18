import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { LeadTable } from '@/components/lead-table';
import { getCurrentUser, canWrite } from '@/lib/auth';
import { listLeads } from '@/lib/leads';
export const dynamic='force-dynamic';
export default async function LeadsPage({searchParams}:{searchParams:Promise<{q?:string;stage?:string}>}) {
  const user=await getCurrentUser();if(!user) redirect('/login');
  const {q='',stage='all'}=await searchParams;
  let leads;
  try {leads=await listLeads(user)} catch {return <AppShell active="Leads"><h1>Leads</h1><p role="alert">Lead storage is unavailable. Please retry later.</p></AppShell>}
  const filtered=leads.filter(l=>(stage==='all'||l.stage===stage)&&`${l.first_name} ${l.last_name} ${l.email??''} ${l.phone}`.toLowerCase().includes(q.toLowerCase()));
  return <AppShell active="Leads"><div className="hero-row page-title"><div><p className="eyebrow">Sales pipeline</p><h1>Leads</h1><p className="muted">Latest 100 accessible leads, including saved intake drafts.</p></div>{canWrite(user)?<Link className="button primary" href="/intake">+ Add lead</Link>:null}</div><form className="filters"><input name="q" aria-label="Search leads" placeholder="Search leads…" defaultValue={q}/><select name="stage" aria-label="Stage" defaultValue={stage}><option value="all">All stages</option>{['new','contacted','intake','quoted','enrolled','closed'].map(s=><option key={s}>{s}</option>)}</select><button className="button secondary" type="submit">Filter</button></form><section className="panel table-panel"><LeadTable leads={filtered} canEdit={canWrite(user)}/></section></AppShell>;
}
