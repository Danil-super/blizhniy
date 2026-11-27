import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers";

export class AdminPasskeyError extends Error {
  constructor() {
    super("Administrator passkey verification required");
    this.name = "AdminPasskeyError";
  }
}

export function adminPasskeyRelyingParty(origin: string): string {
  if (typeof window !== "undefined") throw new AdminPasskeyError();
  const url = URL.parse(origin);
  if (!url || url.protocol !== "https:" || url.origin !== origin) throw new AdminPasskeyError();
  return url.hostname;
}

export async function createAdminPasskeyOptions(origin: string, credentialIds: readonly string[]) {
  const rpID = adminPasskeyRelyingParty(origin);
  if (!credentialIds.length) throw new AdminPasskeyError();
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: credentialIds.map(id => ({ id })),
    userVerification: "required",
    timeout: 90_000,
  });
}

function assertClientContext(clientData: string, origin: string) {
  // Reject embedded contexts even on clients that omit the top origin.
  const data = decodeClientDataJSON(clientData);
  if (data.origin !== origin || (data.crossOrigin !== undefined && data.crossOrigin !== false) || data.topOrigin !== undefined) {
    throw new AdminPasskeyError();
  }
}

export async function createAdminPasskeyRegistration(origin: string, userHandle: string, credentialIds: string[]) {
  return generateRegistrationOptions({
    rpID: adminPasskeyRelyingParty(origin),
    rpName: "БЛИЖНИЙ",
    userID: Uint8Array.from(Buffer.from(userHandle, "base64url")),
    userName: `admin-${userHandle.slice(0, 12)}`,
    userDisplayName: "Администратор БЛИЖНЕГО",
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    excludeCredentials: credentialIds.map(id => ({ id })),
    timeout: 90_000,
  });
}

export async function verifyAdminPasskeyRegistration(origin: string, challenge: string,
  response: RegistrationResponseJSON): Promise<WebAuthnCredential> {
  const rpID = adminPasskeyRelyingParty(origin);
  try {
    assertClientContext(response.response.clientDataJSON, origin);
    const result = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserPresence: true, requireUserVerification: true,
    });
    if (!result.verified) throw new AdminPasskeyError();
    return result.registrationInfo.credential;
  } catch {
    throw new AdminPasskeyError();
  }
}

type AdminPasskeyAssertion = {
  origin: string;
  challenge: string;
  credential: WebAuthnCredential;
  userHandle: string;
  assertion: AuthenticationResponseJSON;
};

/** The caller supplies the locked credential and consumes the stored challenge with the authorized action. */
export async function verifyAdminPasskeyAssertion({
  origin, challenge, credential, userHandle, assertion,
}: AdminPasskeyAssertion): Promise<number> {
  const rpID = adminPasskeyRelyingParty(origin);
  try {
    const response = assertion.response;
    if (assertion.id !== credential.id || (response.userHandle !== undefined && response.userHandle !== userHandle)) {
      throw new AdminPasskeyError();
    }
    assertClientContext(response.clientDataJSON, origin);
    const result = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });
    if (!result.verified) throw new AdminPasskeyError();
    return result.authenticationInfo.newCounter;
  } catch {
    throw new AdminPasskeyError();
  }
}
