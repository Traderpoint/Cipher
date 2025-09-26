"use client"

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Server,
  Database,
  Activity,
  Zap,
  Users,
  Globe,
  TestTube,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart,
  LineChart,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  AlertTriangle,
  Info,
  RefreshCw,
  Play,
  Pause,
  Eye,
  Home,
  ExternalLink
} from 'lucide-react';
import {
  LineChart as RechartsLineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell
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
    memory: {
      used: number;
      free: number;
      total: number;
      percentage: number;
      external: number;
      arrayBuffers: number;
    };
    cpu: {
      percentage: number;
      loadAverage: number[];
    };
  };
  postgresql: {
    status: string;
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    maxConnections: number;
    totalQueries: number;
    failedQueries: number;
    averageQueryTime: number;
    slowQueries: Array<{
      query: string;
      duration: number;
      timestamp: Date;
    }>;
    connectionErrors: number;
    poolUtilization: number;
    replicationLag: number;
    databaseSize: string;
    tableStats: Array<{
      table: string;
      rows: number;
      size: string;
    }>;
  };
  llm: Record<string, {
    provider: string;
    model: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    totalTokensUsed: number;
    averageTokensPerRequest: number;
    lastRequestTime: Date;
    errorRate: number;
    requestsPerMinute: number;
  }>;
  memory: {
    totalKnowledge: number;
    totalReflections: number;
    vectorStorageSize: number;
    averageSearchTime: number;
    totalSearches: number;
    memoryEfficiencyScore: number;
    topSearchPatterns: Array<{
      pattern: string;
      count: number;
      averageRelevance: number;
    }>;
    vectorOperations: {
      searches: number;
      insertions: number;
      updates: number;
      deletions: number;
    };
  };
  websocket: {
    activeConnections: number;
    messagesReceived: number;
    messagesSent: number;
    connectionErrors: number;
    averageLatency: number;
    peakConnections: number;
    bytesTransferred: number;
  };
  api: {
    totalRequests: number;
    requestsByEndpoint: Record<string, number>;
    averageResponseTime: Record<string, number>;
    errorsByEndpoint: Record<string, number>;
    popularEndpoints: Array<{
      endpoint: string;
      count: number;
      averageTime: number;
    }>;
    statusCodes: Record<string, number>;
    throughput: {
      requestsPerSecond: number;
      averageResponseSize: number;
    };
  };
  sessions: {
    active: number;
    total: number;
    averageDuration: number;
    newSessions: number;
    expiredSessions: number;
  };
  testing: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    testSuites: Array<{
      name: string;
      passed: number;
      failed: number;
      duration: number;
    }>;
    coverage: number;
    lastRun: Date;
    averageTestDuration: number;
    performanceTests: Array<{
      name: string;
      threshold: number;
      actual: number;
      status: 'pass' | 'fail';
    }>;
  };
}

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

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-100 text-green-800 border-green-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="w-4 h-4" />;
      case 'warning': return <AlertTriangle className="w-4 h-4" />;
      case 'critical': return <XCircle className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  return (
    <Badge className={`${getStatusColor(status)} flex items-center gap-1 px-3 py-1`}>
      {getStatusIcon(status)}
      {status.toUpperCase()}
    </Badge>
  );
};

const MetricCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  subtitle?: string;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'gray';
}> = ({ title, value, icon, trend, subtitle, color = 'blue' }) => {
  const colorClasses = {
    blue: 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-blue-200',
    green: 'bg-gradient-to-br from-green-500 to-green-600 text-white shadow-green-200',
    yellow: 'bg-gradient-to-br from-yellow-500 to-yellow-600 text-white shadow-yellow-200',
    red: 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-red-200',
    purple: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-purple-200',
    gray: 'bg-gradient-to-br from-gray-500 to-gray-600 text-white shadow-gray-200'
  };

  const backgroundColors = {
    blue: 'bg-blue-50 border-blue-100',
    green: 'bg-green-50 border-green-100',
    yellow: 'bg-yellow-50 border-yellow-100',
    red: 'bg-red-50 border-red-100',
    purple: 'bg-purple-50 border-purple-100',
    gray: 'bg-gray-50 border-gray-100'
  };

  return (
    <Card className={`transition-all duration-300 hover:shadow-lg hover:scale-105 border ${backgroundColors[color]} bg-white`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <div className={`p-4 rounded-xl ${colorClasses[color]} shadow-lg`}>
            {icon}
          </div>
        </div>
        {trend && (
          <div className="flex items-center mt-4 pt-4 border-t border-gray-100">
            {trend === 'up' ? (
              <TrendingUp className="w-4 h-4 text-green-500" />
            ) : trend === 'down' ? (
              <TrendingDown className="w-4 h-4 text-red-500" />
            ) : (
              <Activity className="w-4 h-4 text-gray-500" />
            )}
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
};

export const AdvancedMonitoringDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedView, setSelectedView] = useState<'overview' | 'database' | 'api' | 'testing'>('overview');

  const fetchDashboardData = useCallback(async () => {
    try {
      const response = await fetch('/api/monitoring/dashboard');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const dashboardData = await response.json();
      setData(dashboardData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchDashboardData, 60000); // Refresh every 60 seconds
    return () => clearInterval(interval);
  }, [autoRefresh, fetchDashboardData]);

  if (loading) {
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

  if (error || !data) {
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
              Failed to load monitoring dashboard: {error || 'No data available'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const statusCodeData = data.api?.statusCodes
    ? Object.entries(data.api.statusCodes).map(([code, count]) => ({
        name: code,
        value: count,
        fill: code.startsWith('2') ? '#10b981' : code.startsWith('4') ? '#f59e0b' : '#ef4444'
      }))
    : [];

  const performanceData = data.api?.popularEndpoints?.map(ep => ({
    name: ep.endpoint.split('/').pop() || ep.endpoint,
    responseTime: ep.averageTime,
    requests: ep.count
  })) || [];

  const sidebarItems = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'database', label: 'Database', icon: <Database className="w-5 h-5" /> },
    { id: 'api', label: 'API Endpoints', icon: <Globe className="w-5 h-5" /> },
    { id: 'testing', label: 'Testing', icon: <TestTube className="w-5 h-5" /> },
  ] as const;

  return (
    <div className="flex h-screen bg-white">
      {/* Left Sidebar */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Advanced Monitoring</h2>
          <p className="text-gray-600 text-sm mt-1">Real-time system performance</p>

          {/* Auto-refresh controls */}
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="bg-white text-xs"
            >
              {autoRefresh ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
              {autoRefresh ? 'Pause' : 'Auto'}
            </Button>
            <Button
              size="sm"
              onClick={fetchDashboardData}
              className="bg-blue-500 hover:bg-blue-600 text-white text-xs"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Navigation Menu */}
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

        {/* System Status in Sidebar */}
        <div className="p-4 border-t border-gray-200">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Status</span>
              <StatusBadge status={data.health?.status || 'unknown'} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Uptime</span>
              <span className="text-gray-900 font-medium">
                {formatUptime(data.system?.uptime || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Memory</span>
              <span className="text-gray-900 font-medium">
                {data.system?.memory?.percentage?.toFixed(1) || 0}%
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
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
        {/* Header */}
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

            {/* Last updated indicator */}
            <div className="text-sm text-gray-500">
              Last updated: {new Date(data.timestamp || Date.now()).toLocaleTimeString()}
              {autoRefresh && <span className="ml-2 text-green-600">• Live</span>}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
          {/* Health Status Alert */}
          {data.health?.status !== 'healthy' && data.health?.status && (
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

      {selectedView === 'overview' && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="System Uptime"
              value={formatUptime(data.system?.uptime || 0)}
              icon={<Server className="w-7 h-7" />}
              color="green"
              trend="up"
            />
            <MetricCard
              title="Memory Usage"
              value={`${data.system?.memory?.percentage?.toFixed(1) || 0}%`}
              icon={<Cpu className="w-7 h-7" />}
              color={(data.system?.memory?.percentage || 0) > 80 ? 'red' : 'blue'}
              subtitle={formatBytes(data.system?.memory?.used || 0)}
            />
            <MetricCard
              title="Active Sessions"
              value={data.sessions?.active || 0}
              icon={<Users className="w-7 h-7" />}
              color="purple"
              trend="up"
            />
            <MetricCard
              title="API Requests/sec"
              value={data.api?.throughput?.requestsPerSecond || 0}
              icon={<Zap className="w-7 h-7" />}
              color="blue"
              trend="up"
            />
          </div>

          {/* System Overview */}
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
                    <span>{data.system?.memory?.percentage?.toFixed(1) || 0}%</span>
                  </div>
                  <Progress value={data.system?.memory?.percentage || 0} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>CPU</span>
                    <span>{data.system?.cpu?.percentage?.toFixed(1) || 0}%</span>
                  </div>
                  <Progress value={data.system?.cpu?.percentage || 0} className="h-2" />
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

      {selectedView === 'database' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="DB Connections"
              value={`${data.postgresql?.activeConnections || 0}/${data.postgresql?.maxConnections || 0}`}
              icon={<Database className="w-7 h-7" />}
              color="blue"
              subtitle={`${data.postgresql?.poolUtilization?.toFixed(1) || 0}% utilized`}
            />
            <MetricCard
              title="Total Queries"
              value={data.postgresql?.totalQueries?.toLocaleString() || '0'}
              icon={<BarChart3 className="w-7 h-7" />}
              color="green"
              trend="up"
            />
            <MetricCard
              title="Avg Query Time"
              value={`${data.postgresql?.averageQueryTime || 0}ms`}
              icon={<Clock className="w-7 h-7" />}
              color="yellow"
            />
            <MetricCard
              title="Failed Queries"
              value={data.postgresql?.failedQueries || 0}
              icon={<XCircle className="w-7 h-7" />}
              color="red"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <Database className="w-5 h-5 text-blue-600" />
                  </div>
                  Database Tables
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(data.postgresql?.tableStats || []).map((table, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium">{table.table}</p>
                        <p className="text-sm text-gray-600">{table.rows.toLocaleString()} rows</p>
                      </div>
                      <span className="text-sm font-medium">{table.size}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <div className="p-2 bg-red-50 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                  </div>
                  Slow Queries
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(data.postgresql?.slowQueries || []).map((query, i) => (
                    <div key={i} className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <p className="font-mono text-sm text-gray-800 truncate">{query.query}</p>
                      <p className="text-sm text-red-600 mt-1">{query.duration}ms</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {selectedView === 'api' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Requests"
              value={data.api?.totalRequests?.toLocaleString() || '0'}
              icon={<Globe className="w-7 h-7" />}
              color="blue"
              trend="up"
            />
            <MetricCard
              title="Requests/sec"
              value={data.api?.throughput?.requestsPerSecond || 0}
              icon={<Zap className="w-7 h-7" />}
              color="green"
            />
            <MetricCard
              title="Avg Response Size"
              value={formatBytes(data.api?.throughput?.averageResponseSize || 0)}
              icon={<HardDrive className="w-7 h-7" />}
              color="purple"
            />
            <MetricCard
              title="WebSocket Connections"
              value={data.websocket?.activeConnections || 0}
              icon={<Network className="w-7 h-7" />}
              color="yellow"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <div className="p-2 bg-purple-50 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-purple-600" />
                  </div>
                  Endpoint Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="responseTime" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <div className="p-2 bg-green-50 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                  </div>
                  Popular Endpoints
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(data.api?.popularEndpoints || []).map((endpoint, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-mono text-xs truncate flex-1 mr-2">{endpoint.endpoint}</span>
                        <span className="font-medium">{endpoint.count.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Avg: {endpoint.averageTime}ms</span>
                      </div>
                      <Progress value={Math.min(100, (endpoint.count / Math.max(...(data.api?.popularEndpoints || []).map(e => e.count)) * 100))} className="h-1" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {selectedView === 'testing' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Tests"
              value={data.testing?.totalTests || 0}
              icon={<TestTube className="w-7 h-7" />}
              color="blue"
            />
            <MetricCard
              title="Passed Tests"
              value={data.testing?.passedTests || 0}
              icon={<CheckCircle className="w-7 h-7" />}
              color="green"
            />
            <MetricCard
              title="Failed Tests"
              value={data.testing?.failedTests || 0}
              icon={<XCircle className="w-7 h-7" />}
              color="red"
            />
            <MetricCard
              title="Test Coverage"
              value={`${data.testing?.coverage || 0}%`}
              icon={<Eye className="w-7 h-7" />}
              color="purple"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <TestTube className="w-5 h-5 text-blue-600" />
                  </div>
                  Test Suites
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(data.testing?.testSuites || []).map((suite, i) => (
                    <div key={i} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex justify-between items-center mb-2">
                        <h4 className="font-medium">{suite.name}</h4>
                        <span className="text-sm text-gray-500">{suite.duration}ms</span>
                      </div>
                      <div className="flex gap-4 text-sm">
                        <span className="text-green-600">✓ {suite.passed} passed</span>
                        {suite.failed > 0 && <span className="text-red-600">✗ {suite.failed} failed</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900">
                  <div className="p-2 bg-yellow-50 rounded-lg">
                    <Zap className="w-5 h-5 text-yellow-600" />
                  </div>
                  Performance Tests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(data.testing?.performanceTests || []).map((test, i) => (
                    <div key={i} className={`p-3 rounded-lg ${
                      test.status === 'pass' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                    }`}>
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{test.name}</span>
                        <div className="flex items-center gap-2">
                          {test.status === 'pass' ?
                            <CheckCircle className="w-4 h-4 text-green-600" /> :
                            <XCircle className="w-4 h-4 text-red-600" />
                          }
                          <span className="text-sm">{test.actual}/{test.threshold}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
};