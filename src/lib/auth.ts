import { headers } from 'next/headers';
import { z } from 'zod';
export type AppRole='admin'|'agent'|'viewer';
export type CurrentUser={id:string;name:string;email:string;roles:AppRole[]};
const principalSchema=z.object({
  userId:z.string().optional(),userDetails:z.string().optional(),
  name_typ:z.string().optional(),role_typ:z.string().optional(),
  claims:z.array(z.object({typ:z.string(),val:z.string()})).default([]),
});
export async function getCurrentUser():Promise<CurrentUser|null> {
  const store=await headers();
  const encoded=store.get('x-ms-client-principal');
  if(!encoded) {
    if(process.env.NODE_ENV!=='production'&&process.env.DEMO_AUTH==='true') return {id:'demo',name:'Demo Agent',email:'demo@safeguard.local',roles:['admin']};
    return null;
  }
  try {
    const principal=principalSchema.parse(JSON.parse(Buffer.from(encoded,'base64').toString('utf8')));
    const claim=(...types:string[])=>principal.claims.find(c=>types.includes(c.typ))?.val;
    // App Service supplies the ID in a separate trusted header. Also support
    // mapped Entra OID claims and the existing Static Web Apps-style principal.
    const id=store.get('x-ms-client-principal-id')??claim('http://schemas.microsoft.com/identity/claims/objectidentifier','oid')??principal.userId;
    if(!id?.trim()) return null;
    const roles=principal.claims.filter(c=>c.typ===principal.role_typ||c.typ.endsWith('/role')||c.typ==='roles').map(c=>c.val).filter((r):r is AppRole=>['admin','agent','viewer'].includes(r));
    const email=store.get('x-ms-client-principal-name')??principal.userDetails??claim('preferred_username','http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress')??'';
    return {id,name:claim(principal.name_typ??'name','name')??(email||'Safeguard user'),email,roles:roles.length?roles:['viewer']};
  } catch {return null}
}
export function canWrite(user:CurrentUser) {return user.roles.includes('admin')||user.roles.includes('agent')}
