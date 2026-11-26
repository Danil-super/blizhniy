import {startLocalUserAccessOperator} from './local-user-access-operator.mjs';
import {parseAdminOperatorEnvelope,parseAdminOperatorResult,adminOperatorErrorStatus} from '../src/lib/admin-operator-contract.ts';
export function startLocalAdminOperator(runtime,{activation}={}){return startLocalUserAccessOperator(runtime,{activation,parseEnvelope:parseAdminOperatorEnvelope,parseResult:parseAdminOperatorResult,errorStatus:adminOperatorErrorStatus});}
