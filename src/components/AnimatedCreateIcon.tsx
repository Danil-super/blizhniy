"use client";

import Image from "next/image";
import addGif from "../../add.gif";

export function AnimatedCreateIcon({ className = "h-5 w-5" }: { className?: string }) {
  return <Image src={addGif} alt="" width={24} height={24} unoptimized className={`shrink-0 object-contain ${className}`} aria-hidden="true" />;
}
