export function GET() {
  return new Response(null, { status: 307, headers: { Location: "/obyavleniya?kind=otdam-darom" } });
}

export { GET as POST, GET as PUT, GET as PATCH, GET as DELETE };
