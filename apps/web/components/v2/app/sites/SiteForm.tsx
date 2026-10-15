"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { SiteOut } from "@contracts";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, primary, quiet, secondary } from "../visits/styles";
import { CompanyPicker, type CompanyChoice } from "./CompanyPicker";
import type { SiteActions } from "./sites-types";

const CHECK = "inline-flex min-h-11 items-center gap-3 text-base";

/**
 * Add or change a delivery site (job CO; Owner, Admin and Sales write, everyone reads). A customer can have many sites. The map pin is the place a truck must reach: type the two numbers, or press "Use my
 * location" when standing at the site (the phone asks first; nothing leaves the phone but the two numbers you save). The truck notes are for the driver: lane width, night delivery, help to unload, the gate. The
 * site contact is the person who receives the goods: their name and number are kept as a contact of this customer. No phone number or e-mail goes in the free-text boxes (the API refuses it).
 */
export function SiteForm(p: { base: string; siteId: string; site: SiteOut | null; company: CompanyChoice | null; contactLabel: string | null; words: TodayWords; actions: SiteActions; go?: (href: string) => void }) {
  const { words, site } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const [company, setCompany] = React.useState<CompanyChoice | null>(p.company);
  const [name, setName] = React.useState(site?.name ?? "");
  const [address, setAddress] = React.useState(site?.address_line ?? "");
  const [city, setCity] = React.useState(site?.city ?? "");
  const [pin, setPin] = React.useState(site?.pin ?? "");
  const [lat, setLat] = React.useState(site?.map_lat != null ? String(site.map_lat) : "");
  const [lng, setLng] = React.useState(site?.map_lng != null ? String(site.map_lng) : "");
  const [distance, setDistance] = React.useState(site?.distance_km != null ? String(site.distance_km) : "");
  const [lane, setLane] = React.useState(site?.lane_width_ft != null ? String(site.lane_width_ft) : "");
  const [night, setNight] = React.useState(site?.night_delivery ?? false);
  const [unload, setUnload] = React.useState(site?.unloading_help ?? false);
  const [notes, setNotes] = React.useState(site?.access_notes ?? "");
  const [active, setActive] = React.useState(site?.active ?? true);
  const [contact, setContact] = React.useState<"keep" | "new" | "none">(site?.site_contact_id ? "keep" : "none");
  const [contactName, setContactName] = React.useState("");
  const [contactPhone, setContactPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [locating, setLocating] = React.useState(false);

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return setProblem({ text: say(words, "site.err.nolocation") });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setProblem({ text: say(words, "site.err.nolocation") });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  async function save() {
    if (busy) return;
    setProblem(null);
    if (!company) return setProblem({ text: say(words, "site.err.company") });
    if (name.trim() === "") return setProblem({ text: say(words, "site.err.name") });
    if (contact === "new" && (contactName.trim() === "" || contactPhone.trim() === "")) return setProblem({ text: say(words, "site.err.contact") });
    setBusy(true);
    const out = await p.actions.save({ siteId: p.siteId, companyId: company.id, name, addressLine: address, city, pin, lat, lng, distanceKm: distance, laneWidthFt: lane, nightDelivery: night, unloadingHelp: unload, accessNotes: notes, active, contact, contactName, contactPhone });
    setBusy(false);
    if (!out.ok) return setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    go(`${p.base}/sites?saved=1`);
  }

  return (
    <form data-screen="site-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-2xl flex-col gap-5">
      <CompanyPicker value={company} onChange={setCompany} search={p.actions.search} words={words} disabled={busy || site !== null} idPrefix="site-cp" />
      <div>
        <label htmlFor="site-name" className={label}>{say(words, "site.field.name")}</label>
        <input id="site-name" value={name} maxLength={200} disabled={busy} onChange={(e) => setName(e.target.value)} aria-describedby="site-name-help" className={field} />
        <p id="site-name-help" className={help}>{say(words, "site.field.name.help")}</p>
      </div>
      <div>
        <label htmlFor="site-address" className={label}>{say(words, "site.field.address")}</label>
        <input id="site-address" value={address} maxLength={400} disabled={busy} onChange={(e) => setAddress(e.target.value)} className={field} />
      </div>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
        <div>
          <label htmlFor="site-city" className={label}>{say(words, "site.field.city")}</label>
          <input id="site-city" value={city} maxLength={120} disabled={busy} onChange={(e) => setCity(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="site-pin" className={label}>{say(words, "site.field.pin")}</label>
          <input id="site-pin" inputMode="numeric" value={pin} maxLength={6} disabled={busy} onChange={(e) => setPin(e.target.value)} className={field} />
        </div>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "site.field.map")}</legend>
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          <div>
            <label htmlFor="site-lat" className={label}>{say(words, "site.field.lat")}</label>
            <input id="site-lat" inputMode="decimal" value={lat} disabled={busy} onChange={(e) => setLat(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="site-lng" className={label}>{say(words, "site.field.lng")}</label>
            <input id="site-lng" inputMode="decimal" value={lng} disabled={busy} onChange={(e) => setLng(e.target.value)} className={field} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={secondary} disabled={busy || locating} onClick={useMyLocation}>{locating ? say(words, "today.act.working") : say(words, "site.map.here")}</button>
          {lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? (
            <a href={`https://www.google.com/maps?q=${encodeURIComponent(lat.trim())},${encodeURIComponent(lng.trim())}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">{say(words, "site.map.open")}</a>
          ) : null}
        </div>
        <p className={help}>{say(words, "site.map.help")}</p>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "site.field.truck")}</legend>
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          <div>
            <label htmlFor="site-distance" className={label}>{say(words, "site.field.distance")}</label>
            <input id="site-distance" inputMode="numeric" value={distance} disabled={busy} onChange={(e) => setDistance(e.target.value)} aria-describedby="site-distance-help" className={field} />
            <p id="site-distance-help" className={help}>{say(words, "site.field.distance.help")}</p>
          </div>
          <div>
            <label htmlFor="site-lane" className={label}>{say(words, "site.field.lane")}</label>
            <input id="site-lane" inputMode="numeric" value={lane} disabled={busy} onChange={(e) => setLane(e.target.value)} className={field} />
          </div>
        </div>
        <label className={CHECK}><input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={night} disabled={busy} onChange={(e) => setNight(e.target.checked)} />{say(words, "site.field.night")}</label>
        <label className={CHECK}><input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={unload} disabled={busy} onChange={(e) => setUnload(e.target.checked)} />{say(words, "site.field.unload")}</label>
        <div>
          <label htmlFor="site-notes" className={label}>{say(words, "site.field.notes")}</label>
          <textarea id="site-notes" rows={3} value={notes} maxLength={1000} disabled={busy} onChange={(e) => setNotes(e.target.value)} aria-describedby="site-notes-help" className={`${field} py-2`} />
          <p id="site-notes-help" className={help}>{say(words, "site.field.notes.help")}</p>
        </div>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line p-4">
        <legend className="px-1 font-display text-lg font-semibold">{say(words, "site.field.contact")}</legend>
        {site?.site_contact_id ? <p className="text-base">{say(words, "site.contact.now", { name: p.contactLabel ?? say(words, "site.contact.unknown") })}</p> : null}
        <div role="radiogroup" aria-label={say(words, "site.field.contact")} className="flex flex-col gap-1">
          {(site?.site_contact_id ? (["keep", "new", "none"] as const) : (["none", "new"] as const)).map((m) => (
            <label key={m} className={CHECK}>
              <input type="radio" name="site-contact" className="size-5 shrink-0 accent-brand-text" checked={contact === m} disabled={busy} onChange={() => setContact(m)} />
              {say(words, `site.contact.${m}`)}
            </label>
          ))}
        </div>
        {contact === "new" ? (
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
            <div>
              <label htmlFor="site-cname" className={label}>{say(words, "site.contact.name")}</label>
              <input id="site-cname" value={contactName} maxLength={200} disabled={busy} onChange={(e) => setContactName(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="site-cphone" className={label}>{say(words, "site.contact.phone")}</label>
              <input id="site-cphone" inputMode="tel" value={contactPhone} maxLength={30} disabled={busy} onChange={(e) => setContactPhone(e.target.value)} className={field} />
            </div>
          </div>
        ) : null}
        <p className={help}>{say(words, "site.contact.help")}</p>
      </fieldset>
      {site ? <label className={CHECK}><input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} />{say(words, "site.field.active")}</label> : null}
      {problem ? (
        <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
          <p>{problem.text}</p>
          {problem.mfa ? <Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link> : null}
        </div>
      ) : null}
      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
        <button type="submit" disabled={busy} className={primary}>{busy ? say(words, "today.act.working") : say(words, "site.save")}</button>
        <Link href={`${p.base}/sites`} aria-disabled={busy} className={quiet}>{say(words, "today.act.cancel")}</Link>
      </div>
    </form>
  );
}
