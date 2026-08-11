export const dynamic="force-dynamic";
export function GET(){return Response.json({status:"ok",service:"safeguard-enrollment-platform",timestamp:new Date().toISOString()},{headers:{"cache-control":"no-store"}})}
