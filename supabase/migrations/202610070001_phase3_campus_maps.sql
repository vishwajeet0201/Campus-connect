create type public.map_node_kind as enum ('corridor', 'door', 'stairs', 'lift', 'ramp', 'entrance');
create type public.story_kind as enum ('student', 'committee', 'official');
create type public.story_media_type as enum ('image', 'video');

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  svg_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now()
);

create table public.poi_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  icon text not null,
  created_at timestamptz not null default now()
);

create table public.pois (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  category_id uuid not null references public.poi_categories(id) on delete restrict,
  name text not null,
  description text,
  room_code text,
  x numeric(9,2) not null,
  y numeric(9,2) not null,
  opening_hours text,
  is_accessible boolean not null default true,
  created_at timestamptz not null default now(),
  constraint pois_xy_check check (x >= 0 and y >= 0)
);

create table public.map_nodes (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  x numeric(9,2) not null,
  y numeric(9,2) not null,
  kind public.map_node_kind not null,
  poi_id uuid references public.pois(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint map_nodes_xy_check check (x >= 0 and y >= 0)
);

create table public.map_edges (
  id uuid primary key default gen_random_uuid(),
  from_node uuid not null references public.map_nodes(id) on delete cascade,
  to_node uuid not null references public.map_nodes(id) on delete cascade,
  weight numeric(9,2) not null default 1 check (weight > 0),
  is_step_free boolean not null default true,
  created_at timestamptz not null default now(),
  constraint map_edges_distinct check (from_node <> to_node)
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind public.story_kind not null,
  media_url text not null,
  media_type public.story_media_type not null,
  caption text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index floors_sort_order_idx on public.floors(sort_order asc);
create index pois_floor_category_idx on public.pois(floor_id, category_id);
create index pois_name_trgm_idx on public.pois using gin (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(room_code, '')));
create index map_nodes_floor_kind_idx on public.map_nodes(floor_id, kind);
create index stories_created_at_idx on public.stories(created_at desc);
create index stories_expires_at_idx on public.stories(expires_at);

create or replace function public.is_story_visible(story_row public.stories)
returns boolean
language sql
stable
set search_path = public
as $$
  select story_row.expires_at > now();
$$;

grant execute on function public.is_story_visible(public.stories) to authenticated;

create or replace function public.current_user_can_post_story()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('committee', 'admin')
        or (p.role = 'student' and current_setting('app.allow_student_stories', true)::boolean)
      )
  );
$$;

grant execute on function public.current_user_can_post_story() to authenticated;

create or replace function public.expire_stories()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.stories where expires_at <= now();
end;
$$;

grant execute on function public.expire_stories() to authenticated;

alter table public.floors enable row level security;
alter table public.poi_categories enable row level security;
alter table public.pois enable row level security;
alter table public.map_nodes enable row level security;
alter table public.map_edges enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.reports enable row level security;

create policy "authenticated users can read map floors"
on public.floors for select to authenticated using (true);
create policy "admins can manage floors"
on public.floors for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "authenticated users can read poi categories"
on public.poi_categories for select to authenticated using (true);
create policy "admins can manage poi categories"
on public.poi_categories for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "authenticated users can read pois"
on public.pois for select to authenticated using (true);
create policy "admins can manage pois"
on public.pois for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "authenticated users can read map nodes"
on public.map_nodes for select to authenticated using (true);
create policy "admins can manage map nodes"
on public.map_nodes for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "authenticated users can read map edges"
on public.map_edges for select to authenticated using (true);
create policy "admins can manage map edges"
on public.map_edges for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy "authenticated users can read active stories"
on public.stories for select to authenticated using (expires_at > now());
create policy "committee/admin can insert stories"
on public.stories for insert to authenticated with check (
  public.current_user_is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'committee')
);
create policy "students can insert stories when allowed"
on public.stories for insert to authenticated with check (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'student')
  and current_setting('app.allow_student_stories', true)::boolean
);
create policy "users can delete their own stories"
on public.stories for delete to authenticated using (author_id = auth.uid());
create policy "users can insert story views" 
on public.story_views for insert to authenticated with check (viewer_id = auth.uid());
create policy "authenticated users can read story views"
on public.story_views for select to authenticated using (true);
create policy "users can delete own story view"
on public.story_views for delete to authenticated using (viewer_id = auth.uid());

