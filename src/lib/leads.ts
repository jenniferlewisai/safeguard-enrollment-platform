import type { CurrentUser } from './auth';
import { query, transaction } from './db';
import type { SavedIntake } from './intake';
import type { intakeSchema } from './intake';
import type { z } from 'zod';

export type Lead = {id:string;first_name:string;last_name:string;email:string|null;phone:string;source:string;stage:string;owner_external_id:string;intake_status:string|null;updated_at:Date};
export const isAdmin = (user:CurrentUser) => user.roles.includes('admin');
export async function listLeads(user:CurrentUser) {
  return (await query<Lead>(`SELECT l.id,l.first_name,l.last_name,l.email,l.phone,l.source,l.stage,l.owner_external_id,l.updated_at,i.status AS intake_status FROM leads l LEFT JOIN lead_intakes i ON i.lead_id=l.id WHERE ($1::boolean OR l.owner_external_id=$2) ORDER BY l.updated_at DESC LIMIT 100`,[isAdmin(user),user.id])).rows;
}
export async function leadCounts(user:CurrentUser) {
  return (await query<{stage:string;count:string}>(`SELECT stage,count(*)::text AS count FROM leads WHERE ($1::boolean OR owner_external_id=$2) GROUP BY stage`,[isAdmin(user),user.id])).rows;
}
export async function getIntake(user:CurrentUser,id:string) {
  return (await query<SavedIntake>(`SELECT i.lead_id,i.data,i.status,i.version FROM lead_intakes i JOIN leads l ON l.id=i.lead_id WHERE l.id=$1 AND ($2::boolean OR l.owner_external_id=$3)`,[id,isAdmin(user),user.id])).rows[0];
}
export class IntakeConflict extends Error {}
export async function saveIntake(user:CurrentUser,input:z.infer<typeof intakeSchema>) {
  return transaction(async client => {
    // The lead PK serializes first-save retries; the version rejects stale tabs.
    if(input.version===0) {
      const inserted=await client.query(`INSERT INTO leads(id,first_name,last_name,email,phone,source,owner_external_id) VALUES($1,$2,$3,NULLIF($4,''),$5,'ACA intake',$6) ON CONFLICT(id) DO NOTHING RETURNING id`,[input.id,input.data.firstName,input.data.lastName,input.data.email,input.data.phone,user.id]);
      if(!inserted.rowCount) throw new IntakeConflict('This intake already exists. Reload before saving.');
    }
    const lead=await client.query(`SELECT id FROM leads WHERE id=$1 AND ($2::boolean OR owner_external_id=$3) FOR UPDATE`,[input.id,isAdmin(user),user.id]);
    if(!lead.rowCount) throw new IntakeConflict('Intake unavailable.');
    const existing=await client.query<SavedIntake>('SELECT lead_id,data,status,version FROM lead_intakes WHERE lead_id=$1',[input.id]);
    const current=existing.rows[0];
    if((current?.version??0)!==input.version || current?.status==='ready_for_quote') throw new IntakeConflict('This intake changed or was submitted. Reload before saving.');
    const status=input.intent==='submit'?'ready_for_quote':'draft';
    const saved=await client.query<SavedIntake>(`INSERT INTO lead_intakes(lead_id,data,status,consent_captured_by) VALUES($1,$2,$3,$4) ON CONFLICT(lead_id) DO UPDATE SET data=EXCLUDED.data,status=EXCLUDED.status,version=lead_intakes.version+1,updated_at=now() RETURNING lead_id,data,status,version`,[input.id,JSON.stringify(input.data),status,user.id]);
    await client.query(`UPDATE leads SET first_name=$2,last_name=$3,email=NULLIF($4,''),phone=$5,notes=$6,stage='intake',updated_at=now() WHERE id=$1`,[input.id,input.data.firstName,input.data.lastName,input.data.email,input.data.phone,input.data.notes]);
    await client.query(`INSERT INTO audit_events(actor_external_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'lead_intake',$3,$4)`,[user.id,input.intent==='submit'?'intake.submitted':'intake.draft_saved',input.id,JSON.stringify({version:saved.rows[0].version,status})]);
    return saved.rows[0];
  });
}
