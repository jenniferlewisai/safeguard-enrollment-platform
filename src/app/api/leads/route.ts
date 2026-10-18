import { canWrite, getCurrentUser } from '@/lib/auth';
import { transaction } from '@/lib/db';
import { listLeads } from '@/lib/leads';
import { leadSchema } from '@/lib/validation';
import { privateJson, sameOrigin } from '@/lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET() {
  const user=await getCurrentUser();
  if(!user) return privateJson({error:'Authentication required'},401);
  try {return privateJson({data:await listLeads(user)})}
  catch {return privateJson({error:'Lead storage unavailable'},503)}
}
export async function POST(request:Request) {
  const user=await getCurrentUser();
  if(!user) return privateJson({error:'Authentication required'},401);
  if(!canWrite(user)) return privateJson({error:'Insufficient role'},403);
  if(!sameOrigin(request)) return privateJson({error:'Invalid origin'},403);
  let body:unknown;
  try {body=await request.json()} catch {return privateJson({error:'Invalid JSON'},400)}
  const parsed=leadSchema.safeParse(body);
  if(!parsed.success) return privateJson({error:'Invalid lead',details:parsed.error.flatten().fieldErrors},422);
  const d=parsed.data;
  try {
    const lead=await transaction(async client=>{
      const result=await client.query("INSERT INTO leads (first_name,last_name,email,phone,source,notes,owner_external_id) VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7) RETURNING id,first_name,last_name,email,phone,source,stage,created_at",[d.firstName,d.lastName,d.email,d.phone,d.source,d.notes??null,user.id]);
      await client.query("INSERT INTO audit_events(actor_external_id,action,entity_type,entity_id) VALUES($1,'lead.created','lead',$2)",[user.id,result.rows[0].id]);
      return result.rows[0];
    });
    return privateJson({data:lead},201);
  } catch {return privateJson({error:'Unable to save lead'},503)}
}
