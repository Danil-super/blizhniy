import { NextResponse } from "next/server";
import { recordStoredListingView } from "@/lib/listing-store";
import { getAuthenticatedRequestUser, isSupabaseServerConfigured } from "@/lib/server-auth";
import { isSupabaseServiceRoleConfigured, isUuid } from "@/lib/supabase-rest";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

const listingViewerCookieName = "blizhniy_listing_viewer";
const listingViewerCookieMaxAge = 60 * 60 * 24 * 365;

function createAnonymousViewerId() {
  return crypto.randomUUID();
}

export async function POST(request: Request, context: RouteContext) {
  const { listingId } = await context.params;

  if (!isUuid(listingId)) {
    return NextResponse.json({ error: "Unsupported listing id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  if (!isSupabaseServerConfigured() || !isSupabaseServiceRoleConfigured()) {
    return NextResponse.json({ error: "Listing views are not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const auth = await getAuthenticatedRequestUser(request);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${listingViewerCookieName}=`))
    ?.slice(listingViewerCookieName.length + 1);
  const anonymousViewerId = cookie || createAnonymousViewerId();
  const viewerKey = auth?.user.id ? `user:${auth.user.id}` : `anon:${anonymousViewerId}`;

  try {
    const views = await recordStoredListingView(listingId, viewerKey);

    if (views === undefined) {
      return NextResponse.json({ error: "Listing views are not configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    const response = NextResponse.json({ views }, { headers: { "Cache-Control": "no-store" } });

    if (!auth?.user.id && !cookie) {
      response.cookies.set(listingViewerCookieName, anonymousViewerId, {
        httpOnly: true,
        maxAge: listingViewerCookieMaxAge,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }

    return response;
  } catch (error) {
    console.error("Failed to record listing view", error);

    return NextResponse.json({ error: "Failed to record listing view" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
