import { NextRequest, NextResponse } from "next/server";

export function proxy(request:NextRequest){
  const appServicePrincipal=request.headers.get("x-ms-client-principal");
  const localDemo=process.env.NODE_ENV!=="production"&&process.env.DEMO_AUTH==="true";
  if(!appServicePrincipal&&!localDemo){const login=new URL("/login",request.url);login.searchParams.set("returnTo",request.nextUrl.pathname);return NextResponse.redirect(login)}
  return NextResponse.next();
}

export const config={matcher:["/((?!api|login|_next/static|_next/image|favicon.ico).*)"]};
