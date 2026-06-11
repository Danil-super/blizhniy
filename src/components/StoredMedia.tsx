"use client";

/* eslint-disable @next/next/no-img-element */

import { ImgHTMLAttributes, VideoHTMLAttributes, useEffect, useState } from "react";
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

  if (!resolvedSrc) {
    return null;
  }

  return <img src={resolvedSrc} alt={alt} {...props} />;
}

export function StoredMediaVideo({ src, ...props }: Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { src?: string }) {
  const resolvedSrc = useResolvedMediaSource(src);

  if (!resolvedSrc) {
    return null;
  }

  return <video src={resolvedSrc} {...props} />;
}
