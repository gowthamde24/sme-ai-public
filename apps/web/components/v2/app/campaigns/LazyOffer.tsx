"use client";

import dynamic from "next/dynamic";

/** The offer form and the "customers who said yes" section, each a chunk of its own (the route-JS budget counts a page's first load): only an offer's pages ever load them. */
export const OfferForm = dynamic(() => import("./OfferForm").then((m) => m.OfferForm));
export const OfferAudience = dynamic(() => import("./OfferAudience").then((m) => m.OfferAudience));
