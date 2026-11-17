import {startLocalUserAccessOperator} from './local-user-access-operator.mjs';
import {parseAdminOperatorEnvelope,parseAdminOperatorResult,adminOperatorErrorStatus} from '../src/lib/admin-operator-contract.ts';
export function startLocalAdminOperator(runtime){return startLocalUserAccessOperator(runtime,{parseEnvelope:parseAdminOperatorEnvelope,parseResult:parseAdminOperatorResult,errorStatus:adminOperatorErrorStatus});}
