import { z } from 'zod';
import { canWrite, getCurrentUser } from './auth';
import { privateJson, sameOrigin } from './http';
import { WorkflowError } from './enrollment-workflow';

export async function workflowUser(request:Request) {
  const user=await getCurrentUser();
  if(!user) throw new WorkflowError('Authentication required',401);
  if(!canWrite(user)) throw new WorkflowError('Insufficient role',403);
  if(request.method!=='GET'&&!sameOrigin(request)) throw new WorkflowError('Invalid origin',403);
  if(process.env.HEALTHSHERPA_WORKFLOW_ENABLED!=='true') throw new WorkflowError('Enrollment workflow awaits isolated testing and reconciliation',503);
  return user;
}
export async function parseBody<T>(request:Request,schema:z.ZodType<T>):Promise<T> {
  let body:unknown;
  try {body=await request.json()} catch {throw new WorkflowError('Invalid JSON',400)}
  const parsed=schema.safeParse(body);
  if(!parsed.success) throw new WorkflowError('Check the request fields',422);
  return parsed.data;
}
export function workflowFailure(error:unknown) {
  if(error instanceof WorkflowError) return privateJson({error:error.message},error.status);
  // No PII, database errors, keys, raw provider payloads or links in logs/responses.
  return privateJson({error:'Enrollment service unavailable. Check setup or ask an administrator to review before retrying.'},503);
}
export const caseIdSchema=z.uuid();
export const quoteCaseSchema=z.object({
  caseId:caseIdSchema,countyFips:z.string().regex(/^\d{5}$/),
  effectiveDate:z.iso.date(),
  applicants:z.array(z.object({
    memberId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),age:z.number().int().min(0).max(120),
    relationship:z.enum(['primary','spouse','dependent']),usesTobacco:z.boolean(),
  }).strict()).min(1).max(20),
}).strict().superRefine((v,ctx)=>{
  if(v.applicants.filter(a=>a.relationship==='primary').length!==1 || v.applicants.filter(a=>a.relationship==='spouse').length>1 || new Set(v.applicants.map(a=>a.memberId)).size!==v.applicants.length) {
    ctx.addIssue({code:'custom',message:'Choose one primary, at most one spouse, and unique member IDs'});
  }
});
