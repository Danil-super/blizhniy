/** Server SQL projection only: dates/payment/status are never written by a read.
 * Match the public reader's statement clock and exclusive end of placement. */
export function effectivePublicationStatusSql(alias:''|'w'|'s'=''):string{
 if(!['','w','s'].includes(alias))throw new Error('Invalid publication SQL alias');
 const prefix=alias?alias+'.':'';
 return `case when ${prefix}status='published' and ${prefix}expires_at<=statement_timestamp()
  then 'expired' else ${prefix}status end`;
}
