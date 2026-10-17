import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { getRepository } from "@/lib/graph/repository";
import { PatientBody } from "./schema";

export async function GET() {
  await connection();
  const repo = await getRepository();
  return Response.json(await repo.listPatients());
}

export async function POST(req: NextRequest) {
  const body = PatientBody.safeParse(await req.json());
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Check the patient details." }, { status: 400 });
  const repo = await getRepository();
  const id = await repo.createPatient(body.data);
  return Response.json({ id });
}
