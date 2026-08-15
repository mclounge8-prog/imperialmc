// Домен реального сервера. Вынести в конфиг окружения, когда появится
// отдельный dev/staging контур — пока прод один, хардкодим осознанно.
export const API_BASE_URL = 'https://imperial-mc.online';

export type StaffLoginResponse = {
  token: string;
  staff: {
    id: number;
    name: string;
    role: string;
  };
};

type ApiErrorBody = {
  error?: string;
  code?: string;
  expectedCash?: number;
  countedCash?: number;
};

export class ApiRequestError extends Error {
  code?: string;
  expectedCash?: number;
  countedCash?: number;
  status: number;

  constructor(
    message: string,
    opts: { status: number; code?: string; expectedCash?: number; countedCash?: number } 
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = opts.status;
    this.code = opts.code;
    this.expectedCash = opts.expectedCash;
    this.countedCash = opts.countedCash;
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Сервер вернул не-JSON ответ (статус ${response.status}): ${text.slice(0, 200)}`
    );
  }
}

export async function loginWithPin(pin: string, deviceToken: string): Promise<StaffLoginResponse> {
  const response = await fetch(`${API_BASE_URL}/api/staff/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({ pin }),
  });

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const message = (data as ApiErrorBody).error || 'Не удалось войти';
    throw new Error(message);
  }

  return data as StaffLoginResponse;
}

export type DeviceStatus = {
  active: boolean;
  venue: { id: number; name: string } | null;
};

export async function registerDevice(code: string): Promise<{ token: string }> {
  const response = await fetch(`${API_BASE_URL}/api/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const message = (data as ApiErrorBody).error || 'Не удалось зарегистрировать устройство';
    throw new Error(message);
  }

  return data as { token: string };
}

export async function fetchDeviceStatus(token: string): Promise<DeviceStatus> {
  const response = await fetch(`${API_BASE_URL}/api/devices/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const message = (data as ApiErrorBody).error || 'Не удалось получить статус устройства';
    throw new Error(message);
  }

  return data as DeviceStatus;
}

export type VenueInfo = {
  id: number;
  name: string;
};

export type VenuesResponse = {
  venues: VenueInfo[];
};

export type TableStatus = 'free' | 'occupied' | 'dirty';

export type TableSize = 'small' | 'medium' | 'large';

export type TableInfo = {
  id: number;
  name: string;
  capacity: number;
  status: TableStatus;
  posX: number;
  posY: number;
  /** Preset tile size; terminal scales the whole floor plan to fit the screen. */
  size: TableSize;
  width: number;
  height: number;
};

export type Zone = {
  id: number;
  name: string;
  tables: TableInfo[];
};

export type TablesResponse = {
  zones: Zone[];
};

export type ModifierOption = {
  modifierId: number;
  name: string;
  price: number;
  isDefault: boolean;
  qty: number;
  unit: string | null;
};

// Группа модификаторов позиции меню. id === null — синтетическая группа
// "Состав" (обычные ингредиенты без ограничения выбора); группы с id —
// настоящие ограничения (напр. "Лаваш" — ровно 1 вариант из maxSelect).
export type ModifierGroup = {
  id: number | null;
  name: string;
  minSelect: number;
  maxSelect: number | null;
  options: ModifierOption[];
};

export type MenuItem = {
  id: number;
  name: string;
  price: number;
  imageUrl: string | null;
  modifierGroups: ModifierGroup[];
};

export type MenuCategory = {
  id: number;
  name: string;
  icon: string | null;
  parentId?: number | null;
  items: MenuItem[];
  children?: MenuCategory[];
};

export type MenuResponse = {
  categories: MenuCategory[];
  uncategorized: MenuItem[];
};

// Снапшот одного выбранного модификатора КОНКРЕТНОЙ позиции заказа (что
// реально выбрано при добавлении — не общий каталог, не рецептура блюда)
export type OrderItemModifier = {
  modifierId: number | null;
  name: string;
  price: number;
  qty: number;
  unit: string | null;
};

export type OrderItem = {
  id: number;
  menuItemId: number | null;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
  modifiers: OrderItemModifier[];
};

