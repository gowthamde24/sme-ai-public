"use client";

import dynamic from "next/dynamic";

/**
 * The two interactive islands of the public site (job CM), loaded as chunks of their own: the paver calculator (it carries the quote engine) and the contact form are only on one page each, so a visitor to any other page
 * does not download them (about 10 KB gzip off the first visit of every public page, which the route-JS budget counts). They are still rendered on the server, so the markup is in the page and nothing jumps when the
 * chunk arrives.
 */
export const PaverCalculator = dynamic(() => import("./PaverCalculator").then((m) => m.PaverCalculator));
export const ContactForm = dynamic(() => import("./ContactForm").then((m) => m.ContactForm));
// job DM: the three animated blocks of the home page below the first screen (the six AI workers, the natural-calls card, the plan tabs) are chunks of their own too: the home page is the page most people open, and the route-JS budget counts what it
// loads at first. They are drawn on the server like the rest (the markup is in the page), and become live when the chunk arrives. The example beside the headline (HeroDemo) is on the first screen and stays in the page.
export const Workforce = dynamic(() => import("./Workforce").then((m) => m.Workforce));
export const NaturalCalls = dynamic(() => import("./NaturalCalls").then((m) => m.NaturalCalls));
export const PlansPreview = dynamic(() => import("./PlansPreview").then((m) => m.PlansPreview));
// job DQ: the "book a demo" form is on the home page, the business types' pages and the contact page; it is a chunk of its own like the contact form
export const WaitlistForm = dynamic(() => import("./WaitlistForm").then((m) => m.WaitlistForm));
