// Read-only migration sources and hashes. No database client, credentials or executor.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const names = ["0001-identity.sql", "0002-registration.sql", "0003-auth-rate-limits.sql",
  "0004-password-recovery.sql", "0005-reference-catalog.sql", "0006-media-reservations.sql", "0007-media-write-attempts.sql"];

export function getBootstrapPlan({ includeMail = false, includeProfiles = false, includeListings = false, includeListingPhotos = false, includeListingModeration = false, includeConfirmationNotice = false, includeWorkPublications = false, includeServicePublications = false, includeInteractions = false, includePaymentIntents = false, includePaymentOrders = false, includePaymentVerification = false, includePaymentFulfillment = false, includePaymentReconciliation = false, includePaymentReconciliationRole = false, includeListingContactMethod = false } = {}) {
  if ([includeMail, includeProfiles, includeListings, includeListingPhotos, includeListingModeration, includeConfirmationNotice, includeWorkPublications, includeServicePublications, includeInteractions, includePaymentIntents, includePaymentOrders, includePaymentVerification, includePaymentFulfillment, includePaymentReconciliation, includePaymentReconciliationRole, includeListingContactMethod].some(value => typeof value !== "boolean")) throw new Error("Invalid bootstrap option");
  const mail = [...names, "0008-mail-outbox.sql", "0009-mail-delivery.sql", "0010-production-rate-limits.sql"];
  const account = [...mail, "0011-cabinet-profiles.sql"];
  const listings = [...account, "0012-listings.sql"];
  const photos = [...listings, "0013-listing-photos.sql"];
  const moderation = [...photos, "0014-listing-moderation.sql"];
  const notice = [...moderation, "0015-confirmation-notice.sql"];
  const work = [...notice, "0016-work-publications.sql"];
  const services = [...work, "0017-service-publications.sql"];
  const interactions = [...services, "0018-interactions.sql"];
  const paymentIntents = [...interactions, "0019-payment-intents.sql"];
  const paymentOrders = [...paymentIntents, "0020-payment-orders.sql"];
  const paymentVerification = [...paymentOrders, "0021-payment-verification.sql"];
  const fulfillment = [...paymentVerification, "0022-listing-payment-fulfillment.sql"];
  const reconciliation = [...fulfillment, "0023-payment-reconciliation.sql"];
  const lockGuards = [...reconciliation, "0024-reconciliation-lock-guards.sql"];
  const approved = includeListingContactMethod ? [...lockGuards, "0025-listing-contact-method.sql"] : includePaymentReconciliationRole ? lockGuards : includePaymentReconciliation ? reconciliation : includePaymentFulfillment ? fulfillment : includePaymentVerification ? paymentVerification : includePaymentOrders ? paymentOrders : includePaymentIntents ? paymentIntents : includeInteractions ? interactions : includeServicePublications ? services : includeWorkPublications ? work : includeConfirmationNotice ? notice : includeListingModeration ? moderation : includeListingPhotos ? photos : includeListings ? listings : includeProfiles ? account : includeMail ? mail : names;
  return approved.map(name => {
    const source = readFileSync(new URL(`../database/migrations/${name}`, import.meta.url), "utf8");
    if (!/^begin;$/m.test(source) || !/commit;\s*$/.test(source)) throw new Error("Invalid bootstrap migration");
    return { name, sha256: createHash("sha256").update(source).digest("hex"),
      sql: source.replace(/^begin;\r?\n/m, "").replace(/commit;\s*$/, "") };
  });
}
