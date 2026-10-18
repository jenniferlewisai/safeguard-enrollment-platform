'use client';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { emptyIntake, type SavedIntake } from '@/lib/intake';

export function IntakeForm({id,saved}:{id:string;saved?:SavedIntake}) {
  const data=saved?.data??emptyIntake();
  const [version,setVersion]=useState(saved?.version??0);
  const [submitted,setSubmitted]=useState(saved?.status==='ready_for_quote');
  const [busy,setBusy]=useState(false);
  const saving=useRef(false);
  const [message,setMessage]=useState('');
  const [errors,setErrors]=useState<string[]>([]);
  const [conflict,setConflict]=useState(false);
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(saving.current||submitted) return;
    const form=event.currentTarget;
    const intent=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='draft'?'draft':'submit';
    const values=new FormData(form);
    if(values.get('consent')!=='on') {setErrors(['Applicant consent is required before saving any personal information.']);return}
    saving.current=true;setBusy(true);setErrors([]);setMessage('');setConflict(false);
    const number=(name:string)=>values.get(name)===''?null:Number(values.get(name));
    try {
      const response=await fetch('/api/intakes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,version,intent,data:{...Object.fromEntries(values),householdSize:number('householdSize'),income:number('income'),coverageYear:Number(values.get('coverageYear')),consent:true}})});
      const result=await response.json();
      if(!response.ok) {setConflict(response.status===409);setErrors(result.details??[result.error??'Unable to save. Please retry.']);return}
      setVersion(result.data.version);setSubmitted(result.data.status==='ready_for_quote');
      window.history.replaceState(null,'',`/intake?id=${id}`);
      setMessage(intent==='draft'?'Draft saved. You can resume it from Leads.':'Intake saved and ready for quote preparation. No quote or enrollment has been submitted.');
    } catch {setErrors(['Unable to reach intake storage. Your entries remain on this page. Please retry.'])}
    finally {saving.current=false;setBusy(false)}
  }
  return <form className="panel form-grid" onSubmit={save}>
    <fieldset className="intake-fields" disabled={busy||submitted}>
    <div className="form-section"><h2>Primary applicant</h2></div>
    {([['firstName','First name','text'],['lastName','Last name','text'],['dob','Date of birth','date'],['phone','Mobile phone','tel'],['email','Email address','email']] as const).map(([name,label,type])=><div className="field" key={name}><label htmlFor={name}>{label}</label><input id={name} name={name} type={type} defaultValue={data[name]} required maxLength={name==='phone'?30:80}/></div>)}
    <div className="field"><label htmlFor="preferred">Preferred contact</label><select id="preferred" name="preferred" defaultValue={data.preferred}><option>Phone</option><option>Text</option><option>Email</option></select></div>
    <div className="form-section"><h2>Coverage household</h2></div>
    {([['address','Home address'],['county','County'],['zipCode','ZIP code']] as const).map(([name,label])=><div className="field" key={name}><label htmlFor={name}>{label}</label><input id={name} name={name} defaultValue={data[name]} required maxLength={name==='zipCode'?5:200} pattern={name==='zipCode'?'[0-9]{5}':undefined}/></div>)}
    <div className="field"><label htmlFor="householdSize">Household size</label><input id="householdSize" name="householdSize" type="number" min="1" max="20" defaultValue={data.householdSize??''} required/></div>
    <div className="field"><label htmlFor="income">Estimated annual household income</label><input id="income" name="income" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={data.income??''} required/></div>
    <div className="field"><label htmlFor="coverageYear">Coverage year</label><input id="coverageYear" name="coverageYear" type="number" min="2026" max="2100" defaultValue={data.coverageYear} required/></div>
    <div className="form-section"><h2>Consent and eligibility</h2></div>
    <div className="field full"><div className="notice">Do not enter Social Security numbers or immigration document numbers here. Sensitive eligibility data remains in the authorized Marketplace enrollment flow. Consent is required for both draft saving and submission.</div></div>
    <div className="field full"><label><input name="consent" type="checkbox" defaultChecked={Boolean(saved)} required/> Applicant provided permission to collect information and assist with Marketplace coverage.</label></div>
    <div className="field full"><label htmlFor="notes">Agent notes</label><textarea id="notes" name="notes" maxLength={2000} defaultValue={data.notes} placeholder="Follow-up details; exclude sensitive document numbers"/></div>
    </fieldset>
    {errors.length>0?<div className="field full" role="alert"><ul>{errors.map(error=><li key={error}>{error}</li>)}</ul></div>:null}
    {conflict?<a className="field full" href={`/intake?id=${id}`}>Open the saved intake before making further changes</a>:null}
    <p className="field full" role="status">{message|| (submitted?'This intake is ready for quote preparation.':'Drafts may be incomplete. Submitted intakes are read-only.')}</p>
    <div className="form-actions"><Link className="button secondary" href="/leads">Back to leads</Link>{!submitted?<><button className="button secondary" type="submit" value="draft" formNoValidate disabled={busy}>Save draft</button><button className="button primary" type="submit" value="submit" disabled={busy}>{busy?'Saving…':'Save and prepare quote'}</button></>:null}</div>
  </form>;
}
