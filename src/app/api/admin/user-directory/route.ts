import {handleAdminUserDirectoryRequest} from '@/lib/admin-user-directory-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handleAdminUserDirectoryRequest;
export const GET=handleAdminUserDirectoryRequest;
export const PUT=handleAdminUserDirectoryRequest;
export const PATCH=handleAdminUserDirectoryRequest;
export const DELETE=handleAdminUserDirectoryRequest;
