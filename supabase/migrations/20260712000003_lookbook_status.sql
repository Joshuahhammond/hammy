-- Async lookbook generation: track job state on the lookbook itself

alter table public.lookbooks
  add column if not exists status text not null default 'ready';
