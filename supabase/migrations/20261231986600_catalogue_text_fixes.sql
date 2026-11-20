-- Telugu and STOP-line corrections of the catalogue drafts (planner's native check, 20 Nov 2026): visit_invite, time_to_come_back and we_missed_you (English and Telugu) end with the STOP line like every marketing message,
-- and the Telugu of four messages is rewritten. Only a draft that still holds the OLD words is changed (one an owner edited, submitted or approved is left alone); nothing is submitted to Meta.
update integrations.wa_templates w
   set body = v.new_body, updated_at = now()
  from (values
  ('visit_invite', 'en', 'Hello {{1}}, this is {{2}}. Would you like to book a {{3}}? Reply here with a day and time that suits you.', 'Hello {{1}}, this is {{2}}. Would you like to book a {{3}}? Reply here with a day and time that suits you. Reply STOP to unsubscribe.'),
  ('visit_invite', 'te', 'నమస్కారం {{1}} గారు! {{2}} నుండి. మీరు {{3}} బుక్ చేసుకుంటారా? మీకు అనుకూలమైన రోజు, టైమ్ ఇక్కడే చెప్పండి.', 'నమస్కారం {{1}} గారు! ఇది {{2}} నుండి. మీకు {{3}} బుక్ చేయమంటారా? మీకు వీలైన రోజు, టైమ్ ఇక్కడే చెప్పండి. వద్దనుకుంటే STOP అని పంపండి.'),
  ('after_visit_thanks', 'te', 'నమస్కారం {{1}} గారు! {{2}} తో మీ {{3}} కి ధన్యవాదాలు. ఎలా అనిపించింది? ఏమైనా సహాయం కావాలంటే ఇక్కడే రిప్లై ఇవ్వండి.', 'నమస్కారం {{1}} గారు! {{2}} లో మీ {{3}} కి వచ్చినందుకు ధన్యవాదాలు. ఎలా అనిపించింది? ఏమైనా సహాయం కావాలంటే ఇక్కడే రిప్లై ఇవ్వండి.'),
  ('time_to_come_back', 'en', 'Hello {{1}}, this is {{2}}. It may be time for your next {{3}}. Reply here and we will help you book it.', 'Hello {{1}}, this is {{2}}. It may be time for your next {{3}}. Reply here and we will help you book it. Reply STOP to unsubscribe.'),
  ('time_to_come_back', 'te', 'నమస్కారం {{1}} గారు! {{2}} నుండి. మీ తర్వాతి {{3}} టైమ్ అయినట్టుంది. బుక్ చేయడానికి ఇక్కడే రిప్లై ఇవ్వండి.', 'నమస్కారం {{1}} గారు! ఇది {{2}} నుండి. మీ తర్వాతి {{3}} టైమ్ వచ్చింది. బుక్ చేయడానికి ఇక్కడే రిప్లై ఇవ్వండి. వద్దనుకుంటే STOP అని పంపండి.'),
  ('we_missed_you', 'en', 'Hello {{1}}, we missed you at {{2}}. Would you like to fix a new time for your {{3}}? Reply here and we will help.', 'Hello {{1}}, we missed you at {{2}}. Would you like to fix a new time for your {{3}}? Reply here and we will help. Reply STOP to unsubscribe.'),
  ('we_missed_you', 'te', 'నమస్కారం {{1}} గారు! {{2}} లో మిమ్మల్ని మిస్ అయ్యాం. మీ {{3}} కి కొత్త టైమ్ పెట్టమంటారా? ఇక్కడే రిప్లై ఇవ్వండి.', 'నమస్కారం {{1}} గారు! మీ {{3}} కి మీరు రాలేకపోయారు. {{2}} లో కొత్త టైమ్ పెట్టమంటారా? ఇక్కడే రిప్లై ఇవ్వండి. వద్దనుకుంటే STOP అని పంపండి.')
) as v(name, language, old_body, new_body)
 where w.name = v.name and w.language = v.language and w.body = v.old_body and w.status = 'draft';
