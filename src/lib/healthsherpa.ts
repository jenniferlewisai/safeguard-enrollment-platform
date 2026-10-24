import { policyObservationSchema } from './policy-status';
import { safeShoppingUrl } from './enrollment-link';
export { safeShoppingUrl } from './enrollment-link';
import { z } from 'zod';

// Contract: https://one.healthsherpa.com/openapi.json (reviewed 2026-10-24).
// On-exchange ACA only; direct off-exchange submission is a separate product.
export class HealthSherpaError extends Error {
  constructor(public readonly status:number) {super('HealthSherpa service unavailable')}
}
function configuration() {
  const base=process.env.HEALTHSHERPA_API_BASE_URL || process.env.HEALTHSHERPA_BASE_URL;
  if (!base || !['https://api.one.healthsherpa.com','https://staging-api.one.healthsherpa.com'].includes(base.replace(/\/+$/,''))) {
    throw new Error('Configure an approved HealthSherpa ONE origin');
  }
  const key=process.env.HEALTHSHERPA_API_KEY;
  if (!key || key==='use-an-azure-key-vault-reference') throw new Error('HealthSherpa key is not configured');
  return {base:base.replace(/\/+$/,''),key};
}
export function healthSherpaConfigured() {
  try {configuration();return true} catch {return false}
}
async function call(path:string,body?:unknown,idempotencyKey?:string):Promise<unknown> {
  const {base,key}=configuration();
  const headers:Record<string,string>={'x-api-key':key,accept:'application/json'};
  if(body!==undefined) headers['content-type']='application/json';
  if(idempotencyKey) headers['Idempotency-Key']=idempotencyKey;
  // No automatic retries or redirects: never forward keys to another host.
  const response=await fetch(`${base}${path}`,{
    method:body===undefined?'GET':'POST',headers,
    body:body===undefined?undefined:JSON.stringify(body),
    cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),
  });
  if(!response.ok) throw new HealthSherpaError(response.status);
  // Never expose or log upstream error bodies or consumer-bearing request URLs.
  return response.json();
}
const countySchema=z.object({counties:z.array(z.object({fips_code:z.string().regex(/^\d{5}$/),name:z.string(),state:z.string().regex(/^[A-Z]{2}$/)}))});
export async function healthSherpaCounties(zip:string) {
  return countySchema.parse(await call(`/v1/reference/counties?zip_code=${encodeURIComponent(zip)}`)).counties;
}
export async function selectedCounty(zip:string,fips:string) {
  const county=(await healthSherpaCounties(zip)).find(c=>c.fips_code===fips);
  if(!county) throw new Error('Choose a county returned for this ZIP');
  return county;
}
export async function requestHealthSherpaQuote(payload:unknown) {
  return z.object({plans:z.array(z.object({plan_id:z.string(),name:z.string(),pricing:z.object({net_premium:z.number().optional()}).optional()})),meta:z.record(z.string(),z.unknown())}).parse(await call('/v1/quotes',payload));
}
export async function requestHealthSherpaSession(payload:unknown,key:string,caseId:string) {
  const response=z.object({external_id:z.string(),links:z.object({shopping_url:z.string()})}).parse(await call('/v1/enrollment-sessions',payload,key));
  if(response.external_id!==caseId) throw new Error('Enrollment correlation mismatch');
  return safeShoppingUrl(response.links.shopping_url);
}

// Provider list supports no external_id filter. Scan bounded metadata pages server-side;
// return only one exact case/year match. Never expose the linked agent's book to the caller.
export async function readHealthSherpaPolicies(caseId:string,year:number) {
  const listSchema=z.object({applications:z.array(z.object({
    confirmation_id:z.string().min(1).max(200).optional(),external_id:z.string().nullable().optional(),plan_year:z.number().int().optional(),
  })),pagination:z.object({limit:z.number().int(),offset:z.number().int()})});
  const matches:string[]=[];
  let complete=false;
  for(let page=0;page<10;page++) {
    const offset=page*100;
    const result=listSchema.parse(await call(`/v1/policy-status/applications?exchange=on_exchange&plan_year=${year}&limit=100&offset=${offset}`));
    if(result.pagination.offset!==offset||result.pagination.limit!==100||result.applications.length>100) throw new Error('Invalid provider pagination');
    for(const application of result.applications) {
      if(application.external_id===caseId && application.plan_year===year) {
        if(!application.confirmation_id) throw new Error('Missing provider correlation');
        matches.push(application.confirmation_id);
      }
    }
    if(matches.length>1) throw new Error('Multiple provider applications require reconciliation');
    if(result.applications.length<100) {complete=true;break}
  }
  if(!complete||matches.length!==1) throw new Error('Provider application cannot be correlated safely');
  const result=z.object({policy_statuses:z.array(policyObservationSchema).max(100)}).parse(
    await call(`/v1/policy-status/applications/${encodeURIComponent(matches[0])}?exchange=on_exchange&plan_year=${year}`));
  return result.policy_statuses;
}
