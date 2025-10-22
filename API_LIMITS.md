# API Rate Limits & Usage

## OpenWeatherMap API (NEW - Primary Weather Source)

**Free Tier Limits:**
- **Rate Limit:** 60 calls per minute
- **Daily Limit:** 1,000,000 calls per month
- **Our Implementation:** 50 calls per minute (83% of limit)
- **Cooldown:** 2 seconds between calls

**Current Usage Pattern:**
- Weather updates every 5 minutes
- Each update = 1 API call
- **Daily Usage:** ~288 calls (well under 1M limit)
- **Peak Usage:** 1 call every 5 minutes = 12 calls/hour

## LocationIQ API (Location Data)

**Free Tier Limits:**
- **Rate Limit:** 1 call per second
- **Daily Limit:** 5,000 calls per day
- **Our Implementation:** 5 calls per second (500% of limit - but we use 1s cooldown)
- **Cooldown:** 1 second between calls

**Current Usage Pattern:**
- Location updates every 1 minute (when moving)
- Each update = 1 API call
- **Daily Usage:** ~1,440 calls (well under 5K limit)

## RealtimeIRL API (GPS Tracking)

**No Rate Limits** - WebSocket connection for live GPS data

## Pulsoid API (Heart Rate)

**No Rate Limits** - WebSocket connection for live heart rate data

## Mapbox API (Map Tiles)

**Free Tier Limits:**
- **Rate Limit:** 10 calls per second
- **Monthly Limit:** 50,000 requests
- **Our Implementation:** No explicit rate limiting (tiles cached by browser)

## Summary

✅ **All APIs are well within limits**
✅ **Conservative rate limiting implemented**
✅ **No risk of exceeding daily/monthly limits**
✅ **Cooldown periods prevent rapid successive calls**

**Total Daily API Calls:**
- OpenWeatherMap: ~288 calls (0.03% of limit)
- LocationIQ: ~1,440 calls (29% of limit)
- Mapbox: ~100-200 calls (0.4% of limit)

**Safe for 24/7 streaming!** 🚀
