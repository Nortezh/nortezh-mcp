// The slice of Swagger 2.0 that this repo's spec actually uses.
//
// Deliberately narrow: it describes what `nortezh-backend`'s generated swagger.json
// contains, not the whole 2.0 format. Every field here was confirmed present by scanning
// the real spec, so anything the generator meets is either typed below or an unexpected
// construct worth failing on.

/** A Swagger 2.0 schema fragment. Open-ended because vendor extensions ride along. */
export interface SwaggerSchema {
  $ref?: string
  type?: string
  format?: string
  description?: string
  properties?: Record<string, SwaggerSchema>
  required?: string[]
  items?: SwaggerSchema
  allOf?: SwaggerSchema[]
  additionalProperties?: SwaggerSchema | boolean
  enum?: unknown[]
  example?: unknown
  [extension: string]: unknown
}

export interface SwaggerParameter {
  name: string
  in: 'body' | 'query' | 'path' | 'header' | 'formData'
  description?: string
  required?: boolean
  schema?: SwaggerSchema
}

export interface SwaggerOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: SwaggerParameter[]
  /** Machine-readable error codes, added by the annotation work for exactly this use. */
  'x-error-codes'?: string[]
  'x-mcp-read-only'?: boolean
  'x-mcp-destructive'?: boolean
}

export interface SwaggerDocument {
  info?: { title?: string; version?: string }
  basePath?: string
  paths?: Record<string, Record<string, SwaggerOperation>>
  definitions?: Record<string, SwaggerSchema>
}

/** A JSON Schema fragment as handed to an MCP client. */
export type JsonSchema = Record<string, unknown>
