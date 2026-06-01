import Image from "next/image";

export function LogoMark() {
  return (
    <Image
      src="/brand/logo-soft.png"
      alt=""
      width={72}
      height={72}
      priority
      aria-hidden="true"
      className="h-9 w-9 object-contain sm:h-11 sm:w-11 md:h-14 md:w-14"
    />
  );
}
