import { useEffect, useState } from 'react'
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
      </section>
    </main>
  )
}

export default App
