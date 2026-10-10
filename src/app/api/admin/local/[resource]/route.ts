import { handleLocalAdminRequest } from "@/lib/local-admin-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  return handleLocalAdminRequest(request, resource);
}

export const POST = handle;
export const PATCH = handle;
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
