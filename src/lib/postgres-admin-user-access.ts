import {hashSessionToken} from './identity';
import {AdminUserAccessError,parseAdminUserAccessCommand,parseAdminUserAccessResult,type UserAccessErrorCode} from './admin-user-access-contract.ts';
import type {PostgresQueries} from './postgres';
/** EXECUTE-only private operator database. One atomic statement; never retry a lost response. */
export class PostgresAdminUserAccess{
  constructor(private readonly db:PostgresQueries){}
  async execute(token:string,value:unknown){
    const command=parseAdminUserAccessCommand(value),hash=hashSessionToken(token);
    if(!hash)throw new AdminUserAccessError('ADMIN_REQUIRED');
    try{
      const input=command.action==='change'?command.input:null;
      const {rows}=await this.db.query<{result:unknown}>('select app.admin_user_access($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
        [hash,command.expectedAdminId,command.action,input?.targetId??(command.action!=='change'?command.targetId:null),input?.id??(command.action==='recover'?command.id:null),input?.expectedVersion??null,input?.role??null,input?.isBlocked??null,input?.reason??null]);
      if(rows.length!==1)throw Error();return parseAdminUserAccessResult(command,rows[0].result);
    }catch(error){
      const codes:Record<string,UserAccessErrorCode>={PUA01:'ADMIN_REQUIRED',PUA02:'OPERATION_CONFLICT',PUA03:'STALE_ACCESS',PUA04:'LAST_ADMIN',PUA05:'SELF_CHANGE',PUA06:'USER_UNAVAILABLE',PUA07:'USER_NOT_READY','55P03':'ACCESS_BUSY'};
      const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
      throw new AdminUserAccessError(typeof code==='string'&&Object.hasOwn(codes,code)?codes[code]:'ACCESS_UNAVAILABLE');
    }
  }
}
