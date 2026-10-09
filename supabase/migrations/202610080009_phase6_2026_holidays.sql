insert into public.holidays (date, name, kind, created_by)
select v.date::date, v.name, 'national'::public.holiday_kind, p.id
from (values
  ('2026-01-26', 'Republic Day'),
  ('2026-02-15', 'Mahashivratri'),
  ('2026-02-19', 'Chhatrapati Shivaji Maharaj Jayanti'),
  ('2026-03-03', 'Holi (Second Day)'),
  ('2026-03-19', 'Gudhi Padwa'),
  ('2026-03-21', 'Ramzan Eid (Eid-ul-Fitr)'),
  ('2026-03-26', 'Ram Navami'),
  ('2026-03-31', 'Mahavir Janma Kalyanak'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-14', 'Dr. Babasaheb Ambedkar Jayanti'),
  ('2026-05-01', 'Maharashtra Day'),
  ('2026-05-02', 'Buddha Purnima'),
  ('2026-05-28', 'Bakri Eid (Eid-ul-Adha)'),
  ('2026-06-26', 'Muharram'),
  ('2026-08-15', 'Independence Day'),
  ('2026-08-15', 'Parsi New Year (Jamshedi Navroz)'),
  ('2026-08-26', 'Eid-e-Milad'),
  ('2026-09-14', 'Ganesh Chaturthi'),
  ('2026-10-02', 'Mahatma Gandhi Jayanti'),
  ('2026-10-20', 'Dussehra (Vijayadashami)'),
  ('2026-11-08', 'Diwali Amavasya (Lakshmi Pujan)'),
  ('2026-11-10', 'Diwali - Balipratipada'),
  ('2026-11-24', 'Gurunanak Jayanti'),
  ('2026-12-25', 'Christmas')
) as v(date, name)
cross join lateral (
  select id from public.profiles
  where role = 'admin'
  order by created_at
  limit 1
) p
on conflict (date, name) do update
set kind = excluded.kind;
