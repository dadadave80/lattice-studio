/** Any JSON value. Problem params, command args and template examples use it (contracts §3.1). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A JSON object. */
export type JsonObject = { [key: string]: Json };
