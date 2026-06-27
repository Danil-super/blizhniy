import { NextResponse } from "next/server";
import { isAdminRequest, isDemoAdminBypassEnabled } from "@/lib/server-auth";
import { listAdminUsers, updateAdminUser } from "@/lib/user-store";
import type { AdminUserRow } from "@/components/admin/AdminUsersClient";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(isDemoAdminBypassEnabled() || (await isAdminRequest(request)))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    return NextResponse.json({ users: await listAdminUsers() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load users" }, { status: 500 });
  }
}

type UpdateUserPayload = {
  id?: string;
  isBlocked?: boolean;
  role?: string;
};

const userRoles: AdminUserRow["role"][] = ["admin", "organization", "specialist", "user"];

function isUserRole(value: string): value is AdminUserRow["role"] {
  return userRoles.includes(value as AdminUserRow["role"]);
}

export async function PATCH(request: Request) {
  if (!(isDemoAdminBypassEnabled() || (await isAdminRequest(request)))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as UpdateUserPayload | null;
  const id = String(payload?.id ?? "").trim();
  const role = typeof payload?.role === "string" && isUserRole(payload.role) ? payload.role : undefined;
  const isBlocked = typeof payload?.isBlocked === "boolean" ? payload.isBlocked : undefined;

  if (!id || (role === undefined && isBlocked === undefined)) {
    return NextResponse.json({ error: "Invalid user update payload" }, { status: 400 });
  }

  try {
    const user = await updateAdminUser({ id, isBlocked, role });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update user" }, { status: 500 });
  }
}
