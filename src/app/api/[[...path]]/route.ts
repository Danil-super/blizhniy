const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function GET() {
  return Response.json({error: {code: 'NOT_FOUND'}}, {status: 404, headers});
}

export function HEAD() {
  return new Response(null, {status: 404, headers});
}

export {GET as POST, GET as PUT, GET as PATCH, GET as DELETE, GET as OPTIONS};
