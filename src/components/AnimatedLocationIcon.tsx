"use client";

import { useEffect, useRef } from "react";
import lottie, { type AnimationItem } from "lottie-web";
import locationAnimation from "../../location.json";

export function AnimatedLocationIcon({ className = "h-5 w-5" }: { className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animation: AnimationItem = lottie.loadAnimation({
      animationData: locationAnimation,
      autoplay: !prefersReducedMotion,
      container: containerRef.current,
      loop: !prefersReducedMotion,
      renderer: "svg",
      rendererSettings: {
        preserveAspectRatio: "xMidYMid meet",
      },
    });

    if (prefersReducedMotion) {
      animation.goToAndStop(0, true);
    }

    return () => {
      animation.destroy();
    };
  }, []);

  return <span ref={containerRef} aria-hidden="true" className={`block shrink-0 overflow-hidden leading-none ${className}`} />;
}
