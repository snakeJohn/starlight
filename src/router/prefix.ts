import type { Router, RouteHandler, RouteResult, HTTPRequest } from '@songloft/plugin-sdk';

function joinRoutePath(prefix: string, path: string): string {
  const parts = [...prefix.split('/'), ...path.split('/')].filter(Boolean);
  return '/' + parts.join('/');
}

export function prefixRouter(router: Router, prefix: string): Router {
  return {
    get(path: string, handler: RouteHandler): void {
      router.get(joinRoutePath(prefix, path), handler);
    },
    post(path: string, handler: RouteHandler): void {
      router.post(joinRoutePath(prefix, path), handler);
    },
    put(path: string, handler: RouteHandler): void {
      router.put(joinRoutePath(prefix, path), handler);
    },
    delete(path: string, handler: RouteHandler): void {
      router.delete(joinRoutePath(prefix, path), handler);
    },
    handle(req: HTTPRequest): RouteResult {
      return router.handle(req);
    },
  };
}
