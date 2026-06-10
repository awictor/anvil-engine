export interface AnvilClientOptions {
    baseUrl: string;
    apiKey?: string;
}
export interface SessionCreateOptions {
    headless?: boolean;
    dimensions?: {
        width: number;
        height: number;
    };
    proxyUrl?: string;
    userDataDir?: string;
    stealth?: boolean;
    userAgent?: string;
}
export declare class AnvilClient {
    private baseUrl;
    private apiKey;
    constructor(options: AnvilClientOptions);
    private headers;
    private request;
    createSession(options?: SessionCreateOptions): Promise<{
        id: string;
        status: string;
        websocketUrl: string;
        cdpPort: number;
        fingerprint: boolean;
    }>;
    getSession(sessionId?: string): Promise<{
        id: string | null;
        status: string;
    }>;
    getSessionById(id: string): Promise<{
        id: string;
        status: string;
        dimensions: {
            width: number;
            height: number;
        };
        userAgent: string | null;
    }>;
    listSessions(): Promise<{
        sessions: Array<{
            id: string;
            status: string;
            cdpPort: number;
            ageMs: number;
        }>;
        count: number;
    }>;
    releaseSession(id: string): Promise<{
        id: string;
        status: string;
        duration: number;
    }>;
    health(): Promise<{
        status: string;
        sessions: number;
        uptime: number;
        sessionTimeoutMs: number;
        multiSession: boolean;
    }>;
    navigate(url: string, options?: {
        waitUntil?: string;
        sessionId?: string;
    }): Promise<{
        url: string;
        title: string;
    }>;
    scrape(url: string, options?: {
        format?: "html" | "text";
        waitForSelector?: string;
        sessionId?: string;
    }): Promise<{
        content: string;
        title: string;
        url: string;
    }>;
    pdf(options?: {
        url?: string;
        format?: string;
        landscape?: boolean;
        sessionId?: string;
    }): Promise<ArrayBuffer>;
    screenshot(options?: {
        fullPage?: boolean;
        sessionId?: string;
    }): Promise<ArrayBuffer>;
    click(selector: string, options?: {
        button?: string;
        clickCount?: number;
        sessionId?: string;
    }): Promise<{
        success: boolean;
        selector: string;
    }>;
    type(selector: string, text: string, options?: {
        delay?: number;
        sessionId?: string;
    }): Promise<{
        success: boolean;
        selector: string;
    }>;
    select(selector: string, values: string[], sessionId?: string): Promise<{
        success: boolean;
        selector: string;
        selected: string[];
    }>;
    hover(selector: string, sessionId?: string): Promise<{
        success: boolean;
        selector: string;
    }>;
    waitForSelector(selector: string, options?: {
        timeout?: number;
        sessionId?: string;
    }): Promise<{
        success: boolean;
        selector: string;
    }>;
    evaluate(script: string, sessionId?: string): Promise<unknown>;
    upload(selector: string, filename: string, data: string, sessionId?: string): Promise<{
        success: boolean;
        selector: string;
        filename: string;
    }>;
    getCookies(sessionId?: string): Promise<{
        cookies: Array<Record<string, unknown>>;
    }>;
    setCookies(cookies: Array<Record<string, unknown>>, sessionId?: string): Promise<{
        injected: number;
    }>;
    startHar(sessionId?: string): Promise<{
        recording: boolean;
    }>;
    stopHar(sessionId?: string): Promise<{
        recording: boolean;
        entries: number;
    }>;
    getHar(sessionId?: string): Promise<{
        entries: Array<{
            url: string;
            method: string;
            status: number;
            duration: number;
            responseSize: number;
            timestamp: string;
        }>;
    }>;
    intercept(enabled: boolean, options?: {
        blockPatterns?: string[];
        sessionId?: string;
    }): Promise<{
        enabled: boolean;
        blocking: number;
    }>;
    listDownloads(sessionId?: string): Promise<{
        files: Array<{
            name: string;
            size: number;
            createdAt: string;
        }>;
    }>;
    getDownload(filename: string, sessionId?: string): Promise<ArrayBuffer>;
    startRecording(sessionId?: string): Promise<{
        recording: boolean;
        sessionId: string;
    }>;
    stopRecording(sessionId?: string): Promise<{
        recording: boolean;
        actions: number;
    }>;
    getRecording(sessionId?: string): Promise<{
        recording: boolean;
        actions: Array<{
            action: string;
            params: Record<string, unknown>;
            timestamp: string;
            durationMs: number;
        }>;
    }>;
    metrics(): Promise<{
        sessionsCreated: number;
        sessionsReleased: number;
        peakConcurrent: number;
        requestsServed: number;
        errorsCount: number;
        activeSessions: number;
        uptime: number;
    }>;
    docs(): Promise<{
        version: string;
        endpoints: number;
        categories: Record<string, unknown>;
    }>;
}
