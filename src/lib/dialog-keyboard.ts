import type {KeyboardEvent} from 'react';

export function openDialog(dialog:HTMLDialogElement,invoker?:HTMLElement|null){
 const previousFocus=invoker??dialog.ownerDocument.activeElement as HTMLElement|null;
 dialog.showModal();
 return()=>{
  dialog.close();
  // React can remove the dialog before passive cleanup, losing native focus restoration.
  if(previousFocus?.isConnected)previousFocus.focus();
 };
}

/** Native dialogs can put focus on the document at a Tab boundary in Chromium. */
export function containDialogTab(event:KeyboardEvent<HTMLElement>){
 if(event.key!=='Tab')return;
 const dialog=event.currentTarget;
 const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
  .filter(node=>!node.matches(':disabled')&&node.tabIndex>=0&&node.getClientRects().length>0);
 const first=controls[0],last=controls.at(-1),active=dialog.ownerDocument.activeElement;
 if(!first){event.preventDefault();dialog.focus();}
 else if(event.shiftKey&&(active===first||active===dialog)){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&(active===last||active===dialog)){event.preventDefault();first.focus();}
}
