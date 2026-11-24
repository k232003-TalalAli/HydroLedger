/** Simple i18n-ready wrapper — English only for Phase 1. */

const strings = {
  'app.name': 'HYDROLEDGER',
  'nav.overview': 'Overview',
  'nav.flow': 'Live Flow',
  'nav.alerts': 'Alerts',
  'nav.quotas': 'Quotas',
  'nav.ledger': 'Ledger',
  'nav.valves': 'Valves',
  'nav.reports': 'Reports',
  'nav.admin': 'Admin',
  'topbar.connectWallet': 'Connect Wallet',
  'topbar.switchNetwork': 'Switch network',
  'topbar.notifications': 'Notifications',
  'role.citizen': 'Citizen',
  'role.operator': 'Operator',
  'role.admin': 'Admin',
  'network.connected': 'Connected',
  'network.lagging': 'Lagging',
  'network.unreachable': 'Unreachable',
  'network.status.connected': 'Connected',
  'network.status.lagging': 'Lagging',
  'network.status.unreachable': 'Unreachable',
  'page.placeholder': 'Coming in a later phase.',
  'empty.default': 'Nothing here yet.',
  'error.retry': 'Retry',
  'status.normal': 'Normal',
  'status.warning': 'Warning',
  'status.critical': 'Critical',
  'status.offline': 'Offline',
  'status.stale': 'Stale',
} as const;

export type MessageKey = keyof typeof strings;

export function t(key: MessageKey): string {
  return strings[key];
}
