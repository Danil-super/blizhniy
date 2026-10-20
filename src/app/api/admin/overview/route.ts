import {handleAdminOverviewRequest} from '@/lib/admin-overview-runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handleAdminOverviewRequest;
export const GET = handleAdminOverviewRequest;
export const PUT = handleAdminOverviewRequest;
export const PATCH = handleAdminOverviewRequest;
export const DELETE = handleAdminOverviewRequest;
