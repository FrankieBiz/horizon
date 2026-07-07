-- 003_biomarkers: panels + results. Stores THE LAB'S OWN reference range per
-- result (differentiator; FHIR Observation.referenceRange-aligned). Never
-- hardcode ranges.

create table biomarker_panels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  drawn_on date not null,
  lab_name text not null default '',
  source text not null default 'manual' check (source in ('manual', 'pdf_upload')),
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);
alter table biomarker_panels enable row level security;
create policy "own rows" on biomarker_panels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table biomarker_results (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid not null references biomarker_panels (id) on delete cascade,
  marker text not null,
  value double precision not null,
  unit text not null default '',
  ref_low double precision,
  ref_high double precision,
  lab_flag text
);
create index biomarker_results_panel on biomarker_results (panel_id);
alter table biomarker_results enable row level security;
create policy "own rows" on biomarker_results
  for all using (auth.uid() = (select user_id from biomarker_panels where id = panel_id))
  with check (auth.uid() = (select user_id from biomarker_panels where id = panel_id));
