"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { AnimationItem } from "lottie-web";
import locationAnimation from "../../location.json";

export function AnimatedLocationIcon({ className = "h-5 w-5" }: { className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [animationReady, setAnimationReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    let animation: AnimationItem | undefined;
    let cancelled = false;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("lottie-web")
      .then(({ default: lottie }) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        animation = lottie.loadAnimation({
          animationData: locationAnimation,
          autoplay: !prefersReducedMotion,
          container: containerRef.current,
          loop: !prefersReducedMotion,
          renderer: "svg",
          rendererSettings: {
            preserveAspectRatio: "xMidYMid meet",
          },
        });

        animation.addEventListener("DOMLoaded", () => {
          if (!cancelled) {
            setAnimationReady(true);
          }
        });

        if (prefersReducedMotion) {
          animation.goToAndStop(0, true);
        }
      })
      .catch(() => {
        setAnimationReady(false);
      });

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, []);

  return (
    <span aria-hidden="true" className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden leading-none text-[#0875d1] ${className}`}>
      <MapPin className={`absolute inset-0 h-full w-full transition-opacity ${animationReady ? "opacity-0" : "opacity-100"}`} />
      <span ref={containerRef} className={`absolute inset-0 block transition-opacity ${animationReady ? "opacity-100" : "opacity-0"}`} />
    </span>
  );
}