export type OrderGuest = {
  id: number;
  label: string;
  items: OrderItem[];
  total: number;
};

export type OrderStatus = 'open' | 'paid' | 'cancelled';

export type Order = {
  id: number;
  status: OrderStatus;
  table: { id: number; name: string } | null;
  guests: OrderGuest[];
  total: number;
};

type OrderEnvelope = { order: Order };

async function authorizedRequest<T>(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const body = data as ApiErrorBody;
    const message = body.error || 'Ошибка запроса';
    throw new ApiRequestError(message, {
      status: response.status,
      code: body.code,
      expectedCash: body.expectedCash,
      countedCash: body.countedCash,
    });
  }

  return data as T;
}

export function fetchVenues(token: string): Promise<VenuesResponse> {
  return authorizedRequest<VenuesResponse>('/api/venues', token);
}

export function fetchTables(venueId: number, token: string): Promise<TablesResponse> {
  return authorizedRequest<TablesResponse>(`/api/tables?venueId=${venueId}`, token);
}

export function fetchMenu(venueId: number, token: string): Promise<MenuResponse> {
  return authorizedRequest<MenuResponse>(`/api/menu?venueId=${venueId}`, token);
}

export async function getOrCreateTableOrder(tableId: number, token: string): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(`/api/tables/${tableId}/order`, token);
  return order;
}

export async function fetchOrderById(orderId: number, token: string): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(`/api/orders/${orderId}`, token);
  return order;
}

export type OpenOrderSummary = {
  id: number;
  tableId: number | null;
  tableName: string | null;
  total: number;
};

export type OpenOrdersResponse = {
  orders: OpenOrderSummary[];
};

export function fetchOpenOrders(venueId: number, token: string): Promise<OpenOrdersResponse> {
  return authorizedRequest<OpenOrdersResponse>(`/api/orders/open?venueId=${venueId}`, token);
}

export async function createQuickOrder(venueId: number, token: string): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>('/api/orders/quick', token, {
    method: 'POST',
    body: { venue_id: venueId },
  });
  return order;
}

export async function addGuest(orderId: number, token: string): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(`/api/orders/${orderId}/guests`, token, {
    method: 'POST',
    body: {},
  });
  return order;
}

export async function addOrderItem(
  orderId: number,
  menuItemId: number,
  guestId: number,
  token: string,
  modifierIds?: number[]
): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(`/api/orders/${orderId}/items`, token, {
    method: 'POST',
    body: {
      menu_item_id: menuItemId,
      guest_id: guestId,
      ...(modifierIds !== undefined ? { modifier_ids: modifierIds } : {}),
    },
  });
  return order;
}

export async function moveOrderItem(
  orderId: number,
  itemId: number,
  guestId: number,
  token: string
): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(
    `/api/orders/${orderId}/items/${itemId}/guest`,
    token,
    { method: 'PUT', body: { guest_id: guestId } }
  );
  return order;
}

export async function removeOrderItem(
  orderId: number,
  itemId: number,
  token: string
): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(
    `/api/orders/${orderId}/items/${itemId}`,
    token,
    { method: 'DELETE' }
  );
  return order;
}

export type PaymentMethod = 'cash' | 'card';

export async function payGuest(
  orderId: number,
  guestId: number,
  method: PaymentMethod,
  amount: number,
  token: string
): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(
    `/api/orders/${orderId}/guests/${guestId}/pay`,
    token,
    { method: 'POST', body: { payments: [{ method, amount }] } }
  );
  return order;
}

export async function cancelGuest(orderId: number, guestId: number, token: string): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(
    `/api/orders/${orderId}/guests/${guestId}/cancel`,
    token,
    { method: 'POST', body: {} }
  );
  return order;
}

export async function deleteOrderItemFully(
  orderId: number,
  itemId: number,
  token: string
): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(
    `/api/orders/${orderId}/items/${itemId}/full`,
    token,
    { method: 'DELETE' }
  );
  return order;
}

