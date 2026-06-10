import { WebSocketServer } from "ws";
import { type Server } from "node:http";
import { type SessionManager } from "./session.js";
export declare function createCdpProxy(server: Server, sessionManager: SessionManager): WebSocketServer;
