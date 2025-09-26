"use client"

import React, { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { useAdaptiveMonitoring } from '@/hooks/useAdaptiveMonitoring';
import { useCachedFetch } from '@/hooks/useCacheManager';
import { ErrorBoundary } from '@/components/performance/error-boundary';
import { VirtualTable } from '@/components/performance/virtual-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Server, Database, Activity, Zap, Users, Globe, TestTube,
  CheckCircle, XCircle, Clock, TrendingUp, TrendingDown,
  BarChart3, PieChart, AlertTriangle, Info, RefreshCw,
  Play, Pause, Home, ExternalLink
} from 'lucide-react';
import {
  LineChart as RechartsLineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart as RechartsPieChart, Pie, Cell
} from 'recharts';

interface DashboardData {
  timestamp: string;
  health: {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    timestamp: string;
  };
  system: {
    uptime: number;
    memory: { used: number; free: number; total: number; percentage: number; external: number; arrayBuffers: number; };
    cpu: { percentage: number; loadAverage: number[]; };
  };
  postgresql: {
    status: string; totalConnections: number; activeConnections: number;
    idleConnections: number; maxConnections: number; totalQueries: number;
    failedQueries: number; averageQueryTime: number;
    slowQueries: Array<{ query: string; duration: number; timestamp: Date; }>;
    connectionErrors: number; poolUtilization: number; replicationLag: number;
    databaseSize: string; tableStats: Array<{ table: string; rows: number; size: string; }>;
  };
  llm: Record<string, {
    provider: string; model: string; totalRequests: number; successfulRequests: number;
    failedRequests: number; averageResponseTime: number; totalTokensUsed: number;
    averageTokensPerRequest: number; lastRequestTime: Date; errorRate: number; requestsPerMinute: number;
  }>;
  memory: {
    totalKnowledge: number; totalReflections: number; vectorStorageSize: number;
    averageSearchTime: number; totalSearches: number; memoryEfficiencyScore: number;
    topSearchPatterns: Array<{ pattern: string; count: number; averageRelevance: number; }>;
    vectorOperations: { searches: number; insertions: number; updates: number; deletions: number; };
  };
  websocket: {
    activeConnections: number; messagesReceived: number; messagesSent: number;
    connectionErrors: number; averageLatency: number; peakConnections: number; bytesTransferred: number;
  };
  api: {
    totalRequests: number; requestsByEndpoint: Record<string, number>;
    averageResponseTime: Record<string, number>; errorsByEndpoint: Record<string, number>;
    popularEndpoints: Array<{ endpoint: string; count: number; averageTime: number; }>;
    statusCodes: Record<string, number>;
    throughput: { requestsPerSecond: number; averageResponseSize: number; };
  };
  sessions: { active: number; total: number; averageDuration: number; newSessions: number; expiredSessions: number; };
  testing: {
    totalTests: number; passedTests: number; failedTests: number;
    testSuites: Array<{ name: string; passed: number; failed: number; duration: number; }>;
    coverage: number; lastRun: Date; averageTestDuration: number;
    performanceTests: Array<{ name: string; threshold: number; actual: number; status: 'pass' | 'fail'; }>;
  };
}

// Optimized utility functions
const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Memoized components for performance
const StatusBadge = memo<{ status: string }>(({ status }) => {
  const getStatusConfig = useMemo(() => {
    switch (status) {
      case 'healthy': return {
        class: 'bg-green-100 text-green-800 border-green-200',
        icon: <CheckCircle className="w-4 h-4" />
      };
      case 'warning': return {
        class: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        icon: <AlertTriangle className="w-4 h-4" />
      };
      case 'critical': return {
        class: 'bg-red-100 text-red-800 border-red-200',
        icon: <XCircle className="w-4 h-4" />
      };
      default: return {
        class: 'bg-gray-100 text-gray-800 border-gray-200',
        icon: <Info className="w-4 h-4" />
      };
    }
  }, [status]);

  return (
    <Badge className={`${getStatusConfig.class} flex items-center gap-1 px-3 py-1`}>
      {getStatusConfig.icon}
      {status.toUpperCase()}
    </Badge>
  );
});

