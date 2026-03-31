import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { getCustomers } from './customerDb'

type Customer = Awaited<ReturnType<typeof getCustomers>>[number]

function App() {
  const [customers, setCustomers] = useState<Customer[]>([])

  useEffect(() => {
    let alive = true

    getCustomers().then((rows) => {
      if (alive) setCustomers(rows)
    })

    return () => {
      alive = false
    }
  }, [])

  const costs = useMemo(
    () => customers.map((customer) => customer.acquisitionCost).sort((a, b) => a - b),
    [customers],
  )

  const averageCost = useMemo(() => {
    if (!costs.length) return 0
    return costs.reduce((sum, value) => sum + value, 0) / costs.length
  }, [costs])

  const medianCost = useMemo(() => {
    if (!costs.length) return 0
    const middle = Math.floor(costs.length / 2)
    return costs.length % 2 === 0 ? (costs[middle - 1] + costs[middle]) / 2 : costs[middle]
  }, [costs])

  const distribution = useMemo(() => {
    const bins = [0, 0, 0, 0]
    costs.forEach((cost) => {
      if (cost < 750) bins[0] += 1
      else if (cost < 1500) bins[1] += 1
      else if (cost < 2500) bins[2] += 1
      else bins[3] += 1
    })

    return bins.map((count, index) => ({
      label: ['<$750', '$750-$1.5k', '$1.5k-$2.5k', '$2.5k+'][index],
      count,
    }))
  }, [costs])

  return (
    <main className="screen">
      <section className="panel">
        <p className="eyebrow">SQLite database</p>
        <h1>Customers</h1>
        <p className="subtitle">Dummy data seeded inside the app.</p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Acquisition cost</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>{customer.email}</td>
                  <td>{customer.company}</td>
                  <td>{customer.plan}</td>
                  <td>{customer.status}</td>
                  <td>${customer.acquisitionCost.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="widgets">
          <article className="widget">
            <p className="widget__label">Average cost</p>
            <strong className="widget__value">${averageCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
          </article>

          <article className="widget">
            <p className="widget__label">Median cost</p>
            <strong className="widget__value">${medianCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
          </article>

          <article className="widget widget--chart">
            <p className="widget__label">Distribution</p>
            <div className="bars">
              {distribution.map((bucket) => (
                <div key={bucket.label} className="bars__row">
                  <span className="bars__label">{bucket.label}</span>
                  <div className="bars__track">
                    <div
                      className="bars__fill"
                      style={{ width: `${Math.max(bucket.count * 24, bucket.count ? 18 : 0)}%` }}
                    />
                  </div>
                  <span className="bars__count">{bucket.count}</span>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  )
}

export default App
