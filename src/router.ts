import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  requestId: string;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export interface Route {
  method: string;
  /** Path pattern: static segments, ":name" params, or a trailing "*name" rest-capture. */
  pattern: string;
  handler: RouteHandler;
}

interface CompiledRoute {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

/**
 * Ordered first-match-wins router. Registration order is the dispatch
 * order, mirroring the precedence of the original if-chain (e.g.
 * /v1/sessions/list must be registered before /v1/sessions/:id).
 */
export class Router {
  private routes: CompiledRoute[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  addAll(routes: Route[]): this {
    for (const r of routes) this.add(r.method, r.pattern, r.handler);
    return this;
  }

  /** Returns the matching handler and extracted params, or null for 404. */
  match(method: string, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const parts = pathname.split("/").filter(Boolean);
    outer: for (const route of this.routes) {
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith("*")) {
          if (i >= parts.length) continue outer;
          params[seg.slice(1)] = parts.slice(i).join("/");
          return { handler: route.handler, params };
        }
        if (i >= parts.length) continue outer;
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = parts[i];
        } else if (seg !== parts[i]) {
          continue outer;
        }
      }
      if (parts.length !== route.segments.length) continue;
      return { handler: route.handler, params };
    }
    return null;
  }
}
