import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref, type Route } from '../router';

describe('router', () => {
  it('reads paths and old #/ links the same', () => {
    expect(parseRoute('/cs2/review')).toEqual({ page: 'cs2', mode: 'review' });
    expect(parseRoute('#/cs2/review')).toEqual({ page: 'cs2', mode: 'review' });
    expect(parseRoute('/cs2/review?steam_error=x')).toEqual({ page: 'cs2', mode: 'review' });
    expect(parseRoute('/')).toEqual({ page: 'home' });
    expect(parseRoute('/nope')).toEqual({ page: 'missing' });
    expect(parseRoute('/m?c=abc')).toEqual({ page: 'moment', code: 'abc' });
    expect(parseRoute('#/m/abc')).toEqual({ page: 'moment', code: 'abc' });
  });
  it('every page goes to its address and back', () => {
    const rs: Route[] = [{ page: 'home' }, { page: 'puzzles' }, { page: 'cs2', mode: 'report' }, { page: 'deadlock', mode: 'home' }, { page: 'deadlock', mode: 'tactical' }, { page: 'moment', code: 'x_y-z' }];
    for (const r of rs) expect(parseRoute(routeHref(r))).toEqual(r);
  });
});
