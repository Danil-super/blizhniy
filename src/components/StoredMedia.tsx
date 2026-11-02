"use client";

/* eslint-disable @next/next/no-img-element */

import { ImgHTMLAttributes, VideoHTMLAttributes, useCallback, useEffect, useRef, useState } from "react";
import { createPublicPhotoRetry } from "@/lib/public-photo-retry";
import { resolveStoredMediaUrl } from "@/lib/client-media-store";

function useResolvedMediaSource(src?: string) {
  const [resolvedSrc, setResolvedSrc] = useState(src ?? "");

  useEffect(() => {
    let cancelled = false;

    if (!src) {
      setResolvedSrc("");
      return;
    }

    resolveStoredMediaUrl(src)
      .then((value) => {
        if (!cancelled) {
          setResolvedSrc(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolvedSrc;
}

export function StoredMediaImage({ alt = "", src, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src?: string }) {
  const resolvedSrc = useResolvedMediaSource(src);
  const [attempt,setAttempt]=useState(0);
  const image=useRef<HTMLImageElement|null>(null);
  const retry=useRef<{source:string;value:ReturnType<typeof createPublicPhotoRetry>}|null>(null);
  const currentRetry=useCallback(()=>{
    if(!retry.current||retry.current.source!==resolvedSrc){
      retry.current?.value.dispose();
      retry.current={source:resolvedSrc,value:createPublicPhotoRetry(resolvedSrc,()=>setAttempt(value=>value+1))};
    }
    return retry.current.value;
  },[resolvedSrc]);
  useEffect(()=>{
    const next=currentRetry();
    return()=>{next.dispose();if(retry.current?.value===next)retry.current=null;};
  },[currentRetry]);
  useEffect(()=>{
    // An SSR image may fail before React attaches its error listener. Inspect
    // that completed request after hydration instead of leaving a broken image.
    const node=image.current;
    if(node?.complete&&node.naturalWidth===0&&node.getAttribute('src')===resolvedSrc)currentRetry().failed();
  },[currentRetry,resolvedSrc,attempt]);

  if (!resolvedSrc) {
    return null;
  }

  return (
    <img
      {...props}
      ref={image}
      key={`${resolvedSrc}:${attempt}`}
      src={resolvedSrc}
      onError={event=>{if(!currentRetry().failed())props.onError?.(event);}}
      onLoad={event=>{currentRetry().loaded();props.onLoad?.(event);}}
      alt={alt}
      decoding={props.decoding ?? "async"}
      loading={props.loading ?? "lazy"}
    />
  );
}

export function StoredMediaVideo({ src, ...props }: Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { src?: string }) {
  const resolvedSrc = useResolvedMediaSource(src);

  if (!resolvedSrc) {
    return null;
  }

  return <video src={resolvedSrc} {...props} />;
}
