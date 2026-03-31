import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

type CustomerRow = {
  id: number
  name: string
  email: string
  company: string
  plan: string
  status: string
}

const customers: Omit<CustomerRow, 'id'>[] = [
  {
    name: 'Ava Carter',
    email: 'ava.carter@northstar.dev',
    company: 'Northstar Labs',
    plan: 'Pro',
    status: 'Active',
  },
  {
    name: 'Noah Patel',
    email: 'noah@parcelpilot.io',
    company: 'Parcel Pilot',
    plan: 'Starter',
    status: 'Trial',
  },
  {
    name: 'Maya Chen',
    email: 'maya@mintframe.com',
    company: 'Mintframe',
    plan: 'Business',
    status: 'Active',
  },
  {
    name: 'Leo Martins',
    email: 'leo@glowforge.studio',
    company: 'Glowforge Studio',
    plan: 'Enterprise',
    status: 'Paused',
  },
  {
    name: 'Sofia Novak',
    email: 'sofia@harborgrid.co',
    company: 'Harborgrid',
    plan: 'Pro',
    status: 'Active',
  },
]

let dbPromise: Promise<SqlJsStatic> | null = null

async function loadSqlJs() {
  dbPromise ??= initSqlJs({
    locateFile: (file: string) => (file === 'sql-wasm.wasm' ? wasmUrl : file),
  })

  return dbPromise
}

function createDatabase(SQL: SqlJsStatic) {
  const db = new SQL.Database()

  db.run(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `)

  const insert = db.prepare(
    'INSERT INTO customers (name, email, company, plan, status) VALUES (?, ?, ?, ?, ?)',
  )

  for (const customer of customers) {
    insert.run([customer.name, customer.email, customer.company, customer.plan, customer.status])
  }

  insert.free()

  return db
}

export async function getCustomers(): Promise<CustomerRow[]> {
  const SQL = await loadSqlJs()
  const db = createDatabase(SQL)

  try {
    const result = db.exec('SELECT * FROM customers ORDER BY id ASC')
    const rows = result[0]?.values ?? []

    return rows.map((row) => {
      const [id, name, email, company, plan, status] = row

      return {
        id: Number(id),
        name: String(name),
        email: String(email),
        company: String(company),
        plan: String(plan),
        status: String(status),
      }
    })
  } finally {
    db.close()
  }
}
