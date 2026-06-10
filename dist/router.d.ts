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
/**
 * Ordered first-match-wins router. Registration order is the dispatch
 * order, mirroring the precedence of the original if-chain (e.g.
 * /v1/sessions/list must be registered before /v1/sessions/:id).
 */
export declare class Router {
    private routes;
    add(method: string, pattern: string, handler: RouteHandler): this;
    addAll(routes: Route[]): this;
    /** Returns the matching handler and extracted params, or null for 404. */
    match(method: string, pathname: string): {
        handler: RouteHandler;
        params: Record<string, string>;
    } | null;
}
