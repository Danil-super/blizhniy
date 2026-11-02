'use client';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {AdminAccountDeletionRequestsClient} from './AdminAccountDeletionRequestsClient';
import {PrimaryAdminDeletionClient} from './PrimaryAdminDeletionClient';
export function AdminAccountDeletionEntry(){const auth=usePrimaryAccountAuth();return auth?<PrimaryAdminDeletionClient auth={auth}/>:<AdminAccountDeletionRequestsClient/>;}
