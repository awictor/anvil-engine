/**
 * Ordered first-match-wins router. Registration order is the dispatch
 * order, mirroring the precedence of the original if-chain (e.g.
 * /v1/sessions/list must be registered before /v1/sessions/:id).
 */
export class Router {
    routes = [];
    add(method, pattern, handler) {
        this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
        return this;
    }
    addAll(routes) {
        for (const r of routes)
            this.add(r.method, r.pattern, r.handler);
        return this;
    }
    /** Returns the matching handler and extracted params, or null for 404. */
    match(method, pathname) {
        const parts = pathname.split("/").filter(Boolean);
        outer: for (const route of this.routes) {
            if (route.method !== method)
                continue;
            const params = {};
            for (let i = 0; i < route.segments.length; i++) {
                const seg = route.segments[i];
                if (seg.startsWith("*")) {
                    if (i >= parts.length)
                        continue outer;
                    params[seg.slice(1)] = parts.slice(i).join("/");
                    return { handler: route.handler, params };
                }
                if (i >= parts.length)
                    continue outer;
                if (seg.startsWith(":")) {
                    params[seg.slice(1)] = parts[i];
                }
                else if (seg !== parts[i]) {
                    continue outer;
                }
            }
            if (parts.length !== route.segments.length)
                continue;
            return { handler: route.handler, params };
        }
        return null;
    }
}
