import {notFound} from 'next/navigation';
import {AdminWorkspaceShell} from '@/components/admin/AdminShell';
import {PublicationRestrictionWorkspace} from '@/components/admin/PublicationRestrictionWorkspace';
import {readPublicationRestrictionEnabled} from '@/lib/publication-restriction-config';

export const dynamic='force-dynamic';

export default function Page(){
 if(!readPublicationRestrictionEnabled())notFound();
 return <AdminWorkspaceShell activeHref="/admin/publication-restrictions" title="Жалобы на публикации"
  description="Сверьте карточку с обращением перед ограничением её публичного показа." recheckModerator showPublicationComplaints>
  <PublicationRestrictionWorkspace/>
 </AdminWorkspaceShell>;
}
