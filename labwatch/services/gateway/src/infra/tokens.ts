export const REDIS = Symbol('REDIS');
/** A second connection: a Redis client in subscribe mode cannot run normal commands. */
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');
export const DB = Symbol('DB');
