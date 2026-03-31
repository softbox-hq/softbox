import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

type CustomerRow = {
  id: number
  name: string
  email: string
  company: string
  plan: string
  status: string
  acquisitionCost: number
}

const customers: Omit<CustomerRow, 'id'>[] = [
  {
    name: 'Ava Carter',
    email: 'ava.carter@northstar.dev',
    company: 'Northstar Labs',
    plan: 'Pro',
    status: 'Active',
    acquisitionCost: 1240,
  },
  {
    name: 'Noah Patel',
    email: 'noah@parcelpilot.io',
    company: 'Parcel Pilot',
    plan: 'Starter',
    status: 'Trial',
    acquisitionCost: 420,
  },
  {
    name: 'Maya Chen',
    email: 'maya@mintframe.com',
    company: 'Mintframe',
    plan: 'Business',
    status: 'Active',
    acquisitionCost: 1890,
  },
  {
    name: 'Leo Martins',
    email: 'leo@glowforge.studio',
    company: 'Glowforge Studio',
    plan: 'Enterprise',
    status: 'Paused',
    acquisitionCost: 3120,
  },
  {
    name: 'Sofia Novak',
    email: 'sofia@harborgrid.co',
    company: 'Harborgrid',
    plan: 'Pro',
    status: 'Active',
    acquisitionCost: 970,
  },
]

let dbPromise: Promise<SqlJsStatic> | null = null

async function loadSqlJs() {
  if (!dbPromise) {
    dbPromise = fetch(wasmUrl)
      .then((response) => response.arrayBuffer())
      .then((wasmBinary) =>
        initSqlJs({
          wasmBinary,
        }),
      )
  }

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
      status TEXT NOT NULL,
      acquisition_cost INTEGER NOT NULL
    );
  `)

  const insert = db.prepare(
    'INSERT INTO customers (name, email, company, plan, status, acquisition_cost) VALUES (?, ?, ?, ?, ?, ?)',
  )

  for (const customer of customers) {
    insert.run([
      customer.name,
      customer.email,
      customer.company,
      customer.plan,
      customer.status,
      customer.acquisitionCost,
    ])
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
      const [id, name, email, company, plan, status, acquisitionCost] = row

      return {
        id: Number(id),
        name: String(name),
        email: String(email),
        company: String(company),
        plan: String(plan),
        status: String(status),
        acquisitionCost: Number(acquisitionCost),
      }
    })
  } finally {
    db.close()
  }
}
