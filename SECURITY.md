# 🔒 Security Configuration

This application implements comprehensive security measures to protect your API routes and data.

## 🚨 Required Environment Variables

Add these to your `.env.local` file:

```bash
# Admin Authentication (REQUIRED)
ADMIN_PASSWORD=your-super-secure-admin-password-here
JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters-long

# External API Keys
NEXT_PUBLIC_RTIRL_PULL_KEY=your-rtirl-pull-key
NEXT_PUBLIC_OPENWEATHER_KEY=your-openweather-api-key
NEXT_PUBLIC_LOCATIONIQ_KEY=your-locationiq-api-key
NEXT_PUBLIC_TIMEZONEDB_KEY=your-timezonedb-api-key

# Vercel KV Database
KV_URL=your-vercel-kv-url
KV_REST_API_URL=your-vercel-kv-rest-api-url
KV_REST_API_TOKEN=your-vercel-kv-rest-api-token
KV_REST_API_READ_ONLY_TOKEN=your-vercel-kv-rest-api-read-only-token

# Production Domain (for CORS)
NEXT_PUBLIC_VERCEL_URL=your-production-domain.vercel.app
```

## 🔐 Security Features Implemented

### 1. JWT-Based Authentication
- **Admin routes** require valid JWT tokens
- **24-hour token expiration** for security
- **Secure token storage** in localStorage
- **Automatic logout** on token expiration

### 2. Rate Limiting
- **Login attempts**: 5 per minute per IP
- **Admin updates**: 30 per minute per IP (settings, location, weather, timezone)
- **Data retrieval**: No rate limiting (overlay needs frequent access)
- **Prevents brute force** and API abuse

### 3. Input Validation
- **Type checking** for all inputs
- **Structure validation** for settings objects
- **SQL injection protection** via parameterized queries
- **XSS prevention** via input sanitization

### 4. Origin Validation
- **CORS protection** for public routes
- **Referer checking** to prevent unauthorized access
- **Domain whitelist** for production environments

### 5. Error Handling
- **No sensitive data** in error responses
- **Proper HTTP status codes**
- **Rate limiting feedback**
- **Graceful degradation**

## 🛡️ API Route Security Levels

### 🔴 Admin-Only Routes (Require JWT)
- `POST /api/save-settings` - Save overlay settings ✅
- `POST /api/save-location` - Save location data ✅
- `POST /api/save-weather` - Save weather data ✅
- `POST /api/save-timezone` - Save timezone data ✅

### 🟡 Public Routes (Origin Validated Only)  
- `GET /api/get-settings` - Get overlay settings
- `GET /api/get-location` - Get location data
- `GET /api/get-weather` - Get weather data
- `GET /api/get-timezone` - Get timezone data
- `GET /api/settings-stream` - SSE settings stream

### 🟢 Authentication Routes
- `POST /api/admin-login` - Admin login (Rate limited)

## ⚠️ Security Best Practices

### 1. Environment Variables
- **Never commit** `.env.local` to version control
- **Use strong passwords** (16+ characters, mixed case, numbers, symbols)
- **Generate unique JWT secrets** (32+ characters)
- **Rotate secrets** periodically in production

### 2. Production Deployment
- **Set NODE_ENV=production**
- **Use HTTPS only**
- **Configure proper CORS origins**
- **Monitor rate limit violations**
- **Set up security headers**

### 3. Monitoring
- **Monitor failed login attempts**
- **Track API usage patterns**
- **Set up alerts for rate limit violations**
- **Log security events**

## 🚀 Security Headers (Recommended)

Add these headers in your hosting configuration:

```
Content-Security-Policy: default-src 'self'; img-src 'self' https:; script-src 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

## 🔧 Testing Security

1. **Rate Limiting**: Try rapid API calls - should get 429 errors
2. **Authentication**: Try accessing admin routes without token - should get 401
3. **Origin Validation**: Try calling from external domain - should get 403
4. **JWT Expiration**: Wait 24 hours - should require re-login

## 📞 Security Issues

If you discover a security vulnerability, please email: [your-email@domain.com]

**Do not** create public GitHub issues for security vulnerabilities. 