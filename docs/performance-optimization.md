# Performance Optimization Guide

This guide covers performance optimization techniques and configurations for Cipher to handle high-load scenarios.

## Connection Pool Optimization

### PostgreSQL Connection Pool

Cipher uses connection pooling to efficiently manage database connections. The default settings have been optimized for better performance:

**Default Configuration:**
- **Maximum Connections**: 20 (increased from 10)
- **Minimum Connections**: 2
- **Idle Timeout**: 30,000ms
- **Connection Timeout**: 10,000ms

**Environment Variable Configuration:**
```bash
# PostgreSQL URL with connection limit
CIPHER_PG_URL="postgresql://user:pass@localhost:5432/cipher_db?max_connections=20"
```

**Programmatic Configuration:**
```yaml
# In memAgent/cipher.yml
storage:
  backend: postgresql
  config:
    maxConnections: 20
    pool:
      max: 20
      min: 2
      idleTimeoutMillis: 30000
      connectionTimeoutMillis: 10000
```

### Vector Storage Connection Pool

For vector storage operations (Milvus, Qdrant, etc.), connection pooling is also optimized:

**Milvus Connection Pool:**
- **Maximum Connections**: 20 (increased from 10)
- **Connection TTL**: 5 minutes
- **Health Check Interval**: 1 minute

**Configuration Location:**
- File: `src/core/vector_storage/connection-pool.ts`
- Setting: `maxConnections = 20`

## Memory Management

### System Memory Optimization

Monitor and optimize memory usage through the advanced monitoring dashboard:

**Key Metrics to Watch:**
- Memory utilization should stay below 80%
- PostgreSQL connection pool utilization
- Vector storage memory usage

**Access Monitoring:**
- URL: `http://localhost:3000/advanced-monitoring`
- Real-time memory usage tracking
- Connection pool statistics

### Memory Usage Best Practices

1. **Regular Memory Cleanup**
   - Automatic garbage collection for idle connections
   - Memory-efficient vector operations
   - Session cleanup for expired conversations

2. **Connection Pool Monitoring**
   - Monitor active vs idle connections
   - Track connection pool utilization percentage
   - Set alerts for high utilization (>90%)

## Performance Monitoring

### Health Status Indicators

The monitoring system tracks several key performance indicators:

**System Health Status:**
- **Healthy**: All systems operating normally
- **Warning**: High resource usage or minor issues
- **Critical**: System degradation requiring attention

**Key Performance Metrics:**
- API response times
- Database query performance
- Memory usage percentage
- Connection pool utilization
- WebSocket connection health

### Troubleshooting Performance Issues

**High Memory Usage Warning:**
1. Check system memory utilization in monitoring dashboard
2. Review active connections in PostgreSQL pool
3. Consider increasing system resources or optimizing queries

**Database Connection Pool Exhaustion:**
1. Monitor connection pool utilization
2. Increase `maxConnections` if needed
3. Optimize query patterns to reduce connection hold time
4. Check for connection leaks in application code

**Slow Query Performance:**
1. Review slow queries in monitoring dashboard
2. Add database indexes for frequently queried fields
3. Optimize complex queries with JOIN operations
4. Consider query result caching

## Configuration Recommendations

### High-Load Environment

For high-traffic deployments, consider these optimizations:

```yaml
# memAgent/cipher.yml - High Load Configuration
storage:
  backend: postgresql
  config:
    maxConnections: 50
    pool:
      max: 50
      min: 10
      idleTimeoutMillis: 60000
      connectionTimeoutMillis: 15000

# Vector storage optimization
vectorStorage:
  config:
    maxConnections: 30
    connectionTtl: 600000  # 10 minutes
    healthCheckInterval: 30000  # 30 seconds
```

### Development Environment

For development setups, use conservative settings:

```yaml
# memAgent/cipher.yml - Development Configuration
storage:
  backend: postgresql
  config:
    maxConnections: 10
    pool:
      max: 10
      min: 2
      idleTimeoutMillis: 30000
      connectionTimeoutMillis: 10000
```

## Monitoring and Alerts

### Key Metrics to Monitor

1. **System Resources**
   - CPU utilization
   - Memory usage percentage
   - Disk I/O performance

2. **Database Performance**
   - Connection pool utilization
   - Query response times
   - Failed query count

3. **API Performance**
   - Requests per second
   - Average response time
   - Error rates by endpoint

### Setting Up Alerts

Configure monitoring alerts for:
- Memory usage > 85%
- Connection pool utilization > 90%
- API response time > 2000ms
- Database query failures > 1%

## Best Practices

### Connection Management

1. **Use Connection Pooling**: Always use pooled connections rather than direct connections
2. **Monitor Pool Health**: Regularly check connection pool statistics
3. **Proper Cleanup**: Ensure connections are properly released after use
4. **Timeout Configuration**: Set appropriate timeouts for your use case

### Query Optimization

1. **Index Strategy**: Create indexes for frequently queried fields
2. **Query Analysis**: Use EXPLAIN to analyze query performance
3. **Batch Operations**: Group related operations to reduce connection overhead
4. **Connection Reuse**: Minimize connection acquisition overhead

### Scaling Considerations

1. **Horizontal Scaling**: Consider multiple instances behind a load balancer
2. **Database Scaling**: Use read replicas for read-heavy workloads
3. **Caching Strategy**: Implement Redis or similar for frequently accessed data
4. **Resource Monitoring**: Continuously monitor and adjust resource allocation

## Performance Testing

### Load Testing

Use tools like Apache JMeter or k6 to test system performance:

```bash
# Example load test for API endpoints
k6 run --vus 50 --duration 5m load-test.js
```

### Monitoring During Tests

1. Watch the advanced monitoring dashboard during load tests
2. Monitor connection pool utilization
3. Track memory usage patterns
4. Identify performance bottlenecks

### Performance Benchmarks

**Target Performance Metrics:**
- API response time: < 200ms (95th percentile)
- Memory usage: < 80% of available RAM
- Connection pool utilization: < 80%
- Database query time: < 100ms average
- Zero connection timeouts or failures

## Troubleshooting Common Issues

### "High memory usage detected" Warning

**Symptoms:** Warning status in monitoring dashboard
**Causes:** Excessive memory consumption, connection leaks
**Solutions:**
1. Restart services to clear memory
2. Review and optimize queries
3. Increase system memory if needed
4. Check for memory leaks in application code

### Connection Pool Exhaustion

**Symptoms:** Connection timeout errors, failed requests
**Causes:** High concurrent load, connection leaks, slow queries
**Solutions:**
1. Increase `maxConnections` setting
2. Optimize slow queries
3. Implement connection retry logic
4. Monitor for connection leaks

### Slow Response Times

**Symptoms:** High API response times, poor user experience
**Causes:** Database bottlenecks, inefficient queries, resource constraints
**Solutions:**
1. Add database indexes
2. Optimize query patterns
3. Increase system resources
4. Implement caching layer

This optimization guide helps ensure Cipher performs efficiently under various load conditions while maintaining system stability and responsiveness.