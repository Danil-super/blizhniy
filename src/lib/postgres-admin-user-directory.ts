import {withAppSessionTransaction} from './app-session-transaction';
import {AdminAccessError} from './admin-authorization';
import {parseAdminUserQuery,parseAdminUserPage,type AdminUserQuery,type AdminDirectoryUser} from './admin-user-directory-contract.ts';
import type {PostgresDatabase} from './postgres';

export class PostgresAdminUserDirectory {
  constructor(private readonly db:Pick<PostgresDatabase,'transaction'>) {}
  async list(token:string,input:AdminUserQuery) {
    const query=parseAdminUserQuery(input);
    return withAppSessionTransaction(this.db,token,async(tx,actor)=>{
      if(actor.id!==query.expectedAdminId)throw new AdminAccessError();
      // Select named contact fields only; never return the profile JSON or credential columns.
      const {rows}=await tx.query<AdminDirectoryUser>(`select u.id,coalesce(p.profile->>'name','') as name,u.email,
        coalesce(p.profile->>'phone','') as phone,u.role,u.is_blocked as "isBlocked",
        u.email_verified_at is not null as "emailVerified",
        to_char(u.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
        from app.users u left join app.cabinet_profiles p on p.user_id=u.id
        where ($1='' or strpos(lower(u.email),lower($1))>0 or strpos(lower(u.id::text),lower($1))>0
          or strpos(lower(coalesce(p.profile->>'name','')),lower($1))>0
          or strpos(lower(coalesce(p.profile->>'phone','')),lower($1))>0)
        and ($2='all' or u.role=$2)
        and ($3='all' or $3='blocked' and u.is_blocked or $3='active' and not u.is_blocked and u.email_verified_at is not null
          or $3='pending' and not u.is_blocked and u.email_verified_at is null)
        and ($4::timestamptz is null or (u.created_at,u.id)<($4::timestamptz,$5::uuid))
        order by u.created_at desc,u.id desc limit 26`,
        [query.query,query.role,query.status,query.cursor?.updatedAt??null,query.cursor?.id??null]);
      const items=rows.slice(0,25),last=items.at(-1);
      return parseAdminUserPage({items,nextCursor:rows.length>25&&last?{id:last.id,updatedAt:last.createdAt}:null});
    },{requireAdmin:true,denied:()=>new AdminAccessError()});
  }
}
