import { z } from 'zod';
import { transaction } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { audit, caseContext, requireConsent, WorkflowError } from '@/lib/enrollment-workflow';
import { readHealthSherpaPolicies } from '@/lib/healthsherpa';
import { caseIdSchema, parseBody, workflowFailure, workflowUser } from '@/lib/enrollment-api';
export const runtime='nodejs';
const schema=z.object({caseId:caseIdSchema}).strict();
export async function POST(request:Request) {
  try {
    const user=await workflowUser(request),body=await parseBody(request,schema);
    if(process.env.HEALTHSHERPA_POLICY_STATUS_ENABLED!=='true') throw new WorkflowError('HealthSherpa policy-status approval and linked OAuth verification required',503);
    if(!process.env.HEALTHSHERPA_AGENT_EXTERNAL_ID||user.id!==process.env.HEALTHSHERPA_AGENT_EXTERNAL_ID) throw new WorkflowError('Use the configured HealthSherpa-linked agent account',403);
    const c=await transaction(async client=>{
      const c=await caseContext(client,user,body.caseId);requireConsent(c);
      if(!c.hub_client_id) throw new WorkflowError('Reconcile the Hub client before checking provider outcomes');
      const handoff=(await client.query<{status:string;actor_external_id:string}>('SELECT status,actor_external_id FROM healthsherpa_handoffs WHERE case_id=$1',[c.id])).rows[0];
      if(handoff?.status!=='succeeded'||handoff.actor_external_id!==user.id) throw new WorkflowError('Verify the existing agent handoff first');
      return c;
    });
    const policies=await readHealthSherpaPolicies(c.id,c.coverage_year);
    const snapshot=await transaction(async client=>{
      const current=await caseContext(client,user,c.id);requireConsent(current);
      if(current.consent_id!==c.consent_id) throw new WorkflowError('Consent changed during the provider check');
      const result=await client.query<{policies:typeof policies;checked_at:string}>(`INSERT INTO healthsherpa_policy_snapshots(case_id,consent_event_id,policies,checked_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(case_id) DO UPDATE SET consent_event_id=EXCLUDED.consent_event_id,
        policies=EXCLUDED.policies,checked_at=now(),checked_by=EXCLUDED.checked_by RETURNING policies,checked_at`,[c.id,c.consent_id,JSON.stringify(policies),user.id]);
      await audit(client,user,c.id,'policy_status.checked');
      return result.rows[0];
    });
    return privateJson({data:snapshot});
  } catch(error) {return workflowFailure(error)}
}
