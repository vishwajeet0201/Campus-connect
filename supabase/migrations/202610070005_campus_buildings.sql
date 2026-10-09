do $$ begin
  create type public.building_link_kind as enum ('outdoor_path', 'gate', 'bridge');
exception when duplicate_object then null; end $$;

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.buildings (code, name, sort_order)
values ('VJTI', 'VJTI main building', 0), ('MECH', 'Mechanical building', 1)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

alter table public.floors add column if not exists building_id uuid references public.buildings(id) on delete cascade;
alter table public.pois add column if not exists building_id uuid references public.buildings(id) on delete cascade;
alter table public.map_nodes add column if not exists connector_id text;

update public.floors
set building_id = (select id from public.buildings where code = 'VJTI')
where building_id is null;

alter table public.floors drop constraint if exists floors_code_key;
alter table public.floors alter column building_id set not null;
create unique index if not exists floors_building_code_key on public.floors(building_id, code);
create index if not exists floors_building_sort_idx on public.floors(building_id, sort_order);

update public.pois p
set building_id = f.building_id
from public.floors f
where p.floor_id = f.id and p.building_id is null;
alter table public.pois alter column building_id set not null;
create index if not exists pois_building_category_idx on public.pois(building_id, category_id);

create or replace function public.sync_poi_building()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select building_id into new.building_id from public.floors where id = new.floor_id;
  if new.building_id is null then
    raise exception 'POI floor must belong to a building.';
  end if;
  return new;
end;
$$;
drop trigger if exists pois_sync_building on public.pois;
create trigger pois_sync_building before insert or update of floor_id on public.pois
for each row execute function public.sync_poi_building();

create table if not exists public.building_links (
  id uuid primary key default gen_random_uuid(),
  from_node uuid not null references public.map_nodes(id) on delete cascade,
  to_node uuid not null references public.map_nodes(id) on delete cascade,
  distance_m numeric(9,2) not null check (distance_m > 0),
  is_step_free boolean not null default true,
  kind public.building_link_kind not null,
  label text,
  created_at timestamptz not null default now(),
  constraint building_links_distinct check (from_node <> to_node)
);

alter table public.buildings enable row level security;
alter table public.building_links enable row level security;
drop policy if exists "authenticated users can read buildings" on public.buildings;
create policy "authenticated users can read buildings" on public.buildings for select to authenticated using (true);
drop policy if exists "admins can manage buildings" on public.buildings;
create policy "admins can manage buildings" on public.buildings for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
drop policy if exists "authenticated users can read building links" on public.building_links;
create policy "authenticated users can read building links" on public.building_links for select to authenticated using (true);
drop policy if exists "admins can manage building links" on public.building_links;
create policy "admins can manage building links" on public.building_links for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create or replace function public.seed_phase5_buildings()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_building record;
  v_floor record;
  v_category uuid;
  v_node uuid;
  v_other_node uuid;
begin
  for v_building in select id, code from public.buildings order by sort_order loop
    for v_floor in
      select * from (values
        ('G', 'Ground Floor', 0),
        ('1', 'First Floor', 1),
        ('2', 'Second Floor', 2),
        ('3', 'Third Floor', 3),
        ('TPO', 'TPO', 4)
      ) as levels(code, name, sort_order)
      where v_building.code = 'MECH' or levels.code <> 'TPO'
    loop
      insert into public.floors (building_id, code, name, sort_order, svg_path, width, height)
      values (v_building.id, v_floor.code, v_floor.name, v_floor.sort_order,
        case when v_building.code = 'VJTI' and v_floor.code = 'G'
          then '/maps/vjti-ground-floor-1.jpg'
          else '/maps/' || lower(v_building.code) || '-' || v_floor.code || '.svg'
        end,
        case when v_building.code = 'VJTI' and v_floor.code = 'G' then 6072 else 1600 end,
        case when v_building.code = 'VJTI' and v_floor.code = 'G' then 1510 else 1000 end)
      on conflict (building_id, code) do update set name = excluded.name, sort_order = excluded.sort_order, svg_path = excluded.svg_path, width = excluded.width, height = excluded.height;

      insert into public.pois (floor_id, building_id, category_id, name, description, room_code, x, y, is_accessible)
      select f.id, f.building_id, c.id, initcap(c.name) || ' ' || v_floor.code || '-' || gs,
        'Placeholder ' || lower(c.name) || ' for map data', v_floor.code || '-' || lpad(gs::text, 3, '0'),
        180 + ((gs * 137) % 1180), 180 + ((gs * 89) % 620), true
      from public.floors f
      cross join generate_series(1, 15) gs
      join public.poi_categories c on c.code = case when gs = 1 then 'entrance' when gs in (2,3,4,5) then 'classroom' when gs in (6,7) then 'lab' when gs = 8 then 'library' when gs = 9 then 'office' when gs = 10 then 'canteen' when gs = 11 then 'stairs' when gs = 12 then 'lift' when gs = 13 then 'ramp' else 'other' end
      where f.building_id = v_building.id and f.code = v_floor.code
        and not exists (select 1 from public.pois p where p.floor_id = f.id and p.room_code = v_floor.code || '-' || lpad(gs::text, 3, '0'));

      insert into public.map_nodes (floor_id, x, y, kind, connector_id)
      select f.id, case when gs = 1 then 220 else 760 end, case when gs = 1 then 760 else 760 end,
        case when gs = 1 then 'entrance'::public.map_node_kind when gs = 2 then 'stairs'::public.map_node_kind when gs = 3 then 'lift'::public.map_node_kind else 'corridor'::public.map_node_kind end,
        case when gs = 2 then v_building.code || '-stairs-a' when gs = 3 then v_building.code || '-lift-a' else null end
      from public.floors f cross join generate_series(1, 3) gs
      where f.building_id = v_building.id and f.code = v_floor.code
        and not exists (select 1 from public.map_nodes n where n.floor_id = f.id and n.connector_id = case when gs = 2 then v_building.code || '-stairs-a' when gs = 3 then v_building.code || '-lift-a' else null end and n.kind = case when gs = 1 then 'entrance'::public.map_node_kind when gs = 2 then 'stairs'::public.map_node_kind when gs = 3 then 'lift'::public.map_node_kind else 'corridor'::public.map_node_kind end);
    end loop;
  end loop;

  select n.id into v_node from public.map_nodes n join public.floors f on f.id = n.floor_id join public.buildings b on b.id = f.building_id where b.code = 'VJTI' and f.code = 'G' and n.kind = 'entrance' order by n.created_at limit 1;
  select n.id into v_other_node from public.map_nodes n join public.floors f on f.id = n.floor_id join public.buildings b on b.id = f.building_id where b.code = 'MECH' and f.code = 'G' and n.kind = 'entrance' order by n.created_at limit 1;
  if v_node is not null and v_other_node is not null then
    insert into public.building_links (from_node, to_node, distance_m, is_step_free, kind, label)
    select v_node, v_other_node, 85, true, 'outdoor_path', 'VJTI exit to Mechanical building'
    where not exists (select 1 from public.building_links where (from_node = v_node and to_node = v_other_node) or (from_node = v_other_node and to_node = v_node));
  end if;
end;
$$;

select public.seed_phase5_buildings();
alter table public.floors drop constraint if exists floors_code_key;
