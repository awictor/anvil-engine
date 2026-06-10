export interface Config {
    port: number;
    host: string;
    apiKey: string;
    sessionTimeoutMs: number;
    rateLimitRpm: number;
    maxSessions: number;
    poolSize: number;
    webhookUrl: string;
    evaluateTimeoutMs: number;
    harMaxEntries: number;
}
export declare class ConfigError extends Error {
    problems: string[];
    constructor(problems: string[]);
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): Config;
