import { NextResponse } from "next/server";
import { isAdminRequest, isDemoAdminBypassEnabled } from "@/lib/server-auth";
import { listAdminCategories, updateAdminCategory, updateAdminCategoryOrder } from "@/lib/category-store";

export const dynamic = "force-dynamic";

type CategoryPayload = {
  active?: boolean;
  id?: string;
  ids?: string[];
  name?: string;
  sortOrder?: number;
};

async function requireAdmin(request: Request) {
  return isDemoAdminBypassEnabled() || (await isAdminRequest(request));
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    return NextResponse.json({ categories: await listAdminCategories() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load categories" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as CategoryPayload | null;

  try {
    if (Array.isArray(payload?.ids)) {
      return NextResponse.json({ categories: await updateAdminCategoryOrder(payload.ids.map(String)) });
    }

    const id = String(payload?.id ?? "").trim();
    const sortOrder = typeof payload?.sortOrder === "number" && Number.isFinite(payload.sortOrder) ? payload.sortOrder : undefined;
    const category = await updateAdminCategory({
      active: typeof payload?.active === "boolean" ? payload.active : undefined,
      id,
      name: typeof payload?.name === "string" ? payload.name : undefined,
      sortOrder,
    });

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json({ category, categories: await listAdminCategories() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update category" }, { status: 500 });
  }
}
