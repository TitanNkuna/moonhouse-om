import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

type Role = "manager" | "staff" | "delivery";
type Member = { userId: string; displayName: string; role: Role };

const TIMEZONE = process.env.BUSINESS_TIMEZONE?.trim() || "Africa/Johannesburg";

const SEED = [
  ["Kota", 4500],
  ["Quarter chicken", 6500],
  ["Chips", 1800],
  ["Burger", 5500],
  ["Cold drink", 1500],
] as const;

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username needs at least 3 characters")
  .max(30)
  .regex(/^[a-zA-Z0-9_.]+$/, "Username can only use letters, numbers, _ and .");
const passwordSchema = z.string().min(8, "Password needs at least 8 characters").max(128);

function assertRole(role: Role, allowed: Role[]) {
  if (!allowed.includes(role)) throw new Error("You do not have access to do this.");
}

/** The signed-in person's team record. Accounts are never auto-created here. */
async function actor(userId: string): Promise<Member> {
  const sql = await getSql();
  const found = await sql<{ user_id: string; display_name: string; role: Role; active: boolean }>`
    select user_id, display_name, role, active from members where user_id = ${userId}
  `;
  const row = found[0];
  if (!row || !row.active) {
    throw new Error("Your account is not active on this team. Ask your manager.");
  }
  return { userId: row.user_id, displayName: row.display_name, role: row.role };
}

async function log(member: Member, action: string, detail: string) {
  const sql = await getSql();
  await sql`
    insert into audit_log (actor_id, actor_name, action, detail)
    values (${member.userId}, ${member.displayName}, ${action}, ${detail})
  `;
}

const pad = (n: number) => String(n).padStart(4, "0");
const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;

async function createLogin(name: string, username: string, password: string) {
  const { auth, emailForUsername } = await import("@/lib/auth/server");
  const ctx = await auth.$context;
  const taken = await ctx.internalAdapter.findUserByEmail(emailForUsername(username));
  if (taken) throw new Error("That username is already taken.");
  const hash = await ctx.password.hash(password);
  const user = await ctx.internalAdapter.createUser({
    email: emailForUsername(username),
    name,
    emailVerified: true,
    username: username.toLowerCase(),
    displayUsername: username,
  } as never);
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  } as never);
  return user.id as string;
}

async function deleteLogin(userId: string) {
  const sql = await getSql();
  await sql`delete from "user" where id = ${userId}`;
}

// ───────────────────────── First-run setup (public) ─────────────────────────

export const getSetupState = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const n = await sql<{ n: number }>`select count(*)::int as n from members`;
  const biz = await sql<{ name: string; app_name: string }>`select name, app_name from business where id = 1`;
  return {
    needsSetup: (n[0]?.n ?? 0) === 0,
    appName: biz[0]?.app_name ?? "OM Ledger",
    businessName: biz[0]?.name ?? "MoonHouse",
  };
});

/** Creates the first account (the manager). Refuses once any team member exists. */
export const setupManager = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(60),
        username: usernameSchema,
        password: passwordSchema,
        businessName: z.string().trim().min(1).max(80),
        appName: z.string().trim().min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const existing = await sql<{ n: number }>`select count(*)::int as n from members`;
    if ((existing[0]?.n ?? 0) > 0) throw new Error("Setup is already done. Sign in instead.");
    const userId = await createLogin(data.name, data.username, data.password);
    // Atomic claim: only succeeds while the team is still empty.
    const claimed = await sql<{ user_id: string }>`
      insert into members (user_id, display_name, role)
      select ${userId}, ${data.name}, 'manager'
      where not exists (select 1 from members)
      returning user_id
    `;
    if (!claimed[0]) {
      await deleteLogin(userId);
      throw new Error("Setup is already done. Sign in instead.");
    }
    await sql`update business set name = ${data.businessName}, app_name = ${data.appName} where id = 1`;
    const products = await sql<{ n: number }>`select count(*)::int as n from products`;
    if ((products[0]?.n ?? 0) === 0) {
      for (const [name, price] of SEED) {
        await sql`insert into products (name, price_cents) values (${name}, ${price})`;
      }
    }
    await log(
      { userId, displayName: data.name, role: "manager" },
      "member.joined",
      `${data.name} set up the business as manager`,
    );
    return { ok: true };
  });

