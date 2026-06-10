export interface LogFields {
    requestId?: string;
    sessionId?: string;
    durationMs?: number;
    [key: string]: unknown;
}
export interface Logger {
    debug(msg: string, fields?: LogFields): void;
    info(msg: string, fields?: LogFields): void;
    warn(msg: string, fields?: LogFields): void;
    error(msg: string, fields?: LogFields): void;
}
export declare function createLogger(module: string): Logger;
