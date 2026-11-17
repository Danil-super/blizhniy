import {handleAdminUserAccessRequest} from '@/lib/admin-user-access-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handleAdminUserAccessRequest;
export const GET=handleAdminUserAccessRequest;
export const PUT=handleAdminUserAccessRequest;
export const PATCH=handleAdminUserAccessRequest;
export const DELETE=handleAdminUserAccessRequest;
