/**
 * schema.org data for search engines (job CM): a `<script type="application/ld+json">` is DATA, not executable script, so the page's nonce CSP does not apply to it. `<` is escaped so a text can never close the tag.
 * Only what the page really says goes in: the application and its plans, or the questions and answers shown on the page.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function faqLd(items: readonly { q: string; a: string }[]): Record<string, unknown> {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) };
}