// ───────────────────────────── Workspace data ─────────────────────────────

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    const isManager = me.role === "manager";

    const biz = await sql<{
      name: string;
      app_name: string;
      vat_rate: string;
      delivery_fee_cents: number;
      vat_number: string;
      address: string;
      phone: string;
    }>`select name, app_name, vat_rate::text as vat_rate, delivery_fee_cents, vat_number, address, phone
       from business where id = 1`;
    const window = await sql<{ day_start: string; day_end: string }>`
      select
        (date_trunc('day', now() at time zone ${TIMEZONE}::text) at time zone ${TIMEZONE}::text)::timestamptz::text as day_start,
        ((date_trunc('day', now() at time zone ${TIMEZONE}::text) + interval '1 day') at time zone ${TIMEZONE}::text)::timestamptz::text as day_end
    `;
    const products =
      me.role === "delivery"
        ? []
        : await sql<{ id: number; name: string; price_cents: number; active: boolean }>`
            select id, name, price_cents, active from products order by active desc, name
          `;

    type OrderRow = {
      id: number;
      order_no: string;
      invoice_no: string;
      client_name: string;
      client_phone: string;
      location: string;
      fulfillment: string;
      payment_method: string;
      payment_status: string;
      delivery_status: string;
      subtotal_cents: number;
      vat_cents: number;
      vat_rate: string;
      delivery_cents: number;
      total_cents: number;
      created_by: string;
      created_by_name: string;
      created_at: string;
    };
    const cols = `id, order_no, invoice_no, client_name, client_phone, location, fulfillment,
      payment_method, payment_status, delivery_status, subtotal_cents, vat_cents, vat_rate::text as vat_rate,
      delivery_cents, total_cents, created_by, created_by_name, created_at::text as created_at`;
    const orders =
      me.role === "delivery"
        ? await sql.query<OrderRow>(
            `select ${cols} from orders
             where fulfillment = 'delivery'
               and (delivery_status <> 'delivered' or payment_status = 'unpaid' or created_at >= now() - interval '2 days')
             order by created_at desc limit 100`,
          )
        : await sql.query<OrderRow>(`select ${cols} from orders order by created_at desc limit 300`);

    const items = orders.length
      ? await sql<{ order_id: number; name: string; qty: number; unit_price_cents: number }>`
          select order_id, name, qty, unit_price_cents from order_items
          where order_id = any(${orders.map((o) => o.id)}::int[])
          order by id
        `
      : [];

    const members = isManager
      ? await sql<{ user_id: string; display_name: string; role: Role; active: boolean; username: string | null }>`
          select m.user_id, m.display_name, m.role, m.active, u."username" as username
          from members m left join "user" u on u.id = m.user_id
          order by m.created_at
        `
      : [];
    const shifts = isManager
      ? await sql<{
          id: number;
          member_user_id: string;
          shift_date: string;
          starts_at: string;
          ends_at: string;
          note: string;
        }>`select id, member_user_id, shift_date::text as shift_date, starts_at, ends_at, note
           from shifts order by shift_date desc, starts_at limit 80`
      : [];
    const audit = isManager
      ? await sql<{ id: number; actor_name: string; action: string; detail: string; created_at: string }>`
          select id, actor_name, action, detail, created_at::text as created_at
          from audit_log order by created_at desc limit 150
        `
      : [];

    return {
      me,
      timezone: TIMEZONE,
      dayStart: window[0].day_start,
      dayEnd: window[0].day_end,
      business: biz[0] ?? {
        name: "MoonHouse",
        app_name: "OM Ledger",
        vat_rate: "0.15",
        delivery_fee_cents: 2500,
        vat_number: "",
        address: "",
        phone: "",
      },
      products,
      orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })),
      members,
      shifts,
      audit,
    };
  });