export async function transferOrderTable(
  orderId: number,
  tableId: number,
  token: string
): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(`/api/orders/${orderId}/table`, token, {
    method: 'PUT',
    body: { table_id: tableId },
  });
  return order;
}

/* ---------- Оплаченные чеки (переключатель на экране столов) ---------- */

export type PaidReceiptSummary = {
  id: number;
  tableName: string | null;
  guestLabel: string | null;
  staffName: string | null;
  total: number;
  closedAt: string;
};

export type ReceiptDetailItemModifier = {
  modifierId: number | null;
  name: string;
  price: number;
};

export type ReceiptDetailItem = {
  id: number;
  menuItemId: number | null;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
  modifiers: ReceiptDetailItemModifier[];
  // Сравнение с текущим составом позиции меню по умолчанию — что убрали,
  // что докупили сверху в этом конкретном чеке
  removed: string[];
  added: string[];
};

export type PaidReceiptDetail = {
  id: number;
  tableName: string | null;
  guestLabel: string | null;
  staffName: string | null;
  total: number;
  closedAt: string;
  status: string;
  items: ReceiptDetailItem[];
};

export async function fetchPaidReceipts(venueId: number, token: string): Promise<PaidReceiptSummary[]> {
  const { receipts } = await authorizedRequest<{ receipts: PaidReceiptSummary[] }>(
    `/api/receipts?venueId=${venueId}`,
    token
  );
  return receipts;
}

export async function fetchPaidReceiptDetail(id: number, token: string): Promise<PaidReceiptDetail> {
  const { receipt } = await authorizedRequest<{ receipt: PaidReceiptDetail }>(`/api/receipts/${id}`, token);
  return receipt;
}

/* ---------- Смены (открытие/закрытие, X-отчёт, чеки смены) ---------- */

export type PaymentBreakdown = {
  cash: number;
  card: number;
  other: number;
};

export type ShiftCash = {
  openingCash: number;
  cashSales: number;
  deposits: number;
  withdrawals: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
};

export type Shift = {
  id: number;
  venueId: number;
  status: 'open' | 'closed';
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  openingCash: number;
  closingCash: number | null;
  receiptsCount: number;
  guestsCount: number;
  revenueTotal: number;
  avgCheck: number;
  paymentBreakdown: PaymentBreakdown;
  cash: ShiftCash;
};

export type ShiftReceipt = {
  id: number;
  tableName: string | null;
  guestLabel: string | null;
  staffName: string | null;
  status: 'paid' | 'cancelled';
  total: number;
  closedAt: string;
  paymentMethods: string[];
};

export async function fetchCurrentShift(venueId: number, token: string): Promise<Shift | null> {
  const { shift } = await authorizedRequest<{ shift: Shift | null }>(
    `/api/shifts/current?venueId=${venueId}`,
    token
  );
  return shift;
}

export async function openShift(
  venueId: number,
  token: string,
  openingCash = 0
): Promise<Shift> {
  const { shift } = await authorizedRequest<{ shift: Shift }>('/api/shifts/open', token, {
    method: 'POST',
    body: { venue_id: venueId, opening_cash: openingCash },
  });
  return shift;
}

export async function closeShift(
  venueId: number,
  token: string,
  closingCash: number,
  options?: { forcePin?: string }
): Promise<Shift> {
  const { shift } = await authorizedRequest<{ shift: Shift }>('/api/shifts/close', token, {
    method: 'POST',
    body: {
      venue_id: venueId,
      closing_cash: closingCash,
      ...(options?.forcePin ? { force_pin: options.forcePin } : {}),
    },
  });
  return shift;
}

export type CashMovementType = 'deposit' | 'withdrawal';

export type CashMovement = {
  id: number;
  type: CashMovementType;
  amount: number;
  comment: string | null;
  staffName: string | null;
  createdAt: string;
};

export async function createCashMovement(
  venueId: number,
  token: string,
  type: CashMovementType,
  amount: number,
  comment?: string
): Promise<{ movement: CashMovement; shift: Shift }> {
  return authorizedRequest<{ movement: CashMovement; shift: Shift }>(
    '/api/shifts/cash-movements',
    token,
    {
      method: 'POST',
      body: { venue_id: venueId, type, amount, comment: comment || null },
    }
  );
}

