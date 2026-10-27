"use client";

import { useRouter } from "next/navigation";

import { TypeCombobox, type TypeGroup, type TypeWords } from "@/components/v2/auth/TypeCombobox";

/** Step 1 of the sign-up: the one searchable list; choosing a business type goes on to step 2 at once (any kind, "Other" included: what an "Other" business is gets asked at the first-login set-up, after the account exists). */
export function SignupTypePicker({ groups, words, otherId }: { groups: readonly TypeGroup[]; words: TypeWords; otherId: string | null }) {
  const router = useRouter();
  return <TypeCombobox groups={groups} words={words} otherId={otherId} askOther={false} onChoose={(id) => router.push(`/signup?type=${encodeURIComponent(id)}`)} />;
}
