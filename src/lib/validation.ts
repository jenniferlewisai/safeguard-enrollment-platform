import { z } from "zod";
export const leadSchema=z.object({firstName:z.string().trim().min(1).max(80),lastName:z.string().trim().min(1).max(80),email:z.email().optional().or(z.literal("")),phone:z.string().trim().min(7).max(30),source:z.string().trim().min(1).max(80),notes:z.string().trim().max(2000).optional()});
