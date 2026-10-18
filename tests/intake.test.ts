import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';

const state=vi.hoisted(()=>({principal:null as string|null,db:null as unknown as PGlite,failAudit:false}));
vi.mock('next/headers',()=>({headers:async()=>new Headers(state.principal?{'x-ms-client-principal':state.principal}:{})}));
vi.mock('@/lib/db',()=>({
  query:async(sql:string,params:unknown[]=[])=>{const r=await state.db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}},
  transaction:async(work:(client:unknown)=>Promise<unknown>)=>state.db.transaction(async tx=>work({query:async(sql:string,params:unknown[]=[])=>{
    if(state.failAudit&&sql.includes('INSERT INTO audit_events')) throw new Error('fictional audit failure');
    const r=await tx.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};
  }})),
}));
import { GET as leadsGet, POST as leadsPost } from '@/app/api/leads/route';
import { POST } from '@/app/api/intakes/route';
import { getCurrentUser } from '@/lib/auth';
import { getIntake, leadCounts } from '@/lib/leads';
import { emptyIntake } from '@/lib/intake';
import { sameOrigin } from '@/lib/http';

function signIn(id='fictional-agent-a',role='agent') {state.principal=Buffer.from(JSON.stringify({userId:id,userDetails:`${id}@example.test`,claims:[{typ:'roles',val:role}]})).toString('base64')}
function input() {return {id:randomUUID(),version:0,intent:'draft',data:{...emptyIntake(),firstName:'Fictional',lastName:'Applicant'}}}
function request(body:unknown,origin='http://localhost') {return new Request('http://localhost/api/intakes',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)})}
async function leadRows(){const response=await leadsGet();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');return (await response.json()).data}
beforeAll(async()=>{
  state.db=new PGlite();
  // PGlite supplies gen_random_uuid() in core; pgcrypto is not bundled.
  await state.db.exec(readFileSync('database/001_initial.sql','utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  await state.db.exec(readFileSync('database/002_intake.sql','utf8'));
},30000);
afterAll(async()=>{await state.db.close()});
beforeEach(async()=>{state.failAudit=false;await state.db.exec('TRUNCATE lead_intakes,leads,audit_events CASCADE');signIn()});
describe('authenticated intake persistence',()=>{
  it('supports mapped Azure App Service identities and disables demo auth in production',async()=>{
    state.principal=Buffer.from(JSON.stringify({auth_typ:'aad',name_typ:'name',role_typ:'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',claims:[{typ:'http://schemas.microsoft.com/identity/claims/objectidentifier',val:'fictional-entra-id'},{typ:'name',val:'Fictional Agent'},{typ:'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',val:'agent'}]})).toString('base64');
    expect(await getCurrentUser()).toMatchObject({id:'fictional-entra-id',name:'Fictional Agent',roles:['agent']});
    state.principal=null;vi.stubEnv('NODE_ENV','production');vi.stubEnv('DEMO_AUTH','true');
    try {expect(await getCurrentUser()).toBeNull()} finally {vi.unstubAllEnvs()}
  });
  it('accepts the addressed host behind a proxy and rejects foreign origins',()=>{
    expect(sameOrigin(new Request('http://localhost/api/intakes',{headers:{host:'app.example.test',origin:'https://app.example.test','x-forwarded-proto':'https'}}))).toBe(true);
    expect(sameOrigin(new Request('http://localhost/api/intakes',{headers:{host:'app.example.test',origin:'https://foreign.example.test','x-forwarded-proto':'https'}}))).toBe(false);
  });
  it('saves, retrieves, resumes and submits a draft without duplicate leads',async()=>{
    const body=input();
    let response=await POST(request(body));expect(response.status).toBe(201);
    let saved=(await response.json()).data;expect(saved.version).toBe(1);
    expect((await leadRows())[0].intake_status).toBe('draft');
    const user=(await getCurrentUser())!;
    expect((await getIntake(user,body.id)).data.firstName).toBe('Fictional');
    response=await POST(request({...body,version:1,data:{...body.data,notes:'Fictional follow-up'}}));
    expect(response.status).toBe(200);saved=(await response.json()).data;expect(saved.version).toBe(2);
    response=await POST(request({...body,version:2,intent:'submit',data:{...body.data,dob:'1990-01-01',phone:'2025550100',email:'applicant@example.test',address:'123 Fictional Lane',county:'Test County',zipCode:'20001',householdSize:2,income:42000}}));
    expect(response.status).toBe(200);expect((await response.json()).data.status).toBe('ready_for_quote');
    expect(await leadRows()).toHaveLength(1);
    expect(await leadCounts(user)).toEqual([{stage:'intake',count:'1'}]);
    const audit=await state.db.query('SELECT action,metadata FROM audit_events ORDER BY id');expect(audit.rows).toHaveLength(3);
    expect(JSON.stringify(audit.rows)).not.toContain('Fictional');
    const consent=await state.db.query<{consent_captured_by:string}>('SELECT consent_captured_by FROM lead_intakes');expect(consent.rows[0].consent_captured_by).toBe(user.id);
    expect((await POST(request({...body,version:3}))).status).toBe(409);
  });
  it('rejects unauthenticated, malformed principals, viewer writes and cross-origin writes',async()=>{
    state.principal=null;expect((await POST(request(input()))).status).toBe(401);expect((await leadsGet()).status).toBe(401);
    state.principal=Buffer.from(JSON.stringify({claims:[{typ:'roles',val:'admin'}]})).toString('base64');expect((await POST(request(input()))).status).toBe(401);
    state.principal='not-json';expect(await getCurrentUser()).toBeNull();
    signIn('fictional-viewer','viewer');expect((await POST(request(input()))).status).toBe(403);expect((await leadsPost(request({})) ).status).toBe(403);
    signIn();expect((await POST(request(input(),'https://foreign.example'))).status).toBe(403);
  });
  it('scopes reads and updates to owners, with admin access',async()=>{
    const body=input();expect((await POST(request(body))).status).toBe(201);
    signIn('fictional-agent-b');expect(await leadRows()).toHaveLength(0);
    expect(await getIntake((await getCurrentUser())!,body.id)).toBeUndefined();
    expect((await POST(request({...body,version:1}))).status).toBe(409);
    signIn('fictional-agent-b','viewer');expect(await leadRows()).toHaveLength(0);
    signIn('fictional-admin','admin');expect(await leadRows()).toHaveLength(1);
    expect((await POST(request({...body,version:1}))).status).toBe(200);
    expect((await state.db.query<{consent_captured_by:string}>('SELECT consent_captured_by FROM lead_intakes')).rows[0].consent_captured_by).toBe('fictional-agent-a');
  });
  it('enforces consent, complete submission, types, bounds and strict field lists',async()=>{
    const body=input();
    for(const bad of [{...body,data:{...body.data,consent:false}},{...body,intent:'submit'},{...body,data:{...body.data,householdSize:21}},{...body,data:{...body.data,income:-1}},{...body,data:{...body.data,dob:'2026-02-31'}},{...body,data:{...body.data,ssn:'fictional'}},{...body,owner_external_id:'fictional-agent-b'}]) expect((await POST(request(bad))).status).toBe(422);
    expect((await POST(new Request('http://localhost/api/intakes',{method:'POST',body:'{'}))).status).toBe(400);
    expect(await leadRows()).toHaveLength(0);
  });
  it('rejects first-save retries and stale versions without overwriting',async()=>{
    const body=input();expect((await POST(request(body))).status).toBe(201);
    expect((await POST(request(body))).status).toBe(409);
    expect((await POST(request({...body,version:1}))).status).toBe(200);
    expect((await POST(request({...body,version:1,data:{...body.data,firstName:'Stale'}}))).status).toBe(409);
    expect((await leadRows())[0].first_name).toBe('Fictional');
  });
  it('rolls back all writes on audit failure and permits retry',async()=>{
    const body=input();state.failAudit=true;
    expect((await POST(request(body))).status).toBe(503);
    expect(await leadRows()).toHaveLength(0);
    state.failAudit=false;expect((await POST(request(body))).status).toBe(201);
  });
  it('preserves the lead creation API and assigns ownership from the session',async()=>{
    expect((await leadsPost(request({firstName:'Fictional',lastName:'Lead',phone:'2025550101',email:'lead@example.test',source:'Test'}))).status).toBe(201);
    expect((await leadRows())[0].owner_external_id).toBe('fictional-agent-a');
  });
});
