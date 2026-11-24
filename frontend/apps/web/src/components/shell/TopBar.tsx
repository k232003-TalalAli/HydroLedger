import type { Role } from '@hydroledger/shared';
import { ROLES } from '@hydroledger/shared';
import { Button, Chip, StatusGlyph, type StatusKind } from '@/components/ui';
import { t } from '@/lib/i18n';
import { truncateHash } from '@/lib/format';
import { isDevRoleSwitcherEnabled, useSessionStore, type NetworkHealth } from '@/store/session';
import { Logo } from './Logo';
import { ScenarioSwitcher } from './ScenarioSwitcher';

function networkToStatus(health: NetworkHealth): StatusKind {
  if (health === 'connected') return 'normal';
  if (health === 'lagging') return 'warning';
  return 'offline';
}

export function TopBar() {
  const role = useSessionStore((s) => s.role);
  const setRole = useSessionStore((s) => s.setRole);
  const walletAddress = useSessionStore((s) => s.walletAddress);
  const setWalletAddress = useSessionStore((s) => s.setWalletAddress);
  const chainName = useSessionStore((s) => s.chainName);
  const blockNumber = useSessionStore((s) => s.blockNumber);
  const networkHealth = useSessionStore((s) => s.networkHealth);
  const activeAlertCount = useSessionStore((s) => s.activeAlertCount);
  const showRoleSwitcher = isDevRoleSwitcherEnabled();

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-bg px-4">
      <Logo />

      <div className="ml-2 hidden items-center gap-2 md:flex">
        <StatusGlyph
          status={networkToStatus(networkHealth)}
          label={t(`network.status.${networkHealth}`)}
          showLabel={false}
        />
        <span className="font-mono text-[11px] text-text-2">
          {chainName}
          {blockNumber != null ? ` · #${blockNumber.toLocaleString()}` : ''}
        </span>
        <span className="sr-only">{t(`network.status.${networkHealth}`)}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-btn border border-border text-text hover:border-accent"
          aria-label={t('topbar.notifications')}
        >
          <BellIcon />
          {activeAlertCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-btn bg-accent px-1 font-mono text-[10px] text-accent-ink">
              {activeAlertCount}
            </span>
          ) : null}
        </button>

        <Chip accent>
          <span className="uppercase tracking-label">{t(`role.${role}`)}</span>
        </Chip>

        {showRoleSwitcher ? (
          <>
            <ScenarioSwitcher />
            <label className="hidden items-center gap-1 sm:flex">
              <span className="sr-only">Dev role switcher</span>
              <select
                className="h-8 rounded-btn border border-border bg-surface px-2 font-mono text-[11px] text-text"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                aria-label="Switch role (dev)"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setWalletAddress(walletAddress ? null : '0x9f3a12AbCdEf9876543210FeDcBa0987654321c21e')
          }
        >
          {walletAddress ? truncateHash(walletAddress) : t('topbar.connectWallet')}
        </Button>
      </div>
    </header>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5v2.2L3 9.5h10l-1.5-2.3V5A3.5 3.5 0 0 0 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M6.5 12a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
