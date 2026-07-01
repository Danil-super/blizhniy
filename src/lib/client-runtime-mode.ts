"use client";

export function shouldShowClientFallbackContent() {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_DEMO_CONTENT === "true";
}
