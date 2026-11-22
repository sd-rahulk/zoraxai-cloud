export const knowledgePath = "/api/admin/knowledge";

export const businessFields = [
  ["company", "Business name"], ["contact_name", "Contact name"], ["email", "Business email"],
  ["phone", "Business phone"], ["website", "Website URL"], ["location", "Primary location"],
  ["street_address", "Street address"], ["city", "City"], ["region", "State or region"],
  ["postal_code", "Postal code"], ["country", "Country"],
  ["description", "Business description"], ["services", "Services"],
] as const;

export type BusinessField = (typeof businessFields)[number][0];
export type ProfileValue = string | number | boolean;
export type Answer = { question: string; answer: string };
export type ProfileContent = {
  name: string; category: string; business: Partial<Record<BusinessField, string>>;
  custom: Record<string, ProfileValue>; answers: Answer[]; context: string;
};
export type ProfileSummary = {
  id: string; name: string; category: string; is_default: boolean;
  version: number; created_at: string; updated_at: string;
};
export type ProfileRecord = ProfileSummary & { profile: ProfileContent; access_key_ids: string[] };
export type ProfileTransfer = { format_version: 1; profile: ProfileContent };
export type Revision = { version: number; created_at: string };
