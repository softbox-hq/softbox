declare module 'sql.js' {
  export type SqlJsStatic = {
    Database: new () => {
      run(sql: string): void
      prepare(sql: string): {
        run(params?: Array<string | number>): void
        free(): void
      }
      exec(sql: string): Array<{
        values: unknown[][]
      }>
      close(): void
    }
  }

  type InitSqlJs = (options: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>

  const initSqlJs: InitSqlJs
  export default initSqlJs
}
