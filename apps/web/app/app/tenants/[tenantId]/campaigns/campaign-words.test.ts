import { describe, expect, it } from "vitest";

import { LANGS } from "@/i18n/lang";

import { campaignWords } from "./campaign-words";

/**
 * Job DF: on staging the Announcements page of a school drew its title as the raw key `nav.item.announcements`, because the campaign screens' word list kept `nav.item.campaigns` but not the announcements title the
 * same view (CampaignsView, `announcements` mode) reads. Every key the view reads must be in the list, in every language.
 */
describe("the words of the campaign and announcement screens", () => {
  it.each(LANGS)("%s: the titles of both lists, the call list and every key CampaignsView draws are there", (lang) => {
    const w = campaignWords(lang);
    for (const key of ["nav.item.campaigns", "nav.item.announcements", "nav.item.calllist", "camp.sub", "camp.ann.sub", "camp.add", "camp.ann.add"]) {
      expect(w[key], `${lang}: ${key}`).toBeTruthy();
      expect(w[key], `${lang}: ${key}`).not.toBe(key);
    }
  });
});
