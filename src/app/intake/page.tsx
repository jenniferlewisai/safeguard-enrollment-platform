import { randomUUID } from 'node:crypto';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { IntakeForm } from '@/components/intake-form';
import { canWrite, getCurrentUser } from '@/lib/auth';
import { getIntake } from '@/lib/leads';
export const dynamic='force-dynamic';
export default async function IntakePage({searchParams}:{searchParams:Promise<{id?:string}>}) {
  const user=await getCurrentUser();
  if(!user) redirect('/login');
  if(!canWrite(user)) return <AppShell active="ACA Intake"><h1>ACA household intake</h1><p>Only agents and administrators can save intake information.</p></AppShell>;
  const {id}=await searchParams;
  if(id&&!z.uuid().safeParse(id).success) notFound();
  let saved;
  try {saved=id?await getIntake(user,id):undefined} catch {return <AppShell active="ACA Intake"><p role="alert">Intake storage is unavailable. Please retry later.</p></AppShell>}
  if(id&&!saved) notFound();
  return <AppShell active="ACA Intake"><div className="page-title"><p className="eyebrow">Application intake</p><h1>ACA household intake</h1><p className="muted">Save a partial draft or complete the intake for quote preparation.</p></div><IntakeForm id={id??randomUUID()} saved={saved}/></AppShell>;
}
