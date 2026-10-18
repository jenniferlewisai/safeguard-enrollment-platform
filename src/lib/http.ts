export function sameOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(!origin) return true; // Non-browser clients still require authentication.
  const expected=new URL(request.url);
  // Next.js can reconstruct an internal URL behind App Service or next dev.
  // Host is the addressed application; never trust an arbitrary forwarded host.
  expected.host=request.headers.get('host')??expected.host;
  const protocol=request.headers.get('x-forwarded-proto');
  if(protocol==='https'||protocol==='http') expected.protocol=`${protocol}:`;
  return origin===expected.origin;
}
export function privateJson(body:unknown,status=200) {
  return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
}
