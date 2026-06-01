import Image from "next/image";

const contactIconSrc = {
  message: "/brand/message.jpg",
  phone: "/brand/phone.jpg",
};

type ContactAssetIconProps = {
  className?: string;
  kind: keyof typeof contactIconSrc;
  size?: number;
};

export function ContactAssetIcon({ className = "h-7 w-7", kind, size = 32 }: ContactAssetIconProps) {
  return (
    <Image
      src={contactIconSrc[kind]}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      className={`shrink-0 rounded-full object-cover shadow-[0_1px_4px_rgba(8,117,209,0.22)] ring-1 ring-white/80 ${className}`}
    />
  );
}
