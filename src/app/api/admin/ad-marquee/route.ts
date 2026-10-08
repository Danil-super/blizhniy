import { NextResponse } from "next/server";
import { AdMarqueeTransitionConflictError, listAdMarqueePlacementsForAdmin, updateAdMarqueePlacementForAdmin } from "@/lib/ad-marquee-store";
import { isAdminRequest, isDemoAdminBypassEnabled, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isUuid } from "@/lib/supabase-rest";

type UpdateAdMarqueeBody = {
  adminComment?: string;
  id?: string;
  sortOrder?: number;
  status?: "pending_payment" | "rejected" | "archived";
};

export const dynamic = "force-dynamic";

async function requireAdmin(request: Request) {
  if (isDemoAdminBypassEnabled()) {
    return null;
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Auth is not configured" }, { status: 503 });
  }

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  return null;
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request);

  if (denied) {
    return denied;
  }

  try {
    return NextResponse.json({ placements: await listAdMarqueePlacementsForAdmin() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load ad marquee placements" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin(request);

  if (denied) {
    return denied;
  }

  const body = (await request.json().catch(() => null)) as UpdateAdMarqueeBody | null;
  const status = body?.status;

  if (typeof body?.id !== "string" || !isUuid(body.id)
    || !status || !["pending_payment", "rejected", "archived"].includes(status)
    || (body.adminComment !== undefined && (typeof body.adminComment !== "string" || body.adminComment.length > 2000))
    || (body.sortOrder !== undefined && (!Number.isInteger(body.sortOrder) || body.sortOrder < -2147483648 || body.sortOrder > 2147483647))) {
    return NextResponse.json({ error: "Invalid ad marquee update payload" }, { status: 400 });
  }

  try {
    const placement = await updateAdMarqueePlacementForAdmin({
      adminComment: body.adminComment,
      id: body.id,
      sortOrder: body.sortOrder ?? 0,
      status,
    });

    if (!placement) {
      return NextResponse.json({ error: "Placement not found" }, { status: 404 });
    }

    return NextResponse.json({ placement, placements: await listAdMarqueePlacementsForAdmin() });
  } catch (error) {
    if (error instanceof AdMarqueeTransitionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update ad marquee placement" }, { status: 400 });
  }
}
