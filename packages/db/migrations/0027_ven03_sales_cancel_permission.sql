insert into permissions(id,code,module,description) values
  ('01992ea1-1250-7000-8000-000000000063','sales.cancel','sales','sales.cancel')
on conflict (code) do nothing;
