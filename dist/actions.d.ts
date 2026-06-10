import type { Cookie, CookieParam } from "puppeteer-core";
import { type Session, type SessionManager } from "./session.js";
export interface HarEntry {
    url: string;
    method: string;
    status: number;
    duration: number;
    responseSize: number;
    timestamp: string;
}
export interface ActionEntry {
    action: string;
    params: Record<string, unknown>;
    timestamp: string;
    durationMs: number;
}
export interface ActionsConfig {
    evaluateTimeoutMs: number;
    harMaxEntries: number;
}
/**
 * Browser business logic, decoupled from the HTTP layer. Owns one cached
 * puppeteer connection per session (invalidated on crash/destroy), the
 * HAR/recording stores, and their page listeners — all released via
 * SessionManager.onDestroy so nothing leaks when a session dies.
 */
export declare class SessionActions {
    private sessionManager;
    private config;
    private connections;
    private harStore;
    private harListeners;
    private interceptListeners;
    private recordingStore;
    constructor(sessionManager: SessionManager, config?: ActionsConfig);
    private getBrowser;
    private invalidate;
    private relaunch;
    /**
     * Runs a browser operation against the session with in-flight tracking
     * (blocks the cleanup race) and a single relaunch retry on crash.
     */
    private run;
    private authenticated;
    applySessionDefaults(session: Session, opts: {
        userAgent?: string;
        width: number;
        height: number;
        fingerprintScript?: string;
    }): Promise<void>;
    navigate(session: Session, params: {
        url: string;
        waitUntil?: string;
        timeout?: number;
    }): Promise<{
        url: string;
        title: string;
    }>;
    scrape(session: Session, params: {
        url: string;
        waitForSelector?: string;
        format?: string;
    }): Promise<{
        content: string;
        title: string;
        url: string;
    }>;
    pdf(session: Session, params: {
        url?: string;
        format?: string;
        landscape?: boolean;
    }): Promise<Uint8Array>;
    screenshot(session: Session, fullPage: boolean): Promise<Uint8Array>;
    getCookies(session: Session): Promise<Cookie[]>;
    setCookies(session: Session, cookies: CookieParam[]): Promise<number>;
    click(session: Session, params: {
        selector: string;
        button?: string;
        clickCount?: number;
    }): Promise<void>;
    type(session: Session, params: {
        selector: string;
        text: string;
        delay?: number;
    }): Promise<void>;
    select(session: Session, params: {
        selector: string;
        values: string[];
    }): Promise<string[]>;
    hover(session: Session, selector: string): Promise<void>;
    wait(session: Session, params: {
        selector: string;
        timeout?: number;
    }): Promise<void>;
    upload(session: Session, params: {
        selector: string;
        tempPath: string;
    }): Promise<void>;
    evaluate(session: Session, script: string): Promise<unknown>;
    startHar(session: Session): Promise<void>;
    stopHar(session: Session): HarEntry[];
    getHar(session: Session): HarEntry[];
    private removeHarListener;
    setIntercept(session: Session, enabled: boolean, blockPatterns: string[]): Promise<void>;
    startRecording(session: Session): void;
    stopRecording(session: Session): ActionEntry[];
    getRecording(session: Session): {
        recording: boolean;
        actions: ActionEntry[];
    };
    recordAction(sessionId: string, action: string, params: Record<string, unknown>, durationMs: number): void;
    releaseSessionResources(sessionId: string): void;
}
