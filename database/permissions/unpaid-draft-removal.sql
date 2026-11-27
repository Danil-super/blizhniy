-- Pair with candidate 0070. Existing table privileges stay as installed.
grant execute on function app.remove_unpaid_draft(text,uuid,text,uuid,bigint,boolean) to blizhniy_runtime;
