import type { ReactNode } from "react";

export function BrandName() {
  return <span className="italic">БЛИЖНИЙ</span>;
}

export function renderBrandText(value: string): ReactNode {
  const parts = value.split("БЛИЖНИЙ");

  if (parts.length === 1) {
    return value;
  }

  return parts.flatMap((part, index) =>
    index === parts.length - 1
      ? [part]
      : [
          part,
          <BrandName key={`brand-${index}`} />,
        ],
  );
}
