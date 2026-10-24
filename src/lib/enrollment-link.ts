// Shared validation without importing server-only configuration into the browser bundle.
export function safeShoppingUrl(value:unknown) {
  if(typeof value!=='string') throw new Error('Invalid enrollment link');
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.port ||
    !(url.hostname==='healthsherpa.com'||url.hostname.endsWith('.healthsherpa.com'))) throw new Error('Invalid enrollment link');
  return url.href;
}
