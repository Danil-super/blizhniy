import {handleAdminTariffRequest} from '@/lib/admin-tariff-runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=handleAdminTariffRequest;
export const GET=handleAdminTariffRequest;
export const PUT=handleAdminTariffRequest;
export const PATCH=handleAdminTariffRequest;
export const DELETE=handleAdminTariffRequest;
