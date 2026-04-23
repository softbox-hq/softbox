import { useEffect, useMemo, useState } from 'react'
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import crmDbUrl from './assets/crm-demo.sqlite?url'
import './App.css'

type Summary = {
  totalCustomers: number
  openDeals: number
  pipelineValue: number
  overdueActivities: number
}

type CustomerRow = {
  id: number
  name: string
  company: string
  email: string
  owner: string
  status: string
  city: string
  lastContacted: string
}

type DealRow = {
  id: number
  customer: string
  title: string
  stage: string
  amount: number
  closeDate: string
  priority: string
}

type ActivityRow = {
  id: number
  customer: string
  kind: string
  summary: string
  dueAt: string
  completed: number
}

type DashboardData = {
  summary: Summary
  customers: CustomerRow[]
  deals: DealRow[]
  activities: ActivityRow[]
}

const DB_PATH = crmDbUrl
const TODAY = '2026-04-23 16:33'

function queryRows<T>(db: { exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }> }, sql: string) {
  const [result] = db.exec(sql)

  if (!result) {
    return [] as T[]
  }

  return result.values.map((row) =>
    Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
  ) as T[]
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      try {
        const SQL = await initSqlJs({
          locateFile: () => sqlWasmUrl,
        })
        const response = await fetch(DB_PATH)

        if (!response.ok) {
          throw new Error(`Failed to load ${DB_PATH}`)
        }

        const buffer = await response.arrayBuffer()
        const db = new SQL.Database(new Uint8Array(buffer))

        const summaryRow = queryRows<Summary>(
          db,
          `SELECT
             (SELECT COUNT(*) FROM customers) AS totalCustomers,
             (SELECT COUNT(*) FROM deals WHERE stage NOT IN ('Closed Won', 'Closed Lost')) AS openDeals,
             (SELECT COALESCE(SUM(amount), 0) FROM deals WHERE stage NOT IN ('Closed Won', 'Closed Lost')) AS pipelineValue,
             (SELECT COUNT(*) FROM activities WHERE completed = 0 AND due_at < '${TODAY}') AS overdueActivities`,
        )[0]

        const customers = queryRows<CustomerRow>(
          db,
          `SELECT id, name, company, email, owner, status, city, last_contacted AS lastContacted
           FROM customers
           ORDER BY created_at DESC`,
        )

        const deals = queryRows<DealRow>(
          db,
          `SELECT deals.id, customers.company AS customer, deals.title, deals.stage, deals.amount,
                  deals.close_date AS closeDate, deals.priority
           FROM deals
           JOIN customers ON customers.id = deals.customer_id
           ORDER BY deals.amount DESC`,
        )

        const activities = queryRows<ActivityRow>(
          db,
          `SELECT activities.id, customers.company AS customer, activities.kind, activities.summary,
                  activities.due_at AS dueAt, activities.completed
           FROM activities
           JOIN customers ON customers.id = activities.customer_id
           ORDER BY activities.due_at ASC`,
        )

        db.close()

        if (!cancelled) {
          setData({
            summary: summaryRow,
            customers,
            deals,
            activities,
          })
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      }
    }

    void loadDashboard()

    return () => {
      cancelled = true
    }
  }, [])

  const nextActivity = useMemo(
    () => data?.activities.find((activity) => activity.completed === 0) ?? null,
    [data],
  )

  if (error) {
    return (
      <main className="crm-shell">
        <section className="panel error-panel">
          <p className="eyebrow">SQLite CRM</p>
          <h1>Couldn’t open the demo database.</h1>
          <p>{error}</p>
        </section>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="crm-shell">
        <section className="panel loading-panel">
          <p className="eyebrow">SQLite CRM</p>
          <h1>Loading seeded database…</h1>
        </section>
      </main>
    )
  }

  return (
    <main className="crm-shell">
      <section className="hero-card panel">
        <div>
          <p className="eyebrow">SQLite CRM</p>
          <h1>Demo pipeline loaded from a real .sqlite file</h1>
          <p className="hero-copy">
            This dashboard reads <code>{DB_PATH}</code> in the browser and shows seeded
            customers, deals, and follow-up activity.
          </p>
        </div>
        {nextActivity ? (
          <div className="next-up card-highlight">
            <span className="mini-label">Next activity</span>
            <strong>{nextActivity.kind}</strong>
            <p>{nextActivity.summary}</p>
            <span>
              {nextActivity.customer} · {nextActivity.dueAt}
            </span>
          </div>
        ) : null}
      </section>

      <section className="stats-grid">
        <article className="panel stat-card">
          <span className="mini-label">Customers</span>
          <strong>{data.summary.totalCustomers}</strong>
          <p>Seeded contacts across 6 accounts</p>
        </article>
        <article className="panel stat-card">
          <span className="mini-label">Open deals</span>
          <strong>{data.summary.openDeals}</strong>
          <p>Active opportunities still in motion</p>
        </article>
        <article className="panel stat-card">
          <span className="mini-label">Pipeline value</span>
          <strong>{formatCurrency(data.summary.pipelineValue)}</strong>
          <p>Total value excluding closed business</p>
        </article>
        <article className="panel stat-card">
          <span className="mini-label">Overdue</span>
          <strong>{data.summary.overdueActivities}</strong>
          <p>Activities scheduled before {TODAY}</p>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel data-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Accounts</p>
              <h2>Customers</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>City</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name}</strong>
                      <span>{customer.email}</span>
                    </td>
                    <td>{customer.company}</td>
                    <td>
                      <span className="badge">{customer.status}</span>
                    </td>
                    <td>{customer.owner}</td>
                    <td>{customer.city}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel data-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Revenue</p>
              <h2>Deals</h2>
            </div>
          </div>
          <div className="deal-list">
            {data.deals.map((deal) => (
              <div key={deal.id} className="deal-item">
                <div>
                  <strong>{deal.title}</strong>
                  <p>
                    {deal.customer} · {deal.stage}
                  </p>
                </div>
                <div className="deal-meta">
                  <span>{formatCurrency(deal.amount)}</span>
                  <small>
                    {deal.priority} · {deal.closeDate}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel data-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Execution</p>
            <h2>Upcoming activity</h2>
          </div>
        </div>
        <div className="activity-list">
          {data.activities.map((activity) => (
            <div key={activity.id} className="activity-item">
              <div>
                <span className="badge subtle">{activity.kind}</span>
                <strong>{activity.summary}</strong>
                <p>{activity.customer}</p>
              </div>
              <div className="activity-meta">
                <span>{activity.dueAt}</span>
                <small>{activity.completed ? 'Done' : 'Open'}</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
