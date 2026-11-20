export function GET() {
  return new Response(null, { status: 307, headers: { Location: "/obyavleniya?kind=kuplyu" } });
}

export { GET as POST, GET as PUT, GET as PATCH, GET as DELETE };
