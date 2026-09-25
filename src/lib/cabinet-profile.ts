export type CabinetProfile = {
  name: string;
  avatarDataUrl: string;
  avatarZoom: number;
  avatarPositionX: number;
  avatarPositionY: number;
  phone: string;
  phoneVerified: boolean;
  verifiedPhone: string;
  email: string;
  city: string;
  notifyBookings: boolean;
  notifyMessages: boolean;
  notifyPayments: boolean;
  notifyPublicationStatus: boolean;
  notifySystem: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  organizationName: string;
  organizationInn: string;
  organizationOgrn: string;
  organizationAddress: string;
  organizationWebsite: string;
  organizationDescription: string;
};

export function createDefaultCabinetProfile(identity: { name: string; email: string }): CabinetProfile {
  return {
    name: identity.name,
    avatarDataUrl: "",
    avatarZoom: 1,
    avatarPositionX: 50,
    avatarPositionY: 50,
    phone: "",
    phoneVerified: false,
    verifiedPhone: "",
    email: identity.email,
    city: "Краснодар",
    notifyBookings: true,
    notifyMessages: true,
    notifyPayments: true,
    notifyPublicationStatus: true,
    notifySystem: true,
    emailNotifications: true,
    pushNotifications: false,
    organizationName: "",
    organizationInn: "",
    organizationOgrn: "",
    organizationAddress: "",
    organizationWebsite: "",
    organizationDescription: "",
  };
}
