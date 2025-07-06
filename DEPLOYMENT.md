# 🚀 Vercel Deployment Guide

## ✅ Pre-Deployment Checklist

### 1. **Environment Variables**
Make sure you have these ready:
- [ ] `UPSTASH_REDIS_REST_URL` - Your Upstash Redis URL
- [ ] `UPSTASH_REDIS_REST_TOKEN` - Your Upstash Redis token
- [ ] `LOCATIONIQ_API_KEY` - LocationIQ API key
- [ ] `OPENWEATHER_API_KEY` - OpenWeatherMap API key
- [ ] `PULSOID_ACCESS_TOKEN` - Pulsoid access token
- [ ] `PULSOID_WEBSOCKET_TOKEN` - Your WebSocket token: `c90db09d-d194-4280-a648-fb93a6142f77`

### 2. **Local Testing**
- [ ] `npm run build` - Builds successfully ✅
- [ ] `npm run dev` - Runs without errors
- [ ] WebSocket connection works locally
- [ ] Overlay displays data correctly

## 🌐 Deploy to Vercel

### Option 1: GitHub Integration (Recommended)

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Ready for Vercel deployment"
   git push origin main
   ```

2. **Connect to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Sign in with GitHub
   - Click "New Project"
   - Import your `tazo-app` repository
   - Vercel will auto-detect Next.js settings

3. **Configure Environment Variables**
   - In your Vercel project dashboard
   - Go to Settings → Environment Variables
   - Add each variable from the checklist above

4. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy automatically

### Option 2: Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Login and Deploy**
   ```bash
   vercel login
   vercel
   ```

3. **Follow the prompts**
   - Link to existing project or create new
   - Set environment variables when prompted

## 🔧 Post-Deployment Setup

### 1. **Test Your Deployment**
Visit these URLs to verify everything works:

- **Admin Panel**: `https://your-app.vercel.app`
- **Overlay**: `https://your-app.vercel.app/overlay`
- **Health Check**: `https://your-app.vercel.app/api/health`

### 2. **Configure OBS**
- Add Browser Source in OBS
- URL: `https://your-app.vercel.app/overlay`
- Width: 1920, Height: 1080
- Refresh browser when scene becomes active: ✅

### 3. **Test WebSocket Connection**
- Go to Settings tab in admin panel
- Enter your WebSocket token
- Click "Connect"
- Verify heart rate updates in real-time

### 4. **Test Redis Integration**
- Visit `/api/redis-test` to verify Redis connection
- This endpoint uses `Redis.fromEnv()` as recommended by Vercel
- Should return "Redis connection successful" if configured correctly

## 📊 Data Persistence

### ✅ What Survives Redeploys
- **Redis Data**: Heart rate, GPS, weather, location data
- **Overlay Configuration**: All settings and toggles
- **Historical Data**: Past heart rate readings

### ❌ What Gets Reset
- **WebSocket Connections**: Will reconnect automatically
- **In-memory Cache**: Cleared on redeploy (not used in production)

## 🚨 Troubleshooting

### Common Issues

1. **Build Fails**
   ```bash
   # Check locally first
   npm run build
   npm run lint
   ```

2. **Environment Variables Missing**
   - Double-check all variables in Vercel dashboard
   - Ensure no typos in variable names

3. **Redis Connection Fails**
   - Verify Upstash Redis credentials
   - Check if Redis instance is active

4. **WebSocket Not Connecting**
   - Verify Pulsoid token is correct
   - Check browser console for errors
   - Ensure HTTPS is used (required for WebSocket)

5. **Overlay Not Updating**
   - Check `/api/health` endpoint
   - Verify Redis data is being stored
   - Check overlay configuration settings

### Debug Endpoints

- **Health Check**: `/api/health` - Overall system status
- **Test APIs**: `/api/test-apis` - API connection status
- **Overlay Data**: `/api/overlay-data` - Current data
- **WebSocket Test**: `/api/test-pulsoid-ws?token=YOUR_TOKEN`

## 🔄 Continuous Deployment

### Automatic Deploys
- Push to `main` branch → Automatic deployment
- Pull requests → Preview deployments
- Environment variables persist across deployments

### Manual Deploys
```bash
vercel --prod
```

## 📈 Monitoring

### Vercel Analytics
- Function execution times
- Error rates
- Performance metrics

### Custom Monitoring
- Health check endpoint for uptime monitoring
- Redis data persistence verification
- WebSocket connection status

## 🎯 Production Checklist

- [ ] All environment variables configured
- [ ] Health check returns "healthy"
- [ ] WebSocket connects successfully
- [ ] Overlay displays real-time data
- [ ] OBS integration working
- [ ] Error monitoring set up
- [ ] Domain configured (optional)

---

**Need Help?** Check the [Vercel documentation](https://vercel.com/docs) or open an issue in your repository. 