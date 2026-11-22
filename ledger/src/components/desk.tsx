import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { UserButton } from "@/lib/auth/gates";
import {
  createOrder,
  createTeamMember,
  deleteShift,
  getWorkspace,
  markDelivered,
  markPaid,
  resetPassword,
  saveBusiness,
  saveProduct,
  saveShift,
  setMemberActive,
  setRole,
} from "@/lib/ledger.functions";

type Role = "manager" | "staff" | "delivery";
type PayMethod = "cash" | "card" | "eft" | "pay_on_delivery";

type Workspace = Awaited<ReturnType<typeof getWorkspace>>;
type Order = Workspace["orders"][number];
type Business = Workspace["business"];
type MemberRow = Workspace["members"][number];

const money = (cents: number) => `R ${(cents / 100).toFixed(2)}`;
const payLabel: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  eft: "EFT",
  pay_on_delivery: "Pay on delivery",
};

function tabsFor(role: Role): string[] {
  if (role === "manager") return ["Today", "Orders", "New order", "Menu", "Shifts", "Team", "Audit", "Settings"];
  if (role === "staff") return ["New order", "Tickets"];
  return ["Runs"];
}

export function Desk() {
  const [tab, setTab] = useState("Today");
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetId, setSheetId] = useState<number | null>(null);

  async function load() {
    const next = await getWorkspace();
    setData(next);
    setTab((current) => (tabsFor(next.me.role).includes(current) ? current : tabsFor(next.me.role)[0]));
    return next;
  }

  function handleError(e: unknown) {
    const message = e instanceof Error ? e.message : "Something failed";
    if (message.includes("Unauthorized")) {
      window.location.href = "/login";
      return;
    }
    setError(message);
  }

  useEffect(() => {
    load().catch(handleError);
  }, []);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      await load();
      return result;
    } catch (e) {
      handleError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const today = useMemo(() => {
    if (!data) return [];
    const start = new Date(data.dayStart).getTime();
    const end = new Date(data.dayEnd).getTime();
    return data.orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= start && t < end;
    });
  }, [data]);

  if (!data) {
    return <main className="grid min-h-screen place-items-center text-muted">{error || "Opening the ledger…"}</main>;
  }

  const { me, business } = data;
  const tabs = tabsFor(me.role);
  const collected = today.reduce((s, o) => s + (o.payment_status === "paid" ? o.total_cents : 0), 0);
  const sheet = data.orders.find((o) => o.id === sheetId) ?? null;

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-[max(4rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-wide text-brand uppercase">{business.app_name}</p>
          <h1 className="font-display text-3xl leading-none sm:text-4xl">{business.name}</h1>
          <p className="mt-2 text-sm text-muted">
            {me.displayName} · {me.role}
          </p>
        </div>
        <UserButton />
      </header>

      <nav className="sticky top-0 z-10 -mx-4 mb-5 flex gap-2 overflow-x-auto bg-paper px-4 py-2 [scrollbar-width:none]">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium ${
              tab === name ? "bg-brand text-brand-ink" : "bg-card text-ink ring-1 ring-line"
            }`}
          >
            {name}
          </button>
        ))}
      </nav>

      {error && <p className="mb-4 rounded-xl bg-card px-4 py-3 text-sm text-danger ring-1 ring-line">{error}</p>}

      {tab === "Today" && <Today orders={today} collected={collected} />}
      {(tab === "Orders" || tab === "Tickets") && <OrderList orders={data.orders} onOpen={(o) => setSheetId(o.id)} />}
      {tab === "New order" && (
        <NewOrder
          products={data.products.filter((p) => p.active)}
          vat={Number(business.vat_rate)}
          fee={business.delivery_fee_cents}
          busy={busy}
          onCreate={async (payload) => {
            const made = await run(() => createOrder({ data: payload }));
            if (made) setSheetId(made.id);
            return Boolean(made);
          }}
        />
      )}
      {tab === "Runs" && (
        <Runs
          orders={data.orders}
          busy={busy}
          onDeliver={(orderId, paid) => run(() => markDelivered({ data: { orderId, paid } }))}
          onPaid={(orderId) => run(() => markPaid({ data: { orderId } }))}
        />
      )}
      {tab === "Menu" && <Menu products={data.products} busy={busy} onSave={(p) => run(() => saveProduct({ data: p }))} />}
      {tab === "Shifts" && (
        <Shifts
          members={data.members.filter((m) => m.active)}
          allMembers={data.members}
          shifts={data.shifts}
          today={data.dayStart}
          timezone={data.timezone}
          busy={busy}
          onSave={(s) => run(() => saveShift({ data: s }))}
          onDelete={(id) => run(() => deleteShift({ data: { id } }))}
        />
      )}
      {tab === "Team" && (
        <Team
          meId={me.userId}
          members={data.members}
          busy={busy}
          onCreate={(m) => run(() => createTeamMember({ data: m }))}
          onRole={(userId, role) => run(() => setRole({ data: { userId, role } }))}
          onActive={(userId, active) => run(() => setMemberActive({ data: { userId, active } }))}
          onPassword={(userId, password) => run(() => resetPassword({ data: { userId, password } }))}
        />
      )}
      {tab === "Audit" && <Audit rows={data.audit} timezone={data.timezone} />}
      {tab === "Settings" && <Settings business={business} busy={busy} onSave={(b) => run(() => saveBusiness({ data: b }))} />}

      {sheet && <Invoice order={sheet} business={business} timezone={data.timezone} onClose={() => setSheetId(null)} />}
    </div>
  );
}

function Today({ orders, collected }: { orders: Order[]; collected: number }) {
  const byWho = new Map<string, { n: number; total: number }>();
  const qty = new Map<string, number>();
  let sales = 0;
  for (const o of orders) {
    sales += o.total_cents;
    const row = byWho.get(o.created_by_name) ?? { n: 0, total: 0 };
    row.n += 1;
    row.total += o.total_cents;
    byWho.set(o.created_by_name, row);
    for (const item of o.items) qty.set(item.name, (qty.get(item.name) ?? 0) + item.qty);
  }
  const outstanding = orders.filter((o) => o.payment_status === "unpaid").reduce((s, o) => s + o.total_cents, 0);
  return (
    <div className="grid gap-3 md:gap-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        <Stat label="Sales (incl. VAT)" value={money(sales)} />
        <Stat label="Orders today" value={String(orders.length)} />
        <Stat label="Paid / collected" value={money(collected)} />
        <Stat label="Still to be paid" value={money(outstanding)} />
        <Stat label="Deliveries out" value={String(orders.filter((o) => o.delivery_status === "out").length)} />
      </section>
      <section className="grid gap-3 md:grid-cols-2 md:items-start md:gap-4">
        <Card title="Orders taken by">
          {byWho.size === 0 && <Empty>No orders yet today.</Empty>}
          {[...byWho.entries()].map(([name, row]) => (
            <Row key={name} left={name} right={`${row.n} orders · ${money(row.total)}`} />
          ))}
        </Card>
        <Card title="Quantities sold">
          {qty.size === 0 && <Empty>Nothing sold yet.</Empty>}
          {[...qty.entries()].map(([name, n]) => (
            <Row key={name} left={name} right={String(n)} />
          ))}
        </Card>
      </section>
    </div>
  );
}

function OrderList({ orders, onOpen }: { orders: Order[]; onOpen: (o: Order) => void }) {
  if (!orders.length) return <Empty>No orders on the books yet.</Empty>;
  return (
    <ul className="grid gap-3">
      {orders.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => onOpen(o)} className="w-full rounded-2xl bg-card p-4 text-left ring-1 ring-line">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-xl">{o.order_no}</span>
              <span className="font-medium">{money(o.total_cents)}</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {o.client_name} · {o.fulfillment} · {payLabel[o.payment_method]} · {o.payment_status}
              {o.fulfillment === "delivery" ? ` · ${o.delivery_status === "delivered" ? "delivered" : "out for delivery"}` : ""}
              {" · "}
              {o.created_by_name}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NewOrder({
  products,
  vat,
  fee,
  busy,
  onCreate,
}: {
  products: { id: number; name: string; price_cents: number }[];
  vat: number;
  fee: number;
  busy: boolean;
  onCreate: (p: {
    clientName: string;
    clientPhone: string;
    location: string;
    fulfillment: "delivery" | "pickup";
    paymentMethod: PayMethod;
    items: { productId: number; qty: number }[];
  }) => Promise<boolean>;
}) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [location, setLocation] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("pickup");
  const [paymentMethod, setPay] = useState<PayMethod>("cash");
  const lines = products.filter((p) => (qty[p.id] ?? 0) > 0);
  const subtotal = lines.reduce((s, p) => s + p.price_cents * qty[p.id], 0);
  const delivery = fulfillment === "delivery" ? fee : 0;
  const vatCents = Math.round((subtotal + delivery) * vat);
  const methods: PayMethod[] = fulfillment === "delivery" ? ["cash", "card", "eft", "pay_on_delivery"] : ["cash", "card", "eft"];

  function chooseFulfillment(f: "delivery" | "pickup") {
    setFulfillment(f);
    if (f === "pickup" && paymentMethod === "pay_on_delivery") setPay("cash");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onCreate({
      clientName,
      clientPhone,
      location: fulfillment === "delivery" ? location : "",
      fulfillment,
      paymentMethod,
      items: lines.map((p) => ({ productId: p.id, qty: qty[p.id] })),
    });
    if (ok) {
      setQty({});
      setClientName("");
      setClientPhone("");
      setLocation("");
      setFulfillment("pickup");
      setPay("cash");
    }
  }

  return (
    <form className="grid gap-4 md:grid-cols-2 md:items-start" onSubmit={submit}>
      <Card title="1 · What goes in the order" className="md:row-span-2">
        {products.length === 0 && <Empty>The manager has not listed any products yet.</Empty>}
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-muted">{money(p.price_cents)} ex VAT</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label={`Less ${p.name}`} className="h-11 w-11 rounded-full bg-paper ring-1 ring-line" onClick={() => setQty((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))}>−</button>
              <span className="w-6 text-center">{qty[p.id] ?? 0}</span>
              <button type="button" aria-label={`More ${p.name}`} className="h-11 w-11 rounded-full bg-paper ring-1 ring-line" onClick={() => setQty((q) => ({ ...q, [p.id]: Math.min(99, (q[p.id] ?? 0) + 1) }))}>+</button>
            </div>
          </div>
        ))}
      </Card>
      <Card title="2 · Client, delivery and payment">
        <Field label="Client name" value={clientName} onChange={setClientName} required />
        <Field label="Phone / WhatsApp" value={clientPhone} onChange={setClientPhone} />
        <div className="mt-3 flex gap-2">
          {(["pickup", "delivery"] as const).map((f) => (
            <button key={f} type="button" onClick={() => chooseFulfillment(f)} className={`min-h-11 flex-1 rounded-full capitalize ${fulfillment === f ? "bg-brand text-brand-ink" : "bg-paper ring-1 ring-line"}`}>
              {f === "pickup" ? "Pick up" : "Delivery"}
            </button>
          ))}
        </div>
        {fulfillment === "delivery" && <Field label="Delivery address" value={location} onChange={setLocation} required />}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {methods.map((m) => (
            <button key={m} type="button" onClick={() => setPay(m)} className={`min-h-11 rounded-xl text-sm ${paymentMethod === m ? "bg-ink text-paper" : "bg-paper ring-1 ring-line"}`}>
              {payLabel[m]}
            </button>
          ))}
        </div>
      </Card>
      <Card title="3 · Invoice">
        <Row left="Items (ex VAT)" right={money(subtotal)} />
        <Row left="Delivery (ex VAT)" right={money(delivery)} />
        <Row left={`VAT ${(vat * 100).toFixed(0)}% (items + delivery)`} right={money(vatCents)} />
        <Row left="Total" right={money(subtotal + vatCents + delivery)} />
      </Card>
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-2xl bg-ink p-3 text-paper shadow-lg md:col-span-2">
        <div className="pl-2">
          <p className="text-xs opacity-70">{lines.reduce((s, p) => s + qty[p.id], 0)} items · incl. VAT</p>
          <p className="font-display text-2xl leading-none">{money(subtotal + vatCents + delivery)}</p>
        </div>
        <button disabled={busy || !lines.length || !clientName.trim()} className="min-h-12 rounded-xl bg-accent px-5 font-medium text-paper disabled:opacity-50">
          {busy ? "Creating…" : "Create order & invoice"}
        </button>
      </div>
    </form>
  );
}

function Runs({
  orders,
  busy,
  onDeliver,
  onPaid,
}: {
  orders: Order[];
  busy: boolean;
  onDeliver: (id: number, paid: boolean) => void;
  onPaid: (id: number) => void;
}) {
  const deliveries = orders.filter((o) => o.fulfillment === "delivery");
  const open = deliveries.filter((o) => o.delivery_status !== "delivered").reverse();
  const owing = deliveries.filter((o) => o.delivery_status === "delivered" && o.payment_status === "unpaid");
  return (
    <div className="grid gap-6">
      <section>
        <h2 className="mb-3 font-display text-2xl">To deliver</h2>
        <ul className="grid gap-3">
          {open.length === 0 && <Empty>No open deliveries.</Empty>}
          {open.map((o) => (
            <li key={o.id} className="rounded-2xl bg-card p-4 ring-1 ring-line">
              <p className="font-display text-2xl">{o.order_no}</p>
              <p className="mt-1 font-medium">{o.client_name}</p>
              <p className="text-sm text-muted">
                {o.location || "No location"}
                {o.client_phone ? ` · ${o.client_phone}` : ""}
              </p>
              <ul className="mt-2 text-sm">
                {o.items.map((i, n) => (
                  <li key={n}>{i.qty} × {i.name}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm">
                {payLabel[o.payment_method]} · {o.payment_status === "paid" ? "already paid" : `collect ${money(o.total_cents)}`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {o.payment_method === "pay_on_delivery" ? (
                  <>
                    <button disabled={busy} type="button" className="min-h-11 rounded-xl bg-accent px-4 text-paper" onClick={() => onDeliver(o.id, true)}>
                      Delivered & paid
                    </button>
                    <button disabled={busy} type="button" className="min-h-11 rounded-xl px-4 ring-1 ring-line" onClick={() => onDeliver(o.id, false)}>
                      Delivered, not paid yet
                    </button>
                  </>
                ) : (
                  <button disabled={busy} type="button" className="min-h-11 rounded-xl bg-brand px-4 text-brand-ink" onClick={() => onDeliver(o.id, true)}>
                    Delivered
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {owing.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">Delivered, waiting for payment</h2>
          <ul className="grid gap-3">
            {owing.map((o) => (
              <li key={o.id} className="rounded-2xl bg-card p-4 ring-1 ring-line">
                <p className="font-medium">{o.order_no} · {o.client_name}</p>
                <p className="text-sm text-muted">Owing {money(o.total_cents)}</p>
                <button disabled={busy} type="button" className="mt-3 min-h-11 rounded-xl bg-accent px-4 text-paper" onClick={() => onPaid(o.id)}>
                  Payment received
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Menu({
  products,
  busy,
  onSave,
}: {
  products: { id: number; name: string; price_cents: number; active: boolean }[];
  busy: boolean;
  onSave: (p: { id?: number; name: string; priceCents: number; active: boolean }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const toCents = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);
  return (
    <div className="grid gap-4">
      <Card title="Add a product">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const cents = toCents(price);
            if (!Number.isFinite(cents) || cents < 0) return;
            await onSave({ name, priceCents: cents, active: true });
            setName("");
            setPrice("");
          }}
        >
          <Field label="Name" value={name} onChange={setName} required />
          <Field label="Price ex VAT (R)" value={price} onChange={setPrice} required inputMode="decimal" />
          <button disabled={busy} className="min-h-11 rounded-xl bg-brand text-brand-ink">Save product</button>
        </form>
      </Card>
      <ul className="grid gap-2">
        {products.map((p) => (
          <li key={p.id} className="rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
            {editing === p.id ? (
              <form
                className="grid gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const cents = toCents(editPrice);
                  if (!Number.isFinite(cents) || cents < 0) return;
                  await onSave({ id: p.id, name: editName, priceCents: cents, active: p.active });
                  setEditing(null);
                }}
              >
                <Field label="Name" value={editName} onChange={setEditName} required />
                <Field label="Price ex VAT (R)" value={editPrice} onChange={setEditPrice} required inputMode="decimal" />
                <div className="flex gap-2">
                  <button disabled={busy} className="min-h-11 flex-1 rounded-xl bg-brand text-brand-ink">Save</button>
                  <button type="button" className="min-h-11 flex-1 rounded-xl ring-1 ring-line" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className={p.active ? "font-medium" : "font-medium text-muted line-through"}>{p.name}</p>
                  <p className="text-sm text-muted">{money(p.price_cents)} ex VAT</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="min-h-11 rounded-full px-3 text-sm ring-1 ring-line" onClick={() => { setEditing(p.id); setEditName(p.name); setEditPrice((p.price_cents / 100).toFixed(2)); }}>
                    Edit
                  </button>
                  <button disabled={busy} type="button" className="min-h-11 rounded-full px-3 text-sm ring-1 ring-line" onClick={() => onSave({ id: p.id, name: p.name, priceCents: p.price_cents, active: !p.active })}>
                    {p.active ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shifts({
  members,
  allMembers,
  shifts,
  today,
  timezone,
  busy,
  onSave,
  onDelete,
}: {
  members: MemberRow[];
  allMembers: MemberRow[];
  shifts: Workspace["shifts"];
  today: string;
  timezone: string;
  busy: boolean;
  onSave: (s: { memberUserId: string; shiftDate: string; startsAt: string; endsAt: string; note: string }) => Promise<unknown>;
  onDelete: (id: number) => void;
}) {
  const todayDate = new Date(today).toLocaleDateString("en-CA", { timeZone: timezone });
  const [memberUserId, setMember] = useState(members[0]?.user_id ?? "");
  const [shiftDate, setDate] = useState(todayDate);
  const [startsAt, setStart] = useState("09:00");
  const [endsAt, setEnd] = useState("17:00");
  const names = new Map(allMembers.map((m) => [m.user_id, m.display_name]));
  return (
    <div className="grid gap-4">
      <Card title="Who is on shift">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ memberUserId: memberUserId || members[0]?.user_id, shiftDate, startsAt, endsAt, note: "" });
          }}
        >
          <label className="grid gap-1 text-sm">
            Person
            <select value={memberUserId} onChange={(e) => setMember(e.target.value)} className="min-h-11 rounded-xl bg-paper px-3 ring-1 ring-line">
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.display_name} · {m.role}</option>
              ))}
            </select>
          </label>
          <Field label="Date" type="date" value={shiftDate} onChange={setDate} required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" type="time" value={startsAt} onChange={setStart} required />
            <Field label="To" type="time" value={endsAt} onChange={setEnd} required />
          </div>
          <button disabled={busy || !members.length} className="min-h-11 rounded-xl bg-brand text-brand-ink">Add shift</button>
        </form>
      </Card>
      <ul className="grid gap-2">
        {shifts.length === 0 && <Empty>No shifts scheduled.</Empty>}
        {shifts.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
            <div>
              <p className="font-medium">{names.get(s.member_user_id) ?? "Team"}</p>
              <p className="text-sm text-muted">{s.shift_date} · {s.starts_at}–{s.ends_at}</p>
            </div>
            <button disabled={busy} type="button" className="min-h-11 rounded-full px-3 text-sm ring-1 ring-line" onClick={() => onDelete(s.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Team({
  meId,
  members,
  busy,
  onCreate,
  onRole,
  onActive,
  onPassword,
}: {
  meId: string;
  members: MemberRow[];
  busy: boolean;
  onCreate: (m: { name: string; username: string; password: string; role: Role }) => Promise<unknown>;
  onRole: (userId: string, role: Role) => void;
  onActive: (userId: string, active: boolean) => void;
  onPassword: (userId: string, password: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setNewRole] = useState<Role>("staff");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  return (
    <div className="grid gap-4">
      <Card title="Add a team member">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await onCreate({ name, username, password, role });
            setName("");
            setUsername("");
            setPassword("");
          }}
        >
          <Field label="Name" value={name} onChange={setName} required />
          <Field label="Username (they sign in with this)" value={username} onChange={setUsername} required />
          <Field label="Password (min 8 characters)" value={password} onChange={setPassword} required />
          <div className="flex gap-2">
            {(["staff", "delivery", "manager"] as const).map((r) => (
              <button key={r} type="button" onClick={() => setNewRole(r)} className={`min-h-11 flex-1 rounded-full capitalize ${role === r ? "bg-brand text-brand-ink" : "bg-paper ring-1 ring-line"}`}>
                {r}
              </button>
            ))}
          </div>
          <button disabled={busy} className="min-h-11 rounded-xl bg-ink text-paper">Create login</button>
        </form>
      </Card>
      <ul className="grid gap-3">
        {members.map((m) => (
          <li key={m.user_id} className="rounded-2xl bg-card p-4 ring-1 ring-line">
            <p className={m.active ? "font-medium" : "font-medium text-muted line-through"}>
              {m.display_name} <span className="font-normal text-muted">@{m.username ?? "—"}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["manager", "staff", "delivery"] as const).map((r) => (
                <button key={r} disabled={busy} type="button" onClick={() => onRole(m.user_id, r)} className={`min-h-11 rounded-full px-4 capitalize ${m.role === r ? "bg-brand text-brand-ink" : "bg-paper ring-1 ring-line"}`}>
                  {r}
                </button>
              ))}
              <button type="button" className="min-h-11 rounded-full px-4 text-sm ring-1 ring-line" onClick={() => { setResetFor(resetFor === m.user_id ? null : m.user_id); setNewPassword(""); }}>
                Reset password
              </button>
              {m.user_id !== meId && (
                <button disabled={busy} type="button" className="min-h-11 rounded-full px-4 text-sm ring-1 ring-line" onClick={() => onActive(m.user_id, !m.active)}>
                  {m.active ? "Switch off" : "Switch on"}
                </button>
              )}
            </div>
            {resetFor === m.user_id && (
              <form
                className="mt-3 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await onPassword(m.user_id, newPassword);
                  setResetFor(null);
                  setNewPassword("");
                }}
              >
                <input required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 8)" className="min-h-11 flex-1 rounded-xl bg-paper px-3 ring-1 ring-line outline-none" />
                <button disabled={busy} className="min-h-11 rounded-xl bg-brand px-4 text-brand-ink">Save</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Audit({ rows, timezone }: { rows: Workspace["audit"]; timezone: string }) {
  if (!rows.length) return <Empty>No audit entries yet.</Empty>;
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-2xl bg-card px-4 py-3 ring-1 ring-line">
          <p className="text-sm font-medium">{r.action}</p>
          <p>{r.detail}</p>
          <p className="text-sm text-muted">{r.actor_name} · {fmtDate(r.created_at, timezone)}</p>
        </li>
      ))}
    </ul>
  );
}

function Settings({
  business,
  busy,
  onSave,
}: {
  business: Business;
  busy: boolean;
  onSave: (b: {
    name: string;
    appName: string;
    vatPercent: number;
    deliveryFeeCents: number;
    vatNumber: string;
    address: string;
    phone: string;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState(business.name);
  const [appName, setApp] = useState(business.app_name);
  const [vat, setVat] = useState(String(Math.round(Number(business.vat_rate) * 100)));
  const [fee, setFee] = useState((business.delivery_fee_cents / 100).toFixed(2));
  const [vatNumber, setVatNumber] = useState(business.vat_number);
  const [address, setAddress] = useState(business.address);
  const [phone, setPhone] = useState(business.phone);
  return (
    <Card title="Business details (shown on invoices)">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            name,
            appName,
            vatPercent: Number(vat),
            deliveryFeeCents: Math.round(Number(fee.replace(",", ".")) * 100),
            vatNumber,
            address,
            phone,
          });
        }}
      >
        <Field label="App name" value={appName} onChange={setApp} required />
        <Field label="Business name" value={name} onChange={setName} required />
        <Field label="VAT number" value={vatNumber} onChange={setVatNumber} />
        <Field label="Address" value={address} onChange={setAddress} />
        <Field label="Phone" value={phone} onChange={setPhone} />
        <Field label="VAT %" value={vat} onChange={setVat} inputMode="decimal" />
        <Field label="Delivery fee (R)" value={fee} onChange={setFee} inputMode="decimal" />
        <button disabled={busy} className="min-h-11 rounded-xl bg-brand text-brand-ink">Save</button>
      </form>
    </Card>
  );
}

function fmtDate(iso: string, timezone: string) {
  return new Date(iso).toLocaleString("en-ZA", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
}

function Invoice({
  order,
  business,
  timezone,
  onClose,
}: {
  order: Order;
  business: Business;
  timezone: string;
  onClose: () => void;
}) {
  function print(mode: "invoice" | "sticker") {
    document.body.dataset.print = mode;
    const clear = () => {
      delete document.body.dataset.print;
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.print();
  }
  const delivery = order.fulfillment === "delivery";
  const owing = order.payment_status === "unpaid";
  return (
    <div className="fixed inset-0 z-30 grid place-items-end bg-ink/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:place-items-center" onClick={onClose}>
      <article className="print-sheet max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="invoice-part">
          <p className="font-medium">{business.name}</p>
          {business.address && <p className="text-sm text-muted">{business.address}</p>}
          {business.phone && <p className="text-sm text-muted">{business.phone}</p>}
          {business.vat_number && <p className="text-sm text-muted">VAT no. {business.vat_number}</p>}
          <h2 className="mt-3 font-display text-3xl">Tax invoice {order.invoice_no}</h2>
          <p className="text-sm text-muted">{fmtDate(order.created_at, timezone)} · Order {order.order_no}</p>
          <p className="mt-3 font-medium">{order.client_name}</p>
          <p className="text-sm text-muted">{[order.client_phone, order.location].filter(Boolean).join(" · ")}</p>
          <ul className="mt-4 divide-y divide-line">
            {order.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-3 py-2 text-sm">
                <span>{i.qty} × {i.name} @ {money(i.unit_price_cents)}</span>
                <span>{money(i.unit_price_cents * i.qty)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-sm">
            <Row left="Items (ex VAT)" right={money(order.subtotal_cents)} />
            {delivery && <Row left="Delivery (ex VAT)" right={money(order.delivery_cents)} />}
            <Row left={`VAT ${(Number(order.vat_rate) * 100).toFixed(0)}%`} right={money(order.vat_cents)} />
            <Row left="Total due" right={money(order.total_cents)} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {payLabel[order.payment_method]} · {order.payment_status} · taken by {order.created_by_name}
          </p>
        </div>

        {delivery && (
          <div className="sticker-part mt-6 hidden border-t border-dashed border-line pt-4 text-center print:mt-0 print:block print:border-0">
            <p className="font-display text-6xl leading-none">{order.order_no.split("-").pop()}</p>
            <p className="mt-2 font-display text-2xl">{order.order_no}</p>
            <p className="mt-2 text-lg font-medium">{order.client_name}</p>
            <p>{order.location}</p>
            {order.client_phone && <p>{order.client_phone}</p>}
            <p className="mt-2 text-xl font-bold">
              {owing ? `COLLECT ${money(order.total_cents)} (${payLabel[order.payment_method]})` : "PAID"}
            </p>
          </div>
        )}

        <div className="mt-4 grid gap-2 print:hidden">
          <button type="button" className="min-h-11 rounded-xl bg-ink text-paper" onClick={() => print("invoice")}>Print invoice</button>
          {delivery && (
            <button type="button" className="min-h-11 rounded-xl bg-accent text-paper" onClick={() => print("sticker")}>
              Print order number sticker
            </button>
          )}
          <button type="button" className="min-h-11 rounded-xl ring-1 ring-line" onClick={onClose}>Close</button>
        </div>
      </article>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-2xl sm:text-3xl">{value}</p>
    </div>
  );
}
function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-card p-4 ring-1 ring-line ${className}`}>
      <h2 className="mb-3 font-display text-2xl">{title}</h2>
      {children}
    </section>
  );
}
function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span>{left}</span>
      <span className="font-medium">{right}</span>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  inputMode?: "decimal" | "text";
}) {
  return (
    <label className="mt-2 grid gap-1 text-sm">
      {label}
      <input
        type={type}
        inputMode={inputMode}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl bg-paper px-3 ring-1 ring-line outline-none"
      />
    </label>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-card px-4 py-8 text-center text-muted ring-1 ring-line">{children}</p>;
}
