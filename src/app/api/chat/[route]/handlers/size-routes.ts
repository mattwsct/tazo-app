import { NextResponse } from 'next/server';
import { isSizeRoute, handleSizeRanking, getSizeRouteConfig } from '@/utils/size-ranking';
import { txtResponse } from './shared';

export function handleSizeRoutes(route: string, q: string, searchParams?: URLSearchParams): NextResponse | null {
  if (!isSizeRoute(route)) return null;

  let length: number, girth: number | null = null, unit: 'inch' | 'cm', type: 'erect' | 'flaccid';

  const queryStr = searchParams
    ? (searchParams.get('q') || searchParams.get('query') || searchParams.get('querystring') || '')
    : q;

  if (queryStr) {
    const parts = queryStr.trim().split(/\s+/).filter((p: string) => p);
    length = parseFloat(parts[0] || '');
    girth = parts[1] ? parseFloat(parts[1]) : null;
  } else {
    length = parseFloat(searchParams?.get('l') || searchParams?.get('length') || '');
    const girthParam = searchParams?.get('g') || searchParams?.get('girth');
    girth = girthParam ? parseFloat(girthParam) : null;
  }

  const routeConfig = getSizeRouteConfig(route);
  if (routeConfig) {
    ({ unit, type } = routeConfig);
  } else {
    unit = ((searchParams?.get('unit') || 'inch').toLowerCase()) as 'inch' | 'cm';
    type = ((searchParams?.get('type') || 'erect').toLowerCase()) as 'erect' | 'flaccid';
  }

  if (isNaN(length) || length <= 0) {
    const routeName = routeConfig ? route : 'size';
    return txtResponse(`Usage: ${routeName} 7 (length) 5.5 (girth)`, 200);
  }

  const result = handleSizeRanking(length, girth, unit, type);
  if (!result) {
    return txtResponse(`Invalid input. Usage: ${route} 7 (length) 5.5 (girth)`, 200);
  }

  return txtResponse(result, 200);
}
