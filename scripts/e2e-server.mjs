// Ephemeral, fictional-only test environment. Never reads a deployment database.
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const db=new PGlite();
await db.exec(readFileSync('database/001_initial.sql','utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
await db.exec(readFileSync('database/002_intake.sql','utf8'));
await db.exec(readFileSync('database/003_enrollment_workflow.sql','utf8'));
await db.exec(readFileSync('database/004_policy_readback.sql','utf8'));
const server=createServer(db);
await new Promise(resolve=>server.listen(55439,'127.0.0.1',resolve));
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--port','3107','--hostname','127.0.0.1'],{stdio:'inherit',env:{...process.env,NODE_ENV:'development',DEMO_AUTH:'false',DATABASE_URL:'postgres://postgres@127.0.0.1:55439/postgres',HEALTHSHERPA_API_KEY:'',HEALTHSHERPA_API_BASE_URL:'',HEALTHSHERPA_BASE_URL:'',HEALTHSHERPA_WORKFLOW_ENABLED:'true',HEALTHSHERPA_POLICY_STATUS_ENABLED:'false',HUB_ENROLLMENT_READ_ENABLED:'false',HEALTHSHERPA_ENROLLMENT_SESSIONS_ENABLED:'false',HEALTHSHERPA_AGENT_EXTERNAL_ID:''}});
function close(){app.kill();server.close();void db.close()}
process.on('SIGTERM',close);process.on('SIGINT',close);
app.on('exit',()=>process.exit());
