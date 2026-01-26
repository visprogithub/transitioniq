import { NextRequest, NextResponse } from "next/server";
import { getPatient } from "@/lib/data/demo-patients";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const patient = getPatient(id);

  if (!patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  return NextResponse.json(patient);
}