create policy "authenticated users can read reports"
on public.reports for select to authenticated using (true);
create policy "authenticated users can insert reports"
on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "admins can manage reports"
on public.reports for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "authenticated users can read stories bucket"
on storage.objects for select to authenticated using (bucket_id = 'stories');
create policy "users can upload story media in own folder"
on storage.objects for insert to authenticated with check (
  bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text and (storage.extension(name) is not null)
);
create policy "users can update their own story media"
on storage.objects for update to authenticated using (
  bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "users can delete their own story media"
on storage.objects for delete to authenticated using (
  bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text
);

insert into public.poi_categories (code, name, icon)
values
  ('classroom', 'Classroom', 'classroom'),
  ('lab', 'Lab', 'lab'),
  ('conference', 'Conference', 'conference'),
  ('staff_room', 'Staff Room', 'staff_room'),
  ('toilet_men', 'Men''s Toilet', 'toilet_men'),
  ('toilet_women', 'Women''s Toilet', 'toilet_women'),
  ('canteen', 'Canteen', 'canteen'),
  ('library', 'Library', 'library'),
  ('office', 'Office', 'office'),
  ('entrance', 'Entrance', 'entrance'),
  ('stairs', 'Stairs', 'stairs'),
  ('lift', 'Lift', 'lift'),
  ('ramp', 'Ramp', 'ramp'),
  ('other', 'Other', 'other')
on conflict (code) do nothing;

insert into public.floors (code, name, sort_order, svg_path, width, height)
values
  ('G', 'Ground Floor', 0, '/maps/floor-G.svg', 1600, 1000),
  ('1', 'First Floor', 1, '/maps/floor-1.svg', 1600, 1000),
  ('2', 'Second Floor', 2, '/maps/floor-2.svg', 1600, 1000)
on conflict (code) do nothing;

create extension if not exists pgcrypto;

create or replace function public.seed_phase3_sample_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  floor_g uuid;
  floor_1 uuid;
  floor_2 uuid;
  cat_classroom uuid;
  cat_lab uuid;
  cat_conference uuid;
  cat_staff_room uuid;
  cat_toilet_men uuid;
  cat_toilet_women uuid;
  cat_canteen uuid;
  cat_library uuid;
  cat_office uuid;
  cat_entrance uuid;
  cat_stairs uuid;
  cat_lift uuid;
  cat_ramp uuid;
  cat_other uuid;
begin
  select id into floor_g from public.floors where code = 'G';
  select id into floor_1 from public.floors where code = '1';
  select id into floor_2 from public.floors where code = '2';

  select id into cat_classroom from public.poi_categories where code = 'classroom';
  select id into cat_lab from public.poi_categories where code = 'lab';
  select id into cat_conference from public.poi_categories where code = 'conference';
  select id into cat_staff_room from public.poi_categories where code = 'staff_room';
  select id into cat_toilet_men from public.poi_categories where code = 'toilet_men';
  select id into cat_toilet_women from public.poi_categories where code = 'toilet_women';
  select id into cat_canteen from public.poi_categories where code = 'canteen';
  select id into cat_library from public.poi_categories where code = 'library';
  select id into cat_office from public.poi_categories where code = 'office';
  select id into cat_entrance from public.poi_categories where code = 'entrance';
  select id into cat_stairs from public.poi_categories where code = 'stairs';
  select id into cat_lift from public.poi_categories where code = 'lift';
  select id into cat_ramp from public.poi_categories where code = 'ramp';
  select id into cat_other from public.poi_categories where code = 'other';

  insert into public.pois (floor_id, category_id, name, description, room_code, x, y, opening_hours, is_accessible)
  values
    (floor_g, cat_entrance, 'Main Entrance', 'Campus entrance and visitor check-in', 'G-01', 240, 760, '08:00-18:00', true),
    (floor_g, cat_office, 'Admissions Office', 'Student support and admissions desk', 'G-02', 500, 700, '09:00-17:00', true),
    (floor_g, cat_library, 'Library Annex', 'Study hall and reading lounge', 'G-03', 820, 440, '08:30-18:30', true),
    (floor_g, cat_canteen, 'Cafeteria', 'Main canteen and snack stall', 'G-04', 1120, 320, '09:00-20:00', true),
    (floor_g, cat_stairs, 'North Stairwell', 'Vertical access', 'G-05', 660, 600, null, true),
    (floor_g, cat_lift, 'Lift Lobby A', 'Accessible lift', 'G-06', 760, 610, null, true),
    (floor_g, cat_ramp, 'Barrier-free Route', 'Accessible ramp', 'G-07', 920, 740, null, true),
    (floor_g, cat_classroom, 'Room G-101', 'Lecture room', 'G-101', 360, 500, '08:00-17:00', true),
    (floor_g, cat_classroom, 'Room G-102', 'Seminar hall', 'G-102', 500, 500, '08:00-17:00', true),
    (floor_g, cat_classroom, 'Room G-103', 'Computer lab support room', 'G-103', 650, 500, '09:00-18:00', true),
    (floor_g, cat_classroom, 'Room G-104', 'Tutorial room', 'G-104', 820, 500, '08:00-18:00', true),
    (floor_g, cat_lab, 'Electronics Lab', 'Circuit design and robotics lab', 'G-201', 350, 300, '09:00-18:00', true),
    (floor_g, cat_lab, 'Workshop Bay', 'Mechanical workshop', 'G-202', 520, 250, '09:00-17:30', true),
    (floor_g, cat_conference, 'Conference Room', 'Boardroom and meetings', 'G-301', 980, 500, '08:00-18:00', true),
    (floor_g, cat_staff_room, 'Faculty Office', 'Department faculty room', 'G-302', 1080, 500, '09:00-17:00', true),
    (floor_g, cat_toilet_men, 'Men''s Toilet', 'Ground floor washroom', 'G-401', 1100, 690, '06:00-22:00', true),
    (floor_g, cat_toilet_women, 'Women''s Toilet', 'Ground floor washroom', 'G-402', 1210, 690, '06:00-22:00', true),
    (floor_g, cat_other, 'Student Services Desk', 'Administrative help desk', 'G-403', 360, 760, '09:00-17:00', true),
    (floor_g, cat_other, 'Security Desk', 'Campus security', 'G-404', 1300, 760, '24/7', true),
    (floor_g, cat_other, 'Bicycle Stand', 'Cycle parking', 'G-405', 1300, 250, '06:00-22:00', true),
    (floor_1, cat_entrance, 'North Entrance', 'First-floor entry plaza', '1-01', 300, 730, '08:00-18:00', true),
    (floor_1, cat_classroom, 'Room 101', 'Lecture hall', '1-101', 430, 520, '08:00-17:00', true),
    (floor_1, cat_classroom, 'Room 102', 'Tutorial block', '1-102', 570, 520, '08:00-17:00', true),
    (floor_1, cat_classroom, 'Room 103', 'Applied mathematics classroom', '1-103', 710, 520, '08:00-17:00', true),
    (floor_1, cat_classroom, 'Room 104', 'Design studio room', '1-104', 930, 520, '08:00-17:00', true),
    (floor_1, cat_lab, 'Physics Lab', 'Experiments and instruments', '1-201', 420, 280, '09:00-17:00', true),
    (floor_1, cat_lab, 'Chemistry Lab', 'Research and practical work', '1-202', 650, 280, '09:00-17:00', true),
    (floor_1, cat_conference, 'Seminar Hall', 'Guest lectures and events', '1-301', 990, 310, '09:00-18:00', true),
    (floor_1, cat_library, 'Reading Lounge', 'Quiet study area', '1-302', 1120, 430, '09:00-18:00', true),
    (floor_1, cat_staff_room, 'Department Office', 'Faculty and staff', '1-303', 1050, 700, '09:00-17:00', true),
    (floor_1, cat_toilet_men, 'Men''s Toilet', 'First floor men’s toilet', '1-401', 1180, 250, '06:00-22:00', true),
    (floor_1, cat_toilet_women, 'Women''s Toilet', 'First floor women’s toilet', '1-402', 1280, 250, '06:00-22:00', true),
    (floor_1, cat_stairs, 'West Stairwell', 'Access to upper levels', '1-501', 740, 740, null, true),
    (floor_1, cat_lift, 'Lift Lobby B', 'Accessible elevator', '1-502', 810, 760, null, true),
    (floor_1, cat_ramp, 'Accessible Ramp', 'Wheelchair route', '1-503', 920, 760, null, true),
    (floor_2, cat_classroom, 'Room 201', 'Engineering drawing studio', '2-101', 420, 540, '08:00-17:00', true),
    (floor_2, cat_classroom, 'Room 202', 'Project room', '2-102', 580, 540, '08:00-17:00', true),
    (floor_2, cat_classroom, 'Room 203', 'Senior design studio', '2-103', 730, 540, '08:00-17:00', true),
    (floor_2, cat_classroom, 'Room 204', 'Computer lab', '2-104', 960, 540, '08:00-17:00', true),
    (floor_2, cat_lab, 'Innovation Lab', 'Prototype and fabrication lab', '2-201', 420, 260, '09:00-17:30', true),
    (floor_2, cat_lab, 'Research Lab', 'Applied research and testing', '2-202', 690, 260, '09:00-17:30', true),
    (floor_2, cat_conference, 'Boardroom', 'A/V enabled meeting room', '2-301', 1000, 320, '09:00-18:00', true),
    (floor_2, cat_library, 'Archives', 'Reference resources', '2-302', 1110, 420, '09:00-17:00', true),
    (floor_2, cat_office, 'Student Council Office', 'Campus leadership office', '2-303', 980, 700, '09:00-17:00', true),
    (floor_2, cat_toilet_men, 'Men''s Toilet', 'Upper floor washroom', '2-401', 1170, 250, '06:00-22:00', true),
    (floor_2, cat_toilet_women, 'Women''s Toilet', 'Upper floor washroom', '2-402', 1290, 250, '06:00-22:00', true),
    (floor_2, cat_stairs, 'East Stairwell', 'Upper floor connection', '2-501', 760, 760, null, true),
    (floor_2, cat_lift, 'Lift Lobby C', 'Accessible lift', '2-502', 870, 760, null, true),
    (floor_2, cat_ramp, 'Accessible Route', 'Ramp to common area', '2-503', 960, 760, null, true),
    (floor_2, cat_entrance, 'South Entrance', 'Upper campus access', '2-601', 250, 760, '08:00-18:00', true)
  on conflict do nothing;

  insert into public.map_nodes (floor_id, x, y, kind, poi_id)
  values
    (floor_g, 220, 760, 'entrance', null),
    (floor_g, 360, 760, 'door', null),
    (floor_g, 500, 700, 'door', null),
    (floor_g, 660, 600, 'stairs', null),
    (floor_g, 760, 610, 'lift', null),
    (floor_g, 920, 740, 'ramp', null),
    (floor_g, 1120, 320, 'door', null),
    (floor_1, 300, 730, 'entrance', null),
    (floor_1, 740, 740, 'stairs', null),
    (floor_1, 810, 760, 'lift', null),
    (floor_1, 920, 760, 'ramp', null),
    (floor_2, 250, 760, 'entrance', null),
    (floor_2, 760, 760, 'stairs', null),
    (floor_2, 870, 760, 'lift', null),
    (floor_2, 960, 760, 'ramp', null)
  on conflict do nothing;

  insert into public.map_edges (from_node, to_node, weight, is_step_free)
  select n1.id, n2.id, 1.0, true
  from public.map_nodes n1
  join public.map_nodes n2 on n1.floor_id = n2.floor_id and n1.id <> n2.id
  where n1.floor_id = floor_g and n1.x between 220 and 760 and n2.x between 220 and 760
  limit 1;

  insert into public.map_edges (from_node, to_node, weight, is_step_free)
  values
    ((select id from public.map_nodes where floor_id = floor_g and x = 220 and y = 760), (select id from public.map_nodes where floor_id = floor_g and x = 360 and y = 760), 1.5, true),
    ((select id from public.map_nodes where floor_id = floor_g and x = 360 and y = 760), (select id from public.map_nodes where floor_id = floor_g and x = 500 and y = 700), 1.2, true),
    ((select id from public.map_nodes where floor_id = floor_g and x = 500 and y = 700), (select id from public.map_nodes where floor_id = floor_g and x = 660 and y = 600), 1.8, true),
    ((select id from public.map_nodes where floor_id = floor_g and x = 660 and y = 600), (select id from public.map_nodes where floor_id = floor_g and x = 760 and y = 610), 1.0, true),
    ((select id from public.map_nodes where floor_id = floor_g and x = 760 and y = 610), (select id from public.map_nodes where floor_id = floor_g and x = 920 and y = 740), 2.0, true),
    ((select id from public.map_nodes where floor_id = floor_g and x = 500 and y = 700), (select id from public.map_nodes where floor_id = floor_g and x = 1120 and y = 320), 3.0, true),
    ((select id from public.map_nodes where floor_id = floor_1 and x = 300 and y = 730), (select id from public.map_nodes where floor_id = floor_1 and x = 740 and y = 740), 1.7, true),
    ((select id from public.map_nodes where floor_id = floor_1 and x = 740 and y = 740), (select id from public.map_nodes where floor_id = floor_1 and x = 810 and y = 760), 1.0, true),
    ((select id from public.map_nodes where floor_id = floor_1 and x = 810 and y = 760), (select id from public.map_nodes where floor_id = floor_1 and x = 920 and y = 760), 1.1, true),
    ((select id from public.map_nodes where floor_id = floor_2 and x = 250 and y = 760), (select id from public.map_nodes where floor_id = floor_2 and x = 760 and y = 760), 1.8, true),
    ((select id from public.map_nodes where floor_id = floor_2 and x = 760 and y = 760), (select id from public.map_nodes where floor_id = floor_2 and x = 870 and y = 760), 1.1, true),
    ((select id from public.map_nodes where floor_id = floor_2 and x = 870 and y = 760), (select id from public.map_nodes where floor_id = floor_2 and x = 960 and y = 760), 1.0, true)
on conflict do nothing;
end;
$$;

select public.seed_phase3_sample_data();

create policy "admins and committee can read reports and stories"
on public.reports for select to authenticated using (public.current_user_is_admin() or exists (select 1 from public.profiles where id = auth.uid() and role = 'committee'));