// ──────────────────────────────── Orders ────────────────────────────────

export const createOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        clientName: z.string().trim().min(1).max(80),
        clientPhone: z.string().trim().max(40).default(""),
        location: z.string().trim().max(160).default(""),
        fulfillment: z.enum(["delivery", "pickup"]),
        paymentMethod: z.enum(["cash", "card", "eft", "pay_on_delivery"]),
        items: z
          .array(z.object({ productId: z.number().int(), qty: z.number().int().min(1).max(99) }))
          .min(1)
          .max(40),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["staff", "manager"]);
    if (data.fulfillment === "delivery" && !data.location) throw new Error("Delivery needs a location.");
    if (data.paymentMethod === "pay_on_delivery" && data.fulfillment !== "delivery") {
      throw new Error("Pay on delivery only works for delivery orders.");
    }

    const biz = await sql<{ vat_rate: string; delivery_fee_cents: number }>`
      select vat_rate::text as vat_rate, delivery_fee_cents from business where id = 1
    `;
    const vatRate = Number(biz[0]?.vat_rate ?? 0.15);
    const fee = biz[0]?.delivery_fee_cents ?? 2500;

    // Merge duplicate lines, then price from the database (never from the client).
    const qtyById = new Map<number, number>();
    for (const i of data.items) qtyById.set(i.productId, (qtyById.get(i.productId) ?? 0) + i.qty);
    const ids = [...qtyById.keys()];
    const products = await sql<{ id: number; name: string; price_cents: number; active: boolean }>`
      select id, name, price_cents, active from products where id = any(${ids}::int[])
    `;
    const lines = ids.map((id) => {
      const p = products.find((x) => x.id === id && x.active);
      if (!p) throw new Error("A product on this ticket is no longer on the menu.");
      return { productId: id, name: p.name, unit: p.price_cents, qty: Math.min(99, qtyById.get(id) as number) };
    });
    const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const delivery = data.fulfillment === "delivery" ? fee : 0;
    // VAT applies to the items and to the delivery fee.
    const vat = Math.round((subtotal + delivery) * vatRate);
    const total = subtotal + vat + delivery;
    const paidNow = data.paymentMethod !== "pay_on_delivery";

    // Numbers are sequential per day; a unique constraint + retry makes two
    // simultaneous tickets safe (the loser simply takes the next number).
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const day = await sql<{ key: string; next: number }>`
        select to_char(now() at time zone ${TIMEZONE}::text, 'YYYYMMDD') as key,
               coalesce(max(substring(order_no from '[0-9]+$')::int), 0) + 1 as next
        from orders
        where order_no like 'ORD-' || to_char(now() at time zone ${TIMEZONE}::text, 'YYYYMMDD') || '-%'
      `;
      const orderNo = `ORD-${day[0].key}-${pad(day[0].next)}`;
      const invoiceNo = `INV-${day[0].key}-${pad(day[0].next)}`;
      try {
        // One statement = one transaction: an order never exists without its items.
        const rows = await sql<{ id: number }>`
          with o as (
            insert into orders (
              order_no, invoice_no, client_name, client_phone, location, fulfillment,
              payment_method, payment_status, delivery_status,
              subtotal_cents, vat_cents, vat_rate, delivery_cents, total_cents,
              created_by, created_by_name, paid_at
            ) values (
              ${orderNo}, ${invoiceNo}, ${data.clientName}, ${data.clientPhone}, ${data.location}, ${data.fulfillment},
              ${data.paymentMethod}, ${paidNow ? "paid" : "unpaid"}, ${data.fulfillment === "delivery" ? "out" : "na"},
              ${subtotal}, ${vat}, ${vatRate}, ${delivery}, ${total},
              ${me.userId}, ${me.displayName}, ${paidNow ? new Date().toISOString() : null}
            ) returning id
          ), i as (
            insert into order_items (order_id, product_id, name, qty, unit_price_cents)
            select o.id, t.product_id, t.name, t.qty, t.unit
            from o, unnest(${lines.map((l) => l.productId)}::int[], ${lines.map((l) => l.name)}::text[],
                           ${lines.map((l) => l.qty)}::int[], ${lines.map((l) => l.unit)}::int[])
                 as t(product_id, name, qty, unit)
          )
          select id from o
        `;
        await log(me, "order.created", `${orderNo} / ${invoiceNo} for ${data.clientName} · ${rand(total)}`);
        return { orderNo, invoiceNo, id: rows[0].id };
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "23505" && attempt < 7) continue;
        throw e;
      }
    }
    throw new Error("Could not get an order number. Try again.");
  });

