import Image from "next/image";

export function LogoMark() {
  return (
    <Image
      src="/brand/logo-premium.png"
      alt=""
      width={72}
      height={72}
      priority
      aria-hidden="true"
      className="h-10 w-10 object-contain drop-shadow-[0_8px_18px_rgba(8,117,209,0.24)] sm:h-12 sm:w-12 md:h-14 md:w-14"
    />
  );
}
