import "server-only";
import { cache } from "react";
import { getProductionReferenceRepositories } from "./production-reference-runtime";
import { getPublicTariffs as getLegacyPublicTariffs } from "./tariff-store";

// Cache is render/request-scoped, not a persistent snapshot of mutable prices.
// https://react.dev/reference/react/cache#caveats
export const getPublicTariffs = cache(async () => {
  const references = await getProductionReferenceRepositories();
  return references ? references.tariffs.getPublicTariffs() : getLegacyPublicTariffs();
});
