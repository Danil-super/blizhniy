import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isAdminRequest } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ state: "signed-out" }, { status: 401 });
  }

  return NextResponse.json({ state: (await isAdminRequest(request)) ? "admin" : "signed-in" });
}
