-- Add missing tariff enum values.
-- Important: do not insert rows using newly added enum values in this same transaction.
-- PostgreSQL only allows using a newly added enum value after the ALTER TYPE transaction commits.

alter type public.tariff_action add value if not exists 'work_request_publication';
alter type public.tariff_action add value if not exists 'specialist_publication';
alter type public.tariff_action add value if not exists 'ad_marquee';
alter type public.tariff_action add value if not exists 'fair_participation';
