import type { KioskTicketModifier, KioskTicketStatus } from '../api/client';

export const UNIT_LABELS: Record<string, string> = {
  g: 'г',
  ml: 'мл',
  pcs: 'шт',
};

export const GUEST_STATUS: Record<string, { label: string; tint: string }> = {
  new: { label: 'Оформлен', tint: '#8aa4ff' },
  payment: { label: 'Оплата', tint: '#fb923c' },
  cooking: { label: 'Изготавливается', tint: '#f0c14b' },
  ready: { label: 'Готов', tint: '#3ee08a' },
  issued: { label: 'Готов', tint: '#3ee08a' },
  cancelled: { label: 'Отменён', tint: '#e14c4c' },
};

export const STAFF_FLOW: { key: KioskTicketStatus; label: string }[] = [
  { key: 'new', label: 'Оформлен' },
  { key: 'payment', label: 'Оплата' },
  { key: 'cooking', label: 'Изготавливается' },
  { key: 'ready', label: 'Готов' },
];

export function guestStatusLabel(status: string): string {
  return GUEST_STATUS[status]?.label || status;
}

export function guestStatusTint(status: string): string {
  return GUEST_STATUS[status]?.tint || '#98979f';
}

export function formatModifierLine(mod: KioskTicketModifier): string {
  const unit = mod.unitLabel || (mod.unit ? UNIT_LABELS[mod.unit] || mod.unit : '');
  const qty = mod.qty > 0 && unit ? `${mod.qty} ${unit}` : '';
  const price = mod.price > 0 ? `+${Math.round(mod.price)} ₽` : '';
  return [mod.name, qty, price].filter(Boolean).join(' · ');
}

export function isActiveKioskStatus(status: string): boolean {
  return status === 'new' || status === 'payment' || status === 'cooking' || status === 'ready';
}

export function paymentMethodLabel(method?: string | null): string {
  if (method === 'cash') return 'Наличные';
  if (method === 'card') return 'Карта';
  if (method === 'qr') return 'QR';
  return '';
}
