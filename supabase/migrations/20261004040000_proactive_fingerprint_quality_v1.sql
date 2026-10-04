alter table aria_internal.proactive_digests add column if not exists fingerprint_algorithm text;
update aria_internal.proactive_digests
set fingerprint_algorithm=case when length(fingerprint)=32 then 'md5-legacy' else 'unknown-legacy' end
where fingerprint_algorithm is null;
alter table aria_internal.proactive_digests alter column fingerprint_algorithm set default 'sha256';
alter table aria_internal.proactive_digests alter column fingerprint_algorithm set not null;

alter table aria_internal.proactive_trends add column if not exists fingerprint_algorithm text;
update aria_internal.proactive_trends
set fingerprint_algorithm=case when length(fingerprint)=32 then 'md5-legacy' else 'unknown-legacy' end
where fingerprint_algorithm is null;
alter table aria_internal.proactive_trends alter column fingerprint_algorithm set default 'sha256';
alter table aria_internal.proactive_trends alter column fingerprint_algorithm set not null;