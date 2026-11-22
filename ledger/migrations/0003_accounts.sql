-- Accounts, invoice details and delivery tracking.

alter table members add column if not exists active boolean not null default true;

alter table business add column if not exists vat_number text not null default '';
alter table business add column if not exists address text not null default '';
alter table business add column if not exists phone text not null default '';

-- Keep the VAT rate used on each invoice so old invoices never change when the rate does.
alter table orders add column if not exists vat_rate numeric not null default 0.15;
alter table orders add column if not exists delivered_by_name text;

-- Username + password sign-in (Better Auth "username" plugin columns).
alter table "user" add column if not exists "username" text;
alter table "user" add column if not exists "displayUsername" text;
create unique index if not exists "user_username_key" on "user" ("username");
