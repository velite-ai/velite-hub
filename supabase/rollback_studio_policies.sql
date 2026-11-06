-- Restores Compliance Studio's original "any authenticated user" rules.
-- Only run this if the Studio app misbehaves after 6 Nov 2026. It re-opens Studio data to Hub users.
alter policy "Authenticated users can update checks" on public.checks using (auth.role() = 'authenticated');
alter policy "Authenticated users can insert checks" on public.checks with check (auth.role() = 'authenticated');
alter policy "Authenticated users can view all checks" on public.checks using (auth.role() = 'authenticated');
alter policy "export_regulations_read" on public.export_regulations using (auth.role() = 'authenticated');
alter policy "export_regulations_update" on public.export_regulations using (auth.role() = 'authenticated');
alter policy "export_regulations_write" on public.export_regulations with check (auth.role() = 'authenticated');
alter policy "internal_guidelines_read" on public.internal_guidelines using (auth.role() = 'authenticated');
alter policy "Authenticated users can manage style rules" on public.style_rules using (auth.role() = 'authenticated');
alter policy "Users can view all profiles" on public.profiles using (auth.role() = 'authenticated');
alter policy "Authenticated users can upload labels" on storage.objects with check (bucket_id = 'labels' and auth.role() = 'authenticated');
alter policy "Authenticated users can read labels" on storage.objects using (bucket_id = 'labels' and auth.role() = 'authenticated');
alter policy "Authenticated users can delete labels" on storage.objects using (bucket_id = 'labels' and auth.role() = 'authenticated');
alter policy "reports_auth_all i3p58f_0" on storage.objects using (bucket_id = 'reports');
alter policy "reports_auth_all i3p58f_1" on storage.objects with check (bucket_id = 'reports');
alter policy "reports_auth_all i3p58f_2" on storage.objects using (bucket_id = 'reports');
alter policy "reports_auth_all i3p58f_3" on storage.objects using (bucket_id = 'reports');
alter policy "guidelines_auth_all 19zhqb_0" on storage.objects using (bucket_id = 'guidelines');
alter policy "guidelines_auth_all 19zhqb_1" on storage.objects with check (bucket_id = 'guidelines');
alter policy "guidelines_auth_all 19zhqb_2" on storage.objects using (bucket_id = 'guidelines');
alter policy "guidelines_auth_all 19zhqb_3" on storage.objects using (bucket_id = 'guidelines');
alter policy "assets_auth_all 1bqp9qb_0" on storage.objects using (bucket_id = 'assets');
alter policy "assets_auth_all 1bqp9qb_1" on storage.objects with check (bucket_id = 'assets');
alter policy "assets_auth_all 1bqp9qb_2" on storage.objects using (bucket_id = 'assets');
alter policy "assets_auth_all 1bqp9qb_3" on storage.objects using (bucket_id = 'assets');
