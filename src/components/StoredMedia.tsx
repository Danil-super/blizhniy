"use client";

/* eslint-disable @next/next/no-img-element */

import { ImgHTMLAttributes, VideoHTMLAttributes, useEffect, useMemo, useState } from "react";
import { resolveStoredMediaUrl } from "@/lib/client-media-store";

type StoredMediaImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "height" | "src" | "width"> & {
  optimizeHeight?: number;
  optimizeWidth?: number;
  src?: string;
};

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

function transformedStorageImageUrl(src: string, width: number, height?: number) {
  if (!src || src.startsWith("blob:") || src.startsWith("data:") || src.startsWith("/")) {
    return src;
  }

  try {
    const url = new URL(src);
    const marker = "/storage/v1/object/public/";
    const markerIndex = url.pathname.indexOf(marker);

    if (markerIndex === -1 || url.pathname.includes("/storage/v1/render/image/")) {
      return src;
    }

    const objectPath = url.pathname.slice(markerIndex + marker.length);
    const transformed = new URL(`${url.origin}/storage/v1/render/image/public/${objectPath}`);

    transformed.searchParams.set("width", String(width));
    transformed.searchParams.set("quality", "72");
    transformed.searchParams.set("resize", "cover");

    if (height) {
      transformed.searchParams.set("height", String(height));
    }

    return transformed.toString();
  } catch {
    return src;
  }
}

export function StoredMediaImage({ alt = "", optimizeHeight, optimizeWidth = 720, src, ...props }: StoredMediaImageProps) {
  const resolvedSrc = useResolvedMediaSource(src);
  const optimizedSrc = useMemo(() => transformedStorageImageUrl(resolvedSrc, optimizeWidth, optimizeHeight), [optimizeHeight, optimizeWidth, resolvedSrc]);
  const [failedOptimizedSrc, setFailedOptimizedSrc] = useState("");

  useEffect(() => {
    setFailedOptimizedSrc("");
  }, [optimizedSrc]);

  if (!resolvedSrc) {
    return null;
  }

  const displaySrc = optimizedSrc && optimizedSrc !== failedOptimizedSrc ? optimizedSrc : resolvedSrc;

  return (
    <img
      {...props}
      src={displaySrc}
      alt={alt}
      decoding={props.decoding ?? "async"}
      loading={props.loading ?? "lazy"}
      onError={(event) => {
        if (displaySrc !== resolvedSrc) {
          setFailedOptimizedSrc(displaySrc);
          return;
        }

        props.onError?.(event);
      }}
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