const MetricCard = memo<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  subtitle?: string;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'gray';
}>(({ title, value, icon, trend, subtitle, color = 'blue' }) => {
  const colorConfig = useMemo(() => ({
    gradient: {
      blue: 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-blue-200',
      green: 'bg-gradient-to-br from-green-500 to-green-600 text-white shadow-green-200',
      yellow: 'bg-gradient-to-br from-yellow-500 to-yellow-600 text-white shadow-yellow-200',
      red: 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-red-200',
      purple: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-purple-200',
      gray: 'bg-gradient-to-br from-gray-500 to-gray-600 text-white shadow-gray-200'
    },
    background: {
      blue: 'bg-blue-50 border-blue-100',
      green: 'bg-green-50 border-green-100',
      yellow: 'bg-yellow-50 border-yellow-100',
      red: 'bg-red-50 border-red-100',
      purple: 'bg-purple-50 border-purple-100',
      gray: 'bg-gray-50 border-gray-100'
    }
  }), []);

  return (
    <Card className={`transition-all duration-300 hover:shadow-lg hover:scale-105 border ${colorConfig.background[color]} bg-white`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <div className={`p-4 rounded-xl ${colorConfig.gradient[color]} shadow-lg`}>
            {icon}
          </div>
        </div>
        {trend && (
          <div className="flex items-center mt-4 pt-4 border-t border-gray-100">
            {trend === 'up' && <TrendingUp className="w-4 h-4 text-green-500" />}
            {trend === 'down' && <TrendingDown className="w-4 h-4 text-red-500" />}
            {trend === 'neutral' && <Activity className="w-4 h-4 text-gray-500" />}
            <span className={`text-sm ml-2 font-medium ${
              trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-600'
            }`}>
              {trend === 'up' ? '↗ Trending up' : trend === 'down' ? '↘ Trending down' : '→ Stable'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

const OptimizedMonitoringDashboardInternal: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedView, setSelectedView] = useState<'overview' | 'database' | 'api' | 'testing'>('overview');

  // Adaptive monitoring with caching
  const { refreshInterval, isAdaptive, handleUpdateResult, setAdaptiveMode, getAdaptiveInfo } = useAdaptiveMonitoring();

  const { fetchData, loading, error, cacheStats } = useCachedFetch<DashboardData>(
    '/api/monitoring/dashboard',
    {},
    { defaultTTL: 30000, staleWhileRevalidate: true }
  );

  const fetchDashboardData = useCallback(async () => {
    try {
      const result = await fetchData();
      if (result) {
        setData(result);
        handleUpdateResult(result.health);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch dashboard data');
      console.error('Dashboard fetch error:', err);
      handleUpdateResult(undefined, error);
    }
  }, [fetchData, handleUpdateResult]);

  useEffect(() => { fetchDashboardData(); }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchDashboardData, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchDashboardData]);

  // Memoized expensive calculations
  const statusCodeData = useMemo(() =>
    data?.api?.statusCodes
      ? Object.entries(data.api.statusCodes).map(([code, count]) => ({
          name: code,
          value: count,
          fill: code.startsWith('2') ? '#10b981' : code.startsWith('4') ? '#f59e0b' : '#ef4444'
        }))
      : [],
    [data?.api?.statusCodes]
  );

  const performanceData = useMemo(() =>
    data?.api?.popularEndpoints?.map(ep => ({
      name: ep.endpoint.split('/').pop() || ep.endpoint,
      responseTime: ep.averageTime,
      requests: ep.count
    })) || [],
    [data?.api?.popularEndpoints]
  );

  const tableColumns = useMemo(() => [
    { key: 'endpoint' as keyof any, header: 'Endpoint', width: 200 },
    { key: 'count' as keyof any, header: 'Requests', width: 100 },
    { key: 'averageTime' as keyof any, header: 'Avg Time (ms)', width: 120 }
  ], []);

  const sidebarItems = useMemo(() => [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'database', label: 'Database', icon: <Database className="w-5 h-5" /> },
    { id: 'api', label: 'API Endpoints', icon: <Globe className="w-5 h-5" /> },
    { id: 'testing', label: 'Testing', icon: <TestTube className="w-5 h-5" /> },
  ] as const, []);

  if (loading && !data) {
    return (
      <div className="flex h-screen bg-white">
        <div className="w-64 bg-gray-50 border-r border-gray-200 animate-pulse">
          <div className="p-6 space-y-4">
            <div className="h-8 bg-gray-200 rounded"></div>
            <div className="h-6 bg-gray-200 rounded w-3/4"></div>
            <div className="space-y-2 mt-6">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-10 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1 p-6 animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-6 w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-screen bg-white">
        <div className="w-64 bg-gray-50 border-r border-gray-200">
          <div className="p-6">
            <h2 className="text-xl font-semibold text-gray-900">Dashboard</h2>
            <p className="text-gray-600 text-sm mt-1">System monitoring</p>
          </div>
        </div>
        <div className="flex-1 p-6">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Failed to load monitoring dashboard: {error?.message || 'No data available'}
              {cacheStats.total > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  Cache: {cacheStats.valid} valid, {cacheStats.stale} stale entries
                </div>
              )}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Optimized Monitoring</h2>
          <p className="text-gray-600 text-sm mt-1">Real-time system performance</p>

          <div className="flex flex-col gap-2 mt-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className="bg-white text-xs"
              >
                {autoRefresh ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                {autoRefresh ? 'Pause' : 'Auto'}
              </Button>
              <Button size="sm" onClick={fetchDashboardData} className="bg-blue-500 hover:bg-blue-600 text-white text-xs">
                <RefreshCw className="w-3 h-3 mr-1" />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdaptiveMode(!isAdaptive)}
                className={`text-xs ${isAdaptive ? 'bg-green-50 text-green-700 border-green-300' : 'bg-white'}`}
              >
                <Zap className={`w-3 h-3 mr-1 ${isAdaptive ? 'text-green-600' : ''}`} />
                {isAdaptive ? 'Smart' : 'Fixed'}
              </Button>
            </div>

            {autoRefresh && (
              <div className="text-xs text-gray-500">
                Refresh: {(refreshInterval / 1000)}s
                {isAdaptive && (
                  <span className="text-green-600 ml-1">
                    ({getAdaptiveInfo().intervalType})
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {sidebarItems.map((item) => (
              <li key={item.id}>
                <Button
                  variant={selectedView === item.id ? 'default' : 'ghost'}
                  className={`w-full justify-start ${
                    selectedView === item.id
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  onClick={() => setSelectedView(item.id as any)}
                >
                  {item.icon}
                  <span className="ml-3">{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Status</span>
              <StatusBadge status={data?.health?.status || 'unknown'} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Uptime</span>
              <span className="text-gray-900 font-medium">
                {formatUptime(data?.system?.uptime || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Memory</span>
              <span className="text-gray-900 font-medium">
                {data?.system?.memory?.percentage?.toFixed(1) || 0}%
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <div className="space-y-2">
            <a
              href="/"
              className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Home className="w-4 h-4" />
              <span>Cipher Welcome Page</span>
              <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
            </a>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 capitalize">{selectedView}</h1>
              <p className="text-gray-600 text-sm mt-1">
                {selectedView === 'overview' && 'System overview and key metrics'}
                {selectedView === 'database' && 'PostgreSQL performance and statistics'}
                {selectedView === 'api' && 'API endpoints and response metrics'}
                {selectedView === 'testing' && 'Test results and performance metrics'}
              </p>
            </div>

            <div className="text-sm text-gray-500">
              Last updated: {new Date(data?.timestamp || Date.now()).toLocaleTimeString()}
              {autoRefresh && <span className="ml-2 text-green-600">• Live</span>}
              {process.env.NODE_ENV === 'development' && (
                <div className="text-xs mt-1">
                  Cache: {cacheStats.valid}V/{cacheStats.stale}S/{cacheStats.expired}E
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
          {data?.health?.status !== 'healthy' && data?.health?.status && (
            <div className="mb-6">
              <Alert className={`border-2 ${
                data.health?.status === 'warning' ? 'border-yellow-200 bg-yellow-50' : 'border-red-200 bg-red-50'
              }`}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold">System Health Issues Detected</span>
                      <ul className="mt-1 list-disc list-inside text-sm">
                        {(data.health?.issues || []).map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                    <StatusBadge status={data.health?.status || 'unknown'} />
                  </div>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Overview View */}
          {selectedView === 'overview' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  title="System Uptime"
                  value={formatUptime(data?.system?.uptime || 0)}
                  icon={<Server className="w-7 h-7" />}
                  color="green"
                  trend="up"
                />
                <MetricCard
                  title="Memory Usage"
                  value={`${data?.system?.memory?.percentage?.toFixed(1) || 0}%`}
                  icon={<Server className="w-7 h-7" />}
                  color={(data?.system?.memory?.percentage || 0) > 80 ? 'red' : 'blue'}
                  subtitle={formatBytes(data?.system?.memory?.used || 0)}
                />
                <MetricCard
                  title="Active Sessions"
                  value={data?.sessions?.active || 0}
                  icon={<Users className="w-7 h-7" />}
                  color="purple"
                  trend="up"
                />
                <MetricCard
                  title="API Requests/sec"
                  value={data?.api?.throughput?.requestsPerSecond || 0}
                  icon={<Zap className="w-7 h-7" />}
                  color="blue"
                  trend="up"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
                <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-gray-900">
                      <div className="p-2 bg-blue-50 rounded-lg">
                        <Server className="w-5 h-5 text-blue-600" />
                      </div>
                      System Resources
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Memory</span>
                        <span>{data?.system?.memory?.percentage?.toFixed(1) || 0}%</span>
                      </div>
                      <Progress value={data?.system?.memory?.percentage || 0} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>CPU</span>
                        <span>{data?.system?.cpu?.percentage?.toFixed(1) || 0}%</span>
                      </div>
                      <Progress value={data?.system?.cpu?.percentage || 0} className="h-2" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-gray-900">
                      <div className="p-2 bg-green-50 rounded-lg">
                        <PieChart className="w-5 h-5 text-green-600" />
                      </div>
                      API Status Codes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <RechartsPieChart>
                        <Pie
                          data={statusCodeData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {statusCodeData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {/* Other views would be similar optimizations... */}
        </div>
      </div>
    </div>
  );
};

// Export with ErrorBoundary wrapper
export const OptimizedMonitoringDashboard: React.FC = memo(() => (
  <ErrorBoundary>
    <OptimizedMonitoringDashboardInternal />
  </ErrorBoundary>
));