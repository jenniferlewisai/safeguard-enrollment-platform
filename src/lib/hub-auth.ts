import { decodeJwt } from 'jose';
import { z } from 'zod';
import { WorkflowError } from './enrollment-workflow';

// This is a read-only Hub identity bridge, not an Entra/license role conversion.
export async function hubReader(request:Request) {
  if(process.env.HUB_ENROLLMENT_READ_ENABLED!=='true') throw new WorkflowError('Hub enrollment view is not configured',503);
  const origin=process.env.HUB_SUPABASE_URL,key=process.env.HUB_SUPABASE_PUBLISHABLE_KEY;
  if(!origin||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin)||!key) throw new WorkflowError('Hub identity configuration required',503);
  // Accept only a public API key; never use a service role to read around Hub RLS.
  if(!key.startsWith('sb_publishable_')) {
    try {if(decodeJwt(key).role!=='anon') throw new Error()} catch {throw new WorkflowError('Configure the Hub public API key',503)}
  }
  const authorization=request.headers.get('authorization')??'';
  if(!authorization.startsWith('Bearer ')||authorization.length>20000) throw new WorkflowError('Hub sign-in required',401);
  const token=authorization.slice(7);
  let claims;
  try {
    claims=z.object({sub:z.uuid(),iss:z.literal(`${origin}/auth/v1`),aud:z.union([z.literal('authenticated'),z.array(z.string()).refine(v=>v.includes('authenticated'))]),aal:z.literal('aal2'),exp:z.number().gt(Date.now()/1000)}).parse(decodeJwt(token));
  } catch {throw new WorkflowError('Verified Hub MFA sign-in required',401)}
  const init={headers:{apikey:key,authorization},cache:'no-store' as const,redirect:'error' as const,signal:AbortSignal.timeout(10000)};
  // Decoded claims above are NOT an authorization decision. Validate this exact token
  // with the configured Supabase Auth server before trusting subject or MFA claims.
  const auth=await fetch(`${origin}/auth/v1/user`,init);
  if(!auth.ok) throw new WorkflowError('Hub authentication could not be verified',auth.status>=500?503:401);
  const user=z.object({id:z.uuid(),is_anonymous:z.boolean().optional()}).parse(await auth.json());
  if(user.id!==claims.sub||user.is_anonymous===true) throw new WorkflowError('Hub sign-in required',401);
  const profiles=await fetch(`${origin}/rest/v1/profiles?select=user_id,office_id,role,active&user_id=eq.${user.id}&limit=2`,{...init,signal:AbortSignal.timeout(10000)});
  if(!profiles.ok) throw new WorkflowError('Hub permissions could not be verified',503);
  const rows=z.array(z.object({user_id:z.uuid(),office_id:z.uuid(),role:z.string(),active:z.boolean()})).parse(await profiles.json());
  const profile=rows.length===1?rows[0]:null;
  if(!profile||profile.user_id!==user.id||!profile.active||!['owner','office_manager'].includes(profile.role)) throw new WorkflowError('Hub owner or office manager access required',403);
  return {userId:user.id,officeId:profile.office_id};
}
