/**
 * The reasons a message waits for approval that the catalogue's send panel explains in its own plain words (`catalogue.why.<reason>`); any other reason is "a rule of the shop asks for approval". They live
 * here, not in the "use server" file, which may export only async functions.
 */
export const WHY_REASONS = ["money", "commitment", "complaint", "model_flagged", "uncertain", "category_other", "no_inbound_window", "auto_off"] as const;

/** The block reasons the send panel has a sentence for (`today.block.<reason>`); any other is "a rule of the system stopped it". */
export const BLOCK_REASONS = ["switch_off", "stopped", "erased", "no_phone", "no_key", "no_opt_in", "daily_limit", "send_failed", "owner_rejected"] as const;
