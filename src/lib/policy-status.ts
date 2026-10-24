import { z } from 'zod';
// Minimal provider observation. No confirmation IDs, policy IDs, balances or household data.
export const policyObservationSchema=z.object({
  status:z.string().max(100).nullable().optional(),
  payment_status:z.string().max(100).nullable().optional(),
  effective_date:z.iso.date().nullable().optional(),
  paid_through_date:z.iso.date().nullable().optional(),
  updated_at:z.iso.datetime({offset:true}).nullable().optional(),
});
export type PolicyObservation=z.infer<typeof policyObservationSchema>;
export type PolicySnapshot={policies:PolicyObservation[];checked_at:string};
