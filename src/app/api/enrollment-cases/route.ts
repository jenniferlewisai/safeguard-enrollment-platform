import { z } from 'zod';
import { privateJson } from '@/lib/http';
import { consent, initializeCase, linkRecords } from '@/lib/enrollment-workflow';
import { caseIdSchema, parseBody, workflowFailure, workflowUser } from '@/lib/enrollment-api';
export const runtime='nodejs';
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('initialize'),leadId:z.uuid()}).strict(),
  z.object({action:z.literal('consent'),caseId:caseIdSchema,status:z.enum(['granted','revoked']),evidenceReference:z.string().trim().min(3).max(300)}).strict(),
  z.object({action:z.literal('link'),caseId:caseIdSchema,hubClientId:z.uuid(),hubOfficeId:z.uuid(),base44EnrollmentId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),reviewConfirmed:z.literal(true)}).strict(),
]);
export async function POST(request:Request) {
  try {
    const user=await workflowUser(request),body=await parseBody(request,schema);
    if(body.action==='initialize') return privateJson({data:await initializeCase(user,body.leadId)});
    if(body.action==='consent') await consent(user,body.caseId,body.status,body.evidenceReference);
    if(body.action==='link') await linkRecords(user,body.caseId,body.hubClientId,body.hubOfficeId,body.base44EnrollmentId);
    return privateJson({ok:true});
  } catch(error) {return workflowFailure(error)}
}