export async function fetchCashMovements(
  venueId: number,
  token: string
): Promise<{ shiftId: number | null; movements: CashMovement[] }> {
  const { shift, movements } = await authorizedRequest<{
    shift: { id: number } | null;
    movements: CashMovement[];
  }>(`/api/shifts/cash-movements?venueId=${venueId}`, token);
  return { shiftId: shift ? shift.id : null, movements };
}

export async function fetchShiftReceipts(
  venueId: number,
  token: string
): Promise<{ shiftId: number | null; receipts: ShiftReceipt[] }> {
  const { shift, receipts } = await authorizedRequest<{ shift: { id: number } | null; receipts: ShiftReceipt[] }>(
    `/api/shifts/receipts?venueId=${venueId}`,
    token
  );
  return { shiftId: shift ? shift.id : null, receipts };
}

// --- Фискализация через кассу АТОЛ (выполняется этим же планшетом,
// см. src/native/atol.ts и src/services/fiscalWorker.ts) ---

export type AtolSettings = {
  enabled: boolean;
  ipAddress?: string;
  ipPort?: number;
  model?: number | null;
  operatorName?: string | null;
};

export async function fetchAtolSettings(venueId: number, token: string): Promise<AtolSettings> {
  return authorizedRequest<AtolSettings>(`/api/fiscal/settings?venueId=${venueId}`, token);
}

export type FiscalJobType =
  | 'open_shift'
  | 'close_shift'
  | 'receipt'
  | 'x_report'
  | 'cash_in'
  | 'cash_out';

export type FiscalJob = {
  id: number;
  type: FiscalJobType;
  receiptId: number | null;
  shiftId: number | null;
  payload: unknown;
  attempts: number;
};

export async function fetchNextFiscalJob(venueId: number, token: string): Promise<FiscalJob | null> {
  const { job } = await authorizedRequest<{ job: FiscalJob | null }>(
    `/api/fiscal/jobs/next?venueId=${venueId}`,
    token
  );
  return job;
}

export type FiscalJobResult = {
  success: boolean;
  fiscalDocNumber?: number | null;
  fiscalSign?: string | null;
  fiscalDatetime?: string | null;
  error?: string;
};

export async function reportFiscalJobResult(
  jobId: number,
  token: string,
  result: FiscalJobResult
): Promise<void> {
  await authorizedRequest(`/api/fiscal/jobs/${jobId}/result`, token, { method: 'POST', body: result });
}

export type FiscalJobStatus = 'pending' | 'in_progress' | 'done' | 'error';

export type FiscalJobListItem = {
  id: number;
  type: FiscalJobType;
  status: FiscalJobStatus;
  receiptId: number | null;
  shiftId: number | null;
  attempts: number;
  lastError: string | null;
  fiscalDocNumber: number | null;
  fiscalSign: string | null;
  fiscalDatetime: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchFiscalJobs(
  venueId: number,
  token: string,
  limit = 30
): Promise<{ jobs: FiscalJobListItem[]; errorCount: number; pendingCount: number }> {
  return authorizedRequest<{ jobs: FiscalJobListItem[]; errorCount: number; pendingCount: number }>(
    `/api/fiscal/jobs?venueId=${venueId}&limit=${limit}`,
    token
  );
}

export async function retryFiscalJob(jobId: number, venueId: number, token: string): Promise<void> {
  await authorizedRequest(`/api/fiscal/jobs/${jobId}/retry?venueId=${venueId}`, token, {
    method: 'POST',
    body: {},
  });
}

export async function retryAllFiscalJobs(
  venueId: number,
  token: string,
  options?: { includeStuck?: boolean }
): Promise<{ retried: number }> {
  return authorizedRequest<{ ok: boolean; retried: number }>(
    `/api/fiscal/jobs/retry-all?venueId=${venueId}`,
    token,
    {
      method: 'POST',
      body: { includeStuck: Boolean(options?.includeStuck) },
    }
  );
}