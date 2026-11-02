// Normalize only routing hints. This must run BEFORE Next's adapter, which hides
// and restores Flight headers around middleware. Never changes auth/identity.
export function normalizeDocumentPrefetchHeaders(incoming) {
  const headers={...incoming};
  if(headers.rsc!=='1') {
    delete headers['next-router-prefetch'];
    delete headers['next-router-segment-prefetch'];
  }
  return headers;
}