export const markDelivered = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ orderId: z.number().int(), paid: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["delivery", "manager"]);
    const rows = await sql<{
      invoice_no: string;
      payment_method: string;
      fulfillment: string;
      delivery_status: string;
    }>`select invoice_no, payment_method, fulfillment, delivery_status from orders where id = ${data.orderId}`;
    const row = rows[0];
    if (!row || row.fulfillment !== "delivery") throw new Error("Not a delivery.");
    if (row.delivery_status === "delivered") throw new Error("Already marked delivered.");
    const markPaid = data.paid || row.payment_method !== "pay_on_delivery";
    await sql`
      update orders set
        delivery_status = 'delivered',
        delivered_at = now(),
        delivered_by_name = ${me.displayName},
        payment_status = ${markPaid ? "paid" : "unpaid"},
        paid_at = case when ${markPaid}::boolean then coalesce(paid_at, now()) else paid_at end
      where id = ${data.orderId}
    `;
    await log(me, "order.delivered", `${row.invoice_no}${markPaid ? " · paid" : " · still unpaid"}`);
    return { ok: true };
  });

/** Driver collects cash later for a pay-on-delivery order that was delivered unpaid. */
export const markPaid = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ orderId: z.number().int() }).parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["delivery", "manager"]);
    const rows = await sql<{ invoice_no: string; payment_status: string }>`
      select invoice_no, payment_status from orders where id = ${data.orderId}
    `;
    if (!rows[0]) throw new Error("Order not found.");
    if (rows[0].payment_status === "paid") throw new Error("Already marked paid.");
    await sql`update orders set payment_status = 'paid', paid_at = now() where id = ${data.orderId}`;
    await log(me, "order.paid", `${rows[0].invoice_no} · payment received`);
    return { ok: true };
  });

// ───────────────────────────── Manager tools ─────────────────────────────

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        id: z.number().int().optional(),
        name: z.string().trim().min(1).max(80),
        priceCents: z.number().int().min(0).max(10_000_00),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    if (data.id) {
      await sql`
        update products set name = ${data.name}, price_cents = ${data.priceCents}, active = ${data.active}
        where id = ${data.id}
      `;
    } else {
      await sql`insert into products (name, price_cents, active) values (${data.name}, ${data.priceCents}, ${data.active})`;
    }
    await log(me, "product.saved", `${data.name} · ${rand(data.priceCents)}${data.active ? "" : " · hidden"}`);
    return { ok: true };
  });

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

export const saveShift = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        memberUserId: z.string().min(1),
        shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        startsAt: timeSchema,
        endsAt: timeSchema,
        note: z.string().max(120).default(""),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    if (data.endsAt <= data.startsAt) throw new Error("The shift must end after it starts.");
    const member = await sql<{ display_name: string }>`select display_name from members where user_id = ${data.memberUserId}`;
    if (!member[0]) throw new Error("That person is not on the team yet.");
    await sql`
      insert into shifts (member_user_id, shift_date, starts_at, ends_at, note, created_by)
      values (${data.memberUserId}, ${data.shiftDate}, ${data.startsAt}, ${data.endsAt}, ${data.note}, ${me.userId})
    `;
    await log(me, "shift.saved", `${member[0].display_name} · ${data.shiftDate} ${data.startsAt}–${data.endsAt}`);
    return { ok: true };
  });

