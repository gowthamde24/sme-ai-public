import { parseDraft, parseFact, parseFacts, parseSource, parseSources, type Fact, type FactKind, type KnowledgeSource } from "@/lib/lead-desk/knowledge";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The knowledge base of the API (night 4, part A1; contract-leads-pack.md section 3): sources (pasted text or a file as base64: the API takes no multipart), drafted facts, and the owner's decisions. Under
 * `/v1/tenants/{id}/knowledge`. Owner and Admin manage; Sales and Viewer read approved facts only. SERVER ONLY, with the person's own token.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/knowledge`;
};
const seg = (id: string): string => (isCanonicalUuid(id) ? id : (() => { throw new ApiContractError("id"); })());
const post = (tenantId: string, path: string, token: string, body: unknown) => apiRequest(`${base(tenantId)}${path}`, token, { method: "POST", body: JSON.stringify(body) });

export const listSources = async (token: string, tenantId: string): Promise<KnowledgeSource[]> => parseSources(await apiRequest(`${base(tenantId)}/sources`, token));
export const addPasteSource = async (token: string, tenantId: string, input: { sourceId: string; title: string; text: string }): Promise<KnowledgeSource> => parseSource(await post(tenantId, "/sources", token, { source_id: input.sourceId, kind: "paste", title: input.title, text: input.text }));
export const addFileSource = async (token: string, tenantId: string, input: { sourceId: string; title: string; filename: string; contentType: string; contentBase64: string }): Promise<KnowledgeSource> =>
  parseSource(await post(tenantId, "/sources", token, { source_id: input.sourceId, kind: "file", title: input.title, filename: input.filename, content_type: input.contentType, content_base64: input.contentBase64 }));
export const draftFacts = async (token: string, tenantId: string, sourceId: string): Promise<Fact[]> => parseDraft(await post(tenantId, `/sources/${seg(sourceId)}/draft-facts`, token, {}));
export const discardSource = async (token: string, tenantId: string, sourceId: string): Promise<KnowledgeSource> => parseSource(await post(tenantId, `/sources/${seg(sourceId)}/discard`, token, {}));
export const listFacts = async (token: string, tenantId: string, status?: string): Promise<Fact[]> => parseFacts(await apiRequest(`${base(tenantId)}/facts?limit=200${status ? `&status=${encodeURIComponent(status)}` : ""}`, token)).facts;
export const addFact = async (token: string, tenantId: string, input: { factId: string; kind: FactKind; text: string }): Promise<Fact> => parseFact(await post(tenantId, "/facts", token, { fact_id: input.factId, kind: input.kind, text: input.text }));
export const editFact = async (token: string, tenantId: string, factId: string, input: { text: string; kind?: FactKind }): Promise<Fact> => parseFact(await post(tenantId, `/facts/${seg(factId)}/edit`, token, input.kind ? { text: input.text, kind: input.kind } : { text: input.text }));
export const decideFact = async (token: string, tenantId: string, factId: string, decision: "approve" | "reject"): Promise<Fact> => parseFact(await post(tenantId, `/facts/${seg(factId)}/decide`, token, { decision }));
