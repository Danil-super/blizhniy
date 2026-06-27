import { NextResponse } from "next/server";
import { getAuthenticatedRequestUser, isAdminRequest, isDemoAdminBypassEnabled } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isDemoAdminBypassEnabled()) {
    return NextResponse.json({ state: "admin" });
  }

  const auth = await getAuthenticatedRequestUser(request);

  if (!auth) {
    return NextResponse.json({ state: "signed-out" }, { status: 401 });
  }

  return NextResponse.json({ state: (await isAdminRequest(request)) ? "admin" : "signed-in" });
}
