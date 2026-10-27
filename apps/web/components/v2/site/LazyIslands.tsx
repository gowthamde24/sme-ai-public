"use client";

import dynamic from "next/dynamic";

/**
 * The two interactive islands of the public site (job CM), loaded as chunks of their own: the paver calculator (it carries the quote engine) and the contact form are only on one page each, so a visitor to any other page
 * does not download them (about 10 KB gzip off the first visit of every public page, which the route-JS budget counts). They are still rendered on the server, so the markup is in the page and nothing jumps when the
 * chunk arrives.
 */
export const PaverCalculator = dynamic(() => import("./PaverCalculator").then((m) => m.PaverCalculator));
export const ContactForm = dynamic(() => import("./ContactForm").then((m) => m.ContactForm));
// job DQ: the "book a demo" form is on the home page, the business types' pages and the contact page; it is a chunk of its own like the contact form
export const WaitlistForm = dynamic(() => import("./WaitlistForm").then((m) => m.WaitlistForm));
