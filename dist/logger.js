const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };
function activeLevel() {
    const env = (process.env.ANVIL_LOG_LEVEL || "info").toLowerCase();
    return LEVEL_RANK[env] ?? LEVEL_RANK.info;
}
function emit(level, module, msg, fields) {
    if (LEVEL_RANK[level] < activeLevel())
        return;
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        module,
        msg,
        ...fields,
    });
    process.stderr.write(line + "\n");
}
export function createLogger(module) {
    return {
        debug: (msg, fields) => emit("debug", module, msg, fields),
        info: (msg, fields) => emit("info", module, msg, fields),
        warn: (msg, fields) => emit("warn", module, msg, fields),
        error: (msg, fields) => emit("error", module, msg, fields),
    };
}
