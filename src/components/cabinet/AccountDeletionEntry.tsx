'use client';
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {AccountDeletionRequestClient} from './AccountDeletionRequestClient';
import {PrimaryAccountDeletionClient} from './PrimaryAccountDeletionClient';
export function AccountDeletionEntry(){
 const auth=usePrimaryAccountAuth();
 return auth?<PrimaryAccountDeletionClient auth={auth}/>:<AccountDeletionRequestClient/>;
}
