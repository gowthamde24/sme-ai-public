/** Mirrors health.schema.json. The JSON schema is the source of truth. */
export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  environment: string;
}
