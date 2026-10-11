/**
 * The word key for each reason a photo was not stored: the API's closed `code`s, plus the three the browser itself can have. Used by the upload bar (client) and by the server's refusals, so both
 * say the same sentence. An unknown code is the general sentence, never the API's own text.
 */
const KEYS: Record<string, string> = {
  photo_type_unsupported: "catalogue.photo.err.type",
  photo_too_large: "catalogue.photo.err.large",
  photo_unreadable: "catalogue.photo.err.unreadable",
  photo_too_big: "catalogue.photo.err.pixels",
  photo_animated: "catalogue.photo.err.animated",
  too_many_photos: "catalogue.photo.full",
  photo_files_missing: "catalogue.photo.err.missing",
  network: "catalogue.photo.err.net",
  aborted: "catalogue.photo.err.net",
  forbidden: "today.err.role",
  mfa_required: "today.err.mfa",
  needs_photo: "catalogue.err.needs_photo",
  catalogue_unavailable: "catalogue.err.unavailable",
};
export const photoErrorKey = (code: string): string => KEYS[code] ?? "catalogue.photo.err.generic";
