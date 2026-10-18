import { canWrite, getCurrentUser } from '@/lib/auth';
import { intakeSchema } from '@/lib/intake';
import { IntakeConflict, saveIntake } from '@/lib/leads';
import { privateJson, sameOrigin } from '@/lib/http';
export const runtime='nodejs';
export async function POST(request:Request) {
  const user=await getCurrentUser();
  if(!user) return privateJson({error:'Authentication required'},401);
  if(!canWrite(user)) return privateJson({error:'Insufficient role'},403);
  if(!sameOrigin(request)) return privateJson({error:'Invalid origin'},403);
  let body:unknown;
  try {body=await request.json()} catch {return privateJson({error:'Invalid JSON'},400)}
  const parsed=intakeSchema.safeParse(body);
  if(!parsed.success) return privateJson({error:'Check the intake fields and applicant consent.',details:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)},422);
  try {return privateJson({data:await saveIntake(user,parsed.data)},parsed.data.version===0?201:200)}
  catch(error) {
    if(error instanceof IntakeConflict) return privateJson({error:error.message},409);
    return privateJson({error:'Unable to save intake. Your entries are still on this page. Please retry.'},503);
  }
}
