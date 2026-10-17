import { z } from "zod";
import { SLOTS, type Slot } from "@/lib/types";

export const PatientBody = z.object({
  name: z.string().trim().min(2, "Enter the person's name.").max(80),
  age: z.coerce.number().int().min(0).max(120, "Enter an age between 0 and 120."),
  sex: z.enum(["female", "male", "other"]).optional(),
  relation: z.string().trim().max(40).optional(),
  conditions: z.array(z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(80) })).max(30).default([]),
  habits: z
    .array(z.object({ foodId: z.string(), frequency: z.string().trim().min(1).max(80), slot: z.enum(SLOTS as [Slot, ...Slot[]]).optional() }))
    .max(20)
    .default([]),
});
