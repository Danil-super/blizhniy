import { createCspReportHandler } from '@/lib/csp-report';
import { getPublicSiteUrl } from '@/lib/site-url';
export const runtime='nodejs';
export const dynamic='force-dynamic';
let handle:ReturnType<typeof createCspReportHandler>|undefined;
export async function POST(request:Request){
  handle??=createCspReportHandler({origin:getPublicSiteUrl()});
  return handle(request);
}
