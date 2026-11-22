-- Shared kitchen ledger: one business, three roles, orders + invoices.

create table if not exists business (
  id int primary key default 1,
  name text not null default 'Your Business',
  app_name text not null default 'Order Ledger',
  vat_rate numeric not null default 0.15,
  delivery_fee_cents int not null default 2500,
  constraint business_one check (id = 1)
);

insert into business (id) values (1) on conflict (id) do nothing;

create table if not exists members (
  user_id text primary key,
  display_name text not null,
  role text not null check (role in ('manager', 'staff', 'delivery')),
  created_at timestamptz not null default now()
);

create table if not exists products (
  id serial primary key,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists shifts (
  id serial primary key,
  member_user_id text not null,
  shift_date date not null,
  starts_at text not null,
  ends_at text not null,
  note text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id serial primary key,
  order_no text not null unique,
  invoice_no text not null unique,
  client_name text not null,
  client_phone text not null default '',
  location text not null default '',
  fulfillment text not null check (fulfillment in ('delivery', 'pickup')),
  payment_method text not null check (payment_method in ('cash', 'card', 'eft', 'pay_on_delivery')),
  payment_status text not null check (payment_status in ('unpaid', 'paid')),
  delivery_status text not null check (delivery_status in ('na', 'out', 'delivered')),
  subtotal_cents int not null,
  vat_cents int not null,
  delivery_cents int not null,
  total_cents int not null,
  created_by text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  paid_at timestamptz
);

create index if not exists orders_created_idx on orders (created_at desc);

create table if not exists order_items (
  id serial primary key,
  order_id int not null references orders (id) on delete cascade,
  product_id int,
  name text not null,
  qty int not null check (qty > 0),
  unit_price_cents int not null
);

create table if not exists audit_log (
  id serial primary key,
  actor_id text not null,
  actor_name text not null,
  action text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_created_idx on audit_log (created_at desc);
