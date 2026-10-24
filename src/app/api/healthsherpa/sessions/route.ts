import { z } from 'zod';
import { transaction } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { audit, caseContext, requireConsent, WorkflowError } from '@/lib/enrollment-workflow';
import { requestHealthSherpaSession, safeShoppingUrl, selectedCounty } from '@/lib/healthsherpa';
import { caseIdSchema, parseBody, workflowFailure, workflowUser } from '@/lib/enrollment-api';
export const runtime='nodejs';
const schema=z.object({caseId:caseIdSchema,countyFips:z.string().regex(/^\d{5}$/)}).strict();
type Handoff={idempotency_key:string;consent_event_id:string;actor_external_id:string;status:string;shopping_url:string|null};
export async function POST(request:Request) {
  try {
    const user=await workflowUser(request),body=await parseBody(request,schema);
    // An API key is linked to one Marketplace agent. Admin is not a license or an OAuth identity.
    if(process.env.HEALTHSHERPA_ENROLLMENT_SESSIONS_ENABLED!=='true') throw new WorkflowError('HealthSherpa enrollment approval and OAuth verification required',503);
    if(!process.env.HEALTHSHERPA_AGENT_EXTERNAL_ID || user.id!==process.env.HEALTHSHERPA_AGENT_EXTERNAL_ID) throw new WorkflowError('Use the explicitly configured HealthSherpa-linked agent account',403);
    const prepared=await transaction(async client=>{
      const c=await caseContext(client,user,body.caseId);requireConsent(c);
      if(!c.hub_client_id) throw new WorkflowError('Administrator must reconcile this case with the Hub client first');
      const existing=(await client.query<Handoff>('SELECT *,consent_event_id::text FROM healthsherpa_handoffs WHERE case_id=$1',[c.id])).rows[0];
      if(existing) {
        if(existing.status==='succeeded' && existing.consent_event_id===c.consent_id && existing.actor_external_id===user.id) return {c,existing};
        throw new WorkflowError('A handoff already exists or needs review. Resume the existing HealthSherpa work; do not create another application.');
      }
      const op=(await client.query<Handoff>(`INSERT INTO healthsherpa_handoffs(case_id,consent_event_id,actor_external_id,status) VALUES($1,$2,$3,'pending') RETURNING *`,[c.id,c.consent_id,user.id])).rows[0];
      await audit(client,user,c.id,'handoff.requested');
      return {c,op};
    });
    if(prepared.existing) return privateJson({data:{shoppingUrl:safeShoppingUrl(prepared.existing.shopping_url),status:'handoff_ready'}});
    const {c,op}=prepared;
    try {
      const county=await selectedCounty(c.data.zipCode,body.countyFips);
      // Only geography is prefilled. The licensed agent reviews household/contact details in
      // HealthSherpa; do not invent missing applicant flags or silently copy partial intake data.
      const shoppingUrl=await requestHealthSherpaSession({
        external_id:c.id,
        context:{product:'aca',exchange:'on_exchange',coverage_family:'medical',coverage_type:'medical',plan_year:c.coverage_year,flow:'agent_assisted',locale:'en-US'},
        location:{zip_code:c.data.zipCode,fips_code:county.fips_code,state:county.state},
      },op!.idempotency_key,c.id);
      await transaction(async client=>{
        const current=await caseContext(client,user,c.id);requireConsent(current);
        if(current.consent_id!==c.consent_id) throw new WorkflowError('Consent changed during handoff; administrator review required');
        await client.query(`UPDATE healthsherpa_handoffs SET status='succeeded',shopping_url=$2,updated_at=now() WHERE case_id=$1`,[c.id,shoppingUrl]);
        await audit(client,user,c.id,'handoff.ready');
      });
      return privateJson({data:{shoppingUrl,status:'handoff_ready'}});
    } catch(error) {
      // Includes timeout, malformed response, and local persistence failure after remote success.
      // Never silently retry an ambiguous remote operation with a new idempotency key.
      await transaction(async client=>{
        await client.query(`UPDATE healthsherpa_handoffs SET status='review_required',updated_at=now() WHERE case_id=$1`,[c.id]);
        await audit(client,user,c.id,'handoff.review_required');
      });
      throw error;
    }
  } catch(error) {return workflowFailure(error)}
}
