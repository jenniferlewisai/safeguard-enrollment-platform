import { z } from 'zod';
import { transaction } from '@/lib/db';
import { privateJson } from '@/lib/http';
import { caseContext, requireConsent, WorkflowError } from '@/lib/enrollment-workflow';
import { healthSherpaCounties } from '@/lib/healthsherpa';
import { workflowFailure, workflowUser } from '@/lib/enrollment-api';
export const runtime='nodejs';
export async function GET(request:Request) {
  try {
    const user=await workflowUser(request),id=new URL(request.url).searchParams.get('caseId');
    if(!z.uuid().safeParse(id).success) throw new WorkflowError('Case ID required',422);
    const c=await transaction(async client=>{const c=await caseContext(client,user,id!);requireConsent(c);return c});
    return privateJson({data:await healthSherpaCounties(c.data.zipCode)});
  } catch(error) {return workflowFailure(error)}
}
