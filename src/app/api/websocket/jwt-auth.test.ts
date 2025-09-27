/**
 * Comprehensive tests for JWT WebSocket Authentication
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketJWTAuth, type JWTPayload, type AuthenticatedWebSocket } from './jwt-auth.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Mock WebSocket for testing
class MockWebSocket {
  public sessionId?: string;
  public userId?: string;
  public clientId?: string;
  public permissions?: string[];
  public isAuthenticated?: boolean;

  constructor(public readyState = 1) {}
}

// Mock request object
interface MockRequest {
  url?: string;
  headers: Record<string, string>;
}

describe('WebSocketJWTAuth', () => {
  let auth: WebSocketJWTAuth;
  let mockWs: MockWebSocket;
  let originalEnv: typeof process.env;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set test environment
    process.env.CIPHER_JWT_SECRET = 'test-secret-key-for-testing-only';
    process.env.CIPHER_JWT_EXPIRY = '1h';
    process.env.CIPHER_JWT_ISSUER = 'cipher-test';

    auth = new WebSocketJWTAuth();
    mockWs = new MockWebSocket();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Token Generation', () => {
    it('should generate a valid JWT token', () => {
      const payload = {
        sessionId: 'test-session',
        userId: 'test-user',
        clientId: 'test-client',
        permissions: ['read', 'write']
      };

      const token = auth.generateToken(payload);

      expect(token).toBeTypeOf('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should generate token with correct payload', () => {
      const payload = {
        sessionId: 'test-session',
        userId: 'test-user',
        permissions: ['read']
      };

      const token = auth.generateToken(payload);
      const decoded = jwt.verify(token, 'test-secret-key-for-testing-only') as JWTPayload;

      expect(decoded.sessionId).toBe(payload.sessionId);
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.permissions).toEqual(payload.permissions);
      expect(decoded.iss).toBe('cipher-test');
    });

    it('should generate client token with auto-generated clientId', () => {
      const token = auth.generateClientToken('session-123', 'user-456', ['admin']);
      const decoded = jwt.verify(token, 'test-secret-key-for-testing-only') as JWTPayload;

      expect(decoded.sessionId).toBe('session-123');
      expect(decoded.userId).toBe('user-456');
      expect(decoded.permissions).toEqual(['admin']);
      expect(decoded.clientId).toBeTypeOf('string');
      expect(decoded.clientId?.length).toBeGreaterThan(0);
    });
  });

  describe('Token Verification', () => {
    it('should verify valid token', () => {
      const payload = {
        sessionId: 'test-session',
        userId: 'test-user',
        permissions: ['read', 'write']
      };

      const token = auth.generateToken(payload);
      const verified = auth.verifyToken(token);

      expect(verified).toBeTruthy();
      expect(verified?.sessionId).toBe(payload.sessionId);
      expect(verified?.userId).toBe(payload.userId);
      expect(verified?.permissions).toEqual(payload.permissions);
    });

    it('should reject invalid token', () => {
      const verified = auth.verifyToken('invalid-token');
      expect(verified).toBeNull();
    });

    it('should reject token with wrong secret', () => {
      const wrongToken = jwt.sign(
        { sessionId: 'test' },
        'wrong-secret',
        { expiresIn: '1h', issuer: 'cipher-test' }
      );

      const verified = auth.verifyToken(wrongToken);
      expect(verified).toBeNull();
    });

    it('should reject expired token', () => {
      const expiredToken = jwt.sign(
        { sessionId: 'test' },
        'test-secret-key-for-testing-only',
        { expiresIn: '-1h', issuer: 'cipher-test' } // Expired 1 hour ago
      );

      const verified = auth.verifyToken(expiredToken);
      expect(verified).toBeNull();
    });

    it('should reject token with wrong issuer', () => {
      const wrongIssuerToken = jwt.sign(
        { sessionId: 'test' },
        'test-secret-key-for-testing-only',
        { expiresIn: '1h', issuer: 'wrong-issuer' }
      );

      const verified = auth.verifyToken(wrongIssuerToken);
      expect(verified).toBeNull();
    });
  });

  describe('Token Extraction from Request', () => {
    it('should extract token from query parameter', () => {
      const token = 'test-token-123';
      const request: MockRequest = {
        url: `/?token=${token}`,
        headers: {}
      };

      const extracted = auth.extractTokenFromRequest(request);
      expect(extracted).toBe(token);
    });

    it('should extract token from Authorization header', () => {
      const token = 'test-token-123';
      const request: MockRequest = {
        headers: {
          authorization: `Bearer ${token}`
        }
      };

      const extracted = auth.extractTokenFromRequest(request);
      expect(extracted).toBe(token);
    });

    it('should extract token from WebSocket subprotocol', () => {
      const token = 'test-token-123';
      const request: MockRequest = {
        headers: {
          'sec-websocket-protocol': `cipher-jwt-${token}, other-protocol`
        }
      };

      const extracted = auth.extractTokenFromRequest(request);
      expect(extracted).toBe(token);
    });

    it('should return null when no token found', () => {
      const request: MockRequest = {
        headers: {}
      };

      const extracted = auth.extractTokenFromRequest(request);
      expect(extracted).toBeNull();
    });

    it('should prioritize query parameter over header', () => {
      const queryToken = 'query-token';
      const headerToken = 'header-token';
      const request: MockRequest = {
        url: `/?token=${queryToken}`,
        headers: {
          authorization: `Bearer ${headerToken}`
        }
      };

      const extracted = auth.extractTokenFromRequest(request);
      expect(extracted).toBe(queryToken);
    });
  });

  describe('WebSocket Authentication', () => {
    it('should authenticate WebSocket with valid token', () => {
      const payload = {
        sessionId: 'test-session',
        userId: 'test-user',
        clientId: 'test-client',
        permissions: ['read', 'write']
      };

      const token = auth.generateToken(payload);
      const request: MockRequest = {
        url: `/?token=${token}`,
        headers: {}
      };

      const authenticatedWs = auth.authenticateConnection(mockWs as any, request);

      expect(authenticatedWs).toBeTruthy();
      expect(authenticatedWs?.sessionId).toBe(payload.sessionId);
      expect(authenticatedWs?.userId).toBe(payload.userId);
      expect(authenticatedWs?.clientId).toBe(payload.clientId);
      expect(authenticatedWs?.permissions).toEqual(payload.permissions);
      expect(authenticatedWs?.isAuthenticated).toBe(true);
    });

    it('should reject WebSocket authentication with invalid token', () => {
      const request: MockRequest = {
        url: '/?token=invalid-token',
        headers: {}
      };

      const authenticatedWs = auth.authenticateConnection(mockWs as any, request);
      expect(authenticatedWs).toBeNull();
    });

    it('should reject WebSocket authentication with no token', () => {
      const request: MockRequest = {
        headers: {}
      };

      const authenticatedWs = auth.authenticateConnection(mockWs as any, request);
      expect(authenticatedWs).toBeNull();
    });

    it('should handle undefined optional fields properly', () => {
      const payload = {
        permissions: ['read']
        // sessionId, userId, clientId are undefined
      };

      const token = auth.generateToken(payload);
      const request: MockRequest = {
        url: `/?token=${token}`,
        headers: {}
      };

      const authenticatedWs = auth.authenticateConnection(mockWs as any, request);

      expect(authenticatedWs).toBeTruthy();
      expect(authenticatedWs?.sessionId).toBeUndefined();
      expect(authenticatedWs?.userId).toBeUndefined();
      expect(authenticatedWs?.clientId).toBeUndefined();
      expect(authenticatedWs?.permissions).toEqual(['read']);
      expect(authenticatedWs?.isAuthenticated).toBe(true);
    });
  });

  describe('Permission System', () => {
    let authenticatedWs: AuthenticatedWebSocket;

    beforeEach(() => {
      const payload = {
        sessionId: 'test-session',
        permissions: ['read', 'write', 'admin']
      };

      const token = auth.generateToken(payload);
      const request: MockRequest = {
        url: `/?token=${token}`,
        headers: {}
      };

      authenticatedWs = auth.authenticateConnection(mockWs as any, request) as AuthenticatedWebSocket;
    });

    it('should check specific permissions correctly', () => {
      expect(auth.hasPermission(authenticatedWs, 'read')).toBe(true);
      expect(auth.hasPermission(authenticatedWs, 'write')).toBe(true);
      expect(auth.hasPermission(authenticatedWs, 'admin')).toBe(true);
      expect(auth.hasPermission(authenticatedWs, 'delete')).toBe(false);
    });

    it('should handle wildcard permission', () => {
      const wildcardPayload = { permissions: ['*'] };
      const token = auth.generateToken(wildcardPayload);
      const request: MockRequest = {
        url: `/?token=${token}`,
        headers: {}
      };

      const wildcardWs = auth.authenticateConnection(mockWs as any, request) as AuthenticatedWebSocket;

      expect(auth.hasPermission(wildcardWs, 'any-permission')).toBe(true);
      expect(auth.hasPermission(wildcardWs, 'another-permission')).toBe(true);
    });

    it('should reject permission check for unauthenticated WebSocket', () => {
      const unauthenticatedWs = mockWs as AuthenticatedWebSocket;
      expect(auth.hasPermission(unauthenticatedWs, 'read')).toBe(false);
    });

    it('should reject permission check for WebSocket without permissions', () => {
      const noPermissionsWs = {
        ...mockWs,
        isAuthenticated: true
        // permissions is undefined
      } as AuthenticatedWebSocket;

      expect(auth.hasPermission(noPermissionsWs, 'read')).toBe(false);
    });
  });

  describe('Middleware', () => {
    it('should create authentication middleware', () => {
      const middleware = auth.authMiddleware();
      expect(middleware).toBeTypeOf('function');
    });

    it('should call next with error for invalid authentication', () => {
      return new Promise<void>((resolve) => {
        const middleware = auth.authMiddleware();
        const request: MockRequest = {
          headers: {}
        };

        middleware(mockWs as any, request, (error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error?.message).toBe('WebSocket authentication failed');
          resolve();
        });
      });
    });

    it('should call next without error for valid authentication', () => {
      return new Promise<void>((resolve) => {
        const payload = { permissions: ['read'] };
        const token = auth.generateToken(payload);
        const request: MockRequest = {
          url: `/?token=${token}`,
          headers: {}
        };

        const middleware = auth.authMiddleware();

        middleware(mockWs as any, request, (error) => {
          expect(error).toBeUndefined();
          expect((mockWs as any).isAuthenticated).toBe(true);
          resolve();
        });
      });
    });
  });

  describe('Security Features', () => {
    it('should generate secure random secret when not provided', () => {
      // Clear environment variables
      delete process.env.CIPHER_JWT_SECRET;

      const newAuth = new WebSocketJWTAuth();

      // Should still be able to generate and verify tokens
      const token = newAuth.generateToken({ permissions: ['test'] });
      const verified = newAuth.verifyToken(token);

      expect(verified).toBeTruthy();
      expect(verified?.permissions).toEqual(['test']);
    });

    it('should use HS256 algorithm for token signing', () => {
      const token = auth.generateToken({ permissions: ['test'] });
      const tokenPart = token.split('.')[0];
      expect(tokenPart).toBeDefined();
      const header = JSON.parse(Buffer.from(tokenPart!, 'base64').toString());

      expect(header.alg).toBe('HS256');
    });

    it('should include timestamp in token', () => {
      const beforeTime = Math.floor(Date.now() / 1000);
      const token = auth.generateToken({ permissions: ['test'] });
      const decoded = jwt.verify(token, 'test-secret-key-for-testing-only') as JWTPayload;

      expect(decoded.iat).toBeGreaterThanOrEqual(beforeTime);
      expect(decoded.exp).toBeGreaterThan(decoded.iat!);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed tokens gracefully', () => {
      const malformedTokens = [
        'not.a.token',
        'definitely-not-a-jwt',
        '',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid-payload.signature',
        'header.payload' // Missing signature
      ];

      malformedTokens.forEach(token => {
        const verified = auth.verifyToken(token);
        expect(verified).toBeNull();
      });
    });

    it('should handle URL parsing errors', () => {
      const invalidUrls = [
        '/?token=', // Empty token
        '/?no-token',
        '/?token=%invalid%url%encoding%',
        undefined
      ];

      invalidUrls.forEach(url => {
        const request: MockRequest = { headers: {} };
        if (url !== undefined) {
          request.url = url;
        }
        const extracted = auth.extractTokenFromRequest(request);
        expect(extracted).toBeOneOf([null, '']);
      });
    });
  });
});