"use client";
import {useEffect,useRef,useState,type ReactNode} from 'react';

/** Size follows actual cards, not the browser height; cursor pages stay server-bounded. */
export function TwoRowCardViewport({label,gridClassName,children,hasMore=false,loading=false,error=false,onLoadMore,enabled=true,className=''}:{
 label:string;gridClassName:string;children:ReactNode;hasMore?:boolean;loading?:boolean;error?:boolean;onLoadMore?:()=>void;enabled?:boolean;className?:string;
}){
 const root=useRef<HTMLDivElement>(null),grid=useRef<HTMLUListElement>(null),end=useRef<HTMLDivElement>(null),[height,setHeight]=useState<number>();
 const load=useRef(onLoadMore);load.current=onLoadMore;
 const canLoad=enabled&&hasMore&&!loading&&!error;
 const allowed=useRef(canLoad);allowed.current=canLoad;
 useEffect(()=>{
  const container=root.current,list=grid.current;if(!container||!list)return;
  const measure=()=>{
   const first=list.firstElementChild;if(!first)return;
   const row=first.getBoundingClientRect().height,styles=getComputedStyle(container),gap=parseFloat(getComputedStyle(list).rowGap)||0;
   if(row>0)setHeight(Math.ceil(row*2+gap+(parseFloat(styles.paddingTop)||0)+(parseFloat(styles.paddingBottom)||0)+(parseFloat(styles.borderTopWidth)||0)+(parseFloat(styles.borderBottomWidth)||0)));
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(list);observer.observe(container);
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!canLoad||!root.current||!end.current)return;
  const observer=new IntersectionObserver(entries=>{if(allowed.current&&entries.some(entry=>entry.isIntersecting))load.current?.();},{root:root.current,threshold:0.1});
  observer.observe(end.current);return()=>observer.disconnect();
 },[canLoad,children]);
 return <div ref={root} role="region" aria-label={label} tabIndex={0} style={{maxHeight:height}}
  className={`max-h-[65vh] min-w-0 overflow-y-auto overscroll-contain rounded-xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${className}`}
  onScroll={event=>{const node=event.currentTarget;if(canLoad&&node.scrollHeight-node.scrollTop-node.clientHeight<48)load.current?.();}}>
  <ul ref={grid} className={gridClassName}>{children}</ul>
  {hasMore&&<div ref={end} aria-hidden="true" className="h-px"/>}
 </div>;
}
