-- Umsatzbuch: Tabellen und Zugriffsregeln.
-- Einmal im Supabase-Dashboard unter "SQL Editor" einfügen und auf "Run" klicken.
-- Jeder angemeldete Nutzer sieht und ändert ausschließlich seine eigenen Zeilen.

create table if not exists public.zbons (
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  datum          date        not null,
  uhrzeit        text,
  z_nr           integer,
  umsatz         numeric(12,2),
  bar            numeric(12,2),
  bar_anzahl     integer,
  kredit         numeric(12,2),
  kredit_anzahl  integer,
  kunden         integer,
  netto          numeric(12,2),
  mwst           numeric(12,2),
  storno         numeric(12,2),
  storno_anzahl  integer,
  gt1            numeric(14,2),
  warengruppen   jsonb       not null default '[]'::jsonb,
  quelle         text,
  aktualisiert   timestamptz not null default now(),
  primary key (user_id, datum)
);

create table if not exists public.einstellungen (
  user_id        uuid        primary key default auth.uid() references auth.users(id) on delete cascade,
  ziele          jsonb       not null default '{}'::jsonb,
  standard_ziel  numeric(12,2)
);

alter table public.zbons enable row level security;
alter table public.einstellungen enable row level security;

drop policy if exists "eigene_zbons" on public.zbons;
create policy "eigene_zbons" on public.zbons
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "eigene_einstellungen" on public.einstellungen;
create policy "eigene_einstellungen" on public.einstellungen
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Live-Abgleich zwischen Geräten
do $$
begin
  begin alter publication supabase_realtime add table public.zbons; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.einstellungen; exception when duplicate_object then null; end;
end $$;
