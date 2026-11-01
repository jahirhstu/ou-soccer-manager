begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select has_function(
  'public',
  'scoped_public_session_performance',
  array['text', 'text', 'uuid'],
  'session performance is exposed through the scoped public RPC'
);

select function_privs_are(
  'public',
  'scoped_public_session_performance',
  array['text', 'text', 'uuid'],
  'anon',
  array['EXECUTE'],
  'anonymous report readers can call the scoped RPC'
);

select function_privs_are(
  'public',
  'scoped_public_session_performance',
  array['text', 'text', 'uuid'],
  'authenticated',
  array['EXECUTE'],
  'authenticated report readers can call the scoped RPC'
);

select * from finish();
rollback;
