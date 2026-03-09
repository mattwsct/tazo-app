import { NextRequest, NextResponse } from 'next/server';
import { CORS_HEADERS, txtResponse, buildChatContext } from './handlers/shared';
import { handleSocialRoutes } from './handlers/social-routes';
import { handleSizeRoutes } from './handlers/size-routes';
import { handleUptimeRoutes } from './handlers/uptime-routes';
import { handleStatsRoutes } from './handlers/stats-routes';
import { handleLocationRoutes } from './handlers/location-routes';
import { handleWeatherRoutes } from './handlers/weather-routes';
import { handleTravelRoutes } from './handlers/travel-routes';
import { handleGameRoutes } from './handlers/game-routes';
import { handleUtilityRoutes } from './handlers/utility-routes';
import { handleStatusRoutes } from './handlers/status-routes';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'access-control-max-age': '86400' },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ route: string }> }
): Promise<NextResponse> {
  const { route } = await params;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const provider = url.searchParams.get('p') || undefined;

  return (
    handleSocialRoutes(route, q, provider) ??
    handleSizeRoutes(route, q, url.searchParams) ??
    (await handleUptimeRoutes(route)) ??
    (await handleStatsRoutes(route)) ??
    await (async () => {
      try {
        const ctx = await buildChatContext();
        return (
          (await handleLocationRoutes(route, q, ctx)) ??
          (await handleWeatherRoutes(route, q, ctx)) ??
          (await handleTravelRoutes(route, q, ctx)) ??
          (await handleGameRoutes(route, q)) ??
          (await handleUtilityRoutes(route, q)) ??
          (await handleStatusRoutes(route, q, ctx)) ??
          txtResponse('Unknown route', 404)
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        return txtResponse(message, 500);
      }
    })()
  );
}
