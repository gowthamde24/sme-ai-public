import type { EmailAddressWords } from "@/components/v2/site/EmailAddress";
import type { SiteT } from "@/i18n/site";

/** The words of the copy button and the mail link, resolved on the server for the EmailAddress island (job DB). */
export const emailWords = (t: SiteT): EmailAddressWords => ({ copy: t("contact.copy"), copied: t("contact.copied"), copyAria: t("contact.copy.aria", { address: "{address}" }), failed: t("contact.copy.failed"), mail: t("contact.mail"), mailAria: t("contact.mail.aria", { address: "{address}" }) });
