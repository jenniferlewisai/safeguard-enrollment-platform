import { z } from 'zod';

const text = z.string().trim().max(200);
const fields = z.object({
  firstName: text.max(80), lastName: text.max(80),
  dob: z.string().refine(v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v && v <= new Date().toISOString().slice(0,10)), 'Enter a valid past date'),
  phone: text.max(30), email: z.email().or(z.literal('')),
  preferred: z.enum(['Phone','Text','Email']), address: text,
  county: text, zipCode: z.string().regex(/^(\d{5})?$/),
  householdSize: z.number().int().min(1).max(20).nullable(),
  income: z.number().min(0).max(9999999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.001).nullable(),
  coverageYear: z.number().int().min(2026).max(2100),
  consent: z.literal(true), notes: z.string().trim().max(2000),
}).strict();
export const intakeSchema = z.object({
  id: z.uuid(), version: z.number().int().nonnegative(),
  intent: z.enum(['draft','submit']), data: fields,
}).strict().superRefine((value,ctx) => {
  if(value.intent !== 'submit') return;
  for(const key of ['firstName','lastName','dob','phone','email','address','county','zipCode'] as const) {
    if(!value.data[key]) ctx.addIssue({code:'custom',path:['data',key],message:'Required for submission'});
  }
  if(value.data.phone.replace(/\D/g,'').length < 7) ctx.addIssue({code:'custom',path:['data','phone'],message:'Enter a valid phone number'});
  for(const key of ['householdSize','income'] as const) if(value.data[key] === null) ctx.addIssue({code:'custom',path:['data',key],message:'Required for submission'});
});
export type IntakeData = z.infer<typeof fields>;
export type SavedIntake = {lead_id:string; data:IntakeData; status:'draft'|'ready_for_quote'; version:number};
export const emptyIntake = (): IntakeData => ({firstName:'',lastName:'',dob:'',phone:'',email:'',preferred:'Phone',address:'',county:'',zipCode:'',householdSize:null,income:null,coverageYear:new Date().getFullYear(),consent:true,notes:''});
