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
};

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

export type TableInfo = {
  id: number;
  name: string;
  capacity: number;
  status: TableStatus;
  posX: number;
  posY: number;
};

export type Zone = {
  id: number;
  name: string;
  tables: TableInfo[];
};

export type TablesResponse = {
  zones: Zone[];
};

export type MenuItem = {
  id: number;
  name: string;
  price: number;
  imageUrl: string | null;
  recipe: OrderItemRecipeEntry[];
};

export type MenuCategory = {
  id: number;
  name: string;
  icon: string | null;
  items: MenuItem[];
};

export type MenuResponse = {
  categories: MenuCategory[];
  uncategorized: MenuItem[];
};

export type OrderItemRecipeEntry = {
  name: string;
  qty: number;
  unit: string;
};

export type OrderItem = {
  id: number;
  menuItemId: number | null;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
  recipe: OrderItemRecipeEntry[];
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
    const message = (data as ApiErrorBody).error || 'Ошибка запроса';
    throw new Error(message);
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
  token: string
): Promise<Order> {
  const { order } = await authorizedRequest<OrderEnvelope>(`/api/orders/${orderId}/items`, token, {
    method: 'POST',
    body: { menu_item_id: menuItemId, guest_id: guestId },
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