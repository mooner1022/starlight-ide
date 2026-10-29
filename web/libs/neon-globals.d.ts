// Web globals NeonJS gives StarLight scripts (it doesn't run in a browser, so there is no DOM).
// Loaded into the editor next to the ES2020 library.

interface Console {
    log(...data: any[]): void;
    info(...data: any[]): void;
    warn(...data: any[]): void;
    error(...data: any[]): void;
    debug(...data: any[]): void;
}
declare var console: Console;

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(id?: number): void;
declare function queueMicrotask(callback: () => void): void;

declare function atob(data: string): string;
declare function btoa(data: string): string;

interface Headers {
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callback: (value: string, key: string) => void): void;
}

interface RequestInit {
    method?: string;
    headers?: Record<string, string> | Headers;
    body?: string | ArrayBuffer | Uint8Array;
    signal?: AbortSignal;
}

interface Response {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly url: string;
    readonly headers: Headers;
    text(): Promise<string>;
    json(): Promise<any>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

declare function fetch(input: string, init?: RequestInit): Promise<Response>;

interface AbortSignal {
    readonly aborted: boolean;
}
declare class AbortController {
    readonly signal: AbortSignal;
    abort(reason?: any): void;
}

declare class URL {
    constructor(url: string, base?: string);
    href: string;
    protocol: string;
    host: string;
    hostname: string;
    port: string;
    pathname: string;
    search: string;
    hash: string;
    readonly searchParams: URLSearchParams;
    toString(): string;
}
declare class URLSearchParams {
    constructor(init?: string | Record<string, string>);
    get(name: string): string | null;
    getAll(name: string): string[];
    set(name: string, value: string): void;
    append(name: string, value: string): void;
    has(name: string): boolean;
    toString(): string;
}

declare class TextEncoder {
    encode(input?: string): Uint8Array;
}
declare class TextDecoder {
    constructor(label?: string);
    decode(input?: ArrayBuffer | Uint8Array): string;
}
