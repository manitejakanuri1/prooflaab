-- Rollback for 501: restore original 'Resume uploaded' step in tpo_student_profile
begin;
set timezone to 'Asia/Kolkata';

do $$
declare
  def text := pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure);
begin
  if position('''step'', ''Resume file missing''' in def) > 0 then
    def := regexp_replace(
      def,
      'case when claim\.id is not null and claim\.storage_path not like ''interests:%'' then[\s\S]+?when claim\.id is not null then',
      'case when claim.id is not null and claim.storage_path not like ''interests:%'' then
        jsonb_build_object(''step'', ''Resume uploaded'', ''done'', true, ''at'', claim.created_at,
          ''detail'', concat_ws('' '' || chr(183) || '' '', ''resume score '' || claim.resume_quality_score, ''ATS '' || claim.ats_match_score,
                              case when claim.status <> ''confirmed'' and claim.confirmed_at is null then ''not confirmed yet'' end))
      when claim.id is not null then'
    );
    execute def;
  end if;
end $$;

do $$
begin
  if position('''step'', ''Resume file missing''' in pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure)) > 0 then
    raise exception '501 rollback self-check failed: Resume file missing still found in tpo_student_profile';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
