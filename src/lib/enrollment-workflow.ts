import type { PoolClient } from 'pg';
import type { CurrentUser } from './auth';
import type { IntakeData } from './intake';
import { transaction } from './db';

export class WorkflowError extends Error {
  constructor(message:string,public readonly status=409) {super(message)}
}
export type CaseRecord={id:string;lead_id:string;coverage_year:number;hub_office_id:string|null;hub_client_id:string|null;base44_enrollment_id:string|null};
export type CaseContext=CaseRecord & {data:IntakeData;version:number;owner_external_id:string;consent_id:string|null;consent_status:string|null};

// Cross-app IDs never grant access. Existing lead ownership remains authoritative here.
export async function caseContext(client:PoolClient,user:CurrentUser,id:string):Promise<CaseContext> {
  const result=await client.query<CaseContext>(`SELECT c.*,i.data,i.version,l.owner_external_id,
    e.id::text AS consent_id,e.status AS consent_status FROM enrollment_cases c
    JOIN leads l ON l.id=c.lead_id JOIN lead_intakes i ON i.lead_id=l.id
    LEFT JOIN LATERAL (SELECT id,status FROM enrollment_consent_events WHERE case_id=c.id ORDER BY id DESC LIMIT 1) e ON true
    WHERE c.id=$1 AND ($2::boolean OR l.owner_external_id=$3) AND i.status='ready_for_quote' FOR UPDATE OF c`,[id,user.roles.includes('admin'),user.id]);
  const record=result.rows[0];
  if(!record) throw new WorkflowError('Enrollment case unavailable',404);
  if(record.coverage_year!==record.data.coverageYear) throw new WorkflowError('Coverage year changed; administrator review required');
  return record;
}
export function requireConsent(c:CaseContext) {
  if(c.consent_status!=='granted') throw new WorkflowError('Record current Marketplace assistance consent before continuing');
}
export async function audit(client:PoolClient,user:CurrentUser,caseId:string,action:string) {
  await client.query(`INSERT INTO audit_events(actor_external_id,action,entity_type,entity_id) VALUES($1,$2,'enrollment_case',$3)`,[user.id,action,caseId]);
}
export async function initializeCase(user:CurrentUser,leadId:string) {
  return transaction(async client=>{
    const lead=await client.query<{data:IntakeData}>(`SELECT i.data FROM lead_intakes i JOIN leads l ON l.id=i.lead_id
      WHERE l.id=$1 AND ($2::boolean OR l.owner_external_id=$3) AND i.status='ready_for_quote' FOR UPDATE OF l`,[leadId,user.roles.includes('admin'),user.id]);
    if(!lead.rows[0]) throw new WorkflowError('Complete an accessible intake first',404);
    const inserted=await client.query<{id:string}>(`INSERT INTO enrollment_cases(lead_id,coverage_year) VALUES($1,$2) ON CONFLICT(lead_id) DO NOTHING RETURNING id`,[leadId,lead.rows[0].data.coverageYear]);
    if(inserted.rows[0]) await audit(client,user,inserted.rows[0].id,'case.created');
    return (await client.query<CaseRecord & {consent_status:string|null}>(`SELECT c.*,(SELECT status FROM enrollment_consent_events WHERE case_id=c.id ORDER BY id DESC LIMIT 1) AS consent_status FROM enrollment_cases c WHERE lead_id=$1`,[leadId])).rows[0];
  });
}
export async function consent(user:CurrentUser,id:string,status:'granted'|'revoked',evidence:string) {
  return transaction(async client=>{
    await caseContext(client,user,id);
    await client.query(`INSERT INTO enrollment_consent_events(case_id,status,evidence_reference,actor_external_id) VALUES($1,$2,$3,$4)`,[id,status,evidence,user.id]);
    await audit(client,user,id,`consent.${status}`);
  });
}
export async function linkRecords(user:CurrentUser,id:string,hubClientId:string,hubOfficeId:string,base44Id?:string) {
  if(!user.roles.includes('admin')) throw new WorkflowError('Administrator reconciliation required',403);
  return transaction(async client=>{
    const c=await caseContext(client,user,id);
    // Correcting a reviewed link requires a separate reviewed repair.
    if((c.hub_client_id && (c.hub_client_id!==hubClientId||c.hub_office_id!==hubOfficeId)) ||
      (c.base44_enrollment_id && base44Id && c.base44_enrollment_id!==base44Id)) throw new WorkflowError('Existing link cannot be reassigned');
    try {
      await client.query(`UPDATE enrollment_cases SET hub_client_id=$2,hub_office_id=$3,
        base44_enrollment_id=coalesce(base44_enrollment_id,$4),linked_by=$5,linked_at=now() WHERE id=$1`,[id,hubClientId,hubOfficeId,base44Id??null,user.id]);
    } catch(error) {
      if((error as {code?:string}).code==='23505') throw new WorkflowError('This client/year or Base44 enrollment already has a case. Reconcile the existing records.');
      throw error;
    }
    await audit(client,user,id,'case.linked');
  });
}
