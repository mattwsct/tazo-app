# Code Simplification Suggestions

## 1. GPS Freshness Logic (Lines 690-767) - HIGH PRIORITY
**Current:** Complex nested conditions checking multiple overlapping conditions
- `wasGpsDataStale` (10 second check)
- `isGpsUpdateRecent` (15 minute check) 
- `isReportedAtFresh` (15 minute check - duplicates `isGpsUpdateRecent`)
- `isFirstGpsUpdate`
- `isFirstFreshGps`

**Simplification:** Consolidate into a single helper function:
```typescript
const isGpsFresh = (gpsUpdateTime: number, now: number, isFirstUpdate: boolean) => {
  const timeSinceUpdate = now - gpsUpdateTime;
  const isRecent = timeSinceUpdate <= GPS_FRESHNESS_TIMEOUT;
  const wasStale = lastGpsUpdateTime.current > 0 && (now - lastGpsUpdateTime.current) > GPS_STALE_TIMEOUT;
  return isRecent && (!wasStale || isFirstUpdate);
};
```

## 2. Redundant GPS Timestamp Refs - MEDIUM PRIORITY
**Current:** 
- `lastGpsUpdateTime` - tracks when we last received GPS (for stale detection)
- `lastGpsReportedAtRef` - tracks RTIRL reportedAt timestamp (for freshness)

**Simplification:** These serve similar purposes. Could combine into one ref that stores both:
```typescript
const lastGpsData = useRef<{ updateTime: number; reportedAt: number } | null>(null);
```

## 3. Timezone UTC Checks - LOW PRIORITY
**Current:** Multiple places check `timezone === 'UTC'` or `timezone !== 'UTC'`

**Simplification:** Create helper function:
```typescript
const isRealTimezone = (tz: string | null) => tz && tz !== 'UTC';
```

## 4. Simple API Rate Limit Functions - LOW PRIORITY
**Current:** `canMakeApiCall` and `trackApiCall` are very simple but wrapped in useCallback

**Simplification:** These could be inlined or simplified since they're only used in one place.

## 5. Settings Refs - LOW PRIORITY
**Current:** 
- `settingsRef` - updated but rarely used
- `lastSettingsHash` - used for comparison

**Simplification:** `settingsRef` seems redundant - could just use `settings` state directly in most places.

## 6. Weather Fetch Condition - LOW PRIORITY
**Current:** Line 850-851 has complex nested condition

**Simplification:** Extract to helper function for readability.

## Recommendation Priority:
1. **GPS Freshness Logic** - Biggest complexity reduction
2. **Redundant GPS Refs** - Cleaner state management
3. Others are minor improvements