export const deleteShift = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ id: z.number().int() }).parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    await sql`delete from shifts where id = ${data.id}`;
    await log(me, "shift.removed", `Shift #${data.id} removed`);
    return { ok: true };
  });

/** Manager creates a login (username + password) for staff or a driver. */
export const createTeamMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(60),
        username: usernameSchema,
        password: passwordSchema,
        role: z.enum(["manager", "staff", "delivery"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    const userId = await createLogin(data.name, data.username, data.password);
    try {
      await sql`insert into members (user_id, display_name, role) values (${userId}, ${data.name}, ${data.role})`;
    } catch (e) {
      await deleteLogin(userId);
      throw e;
    }
    await log(me, "member.created", `${data.name} (@${data.username.toLowerCase()}) added as ${data.role}`);
    return { ok: true };
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z.object({ userId: z.string().min(1), role: z.enum(["manager", "staff", "delivery"]) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    if (data.userId === me.userId && data.role !== "manager") {
      const others = await sql`select user_id from members where role = 'manager' and active and user_id <> ${me.userId}`;
      if (!others.length) throw new Error("Keep at least one manager.");
    }
    const target = await sql<{ display_name: string }>`select display_name from members where user_id = ${data.userId}`;
    await sql`update members set role = ${data.role} where user_id = ${data.userId}`;
    await log(me, "role.changed", `${target[0]?.display_name ?? "Member"} → ${data.role}`);
    return { ok: true };
  });

/** Switch a person off (they are signed out and cannot sign back in) or back on. */
export const setMemberActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ userId: z.string().min(1), active: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    if (data.userId === me.userId) throw new Error("You cannot switch off your own account.");
    const target = await sql<{ display_name: string }>`select display_name from members where user_id = ${data.userId}`;
    if (!target[0]) throw new Error("Member not found.");
    await sql`update members set active = ${data.active} where user_id = ${data.userId}`;
    if (!data.active) await sql`delete from session where "userId" = ${data.userId}`;
    await log(me, data.active ? "member.enabled" : "member.disabled", target[0].display_name);
    return { ok: true };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => z.object({ userId: z.string().min(1), password: passwordSchema }).parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    const target = await sql<{ display_name: string }>`select display_name from members where user_id = ${data.userId}`;
    if (!target[0]) throw new Error("Member not found.");
    const { auth } = await import("@/lib/auth/server");
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(data.userId, await ctx.password.hash(data.password));
    if (data.userId !== me.userId) await sql`delete from session where "userId" = ${data.userId}`;
    await log(me, "password.reset", `Password reset for ${target[0].display_name}`);
    return { ok: true };
  });

export const saveBusiness = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(80),
        appName: z.string().trim().min(1).max(40),
        vatPercent: z.number().min(0).max(30),
        deliveryFeeCents: z.number().int().min(0).max(100_000),
        vatNumber: z.string().trim().max(30).default(""),
        address: z.string().trim().max(200).default(""),
        phone: z.string().trim().max(40).default(""),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const me = await actor(context.userId);
    assertRole(me.role, ["manager"]);
    await sql`
      update business set name = ${data.name}, app_name = ${data.appName},
        vat_rate = ${data.vatPercent / 100}, delivery_fee_cents = ${data.deliveryFeeCents},
        vat_number = ${data.vatNumber}, address = ${data.address}, phone = ${data.phone}
      where id = 1
    `;
    await log(me, "business.updated", `${data.appName} · ${data.name} · VAT ${data.vatPercent}%`);
    return { ok: true };
  });
