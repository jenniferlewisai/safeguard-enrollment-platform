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
