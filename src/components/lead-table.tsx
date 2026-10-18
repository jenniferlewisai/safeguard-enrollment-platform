import Link from 'next/link';
import type { Lead } from '@/lib/leads';
export function LeadTable({leads,canEdit}:{leads:Lead[];canEdit:boolean}) {
  return <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Source</th><th>Phone</th><th>Stage</th><th>Intake</th></tr></thead><tbody>{leads.map(lead=><tr key={lead.id}><td><strong>{[lead.first_name,lead.last_name].filter(Boolean).join(' ')||'Incomplete draft'}</strong><small>{lead.email}</small></td><td>{lead.source}</td><td>{lead.phone||'—'}</td><td><span className={`status ${lead.stage}`}>{lead.stage}</span></td><td>{lead.intake_status?(canEdit?<Link href={`/intake?id=${lead.id}`}>{lead.intake_status==='draft'?'Resume draft':'View intake'}</Link>:lead.intake_status==='draft'?'Draft':'Ready for quote'):'No intake'}</td></tr>)}</tbody></table>{leads.length===0?<p className="notice">No leads found.</p>:null}</div>;
}
