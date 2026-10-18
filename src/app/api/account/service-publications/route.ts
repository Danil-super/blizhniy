import {handleProductionServicePublicationRequest} from '@/lib/production-service-publication-runtime';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const POST=handleProductionServicePublicationRequest;
export const PUT=handleProductionServicePublicationRequest;
