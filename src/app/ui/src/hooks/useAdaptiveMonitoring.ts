import { useState, useCallback } from 'react';

interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  timestamp: string;
}

interface AdaptiveConfig {
  refreshInterval: number;
  isAdaptive: boolean;
  baseInterval: number;
}

const REFRESH_INTERVALS = {
  healthy: 60000,    // 60s pro healthy status
  warning: 30000,    // 30s pro warning status
  critical: 10000,   // 10s pro critical status
  fast: 5000,        // 5s pro rychlé updates při problémech
  error: 120000      // 2min při connection errors
} as const;

export const useAdaptiveMonitoring = () => {
  const [config, setConfig] = useState<AdaptiveConfig>({
    refreshInterval: REFRESH_INTERVALS.healthy,
    isAdaptive: true,
    baseInterval: REFRESH_INTERVALS.healthy
  });

  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState<Date>(new Date());

  // Výpočet adaptivního intervalu na základě system health
  const calculateAdaptiveInterval = useCallback((healthStatus: HealthStatus, hasErrors: boolean = false): number => {
    if (!config.isAdaptive) {
      return config.baseInterval;
    }

    // Při connection errors, zpomal refresh
    if (hasErrors) {
      if (consecutiveErrors >= 3) {
        return REFRESH_INTERVALS.error;
      }
      return Math.min(config.refreshInterval * 1.5, REFRESH_INTERVALS.error);
    }

    // Reset error counter při úspěšném update
    if (consecutiveErrors > 0) {
      setConsecutiveErrors(0);
    }

    // Adaptive refresh podle system health
    switch (healthStatus.status) {
      case 'critical':
        // Při kritických issues, rychlé updates
        return healthStatus.issues.length > 2
          ? REFRESH_INTERVALS.fast
          : REFRESH_INTERVALS.critical;

      case 'warning':
        // Při warnings, střední frekvence
        return healthStatus.issues.length > 1
          ? REFRESH_INTERVALS.critical
          : REFRESH_INTERVALS.warning;

      case 'healthy': {
        // Při healthy state, pomalé updates
        const timeSinceLastSuccess = Date.now() - lastSuccessfulUpdate.getTime();

        // Pokud je systém dlouho healthy, můžeme ještě více zpomalit
        if (timeSinceLastSuccess > 300000) { // 5 minut
          return Math.min(config.baseInterval * 1.5, 90000); // max 90s
        }

        return config.baseInterval;
      }

      default:
        return REFRESH_INTERVALS.healthy;
    }
  }, [config, consecutiveErrors, lastSuccessfulUpdate]);

  // Hook pro handling update results
  const handleUpdateResult = useCallback((healthStatus?: HealthStatus, error?: Error) => {
    if (error) {
      setConsecutiveErrors(prev => prev + 1);
      // Při chybách, adaptvně zpomal
      setConfig(prev => ({
        ...prev,
        refreshInterval: calculateAdaptiveInterval(
          { status: 'critical', issues: [], timestamp: new Date().toISOString() },
          true
        )
      }));
    } else if (healthStatus) {
      setConsecutiveErrors(0);
      setLastSuccessfulUpdate(new Date());

      // Aktualizuj interval na základě health status
      const newInterval = calculateAdaptiveInterval(healthStatus, false);
      setConfig(prev => ({
        ...prev,
        refreshInterval: newInterval
      }));
    }
  }, [calculateAdaptiveInterval]);

  // API pro manual control
  const setAdaptiveMode = useCallback((enabled: boolean) => {
    setConfig(prev => ({
      ...prev,
      isAdaptive: enabled,
      refreshInterval: enabled ? prev.refreshInterval : prev.baseInterval
    }));
  }, []);

  const setBaseInterval = useCallback((interval: number) => {
    setConfig(prev => ({
      ...prev,
      baseInterval: interval,
      refreshInterval: prev.isAdaptive ? prev.refreshInterval : interval
    }));
  }, []);

  const forceReset = useCallback(() => {
    setConsecutiveErrors(0);
    setLastSuccessfulUpdate(new Date());
    setConfig(prev => ({
      ...prev,
      refreshInterval: prev.baseInterval
    }));
  }, []);

  // Poskytni debug info
  const getAdaptiveInfo = useCallback(() => ({
    currentInterval: config.refreshInterval,
    isAdaptive: config.isAdaptive,
    baseInterval: config.baseInterval,
    consecutiveErrors,
    lastSuccessfulUpdate,
    intervalType: config.refreshInterval === REFRESH_INTERVALS.healthy ? 'healthy' :
                 config.refreshInterval === REFRESH_INTERVALS.warning ? 'warning' :
                 config.refreshInterval === REFRESH_INTERVALS.critical ? 'critical' :
                 config.refreshInterval === REFRESH_INTERVALS.fast ? 'fast' :
                 config.refreshInterval === REFRESH_INTERVALS.error ? 'error' : 'custom'
  }), [config, consecutiveErrors, lastSuccessfulUpdate]);

  return {
    refreshInterval: config.refreshInterval,
    isAdaptive: config.isAdaptive,
    handleUpdateResult,
    setAdaptiveMode,
    setBaseInterval,
    forceReset,
    getAdaptiveInfo
  };
};