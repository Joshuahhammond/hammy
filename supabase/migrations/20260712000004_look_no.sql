-- Outfit grouping within a lookbook: items tagged with their look number

alter table public.lookbook_items
  add column if not exists look_no integer not null default 0;

-- Refresh the public share RPC to carry look_no
create or replace function public.get_lookbook_by_token(p_token text)
returns jsonb
language sql
security definer set search_path = public
stable
as $$
  select jsonb_build_object(
    'id', l.id,
    'title', l.title,
    'description', l.description,
    'created_at', l.created_at,
    'client_name', c.name,
    'stylist', jsonb_build_object(
      'full_name', p.full_name,
      'business_name', p.business_name,
      'brand_color', p.brand_color
    ),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', li.id,
            'note', li.note,
            'position', li.position,
            'look_no', li.look_no,
            'name', i.name,
            'brand', i.brand,
            'category', i.category,
            'price_cents', i.price_cents,
            'product_url', i.product_url,
            'image_url', i.image_url,
            'color_hex', i.color_hex
          ) order by li.look_no, li.position, li.id
        )
        from public.lookbook_items li
        join public.items i on i.id = li.item_id
        where li.lookbook_id = l.id
      ),
      '[]'::jsonb
    )
  )
  from public.lookbooks l
  join public.profiles p on p.id = l.stylist_id
  left join public.clients c on c.id = l.client_id
  where l.share_token = p_token
    and l.status = 'ready';
$$;
