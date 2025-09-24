"use client"

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  timestamp: string;
}

interface DashboardData {
  timestamp: string;
  health: HealthStatus;
  summary: {
    uptime: number;
    memoryUsage: number;
    activeConnections: number;
    activeSessions: number;
    totalKnowledge: number;
    llm: {
      totalRequests: number;
      averageResponseTime: number;
      providers: number;
    };
    api: {
      totalRequests: number;
      averageResponseTime: number;
      endpoints: number;
    };
  };
  charts: {
    memoryUsage: {
      current: number;
      threshold: number;
    };
    llmPerformance: Array<{
      provider: string;
      requests: number;
      avgTime: number;
      errorRate: number;
      tokens: number;
    }>;
    apiEndpoints: Array<{
      endpoint: string;
      count: number;
      averageTime: number;
    }>;
    searchPatterns: Array<{
      pattern: string;
      count: number;
      averageRelevance: number;
    }>;
    websocketActivity: {
      received: number;
      sent: number;
      errors: number;
    };
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
      case 'healthy': return 'bg-green-100 text-green-800';
      case 'warning': return 'bg-yellow-100 text-yellow-800';
      case 'critical': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Badge className={getStatusColor(status)}>
      {status.toUpperCase()}
    </Badge>
  );
};

export const MonitoringDashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

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

    const interval = setInterval(fetchDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [autoRefresh, fetchDashboardData]);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4"></div>
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
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load monitoring dashboard: {error || 'No data available'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">System Monitoring</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '⏸ Pause' : '▶ Resume'} Auto-refresh
          </Button>
          <Button onClick={fetchDashboardData}>
            🔄 Refresh
          </Button>
        </div>
      </div>

      {/* Health Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle>System Health</CardTitle>
            <StatusBadge status={data.health.status} />
          </div>
        </CardHeader>
        <CardContent>
          {data.health.issues.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Issues:</p>
              <ul className="space-y-1">
                {data.health.issues.map((issue, i) => (
                  <li key={i} className="text-sm text-red-600 flex items-center">
                    <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.health.issues.length === 0 && (
            <p className="text-green-600">All systems operational</p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Last updated: {new Date(data.timestamp).toLocaleString()}
          </p>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatUptime(data.summary.uptime)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Memory Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.summary.memoryUsage.toFixed(1)}%</p>
            <Progress value={data.summary.memoryUsage} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.summary.activeConnections}</p>
            <p className="text-xs text-gray-500">{data.summary.activeSessions} sessions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Knowledge Base</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.summary.totalKnowledge.toLocaleString()}</p>
            <p className="text-xs text-gray-500">items stored</p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LLM Performance */}
        <Card>
          <CardHeader>
            <CardTitle>LLM Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {data.charts.llmPerformance.length > 0 ? (
              <div className="space-y-4">
                {data.charts.llmPerformance.map((llm, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{llm.provider}</span>
                      <span>{llm.requests.toLocaleString()} requests</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Avg: {llm.avgTime.toFixed(0)}ms</span>
                      <span>Error: {(llm.errorRate * 100).toFixed(1)}%</span>
                      <span>Tokens: {llm.tokens.toLocaleString()}</span>
                    </div>
                    <Progress value={Math.min(100, (llm.requests / Math.max(...data.charts.llmPerformance.map(l => l.requests)) * 100))} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No LLM activity recorded</p>
            )}
          </CardContent>
        </Card>

        {/* API Endpoints */}
        <Card>
          <CardHeader>
            <CardTitle>Popular API Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            {data.charts.apiEndpoints.length > 0 ? (
              <div className="space-y-3">
                {data.charts.apiEndpoints.map((endpoint, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-mono text-xs">{endpoint.endpoint}</span>
                      <span>{endpoint.count}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Avg: {endpoint.averageTime.toFixed(0)}ms</span>
                    </div>
                    <Progress value={Math.min(100, (endpoint.count / Math.max(...data.charts.apiEndpoints.map(e => e.count)) * 100))} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No API activity recorded</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Search Patterns and WebSocket Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top Search Patterns</CardTitle>
          </CardHeader>
          <CardContent>
            {data.charts.searchPatterns.length > 0 ? (
              <div className="space-y-3">
                {data.charts.searchPatterns.slice(0, 5).map((pattern, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="truncate flex-1 mr-2">{pattern.pattern || 'Unknown'}</span>
                      <span>{pattern.count}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Relevance: {(pattern.averageRelevance * 100).toFixed(1)}%</span>
                    </div>
                    <Progress value={Math.min(100, (pattern.count / Math.max(...data.charts.searchPatterns.map(p => p.count)) * 100))} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No search activity recorded</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>WebSocket Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-blue-600">{data.charts.websocketActivity.received}</p>
                <p className="text-xs text-gray-500">Received</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{data.charts.websocketActivity.sent}</p>
                <p className="text-xs text-gray-500">Sent</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{data.charts.websocketActivity.errors}</p>
                <p className="text-xs text-gray-500">Errors</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};