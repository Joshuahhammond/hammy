-- Rebrand: default stylist brand color moves from teal to hammy taupe

alter table public.profiles alter column brand_color set default '#9b8570';

update public.profiles set brand_color = '#9b8570' where brand_color = '#0f766e';
