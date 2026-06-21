/** Connector/MCP sidebar detail now lives with the backend
 *  (server/data/connectorDetails.ts) and is served over the API. This shim
 *  re-exports it so the connector panel keeps resolving until that read migrates. */
export * from '../../server/data/connectorDetails.ts'
