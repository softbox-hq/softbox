declare module 'sql.js' {
  type QueryExecResult = {
    columns: string[]
    values: unknown[][]
  }

  type Database = {
    exec(sql: string): QueryExecResult[]
    close(): void
  }

  type SqlJsStatic = {
    Database: new (data?: Uint8Array) => Database
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string
  }): Promise<SqlJsStatic>
}

declare module '*.sqlite?url' {
  const url: string
  export default url
}
