import type { Alert, CitizenSnapshot, DashboardSnapshot } from './types';

export function toCitizenAlertSummary(
  alert: Alert,
): Pick<Alert, 'id' | 'reason' | 'severity' | 'title' | 'detectedAt' | 'status' | 'sectorId'> {
  return {
    id: alert.id,
    reason: alert.reason,
    severity: alert.severity,
    title: alert.title,
    detectedAt: alert.detectedAt,
    status: alert.status,
    sectorId: alert.sectorId,
  };
}

export function assertNoOperatorFields(citizen: CitizenSnapshot): void {
  const json = JSON.stringify(citizen);
  if (json.includes('PRIVATE_KEY') || json.includes('walletAddress')) {
    throw new Error('Citizen DTO must not expose operator secrets');
  }
}

export type { DashboardSnapshot, CitizenSnapshot };
