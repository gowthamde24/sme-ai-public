/**
 * The enquiry screens' sentences for a business that sells by area, weight or piece (module `materials`; job DG). The shared sentences say "saree type" (the textile business's word for what a line is about);
 * a building-materials business sees the same screens with its own sentences, chosen by the module, never by a business type's name: the same pattern as `mat.req.line` and the `materials` prop of the requirement panel.
 * A business without the module keeps every word it had. The new sentences are in the dictionary under `mat.req.`.
 */
export const MATERIAL_SENTENCES: Readonly<Record<string, string>> = {
  "enq.approving_needs_a_saree_type_and": "mat.req.approving_needs",
  "enq.approve_or_correct_a_saree_type": "mat.req.approve_or_correct",
  "enq.approve_a_saree_type_and_a": "mat.req.approve_a_product",
  "enq.saree_type_fabric_colour_and_quantity": "mat.req.line_fields",
};

/** `words` with the materials sentences on top of the textile ones (the page already holds the `mat.` words). The same object comes back when nothing changes. */
export function withMaterialWords<T extends Record<string, string>>(words: T): T {
  const out: Record<string, string> = { ...words };
  let changed = false;
  for (const [shared, own] of Object.entries(MATERIAL_SENTENCES)) {
    if (own in words && words[own] !== out[shared]) {
      out[shared] = words[own];
      changed = true;
    }
  }
  return changed ? (out as T) : words;
}
