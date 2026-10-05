# ADR 0016: Second factor (TOTP) required for Owner and Admin on privileged actions

Status: accepted for implementation (2026-10-05, T006b M3a, owner's brief). Related: ADR 0001 #7, 0002, 0003, 0014, 0015.

## Context
A stolen Owner password would let an attacker erase data, add themselves as an Owner, export lead labels or change workspace settings.
Supabase Auth issues TOTP factors and puts the session's assurance level in the signed token (`aal`: `aal1` password only, `aal2` after a
valid TOTP code, plus `amr`). Roles and tenants still come from the database, never from claims (ADR 0002); `aal` is the one claim we
now read, because only the Auth server can raise it.

## Decision
1. **Who.** Owners and Admins. Sales and Viewers are unaffected (they hold none of these powers).
2. **Which actions need `aal2`:** erasure request, execute and cancel; any change to memberships or roles; export; anything that opens or
   changes workspace settings (the agents switch, publishing an ICP profile). Reading, labelling, importing, archiving and everything
   Sales can do stay at `aal1`.
3. **Where it is enforced.**
   * **Database (cannot be bypassed by calling PostgREST directly):** `request_erasure`, `execute_erasure`, `cancel_erasure` and
     `set_tenant_agents_enabled` check `auth.jwt() ->> 'aal' = 'aal2'` **after** the caller's role in the tenant is proven (so a stranger
     still gets the generic refusal and learns nothing) and refuse with the dedicated SQLSTATE **`SM306`**, fixed message
     "a second factor is required for this action". A trigger on `memberships` and on `tenants` refuses client-role writes (`current_user`
     is a client role) without `aal2` for the same reason; definer functions such as `create_tenant` and the operator functions run as
     the trusted role and are not caught.
   * **API (clear error, no database round trip):** the same actions return **403 `mfa_required`** for an Owner or Admin whose token is `aal1`.
4. **No grace, no enrolment, no action.** An Owner or Admin with no factor stays `aal1` and is refused; the app sends them to the
   enrolment page. Login asks for the code immediately when a factor exists, so the session is `aal2` from the start (refreshing keeps it).
5. **Unenrol** needs a fresh code typed on the unenrol form (verified first, then the factor is removed), and Supabase itself requires
   `aal2` to remove a verified factor.
6. **Lost device.** Supabase TOTP has no recovery codes. The Owner asks the operator, who verifies identity out of band and removes the
   factor with `app.operator_reset_mfa(email, reason)` (audited, reason recorded) or in the dashboard; the person signs in with the
   password and enrols again (`docs/runbooks/mfa-recovery.md`). The UI says so.
7. **Local vs hosted.** TOTP is enabled in `supabase/config.toml` for local development only. The hosted setting is applied by hand
   (`docs/runbooks/hosted-auth-settings.md`); the verifier reads it from the public auth settings (GET only).

## Consequences and limits
* Every Owner and Admin account must enrol before doing any of the above. Existing local test users get a factor in the test setup.
* `aal2` is a property of the session, not of each action: a stolen **live** `aal2` session is not stopped. Session length and the
  hosted inactivity timeout limit that. TOTP is phishable by a real-time proxy; passkeys are future work.
* Recovery depends on the operator; that is deliberate while the family is the only user.
* Each check is mutation-tested alone (remove it from each function and trigger: the tests must fail).
