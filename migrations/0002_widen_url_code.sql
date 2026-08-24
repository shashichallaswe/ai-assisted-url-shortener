-- Custom aliases share urls.code with generated short codes.
-- Existing 7-character rows satisfy the widened checks.

alter table urls drop constraint urls_code_length;

alter table urls add constraint urls_code_length
  check (char_length(code) between 4 and 32);

alter table urls add constraint urls_code_charset
  check (code ~ '^[0-9A-Za-z_-]+$');
