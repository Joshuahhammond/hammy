export type Profile = {
  id: string;
  full_name: string;
  business_name: string;
  brand_color: string;
  created_at: string;
};

export type Client = {
  id: string;
  stylist_id: string;
  name: string;
  email: string;
  notes: string;
  created_at: string;
};

export type Item = {
  id: string;
  stylist_id: string;
  name: string;
  brand: string;
  category: string;
  price_cents: number | null;
  product_url: string;
  image_url: string;
  color_hex: string;
  hue: number;
  saturation: number;
  lightness: number;
  created_at: string;
};

export type WardrobeItem = {
  id: string;
  client_id: string;
  stylist_id: string;
  name: string;
  brand: string;
  category: string;
  color_hex: string;
  hue: number;
  saturation: number;
  lightness: number;
  image_url: string;
  notes: string;
  created_at: string;
};

export type Lookbook = {
  id: string;
  stylist_id: string;
  client_id: string | null;
  title: string;
  description: string;
  share_token: string;
  status: string; // 'ready' | 'generating' | 'error'
  created_at: string;
};

export type LookbookItem = {
  id: string;
  lookbook_id: string;
  item_id: string;
  note: string;
  position: number;
};

export type SharedLookbook = {
  id: string;
  title: string;
  description: string;
  created_at: string;
  client_name: string | null;
  stylist: {
    full_name: string;
    business_name: string;
    brand_color: string;
  };
  items: Array<{
    id: string;
    note: string;
    position: number;
    look_no: number;
    name: string;
    brand: string;
    category: string;
    price_cents: number | null;
    product_url: string;
    image_url: string;
    color_hex: string;
  }>;
};

export const CATEGORIES = [
  "tops",
  "bottoms",
  "dresses",
  "outerwear",
  "shoes",
  "accessories",
  "other",
] as const;
