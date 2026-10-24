import { z } from 'zod';
import { query } from '@/lib/db';
import { hubReader } from '@/lib/hub-auth';
import { privateJson } from '@/lib/http';
import { WorkflowError } from '@/lib/enrollment-workflow';
import { workflowFailure } from '@/lib/enrollment-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    const reader=await hubReader(request),params=new URL(request.url).searchParams;
    const parsed=z.object({year:z.coerce.number().int().min(2020).max(2099),offset:z.coerce.number().int().min(0).max(100000)}).safeParse({year:params.get('year'),offset:params.get('offset')??0});
    if(!parsed.success) throw new WorkflowError('Coverage year and valid offset required',422);
    const {year,offset}=parsed.data;
    // Office scope comes exclusively from the live verified Hub profile, never a query/header.
    const rows=await query(`SELECT c.id,c.lead_id,c.hub_client_id,c.coverage_year,
      e.status AS consent_status,h.status AS handoff_status,
      CASE WHEN e.status='granted' AND p.consent_event_id=e.id THEN p.policies ELSE NULL END AS policies,
      CASE WHEN e.status='granted' AND p.consent_event_id=e.id THEN p.checked_at ELSE NULL END AS policy_checked_at
      FROM enrollment_cases c
      LEFT JOIN LATERAL (SELECT id,status FROM enrollment_consent_events WHERE case_id=c.id ORDER BY id DESC LIMIT 1) e ON true
      LEFT JOIN healthsherpa_handoffs h ON h.case_id=c.id
      LEFT JOIN healthsherpa_policy_snapshots p ON p.case_id=c.id
      WHERE c.hub_office_id=$1 AND c.hub_client_id IS NOT NULL AND c.coverage_year=$2
      ORDER BY c.id LIMIT 101 OFFSET $3`,[reader.officeId,year,offset]);
    return privateJson({data:rows.rows.slice(0,100),nextOffset:rows.rows.length>100?offset+100:null});
  } catch(error) {return workflowFailure(error)}
}
