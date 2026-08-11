import { Pool, PoolClient, QueryResultRow } from "pg";
let pool:Pool|undefined;
function getPool(){if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");pool??=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:true}:undefined,max:10});return pool}
export async function query<T extends QueryResultRow>(text:string,values:unknown[]=[]){return getPool().query<T>(text,values)}
export async function transaction<T>(work:(client:PoolClient)=>Promise<T>){const client=await getPool().connect();try{await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}}
