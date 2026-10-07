insert into public.departments (code, name) values
  ('CSE', 'Computer Science and Engineering'),
  ('IT', 'Information Technology'),
  ('ECE', 'Electronics and Computer Engineering'),
  ('EXTC', 'Electronics and Telecommunication'),
  ('MECH', 'Mechanical Engineering'),
  ('CIVIL', 'Civil Engineering'),
  ('ELECTRICAL', 'Electrical Engineering'),
  ('PROD', 'Production Engineering'),
  ('TEXTILE', 'Textile Engineering'),
  ('CHEMICAL', 'Chemical Engineering')
on conflict (code) do update set name = excluded.name;