'use client';
import { useState } from 'react';
import { safeShoppingUrl } from '@/lib/enrollment-link';

type County={fips_code:string;name:string;state:string};
type Applicant={memberId:string;age:string;relationship:'primary'|'spouse'|'dependent';usesTobacco:string};
type Case={id:string;coverage_year:number;hub_client_id:string|null;consent_status:string|null};
type Plan={plan_id?:string;name?:string;pricing?:{net_premium?:number}};
async function api(path:string,body?:unknown) {
  const res=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const result=await res.json();
  if(!res.ok) throw new Error(result.error??'Unable to complete request');
  return result;
}
export function EnrollmentWorkspace({leadId,admin}:{leadId:string;admin:boolean}) {
  const [record,setRecord]=useState<Case|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [evidence,setEvidence]=useState(''),[counties,setCounties]=useState<County[]>([]),[fips,setFips]=useState('');
  const [effective,setEffective]=useState(''),[plans,setPlans]=useState<Plan[]>([]),[shoppingUrl,setShoppingUrl]=useState('');
  const [hubClient,setHubClient]=useState(''),[hubOffice,setHubOffice]=useState(''),[legacy,setLegacy]=useState(''),[reviewed,setReviewed]=useState(false);
  const [applicants,setApplicants]=useState<Applicant[]>([{memberId:'applicant-1',age:'',relationship:'primary',usesTobacco:''}]);
  async function run(work:()=>Promise<void>) {
    if(busy)return;setBusy(true);setMessage('');
    try {await work()} catch(error) {setMessage((error as Error).message)} finally {setBusy(false)}
  }
  function update(index:number,field:keyof Applicant,value:string) {
    setPlans([]);setApplicants(rows=>rows.map((a,i)=>i===index?{...a,[field]:value}:a));
  }
  return <section className="panel" style={{padding:24,marginTop:24}} aria-label="HealthSherpa enrollment workspace">
    <h2>Continue with HealthSherpa</h2>
    <p>Use one linked case for this household and coverage year. HealthSherpa handles the agent’s application review and final submission.</p>
    {!record?<button className="button primary" type="button" disabled={busy} onClick={()=>run(async()=>{
      const result=await api('/api/enrollment-cases',{action:'initialize',leadId});setRecord(result.data);
    })}>Open or resume enrollment case</button>:<>
      <p>Coverage year: <strong>{record.coverage_year}</strong> · Hub client: {record.hub_client_id?'Linked':'Awaiting administrator reconciliation'} · Assistance consent: {record.consent_status??'Not recorded'}</p>
      <fieldset disabled={busy} style={{border:0,padding:0}}>
        <legend>Marketplace assistance consent</legend>
        <p>The intake checkbox alone does not establish documented assistance consent. Reference the signed form or recorded evidence. Do not enter document contents here.</p>
        <label>Consent evidence reference<input className="search" value={evidence} onChange={e=>setEvidence(e.target.value)} maxLength={300}/></label>
        <div className="form-actions">
          {(['granted','revoked'] as const).map(status=><button className="button secondary" type="button" key={status} disabled={evidence.trim().length<3} onClick={()=>run(async()=>{
            await api('/api/enrollment-cases',{action:'consent',caseId:record.id,status,evidenceReference:evidence});
            setRecord({...record,consent_status:status});setPlans([]);setShoppingUrl('');setCounties([]);setFips('');setMessage(status==='granted'?'Assistance consent recorded.':'Consent revoked. Further API work is blocked.');
          })}>{status==='granted'?'Record granted consent':'Record revocation'}</button>)}
        </div>
      </fieldset>
      {admin&&!record.hub_client_id&&<fieldset disabled={busy} style={{marginTop:20}}>
        <legend>Administrator reconciliation</legend>
        <p>Verify these IDs against the existing Hub and Base44 records before linking. This does not import or merge records.</p>
        <label>Hub client ID<input value={hubClient} onChange={e=>setHubClient(e.target.value)}/></label>
        <label>Hub office ID<input value={hubOffice} onChange={e=>setHubOffice(e.target.value)}/></label>
        <label>Existing Base44 enrollment ID (optional)<input value={legacy} onChange={e=>setLegacy(e.target.value)}/></label>
        <label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I verified the household, office, year, and any existing enrollment work.</label>
        <button className="button secondary" type="button" disabled={!reviewed||!hubClient||!hubOffice} onClick={()=>run(async()=>{
          await api('/api/enrollment-cases',{action:'link',caseId:record.id,hubClientId:hubClient,hubOfficeId:hubOffice,...(legacy?{base44EnrollmentId:legacy}:{}),reviewConfirmed:true});
          setRecord({...record,hub_client_id:hubClient});setMessage('Existing records linked.');
        })}>Link reviewed records</button>
      </fieldset>}
      <fieldset disabled={busy||record.consent_status!=='granted'} style={{marginTop:20}}>
        <legend>Quote preparation</legend>
        <button className="button secondary" type="button" onClick={()=>run(async()=>{
          setPlans([]);setShoppingUrl('');setFips('');setCounties([]);
          setCounties((await api(`/api/healthsherpa/counties?caseId=${record.id}`)).data);
        })}>Look up counties for saved ZIP</button>
        <label>County<select value={fips} onChange={e=>{setFips(e.target.value);setPlans([]);setShoppingUrl('')}}><option value="">Choose county</option>{counties.map(c=><option value={c.fips_code} key={c.fips_code}>{c.name}, {c.state}</option>)}</select></label>
        <label>Requested effective date<input type="date" value={effective} onChange={e=>{setEffective(e.target.value);setPlans([])}}/></label>
        <p>Add everyone applying for coverage. Ages must be correct for the requested effective date. Household size and income come from the saved intake.</p>
        {applicants.map((a,i)=><div className="form-grid" key={a.memberId}>
          <div className="field"><label htmlFor={`age-${i}`}>Applicant {i+1} age</label><input id={`age-${i}`} type="number" min="0" max="120" value={a.age} onChange={e=>update(i,'age',e.target.value)}/></div>
          <div className="field"><label htmlFor={`relationship-${i}`}>Relationship</label><select id={`relationship-${i}`} value={a.relationship} onChange={e=>update(i,'relationship',e.target.value)}><option value="primary">Primary</option><option value="spouse">Spouse</option><option value="dependent">Dependent</option></select></div>
          <div className="field"><label htmlFor={`tobacco-${i}`}>Tobacco use</label><select id={`tobacco-${i}`} value={a.usesTobacco} onChange={e=>update(i,'usesTobacco',e.target.value)}><option value="">Choose answer</option><option value="false">No</option><option value="true">Yes</option></select></div>
          {i>0&&<button className="button secondary" type="button" onClick={()=>{setApplicants(rows=>rows.filter((_,n)=>n!==i));setPlans([])}}>Remove applicant {i+1}</button>}
        </div>)}
        <div className="form-actions">
          <button className="button secondary" type="button" disabled={applicants.length>=20} onClick={()=>setApplicants(rows=>[...rows,{memberId:crypto.randomUUID(),age:'',relationship:'dependent',usesTobacco:''}])}>Add applicant</button>
          <button className="button primary" type="button" disabled={!fips||!effective||applicants.some(a=>a.age===''||a.usesTobacco==='')} onClick={()=>run(async()=>{
            setPlans([]);
            const result=await api('/api/healthsherpa/quotes',{caseId:record.id,countyFips:fips,effectiveDate:effective,applicants:applicants.map(a=>({...a,age:Number(a.age),usesTobacco:a.usesTobacco==='true'}))});
            setPlans(result.data.plans);setMessage(`${result.data.plans.length} quote results received. Quotes do not confirm enrollment.`);
          })}>Request quotes</button>
        </div>
        {plans.length>0&&<table><thead><tr><th>Plan</th><th>Monthly net premium</th></tr></thead><tbody>{plans.map((p,i)=><tr key={`${p.plan_id}-${i}`}><td>{p.name??p.plan_id??'Plan'}</td><td>{typeof p.pricing?.net_premium==='number'?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(p.pricing.net_premium):'See HealthSherpa'}</td></tr>)}</tbody></table>}
        <h3>Agent enrollment handoff</h3>
        <p>Opens HealthSherpa for household entry, eligibility review, plan selection, and submission. Creating a link does not submit an application. Resume existing work if an application is already in progress.</p>
        <button className="button primary" type="button" disabled={!fips||!record.hub_client_id} onClick={()=>run(async()=>{
          setShoppingUrl('');const result=await api('/api/healthsherpa/sessions',{caseId:record.id,countyFips:fips});
          setShoppingUrl(safeShoppingUrl(result.data.shoppingUrl));
        })}>Create or resume HealthSherpa handoff</button>
        {shoppingUrl&&<p><a href={shoppingUrl} target="_blank" rel="noreferrer noopener">Continue securely in HealthSherpa</a></p>}
      </fieldset>
    </>}
    {(busy||message)&&<p role="status" aria-live="polite">{busy?'Working…':message}</p>}
  </section>;
}
