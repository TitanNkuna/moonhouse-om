-- Default names for this deployment. Only replaces names still on the old placeholders.
alter table business alter column name set default 'MoonHouse';
alter table business alter column app_name set default 'OM Ledger';
update business set name = 'MoonHouse' where id = 1 and name = 'Your Business';
update business set app_name = 'OM Ledger' where id = 1 and app_name = 'Order Ledger';
