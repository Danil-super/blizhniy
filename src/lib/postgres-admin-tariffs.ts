import {hashSessionToken} from './identity';
import {AdminTariffError,parseAdminTariffCommand,parseAdminTariffResult,type TariffAdminErrorCode} from './admin-tariff-contract.ts';
import type {PostgresQueries} from './postgres';
export class PostgresAdminTariffs{
 constructor(private readonly db:PostgresQueries){}
 async execute(token:string,value:unknown){
  const command=parseAdminTariffCommand(value),hash=hashSessionToken(token);if(!hash)throw new AdminTariffError('ADMIN_REQUIRED');
  const input=command.action==='change'?command.input:null;
  try{
   const {rows}=await this.db.query<{result:unknown}>('select app_admin.tariff_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result',
    [hash,command.expectedAdminId,command.action,input?.tariffId??(command.action==='recover'?command.tariffId:null),input?.id??(command.action==='recover'?command.id:null),input?.expectedRevision??null,input?.name??null,input?.price??null,input?.durationDays??null,input?.active??null,input?.reason??null]);
   if(rows.length!==1)throw Error();return parseAdminTariffResult(command,rows[0].result);
  }catch(error){
   const errors:Record<string,TariffAdminErrorCode>={PTA01:'ADMIN_REQUIRED',PTA02:'OPERATION_CONFLICT',PTA03:'STALE_TARIFF',PTA04:'TARIFF_NOT_FOUND','55P03':'ACCESS_BUSY'};
   const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
   throw new AdminTariffError(typeof code==='string'&&Object.hasOwn(errors,code)?errors[code]:'TARIFF_UNAVAILABLE');
  }
 }
}
