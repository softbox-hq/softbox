import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useSoftboxRuntime } from './adapter/runtime'
import type { LiveAppTheme } from './defaultState'
import './App.css'

type CalendarEvent = {
  id: number
  title: string
  date: string
  time: string
  category: 'Work' | 'Personal' | 'Health'
}

const categoryColors: Record<CalendarEvent['category'], string> = {
  Work: 'var(--tag-work)',
  Personal: 'var(--tag-personal)',
  Health: 'var(--tag-health)',
}

const today = new Date()
const seededEvents: CalendarEvent[] = [
  {
    id: 1,
    title: 'Design review',
    date: formatDateKey(today),
    time: '09:30',
    category: 'Work',
  },
  {
    id: 2,
    title: 'Gym session',
    date: formatDateKey(addDays(today, 1)),
    time: '18:00',
    category: 'Health',
  },
  {
    id: 3,
    title: 'Dinner with friends',
    date: formatDateKey(addDays(today, 3)),
    time: '19:30',
    category: 'Personal',
  },
]

function App() {
  const { initialState, publishState } = useSoftboxRuntime()
  const [currentMonth, setCurrentMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  )
  const [events, setEvents] = useState(seededEvents)
  const [selectedDate, setSelectedDate] = useState(
    initialState.ui.selectedDate ?? formatDateKey(today),
  )
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('09:00')
  const [category, setCategory] = useState<CalendarEvent['category']>('Work')
  const [theme, setTheme] = useState<LiveAppTheme>(() => {
    const nextTheme = initialState.ui.theme
    return nextTheme === 'dark' ? 'dark' : 'light'
  })

  const days = useMemo(() => buildMonthDays(currentMonth), [currentMonth])
  const selectedEvents = useMemo(
    () => events
      .filter((event) => event.date === selectedDate)
      .sort((a, b) => a.time.localeCompare(b.time)),
    [events, selectedDate],
  )

  const upcomingEvents = useMemo(
    () => [...events]
      .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
      .slice(0, 4),
    [events],
  )

  const monthLabel = currentMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const selectedDateLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(
    undefined,
    {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    },
  )

  function handleAddEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!title.trim()) {
      return
    }

    setEvents((current) => [
      ...current,
      {
        id: Date.now(),
        title: title.trim(),
        date: selectedDate,
        time,
        category,
      },
    ])
    setTitle('')
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    publishState({
      ...initialState,
      ui: {
        ...initialState.ui,
        selectedDate,
        theme,
      },
    })
  }, [initialState, publishState, selectedDate, theme])

  return (
    <main className="app-shell">
      <section className="calendar-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Calendar</p>
            <h1>{monthLabel}</h1>
            <p className="subtitle">A clean monthly view with the basics done right.</p>
          </div>
          <div className="topbar-actions">
            <div className="theme-toggle" role="group" aria-label="Theme">
              <button
                type="button"
                className={theme === 'light' ? 'toggle-button is-active' : 'toggle-button'}
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
              >
                Light
              </button>
              <button
                type="button"
                className={theme === 'dark' ? 'toggle-button is-active' : 'toggle-button'}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
              >
                Dark
              </button>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                setCurrentMonth(
                  new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
                )
              }
            >
              ← Prev
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
            >
              Today
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                setCurrentMonth(
                  new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
                )
              }
            >
              Next →
            </button>
          </div>
        </header>

        <div className="weekdays">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="calendar-grid">
          {days.map((day) => {
            const dateKey = formatDateKey(day.date)
            const dayEvents = events.filter((event) => event.date === dateKey)
            const isSelected = dateKey === selectedDate
            const isToday = dateKey === formatDateKey(today)

            return (
              <button
                key={dateKey}
                type="button"
                className={[
                  'day-card',
                  day.inCurrentMonth ? '' : 'is-muted',
                  isSelected ? 'is-selected' : '',
                  isToday ? 'is-today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedDate(dateKey)}
              >
                <span className="day-number">{day.date.getDate()}</span>
                <div className="day-events">
                  {dayEvents.slice(0, 2).map((event) => (
                    <span key={event.id} className="event-pill">
                      {event.time} {event.title}
                    </span>
                  ))}
                  {dayEvents.length > 2 ? (
                    <span className="more-events">+{dayEvents.length - 2} more</span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <aside className="sidebar">
        <section className="card">
          <p className="eyebrow">Selected day</p>
          <h2>{selectedDateLabel}</h2>
          <div className="agenda-list">
            {selectedEvents.length ? (
              selectedEvents.map((event) => (
                <article key={event.id} className="agenda-item">
                  <span
                    className="category-dot"
                    style={{ background: categoryColors[event.category] }}
                  />
                  <div>
                    <strong>{event.title}</strong>
                    <p>
                      {event.time} · {event.category}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <p className="empty-state">Nothing here yet. Add something below.</p>
            )}
          </div>
        </section>

        <section className="card">
          <p className="eyebrow">Quick add</p>
          <form className="event-form" onSubmit={handleAddEvent}>
            <label>
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Team sync"
              />
            </label>
            <div className="form-row">
              <label>
                Time
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
              <label>
                Category
                <select
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as CalendarEvent['category'])
                  }
                >
                  <option>Work</option>
                  <option>Personal</option>
                  <option>Health</option>
                </select>
              </label>
            </div>
            <button type="submit" className="primary-button">
              Add event
            </button>
          </form>
        </section>

        <section className="card">
          <p className="eyebrow">Upcoming</p>
          <div className="upcoming-list">
            {upcomingEvents.map((event) => (
              <div key={event.id} className="upcoming-item">
                <strong>{event.title}</strong>
                <p>
                  {new Date(`${event.date}T00:00:00`).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                  {' · '}
                  {event.time}
                </p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  )
}

function buildMonthDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const startOffset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - startOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)

    return {
      date,
      inCurrentMonth: date.getMonth() === month.getMonth(),
    }
  })
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export default App
