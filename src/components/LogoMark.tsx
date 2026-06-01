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
      className="h-11 w-11 object-contain md:h-14 md:w-14"
    />
  );
}
