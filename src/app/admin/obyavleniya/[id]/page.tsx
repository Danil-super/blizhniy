import {notFound} from 'next/navigation';
import {AdminWorkspaceShell} from '@/components/admin/AdminShell';
import {PostgresListingManagement} from '@/components/admin/PostgresListingManagement';
import {parseListingDraftId} from '@/lib/listing-draft-contract';
import {readPostmoderationEnabled} from '@/lib/listing-workflow-config';

export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){
 if(!readPostmoderationEnabled())notFound();
 const {id:routeId}=await params;
 let id:string;
 try{id=parseListingDraftId(routeId);}catch{notFound();}
 return <AdminWorkspaceShell activeHref="/admin/obyavleniya" title="Карточка объявления" description="Все сохранённые поля и фотографии. При нарушении правил укажите причину блокировки для автора."><PostgresListingManagement listingId={id}/></AdminWorkspaceShell>;
}
