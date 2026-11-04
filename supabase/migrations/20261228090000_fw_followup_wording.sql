-- Follow-up wording for every business type (C2's request, 4 Nov 2026; the owner's list of today). The three closed follow-up wordings (T010 part 2) said "your saree requirement" in every pack, so a
-- construction business or a school had drafts that spoke of sarees (C2's seed made none for them). The wording is now about "your enquiry", which every business type has (a school's admission
-- enquiry, a builder's material enquiry, a shop's saree enquiry). Data only: the codes, the touch rule (app.followup_template_code), the pinned engine and every function are unchanged; a draft
-- already made keeps the words it was made with (the database copied them).
update public.followup_templates set body = 'Hello, I am following up on my earlier message about your enquiry. If you would like me to share the details again, or if anything is unclear, please reply here and I will be glad to help.'
 where code = 'followup_gentle';
update public.followup_templates set body = 'Hello, a gentle reminder about your enquiry. Please let me know if you would like to go ahead, need any changes, or would like me to send the details once more.'
 where code = 'followup_reminder';
update public.followup_templates set body = 'Hello, this is my last follow-up on your enquiry, so that I do not trouble you. If you are still interested, please reply here and I will take it forward. Thank you for your time.'
 where code = 'followup_last';
