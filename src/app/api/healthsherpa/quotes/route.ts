import { transaction } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { audit, caseContext, requireConsent, WorkflowError } from '@/lib/enrollment-workflow';
import { requestHealthSherpaQuote, selectedCounty } from '@/lib/healthsherpa';
import { parseBody, quoteCaseSchema, workflowFailure, workflowUser } from '@/lib/enrollment-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    const user=await workflowUser(request),body=await parseBody(request,quoteCaseSchema);
    const c=await transaction(async client=>{
      const c=await caseContext(client,user,body.caseId);requireConsent(c);
      if(body.applicants.length>(c.data.householdSize??0) || Number(body.effectiveDate.slice(0,4))!==c.coverage_year) throw new WorkflowError('Check applicants and coverage-year effective date',422);
      await audit(client,user,c.id,'quote.requested');return c;
    });
    const county=await selectedCounty(c.data.zipCode,body.countyFips);
    const quote=await requestHealthSherpaQuote({
      context:{product:'aca',exchange:'on_exchange',coverage_family:'medical',coverage_type:'medical',plan_year:c.coverage_year},
      location:{zip_code:c.data.zipCode,fips_code:county.fips_code,state:county.state},
      household:{household_size:c.data.householdSize,annual_income:c.data.income,effective_date:body.effectiveDate,
        applicants:body.applicants.map(a=>({member_id:a.memberId,age:a.age,relationship:a.relationship,uses_tobacco:a.usesTobacco}))},
    });
    await transaction(async client=>{
      const current=await caseContext(client,user,c.id);requireConsent(current);
      if(current.consent_id!==c.consent_id) throw new WorkflowError('Consent changed during the request');
      await audit(client,user,c.id,'quote.received');
    });
    return privateJson({data:quote});
  } catch(error) {return workflowFailure(error)}
}
