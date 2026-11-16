import type {MediaFileRecord} from './media-files';
import {encodeFileInspection,decodeFileInspection,FILE_INSPECT_REQUEST_BYTES} from './media-file-inspection-protocol.ts';
export const FILE_RETIRE_REQUEST_BYTES=FILE_INSPECT_REQUEST_BYTES;
export function encodeFileRetirement(record:MediaFileRecord,attemptId:string|null):Buffer{
 const frame=encodeFileInspection(record,attemptId===null?record.id:attemptId);
 frame.write('BFR1',0,'ascii');if(attemptId===null)frame.fill(0,40,76);return frame;
}
export function decodeFileRetirement(frame:Buffer):{record:MediaFileRecord;attemptId:string|null}{
 if(frame.length!==FILE_RETIRE_REQUEST_BYTES||!frame.subarray(0,4).equals(Buffer.from('BFR1')))throw Error('Invalid file retirement frame');
 const copy=Buffer.from(frame),absent=copy.subarray(40,76).every(value=>value===0);
 copy.write('BFI1',0,'ascii');if(absent)copy.copy(copy,40,4,40);
 const result=decodeFileInspection(copy);return{record:result.record,attemptId:absent?null:result.attemptId};
}
