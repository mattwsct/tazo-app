# API Route Protection Setup

This project now includes **Super Simple API Route Protection** using a shared secret between frontend and backend.

## Environment Variables Required

Add these variables to your `.env.local` file:

```env
# API Protection - Required for both server and client
# IMPORTANT: Use the same value for both variables
API_SECRET=your-super-secret-api-key-change-this-in-production
NEXT_PUBLIC_API_SECRET=your-super-secret-api-key-change-this-in-production

# Admin Authentication  
ADMIN_PASSWORD=your-admin-password-here

# External API Keys (existing)
NEXT_PUBLIC_RTIRL_PULL_KEY=your-rtirl-pull-key
NEXT_PUBLIC_OPENWEATHER_KEY=your-openweather-api-key
NEXT_PUBLIC_LOCATIONIQ_KEY=your-locationiq-api-key  
NEXT_PUBLIC_TIMEZONEDB_KEY=your-timezonedb-api-key
```

## Security Implementation

### Protected Routes
All API routes are now protected with shared secret authentication:

- ✅ `/api/get-settings` - Protected
- ✅ `/api/save-settings` - Protected  
- ✅ `/api/get-location` - Protected
- ✅ `/api/save-location` - Protected
- ✅ `/api/get-weather` - Protected
- ✅ `/api/save-weather` - Protected
- ✅ `/api/get-timezone` - Protected
- ✅ `/api/save-timezone` - Protected
- ✅ `/api/settings-stream` - Protected (SSE)
- ❌ `/api/admin-login` - Uses separate password auth

### Authentication Methods

**For regular API calls (GET/POST):**
- Header: `X-API-Secret: your-secret-here`
- Alternative: `Authorization: Bearer your-secret-here`

**For Server-Sent Events (SSE):**
- URL parameter: `/api/settings-stream?secret=your-secret-here`
- (Required because EventSource doesn't support custom headers)

### Frontend Integration

The frontend automatically includes authentication headers:

```typescript
import { authenticatedFetch, createAuthenticatedEventSource } from '@/lib/client-auth';

// Regular API calls
const response = await authenticatedFetch('/api/save-settings', {
  method: 'POST',
  body: JSON.stringify(settings)
});

// Server-Sent Events
const eventSource = createAuthenticatedEventSource('/api/settings-stream');
```

## Production Deployment

1. **Generate a strong secret:**
   ```bash
   # Example: Generate a random 32-character secret
   openssl rand -hex 32
   ```

2. **Set environment variables on your hosting platform:**
   - Vercel: Project Settings → Environment Variables
   - Netlify: Site Settings → Environment Variables
   - Railway/Heroku: Config vars

3. **Important:** Use the same secret value for both `API_SECRET` and `NEXT_PUBLIC_API_SECRET`

## Security Benefits

- ✅ Prevents unauthorized access to your overlay data
- ✅ Protects against API abuse and data scraping  
- ✅ Simple to implement and maintain
- ✅ Works with both regular requests and real-time streams
- ✅ Backward compatible with existing admin authentication

## Troubleshooting

**401 Unauthorized errors:**
1. Check that both `API_SECRET` and `NEXT_PUBLIC_API_SECRET` have the same value
2. Restart your development server after adding environment variables
3. Verify the secret is not empty or using the fallback value

**SSE connection failures:**
- The settings stream uses URL parameters for auth due to EventSource limitations
- Check browser network tab for the actual request URL with secret parameter 