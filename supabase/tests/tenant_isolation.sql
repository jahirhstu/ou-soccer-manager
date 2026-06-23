begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select has_table('public', 'program_templates', 'program templates table exists');

insert into public.organizations(id, name, slug, public_reports_enabled) values
  ('10000000-0000-0000-0000-000000000001', 'Isolation A', 'isolation-a', true),
  ('10000000-0000-0000-0000-000000000002', 'Isolation B', 'isolation-b', false);

insert into public.organization_enabled_programs(organization_id, program_template_id, enabled)
select '10000000-0000-0000-0000-000000000001', id, true
from public.program_templates where key = 'soccer';

insert into public.programs(id, organization_id, program_template_id, name, slug, category, activity_type)
select
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  id,
  'Isolation Soccer',
  'soccer',
  'sport',
  'soccer'
from public.program_templates where key = 'soccer';

select throws_ok(
  $$insert into public.program_modules(organization_id, program_id, module_key)
    values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'attendance')$$,
  'Program does not belong to organization',
  'organization/program mismatch is rejected'
);

select throws_ok(
  $$insert into public.programs(organization_id, program_template_id, name, slug, category, activity_type)
    select '10000000-0000-0000-0000-000000000002', id, 'Disabled Soccer', 'soccer', 'sport', 'soccer'
    from public.program_templates where key = 'soccer'$$,
  'Program template is not enabled for this organization',
  'disabled templates cannot create programs'
);

select results_eq(
  $$select organization_id from public.resolve_enabled_public_scope('isolation-a', 'soccer')$$,
  $$values ('10000000-0000-0000-0000-000000000001'::uuid)$$,
  'public scope resolves only an enabled organization/program pair'
);

select * from finish();
rollback;
