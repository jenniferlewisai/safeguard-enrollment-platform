import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
const state=vi.hoisted(()=>({principal:null as string|null,db:null as unknown as PGlite,failAction:''}));
vi.mock('next/headers',()=>({headers:async()=>new Headers(state.principal?{'x-ms-client-principal':state.principal}:{})}));
vi.mock('@/lib/db',()=>({transaction:async(work:(client:unknown)=>Promise<unknown>)=>state.db.transaction(async tx=>work({query:async(sql:string,params:unknown[]=[])=>{
  if(state.failAction && sql.includes('INSERT INTO audit_events') && params[1]===state.failAction) throw new Error('fictional audit failure');
  const r=await tx.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};
}}))}));
import { POST as intake } from '@/app/api/intakes/route';
import { POST as cases } from '@/app/api/enrollment-cases/route';
import { POST as quotes } from '@/app/api/healthsherpa/quotes/route';
import { POST as sessions } from '@/app/api/healthsherpa/sessions/route';
import { GET as counties } from '@/app/api/healthsherpa/counties/route';
import { emptyIntake } from '@/lib/intake';
import { safeShoppingUrl } from '@/lib/enrollment-link';
const agent='fictional-agent';
function signIn(id=agent,role='agent') {state.principal=Buffer.from(JSON.stringify({userId:id,claims:[{typ:'roles',val:role}]})).toString('base64')}
function req(body:unknown,origin='http://localhost') {return new Request('http://localhost/api/test',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)})}
async function seed() {
  const id=randomUUID();
  const r=await intake(req({id,version:0,intent:'submit',data:{...emptyIntake(),firstName:'Fictional',lastName:'Applicant',dob:'1990-01-01',phone:'2025550100',email:'fictional@example.test',address:'123 Fictional Lane',county:'Test',zipCode:'20001',householdSize:2,income:42000,coverageYear:2027}}));
  expect(r.status).toBe(201);
  const response=await cases(req({action:'initialize',leadId:id}));expect(response.status).toBe(200);
  return (await response.json()).data;
}
async function grant(id:string,status='granted') {
  const r=await cases(req({action:'consent',caseId:id,status,evidenceReference:'fictional-signed-form-001'}));expect(r.status).toBe(200);
}
async function link(id:string,hub=randomUUID()) {
  signIn('fictional-admin','admin');
  const response=await cases(req({action:'link',caseId:id,hubClientId:hub,hubOfficeId:randomUUID(),reviewConfirmed:true}));
  signIn();return response;
}
const quoteBody=(id:string)=>({caseId:id,countyFips:'11001',effectiveDate:'2027-01-01',applicants:[{memberId:'applicant-1',age:36,relationship:'primary',usesTobacco:false}]});
const fetchMock=vi.fn();
beforeAll(async()=>{
  state.db=new PGlite();
  for(const file of ['001_initial.sql','002_intake.sql','003_enrollment_workflow.sql']) await state.db.exec(readFileSync(`database/${file}`,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
},30000);
afterAll(async()=>{await state.db.close()});
beforeEach(async()=>{
  state.failAction='';await state.db.exec('TRUNCATE leads,audit_events CASCADE');signIn();
  vi.stubEnv('HEALTHSHERPA_WORKFLOW_ENABLED','true');vi.stubEnv('HEALTHSHERPA_ENROLLMENT_SESSIONS_ENABLED','true');
  vi.stubEnv('HEALTHSHERPA_AGENT_EXTERNAL_ID',agent);vi.stubEnv('HEALTHSHERPA_API_KEY','fictional-test-key');
  vi.stubEnv('HEALTHSHERPA_API_BASE_URL','https://staging-api.one.healthsherpa.com');
  fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);
  fetchMock.mockImplementation(async(url:string,options:RequestInit)=>{
    if(url.includes('/reference/counties')) return Response.json({counties:[{fips_code:'11001',name:'Fictional County',state:'DC'}]});
    if(url.endsWith('/v1/quotes')) return Response.json({plans:[],meta:{result_count:0}});
    const data=JSON.parse(options.body as string);
    return Response.json({external_id:data.external_id,links:{shopping_url:'https://www.healthsherpa.com/fictional-session'}});
  });
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
describe('one consented enrollment case per linked client and year',()=>{
  it('keeps existing intake data and resumes one case without duplicate rows',async()=>{
    const c=await seed();
    const r=await cases(req({action:'initialize',leadId:c.lead_id}));expect((await r.json()).data.id).toBe(c.id);
    expect((await state.db.query('SELECT * FROM enrollment_cases')).rows).toHaveLength(1);
    expect((await state.db.query('SELECT * FROM leads')).rows).toHaveLength(1);
    expect((await state.db.query<{status:string}>('SELECT status FROM lead_intakes')).rows[0].status).toBe('ready_for_quote');
  });
  it('denies unsigned, revoked, foreign-owner and viewer quote requests before outbound calls',async()=>{
    const c=await seed();expect((await quotes(req(quoteBody(c.id)))).status).toBe(409);expect(fetchMock).not.toHaveBeenCalled();
    await grant(c.id);await grant(c.id,'revoked');expect((await quotes(req(quoteBody(c.id)))).status).toBe(409);
    signIn('another-agent');expect((await quotes(req(quoteBody(c.id)))).status).toBe(404);
    signIn(agent,'viewer');expect((await quotes(req(quoteBody(c.id)))).status).toBe(403);
    expect((await state.db.query('SELECT * FROM enrollment_consent_events')).rows).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('validates county, coverage year, explicit applicant flags, and the official wire payload',async()=>{
    const c=await seed();await grant(c.id);
    expect((await quotes(req({...quoteBody(c.id),effectiveDate:'2026-01-01'}))).status).toBe(422);
    expect((await quotes(req({...quoteBody(c.id),applicants:[{memberId:'x',age:30,relationship:'primary'}]}))).status).toBe(422);
    expect((await quotes(req({...quoteBody(c.id),countyFips:'99999'}))).status).toBe(503);
    const r=await quotes(req(quoteBody(c.id)));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');
    const [url,options]=fetchMock.mock.calls.find(([url])=>url.endsWith('/v1/quotes'))!;
    expect(url).toBe('https://staging-api.one.healthsherpa.com/v1/quotes');
    expect(options.headers).toMatchObject({'x-api-key':'fictional-test-key'});expect(options.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(options.body)).toMatchObject({context:{plan_year:2027,exchange:'on_exchange'},location:{zip_code:'20001',fips_code:'11001',state:'DC'},household:{annual_income:42000,household_size:2,applicants:[{member_id:'applicant-1',relationship:'primary',uses_tobacco:false}]}});
    expect(options.redirect).toBe('error');expect(options.cache).toBe('no-store');
    expect(JSON.stringify((await state.db.query('SELECT * FROM audit_events')).rows)).not.toContain('fictional@example.test');
  });
  it('requires admin-reviewed unique links; never merges two existing lead records',async()=>{
    const a=await seed(),b=await seed(),hub=randomUUID();
    expect((await cases(req({action:'link',caseId:a.id,hubClientId:hub,hubOfficeId:randomUUID(),reviewConfirmed:true}))).status).toBe(403);
    expect((await link(a.id,hub)).status).toBe(200);expect((await link(b.id,hub)).status).toBe(409);
    expect((await state.db.query('SELECT * FROM leads')).rows).toHaveLength(2);
    expect((await link(a.id)).status).toBe(409);
  });
  it('requires a reconciled case and exact linked agent, then resumes the same handoff',async()=>{
    const c=await seed();await grant(c.id);
    expect((await sessions(req({caseId:c.id,countyFips:'11001'}))).status).toBe(409);
    await link(c.id);signIn('fictional-admin','admin');
    expect((await sessions(req({caseId:c.id,countyFips:'11001'}))).status).toBe(403);signIn();
    const body={caseId:c.id,countyFips:'11001'};
    const response=await sessions(req(body));expect(response.status).toBe(200);
    const r2=await sessions(req(body));expect(r2.status).toBe(200);expect(await r2.json()).toEqual(await response.json());
    const calls=fetchMock.mock.calls.filter(([url])=>url.endsWith('/enrollment-sessions'));expect(calls).toHaveLength(1);
    const options=calls[0][1];expect(options.headers['Idempotency-Key']).toMatch(/^[a-f0-9-]+$/);
    expect(JSON.parse(options.body)).toEqual({external_id:c.id,context:{product:'aca',exchange:'on_exchange',coverage_family:'medical',coverage_type:'medical',plan_year:2027,flow:'agent_assisted',locale:'en-US'},location:{zip_code:'20001',fips_code:'11001',state:'DC'}});
    expect((await state.db.query<{stage:string}>('SELECT stage FROM leads')).rows[0].stage).toBe('intake');
    await grant(c.id,'revoked');expect((await sessions(req(body))).status).toBe(409);
  });
  it('persists uncertain operations and blocks automatic retries after timeout',async()=>{
    const c=await seed();await grant(c.id);await link(c.id);
    fetchMock.mockImplementation(async(url:string)=>{
      if(url.includes('/counties')) return Response.json({counties:[{fips_code:'11001',name:'Fictional County',state:'DC'}]});
      throw new Error('fictional network failure');
    });
    const body={caseId:c.id,countyFips:'11001'};
    expect((await sessions(req(body))).status).toBe(503);
    expect((await state.db.query<{status:string}>('SELECT status FROM healthsherpa_handoffs')).rows[0].status).toBe('review_required');
    const count=fetchMock.mock.calls.length;expect((await sessions(req(body))).status).toBe(409);expect(fetchMock).toHaveBeenCalledTimes(count);
  });
  it('withholds quote results if consent is revoked while the provider is working',async()=>{
    const c=await seed();await grant(c.id);
    const original=fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/v1/quotes')) {await grant(c.id,'revoked');return Response.json({plans:[],meta:{result_count:0}})}
      return original(url,options);
    });
    expect((await quotes(req(quoteBody(c.id)))).status).toBe(409);
  });
  it('holds for review after remote success if the local audit cannot be saved',async()=>{
    const c=await seed();await grant(c.id);await link(c.id);state.failAction='handoff.ready';
    expect((await sessions(req({caseId:c.id,countyFips:'11001'}))).status).toBe(503);
    const rows=(await state.db.query<{status:string;shopping_url:string|null}>('SELECT status,shopping_url FROM healthsherpa_handoffs')).rows;
    expect(rows[0]).toMatchObject({status:'review_required',shopping_url:null});
    expect((await sessions(req({caseId:c.id,countyFips:'11001'}))).status).toBe(409);
    expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/enrollment-sessions'))).toHaveLength(1);
  });
  it('fails closed for disabled features, foreign origins, no auth, and arbitrary API origins',async()=>{
    const c=await seed();await grant(c.id);
    expect((await quotes(req(quoteBody(c.id),'https://foreign.example'))).status).toBe(403);
    vi.stubEnv('HEALTHSHERPA_WORKFLOW_ENABLED','false');expect((await cases(req({action:'initialize',leadId:c.lead_id}))).status).toBe(503);
    state.principal=null;expect((await counties(new Request(`http://localhost/api/healthsherpa/counties?caseId=${c.id}`))).status).toBe(401);
    signIn();vi.stubEnv('HEALTHSHERPA_WORKFLOW_ENABLED','true');vi.stubEnv('HEALTHSHERPA_API_BASE_URL','https://evil.example');
    expect((await quotes(req(quoteBody(c.id)))).status).toBe(503);expect(fetchMock).not.toHaveBeenCalled();
  });
  it('accepts only HTTPS links on HealthSherpa domains',()=>{
    for(const url of ['http://healthsherpa.com/a','https://healthsherpa.com.evil.example/a','https://evilhealthsherpa.com/a','https://user@healthsherpa.com/a','javascript:alert(1)']) expect(()=>safeShoppingUrl(url)).toThrow();
    expect(safeShoppingUrl('https://www.healthsherpa.com/a')).toBe('https://www.healthsherpa.com/a');
  });
});
